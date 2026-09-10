// Package coverage answers the completeness question behind GET /v1/coverage:
// **which of my measurements are actually arriving, and who writes them.**
//
// The feature exists because of a specific, repeated failure: a metric can go
// silent without a single error message. Nothing throws, nothing turns red, the
// dashboards keep drawing — and a series that used to arrive every day simply
// stops. Read as a chart, that looks like "you did nothing".
//
// # What this can honestly say, and what it must not
//
// ⚠️ **The server sees strictly less than the phone does, and the difference is
// the whole point.** The app's completeness screen (`Coverage/MetricCoverage.swift`)
// has five states, and four of them are statements about PERMISSIONS: the read
// ran and nothing came (`empty`), the system will still ask about this group
// (`notRequested`), HealthKit rejected this type in the last sync (`refused`),
// there is no HealthKit here at all (`unavailable`). None of that reaches the
// server. A type that was never granted and a type with no sensor behind it
// arrive here identically: as an absence.
//
// So this package never borrows those words. It says what it can actually stand
// behind — whether anything reached THIS SERVER, in the window, ever, from whom —
// in three states of its own (`stateMeasured`, `stateOutsideWindow`,
// `stateNeverArrived`). Where the server cannot distinguish something, the answer
// is a narrower word, not the app's word with a weaker meaning. Wearing the
// phone's vocabulary here would turn a feature about honesty into one that
// misleads.
//
// The one thing the server computes exactly as the phone does is the rhythm and
// the silence that breaks it — see gap.go.
//
// # Hand-written pgx, and no cache
//
// Hand-written for the same reason as `summary`: the day boundaries have to be
// cut in the user's time zone (`ts AT TIME ZONE $tz`), which sqlc cannot type.
//
// Deliberately NOT cached, unlike `/summary`. A completeness report that is sixty
// seconds stale can tell you nothing has arrived for a type whose sample landed
// fifty seconds ago — and "nothing is arriving" is the single most alarming
// sentence this endpoint can produce. The three queries below cost a few hundred
// milliseconds on a year of a real user's data; that is the cheaper side of the
// trade.
package coverage

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/metrics"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
)

// The three states, as plain strings.
//
// ⚠️ Deliberately not the generated `api.CoverageTypeState` constants: those are
// named after the enum VALUES (`Measured`, `NeverArrived`), and oapi-codegen
// renames them the moment another schema introduces a colliding value. Keeping
// our own names means a regeneration can never silently repoint one of these.
const (
	stateMeasured      = "measured"
	stateOutsideWindow = "outside_window"
	stateNeverArrived  = "never_arrived"
)

// Request is one completeness question: a half-open [From, ToExcl) window, cut in
// TZ.
type Request struct {
	From   time.Time
	ToExcl time.Time
	TZ     string
}

type Service struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// observation is everything we managed to learn about one data type. It is the
// hand-off point between the three queries and the pure row builder, which is
// what the tests exercise.
type observation struct {
	// days are the distinct days of the window a sample arrived on, in the user's
	// zone, as civil dates.
	days []time.Time
	// samples is the number of samples within the window.
	samples int
	// everLastDay is the day of the most recent sample REGARDLESS of the window —
	// zero if this type has never arrived. It is what separates "stopped before the
	// window" from "never got here".
	everLastDay time.Time
	sources     []api.CoverageSource
}

// Compute assembles the completeness report.
func (s *Service) Compute(ctx context.Context, userID uuid.UUID, req Request) (api.CoverageResponse, error) {
	if !req.ToExcl.After(req.From) {
		return api.CoverageResponse{}, fmt.Errorf("empty window: %s .. %s", req.From, req.ToExcl)
	}
	obs := map[string]*observation{}

	if err := s.readDays(ctx, userID, req, obs); err != nil {
		return api.CoverageResponse{}, err
	}
	if err := s.readEverSeen(ctx, userID, req.TZ, obs); err != nil {
		return api.CoverageResponse{}, err
	}
	if err := s.readSources(ctx, userID, req, obs); err != nil {
		return api.CoverageResponse{}, err
	}

	lastDay := civil(req.ToExcl.AddDate(0, 0, -1))
	rows := build(obs, lastDay)

	from := openapi_types.Date{Time: req.From}
	to := openapi_types.Date{Time: req.ToExcl.AddDate(0, 0, -1)}
	days := daysBetween(civil(req.From), lastDay) + 1
	tz := req.TZ
	return api.CoverageResponse{From: &from, To: &to, Tz: &tz, Days: &days, Types: &rows}, nil
}

// build turns the observations into the report's rows — **a pure function**, and
// this is what the tests pin down.
//
// The catalog comes first, in its own order, so that an untouched area is visible
// as a block of empty rows rather than as a hole in a list of the things that
// happen to work. Types that arrived without being in the catalog follow.
func build(obs map[string]*observation, lastDay time.Time) []api.CoverageType {
	known := metrics.Ordered()
	rows := make([]api.CoverageType, 0, len(known)+len(obs))

	inCatalog := make(map[string]struct{}, len(known))
	for _, dataType := range known {
		inCatalog[dataType] = struct{}{}
		rows = append(rows, row(dataType, true, obs[dataType], lastDay))
	}

	// `data_type` is an open string on purpose: a type from a newer iOS release is
	// stored rather than dropped. Leaving it out of a COMPLETENESS report of all
	// places would be the exact bug this feature exists to prevent — so it is listed,
	// and flagged as something the catalog does not know.
	var extra []string
	for dataType := range obs {
		if _, ok := inCatalog[dataType]; !ok {
			extra = append(extra, dataType)
		}
	}
	sort.Strings(extra)
	for _, dataType := range extra {
		rows = append(rows, row(dataType, false, obs[dataType], lastDay))
	}
	return rows
}

func row(dataType string, known bool, o *observation, lastDay time.Time) api.CoverageType {
	name, group, in := dataType, api.CoverageTypeGroup(metrics.GroupOf(dataType)), known
	out := api.CoverageType{DataType: &name, Group: &group, InCatalog: &in}

	state := stateNeverArrived
	if o != nil && !o.everLastDay.IsZero() {
		state = stateOutsideWindow
		day := openapi_types.Date{Time: o.everLastDay}
		out.LastDay = &day
	}

	if o != nil && len(o.days) > 0 {
		state = stateMeasured
		// ⚠️ These three are filled in ONLY on this branch, and that is the rule the
		// whole feature stands on: a missing measurement is not a zero. "0 days
		// measured" is a claim that we looked and found nothing on every single day;
		// an absent field says we have nothing to report. In a health app those are
		// different sentences, and the alarming one must not be produced by accident.
		measuredDays, samples := len(o.days), o.samples
		out.MeasuredDays = &measuredDays
		out.SampleCount = &samples
		if len(o.sources) > 0 {
			sources := o.sources
			out.Sources = &sources
		}
		if g, ok := gapOf(o.days, lastDay); ok {
			out.Gap = &api.CoverageGap{
				SilentDays:          &g.silentDays,
				TypicalIntervalDays: floatPtr(g.cadence.typicalIntervalDays),
				ObservedIntervals:   &g.cadence.observedIntervals,
				HistoryDays:         &g.cadence.historyDays,
			}
		}
	}

	s := api.CoverageTypeState(state)
	out.State = &s
	return out
}

// --- the three reads ---

// readDays: which day of the window did each type arrive on, and how many samples
// came. The day grid is what the cadence is derived from, so it is read as days
// and not as a count.
func (s *Service) readDays(ctx context.Context, userID uuid.UUID, req Request, obs map[string]*observation) error {
	rows, err := s.pool.Query(ctx, daysQuery,
		pgconv.UUID(userID), pgconv.Timestamptz(req.From), pgconv.Timestamptz(req.ToExcl), req.TZ)
	if err != nil {
		return fmt.Errorf("coverage day grid: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var dataType string
		var day time.Time
		var count int
		if err := rows.Scan(&dataType, &day, &count); err != nil {
			return fmt.Errorf("coverage day grid scan: %w", err)
		}
		o := at(obs, dataType)
		o.days = append(o.days, civil(day))
		o.samples += count
	}
	return rows.Err()
}

// readEverSeen: the most recent arrival of each type without a window filter.
//
// This is the query that buys the `outside_window` state — the difference between
// "you stopped weighing yourself last spring" and "this has never got here". The
// first has a date the user recognises; the second has nothing to say.
func (s *Service) readEverSeen(ctx context.Context, userID uuid.UUID, tz string, obs map[string]*observation) error {
	rows, err := s.pool.Query(ctx, everQuery, pgconv.UUID(userID), tz)
	if err != nil {
		return fmt.Errorf("coverage last arrival: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var dataType string
		var day time.Time
		if err := rows.Scan(&dataType, &day); err != nil {
			return fmt.Errorf("coverage last arrival scan: %w", err)
		}
		at(obs, dataType).everLastDay = civil(day)
	}
	return rows.Err()
}

// readSources: who wrote it.
//
// ⚠️ This is a much thinner fact than the app's provenance screen, and the
// reason is written down in `Provenance/SampleProvenance.swift`: the upload path
// keeps a bundle identifier and a coarse watch/iphone guess per sample, and
// nothing else. Manufacturer, model, firmware, the writing app's version, and the
// fact that a sample carried no device at all do not survive the wire. A NULL
// device here therefore means "the client did not say" — never "the phone
// measured it", which is the easiest wrong sentence to write in this area and
// would be false for exactly the imported samples where hardware matters most.
func (s *Service) readSources(ctx context.Context, userID uuid.UUID, req Request, obs map[string]*observation) error {
	rows, err := s.pool.Query(ctx, sourcesQuery,
		pgconv.UUID(userID), pgconv.Timestamptz(req.From), pgconv.Timestamptz(req.ToExcl), req.TZ)
	if err != nil {
		return fmt.Errorf("coverage sources: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var dataType string
		var bundle, device *string
		var count int
		var day time.Time
		if err := rows.Scan(&dataType, &bundle, &device, &count, &day); err != nil {
			return fmt.Errorf("coverage sources scan: %w", err)
		}
		src := api.CoverageSource{BundleId: bundle, SampleCount: &count}
		if device != nil {
			d := api.CoverageSourceDevice(*device)
			src.Device = &d
		}
		last := openapi_types.Date{Time: civil(day)}
		src.LastDay = &last
		o := at(obs, dataType)
		o.sources = append(o.sources, src)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, o := range obs {
		sortSources(o.sources)
	}
	return nil
}

// sortSources puts the biggest contributor first. The tie-break is the bundle
// identifier and not the arrival order, so that two equally busy sources do not
// swap places between two reloads of the same page.
func sortSources(sources []api.CoverageSource) {
	sort.SliceStable(sources, func(i, j int) bool {
		a, b := sources[i], sources[j]
		if intOf(a.SampleCount) != intOf(b.SampleCount) {
			return intOf(a.SampleCount) > intOf(b.SampleCount)
		}
		return stringOf(a.BundleId) < stringOf(b.BundleId)
	})
}

func at(obs map[string]*observation, dataType string) *observation {
	o := obs[dataType]
	if o == nil {
		o = &observation{}
		obs[dataType] = o
	}
	return o
}

func floatPtr(v float64) *float32 {
	f := float32(v)
	return &f
}

func intOf(v *int) int {
	if v == nil {
		return 0
	}
	return *v
}

func stringOf(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

// The day boundaries are cut in the user's zone, exactly as in `summary`: "which
// days did my steps arrive on" is a question about local midnights, not UTC ones.
const daysQuery = `
SELECT data_type,
       (ts AT TIME ZONE $4::text)::date AS day,
       count(*)::int
FROM samples
WHERE user_id = $1
  AND ts >= $2 AND ts < $3
GROUP BY data_type, day
ORDER BY data_type, day`

const everQuery = `
SELECT data_type,
       (max(ts) AT TIME ZONE $2::text)::date
FROM samples
WHERE user_id = $1
GROUP BY data_type`

const sourcesQuery = `
SELECT data_type,
       source_bundle,
       source_device,
       count(*)::int,
       (max(ts) AT TIME ZONE $4::text)::date
FROM samples
WHERE user_id = $1
  AND ts >= $2 AND ts < $3
GROUP BY data_type, source_bundle, source_device`
