package challenge

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/metrics"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
	"github.com/nordic-sys/helsa/backend/internal/sourcemerge"
)

// stepMetric is the only measurement the challenge is made of. The phone's
// challenge counts nothing else either — the milestones are step counts.
const stepMetric = "stepCount"

type Service struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

// Query is one request for the challenge.
type Query struct {
	Month Month
	Loc   *time.Location
	// Thresholds, when the caller sent its own row. nil means "resolve it" — see
	// resolveThresholds.
	Thresholds *Thresholds
	// Now exists so tests and the smoke suite can fix the clock; zero means now.
	Now time.Time
}

// Get reads what the challenge needs and computes it.
func (s *Service) Get(ctx context.Context, userID uuid.UUID, q Query) (api.ChallengeResponse, error) {
	now := q.Now
	if now.IsZero() {
		now = time.Now()
	}
	synced, err := s.phoneSettings(ctx, userID)
	if err != nil {
		return api.ChallengeResponse{}, err
	}
	thresholds, source, err := s.resolveThresholds(ctx, userID, q.Thresholds, synced)
	if err != nil {
		return api.ChallengeResponse{}, err
	}

	start, end := window(q.Month, q.Loc, now)
	daily, err := s.dailySteps(ctx, userID, q.Loc, start, end)
	if err != nil {
		return api.ChallengeResponse{}, err
	}
	return Compute(Input{
		Month:      q.Month,
		Thresholds: thresholds,
		Source:     source,
		Daily:      daily,
		RestDays:   synced.restDays,
		Now:        now,
		Loc:        q.Loc,
	}), nil
}

// syncedChallenge is what the phone has uploaded to /v1/settings (`challenge`).
type syncedChallenge struct {
	// present: the phone has sent the block at least once. False on a server
	// whose phone predates the upload — then nothing below means anything.
	present bool
	// thresholds: nil = the phone is on its factory row; empty = the user deleted
	// every milestone. The same distinction the column keeps.
	thresholds []int
	// restDays: the chosen rest-day keys, or nil when the phone has not sent the
	// block. A non-nil empty set is a real "I marked none", and it changes what
	// the response may claim (`missing_inputs`).
	restDays map[string]bool
}

// settingsQuery: the phone's challenge block (migration 00010). Raw SQL rather
// than the sqlc query because this package reads the pool directly, like the
// badge snapshot below.
const settingsQuery = `
SELECT challenge_thresholds, challenge_rest_days, challenge_at IS NOT NULL
FROM phone_settings WHERE user_id = $1`

func (s *Service) phoneSettings(ctx context.Context, userID uuid.UUID) (syncedChallenge, error) {
	var thresholds []int32
	var days []pgtype.Date
	var present bool
	err := s.pool.QueryRow(ctx, settingsQuery, pgconv.UUID(userID)).Scan(&thresholds, &days, &present)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return syncedChallenge{}, nil
	case err != nil:
		return syncedChallenge{}, fmt.Errorf("challenge settings: %w", err)
	case !present:
		// A row written for another block (water, journey) — the challenge one has
		// not arrived yet.
		return syncedChallenge{}, nil
	}
	out := syncedChallenge{present: true, restDays: make(map[string]bool, len(days))}
	if thresholds != nil {
		out.thresholds = make([]int, 0, len(thresholds))
		for _, v := range thresholds {
			out.thresholds = append(out.thresholds, int(v))
		}
	}
	for _, d := range days {
		if d.Valid {
			// The stored value is a calendar date, so its key is read in UTC: there is
			// no instant here to shift into the user's zone.
			out.restDays[d.Time.Format("2006-01-02")] = true
		}
	}
	return out, nil
}

// window is the span the day series has to cover: the month asked for, and the
// streak's lookback, which always ends today whichever month was asked for.
//
// One read rather than two. The two windows overlap completely in the ordinary
// case (the running month), and asking twice for the same days would be a second
// chance for the two answers to disagree while both were in flight.
func window(m Month, loc *time.Location, now time.Time) (start, end time.Time) {
	today := startOfDay(now, loc)
	start, end = today.AddDate(0, 0, -(LookbackDays-1)), today.AddDate(0, 0, 1)
	if first := m.FirstDay(loc); first.Before(start) {
		start = first
	}
	if last := m.EndExclusive(loc); last.After(end) {
		end = last
	}
	return start, end
}

// dailySteps reads one bucket per day, cut in the USER'S timezone, through the
// same source-merged aggregation /summary and the insight rules use
// (sourcemerge, docs/25 F9) — so the challenge cannot disagree with the
// dashboard about which steps belong to which day, nor count a walk once per app
// that recorded it.
func (s *Service) dailySteps(ctx context.Context, userID uuid.UUID, loc *time.Location,
	start, end time.Time) ([]DayTotal, error) {

	rows, err := s.pool.Query(ctx, sourcemerge.BucketQuery, pgconv.UUID(userID), []string{stepMetric},
		"1 day", loc.String(), pgconv.Timestamptz(start), pgconv.Timestamptz(end))
	if err != nil {
		return nil, fmt.Errorf("challenge daily steps: %w", err)
	}
	defer rows.Close()

	out := []DayTotal{}
	for rows.Next() {
		var dataType string
		var day pgtype.Timestamptz
		var steps, avg, mn, mx *float64
		if err := rows.Scan(&dataType, &day, &steps, &avg, &mn, &mx); err != nil {
			return nil, fmt.Errorf("scan daily row: %w", err)
		}
		if steps == nil {
			// An all-NULL day: no measurement, not a zero. It stays out of the list, and
			// the day then reports itself as a gap rather than as a day of sitting still.
			continue
		}
		// A step is a dimensionless count, so this is a no-op today — but the wire
		// scale is the metric catalog's business, not this package's (docs/23 §3.0.1).
		out = append(out, DayTotal{Day: DayKey(day.Time, loc), Steps: metrics.ToWire(stepMetric, *steps)})
	}
	return out, rows.Err()
}

// thresholdQuery: the newest threshold snapshot the phone has recorded.
//
// The fallback for a phone that predates the settings upload (settingsQuery is
// asked first). Such a phone never says what the milestones are — but every
// monthly badge carries the row that was IN FORCE when it was earned
// (`achievements.thresholds`, and the upsert refreshes that snapshot), so the
// most recently written badge is the most recent thing it has said about them.
// It is not a settings feed and it is not pretending to be one: the response
// says the milestones came from a badge, so a page can tell the reader as much.
//
// `updated_at` and not `earned_at`: we want the freshest STATEMENT, not the
// oldest month. A badge for 2025-10 written today knows today's milestones.
const thresholdQuery = `
SELECT thresholds
FROM achievements
WHERE user_id = $1 AND thresholds IS NOT NULL AND cardinality(thresholds) > 0
ORDER BY updated_at DESC, id
LIMIT 1`

// resolveThresholds picks the milestone row: what the caller sent, else what the
// phone uploaded as its settings, else what the phone last recorded on a badge,
// else the factory row.
//
// The uploaded settings come before the badge because they are the phone's
// answer to the very question asked, at its last sync; the badge snapshot is the
// row that was in force when some month was earned — a good guess, and only a
// guess, which is why it now comes second.
func (s *Service) resolveThresholds(ctx context.Context, userID uuid.UUID, given *Thresholds,
	synced syncedChallenge) (Thresholds, api.ChallengeResponseThresholdsSource, error) {

	if given != nil {
		return *given, api.ChallengeResponseThresholdsSourceRequest, nil
	}
	if synced.present {
		// ⚠️ nil and empty are different answers. nil: the phone is on its factory
		// row, so the factory row IS the user's row and is reported as `settings`,
		// not as `default` — the server is no longer guessing. Empty: the user
		// deleted every milestone, and that is respected rather than papered over
		// with the default (the phone does the same).
		if synced.thresholds == nil {
			return NewThresholds(DefaultThresholds), api.ChallengeResponseThresholdsSourceSettings, nil
		}
		return NewThresholds(synced.thresholds), api.ChallengeResponseThresholdsSourceSettings, nil
	}
	var stored []int32
	err := s.pool.QueryRow(ctx, thresholdQuery, pgconv.UUID(userID)).Scan(&stored)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return NewThresholds(DefaultThresholds), api.ChallengeResponseThresholdsSourceDefault, nil
	case err != nil:
		return Thresholds{}, "", fmt.Errorf("challenge thresholds: %w", err)
	}
	values := make([]int, 0, len(stored))
	for _, v := range stored {
		values = append(values, int(v))
	}
	th := NewThresholds(values)
	if len(th.Values) == 0 {
		// A snapshot that survives the cleanup as nothing is not a milestone row; it
		// would leave the reader with no goal and no explanation.
		return NewThresholds(DefaultThresholds), api.ChallengeResponseThresholdsSourceDefault, nil
	}
	return th, api.ChallengeResponseThresholdsSourceAchievement, nil
}
