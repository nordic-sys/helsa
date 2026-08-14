package insights

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/metrics"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
	"github.com/nordic-sys/helsa/backend/internal/sleep"
)

// LookbackDays: how many days back we read. It is the longest requirement among
// the rules — the correlation wants 60 days, the efficiency rule two 28-day
// windows, the deviation rule 28+3, and `baseline-drift` reaches back four
// months. `max` keeps that fact in the code rather than in a comment that would
// go stale the next time a window changes.
//
// ⚠️ A rule whose days never arrive looks EXACTLY like a rule with nothing to
// say: it returns nil either way, silently. That is why this is a `max` over the
// rules' own constants and not a literal — `baseline-drift` doubled it when it
// landed, and a stale number here would have starved it of its older window
// without a single failing test.
//
// The cost is real and worth naming: the daily read now covers 121 buckets rather
// than 61. It is one query per metric either way.
const LookbackDays = max(CorrelationDays, 2*EfficiencyWindowDays, BaselineDays+BaselineSkipDays,
	DriftOlderWindowStartDays, SleepDebtHistoryDays, SocialJetlagWindowDays)

// neededMetrics: these are the only ones we read. Running rules over all 120
// metrics would be cheap to declare and expensive to defend — behind every rule
// there has to be a reason why that particular threshold, and not another.
//
// ⚠️ This list and the rule tables are one contract: a rule that reads
// `in.Daily["respiratoryRate"]` while this list omits it is a rule that can never
// fire on the server, and it fails the same way as everything else here — in
// silence, with the phone showing five drifts and the dashboard three.
// TestEveryDriftMetricIsActuallyRead is what holds the two together.
var neededMetrics = []string{
	"restingHeartRate", "hrv", "stepCount",
	// Read for `baseline-drift` alone: no other rule asks for them, and a slow
	// shift in either is precisely the kind that no short window can see.
	"respiratoryRate", "bodyMass",
}

type Service struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

// Compute reads the daily series the rules need and runs them. With too little
// data it returns an empty list — that is not a failure, it is the right answer.
func (s *Service) Compute(ctx context.Context, userID uuid.UUID, loc *time.Location) ([]api.Insight, error) {
	now := time.Now()
	local := now.In(loc)
	today := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
	start := today.AddDate(0, 0, -LookbackDays)
	// We read today's (partial) day as well, but the rules themselves leave it out
	// — see the notes on the deviation/trend evaluators.
	end := today.AddDate(0, 0, 1)

	in := Input{Today: today, Daily: map[string]Series{}}
	for _, m := range neededMetrics {
		series, err := s.dailySeries(ctx, userID, m, loc, start, end)
		if err != nil {
			return nil, err
		}
		in.Daily[m] = series
	}
	hours, nights, err := s.sleep(ctx, userID, loc, start, end)
	if err != nil {
		return nil, err
	}
	in.SleepHours, in.SleepNights = hours, nights

	workouts, err := s.workouts(ctx, userID, loc, start, end)
	if err != nil {
		return nil, err
	}
	in.Workouts = workouts

	return Evaluate(in, now), nil
}

// dailyQuery: a daily bucket in the user's timezone (using Timescale's
// three-argument time_bucket), with sum AND avg — the caller picks according to
// the metric's aggregation.
const dailyQuery = `
SELECT time_bucket('1 day'::interval, ts, $3::text) AS day,
       sum(value) AS sum_value,
       avg(value) AS avg_value
FROM samples
WHERE user_id = $1 AND data_type = $2 AND ts >= $4 AND ts < $5
GROUP BY day
ORDER BY day`

func (s *Service) dailySeries(ctx context.Context, userID uuid.UUID, dataType string,
	loc *time.Location, start, end time.Time) (Series, error) {
	rows, err := s.pool.Query(ctx, dailyQuery, pgconv.UUID(userID), dataType, loc.String(),
		pgconv.Timestamptz(start), pgconv.Timestamptz(end))
	if err != nil {
		return nil, fmt.Errorf("insights daily series (%s): %w", dataType, err)
	}
	defer rows.Close()

	useSum := metrics.Meta(dataType).Agg == metrics.Sum
	out := Series{}
	for rows.Next() {
		var day pgtype.Timestamptz
		var sum, avg *float64
		if err := rows.Scan(&day, &sum, &avg); err != nil {
			return nil, fmt.Errorf("scan daily row: %w", err)
		}
		v := avg
		if useSum {
			v = sum
		}
		if v == nil {
			continue // an all-NULL day: no measurement, not a zero
		}
		// The rule thresholds (e.g. 2 bpm) are meant on the wire scale, so we convert
		// here too — otherwise the threshold of a percentage metric would be off by a
		// factor of 100.
		out = append(out, Point{Day: day.Time.In(loc), Value: metrics.ToWire(dataType, *v)})
	}
	return out, rows.Err()
}

// sleepQuery: the RAW segments of the window, with the night they belong to.
//
// A night is keyed by the day of "start minus 12 hours": that way a segment
// starting at 23:30 and one starting at 02:00 land in the SAME night. Grouping
// by calendar day cuts the night in half at midnight — which did happen in
// production (the web ended up showing 23 hours 59 minutes of "time in bed").
//
// ⚠️ The duration is deliberately NOT summed in SQL. The segments overlap each
// other (two sources describe the same night, and `inBed` wraps all of it), so
// `sum(ended_at - started_at)` reports about one and a half times the sleep that
// was recorded. The union is computed by internal/sleep, from the same segments
// the phone sees — see the package comment there.
//
// Every stage is read, not just the `asleep*` ones: `awake` overrides the sleep
// underneath it, `inBed` marks out the night's envelope, and the stage names
// come in two spellings which only internal/sleep.Normalize can tell apart.
const sleepQuery = `
SELECT (date_trunc('day', (started_at AT TIME ZONE $2::text) - interval '12 hours'))::date AS night,
       started_at, ended_at, stage
FROM sleep_segments
WHERE user_id = $1
  AND started_at >= $3 AND started_at < $4
ORDER BY night, started_at`

// sleep returns both views of the nights: the duration series the older rules
// use, and the periods the timing rules need.
//
// The two come from ONE pass on purpose. They are different measurements (the
// union of the sleep stages vs falling asleep → waking, which differ whenever
// you wake in the night), but they must agree on what a night is; two passes
// would be two chances for that definition to drift apart.
func (s *Service) sleep(ctx context.Context, userID uuid.UUID, loc *time.Location,
	start, end time.Time) (Series, []SleepNight, error) {
	rows, err := s.pool.Query(ctx, sleepQuery, pgconv.UUID(userID), loc.String(),
		pgconv.Timestamptz(start), pgconv.Timestamptz(end))
	if err != nil {
		return nil, nil, fmt.Errorf("insights sleep series: %w", err)
	}
	defer rows.Close()

	// The rows arrive ordered by night, so one night's segments are collected and
	// resolved before the next one starts.
	var (
		hours    = Series{}
		nights   = []SleepNight{}
		unknown  = map[string]bool{}
		pending  []sleep.Raw
		pendingD time.Time
		havePend bool
	)
	flush := func() {
		if !havePend {
			return
		}
		if night, ok := resolveNight(pending, loc, unknown); ok {
			hours = append(hours, Point{Day: pendingD, Value: night.Hours})
			// A night whose sleep has no two ends has no midpoint either. That is a
			// missing measurement, not a midnight one, so it stays out of the timing
			// rules while its duration still counts.
			if !night.Start.IsZero() && !night.End.IsZero() {
				nights = append(nights, SleepNight{Day: pendingD, Start: night.Start, End: night.End})
			}
		}
		pending, havePend = nil, false
	}

	for rows.Next() {
		var night pgtype.Date
		var startedAt, endedAt pgtype.Timestamptz
		var stage string
		if err := rows.Scan(&night, &startedAt, &endedAt, &stage); err != nil {
			return nil, nil, fmt.Errorf("scan sleep row: %w", err)
		}
		if !startedAt.Valid || !endedAt.Valid {
			continue
		}
		d := night.Time
		day := time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, loc)
		if havePend && !day.Equal(pendingD) {
			flush()
		}
		pendingD, havePend = day, true
		pending = append(pending, sleep.Raw{Start: startedAt.Time, End: endedAt.Time, Stage: stage})
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	flush()

	if len(unknown) > 0 {
		// Not silent data loss: a stage we cannot place is time missing from the
		// night, and that has to be visible somewhere.
		slog.Warn("sleep segments with an unrecognized stage were left out",
			"user", userID, "stages", keys(unknown))
	}
	return hours, nights, nil
}

// nightTotals: one night resolved — the union of its sleep, and the two ends of
// that sleep.
type nightTotals struct {
	Hours      float64
	Start, End time.Time
}

// resolveNight flattens one night's overlapping segments and measures it. The
// second return value is false for a night that holds no sleep at all (only
// `awake`/`inBed`): that is a missing measurement, and a zero-hour night in the
// series would drag every average down as if it were a sleepless one.
func resolveNight(rows []sleep.Raw, loc *time.Location,
	unknown map[string]bool) (nightTotals, bool) {
	spans, unrecognized := sleep.Spans(rows)
	for _, u := range unrecognized {
		unknown[u] = true
	}
	slices, _ := sleep.Resolve(spans)
	night := sleep.Night{Slices: slices}

	asleep := night.Asleep()
	if asleep <= 0 {
		return nightTotals{}, false
	}
	out := nightTotals{Hours: asleep.Hours()}
	if onset, ok := night.Onset(); ok {
		out.Start = onset.In(loc)
	}
	if wake, ok := night.Wake(); ok {
		out.End = wake.In(loc)
	}
	return out, true
}

func keys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// workoutQuery: the finished sessions, with the average heart rate LEFT JOIN-ed
// from the linked `heartRate` samples — the same join the /v1/workouts read path
// uses (internal/workouts), so both see the same number.
//
// `ended_at IS NOT NULL` is a data-minimum condition, not tidiness: a session
// still in progress has no duration, and the load rule would count it as zero
// minutes of training.
const workoutQuery = `
SELECT w.started_at, w.ended_at, w.activity_type, w.total_energy_kcal, w.total_distance_m, hr.avg_hr
FROM workouts w
LEFT JOIN (
    SELECT s.workout_id, avg(s.value) AS avg_hr
    FROM samples s
    WHERE s.user_id = $1 AND s.data_type = 'heartRate' AND s.workout_id IS NOT NULL
    GROUP BY s.workout_id
) hr ON hr.workout_id = w.id
WHERE w.user_id = $1 AND w.ended_at IS NOT NULL
  AND w.started_at >= $2 AND w.started_at < $3
ORDER BY w.started_at`

func (s *Service) workouts(ctx context.Context, userID uuid.UUID, loc *time.Location,
	start, end time.Time) ([]Workout, error) {
	rows, err := s.pool.Query(ctx, workoutQuery, pgconv.UUID(userID),
		pgconv.Timestamptz(start), pgconv.Timestamptz(end))
	if err != nil {
		return nil, fmt.Errorf("insights workouts: %w", err)
	}
	defer rows.Close()

	out := []Workout{}
	for rows.Next() {
		var startedAt, endedAt pgtype.Timestamptz
		var activityType string
		var kcal, distance, avgHR *float64
		if err := rows.Scan(&startedAt, &endedAt, &activityType, &kcal, &distance, &avgHR); err != nil {
			return nil, fmt.Errorf("scan workout row: %w", err)
		}
		if !startedAt.Valid || !endedAt.Valid {
			continue
		}
		local := startedAt.Time.In(loc)
		out = append(out, Workout{
			Day:          time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc),
			ActivityType: activityType,
			Duration:     endedAt.Time.Sub(startedAt.Time),
			EnergyKcal:   kcal,
			DistanceM:    distance,
			AvgHeartRate: avgHR,
		})
	}
	return out, rows.Err()
}
