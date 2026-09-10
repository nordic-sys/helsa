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
	thresholds, source, err := s.resolveThresholds(ctx, userID, q.Thresholds)
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
		Now:        now,
		Loc:        q.Loc,
	}), nil
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

// dailyQuery: one bucket per day, cut in the USER'S timezone with Timescale's
// three-argument time_bucket — the same way /summary and the insight rules cut
// theirs, so the challenge cannot disagree with the dashboard about which steps
// belong to which day.
const dailyQuery = `
SELECT time_bucket('1 day'::interval, ts, $2::text) AS day,
       sum(value) AS steps
FROM samples
WHERE user_id = $1 AND data_type = '` + stepMetric + `' AND ts >= $3 AND ts < $4
GROUP BY day
ORDER BY day`

func (s *Service) dailySteps(ctx context.Context, userID uuid.UUID, loc *time.Location,
	start, end time.Time) ([]DayTotal, error) {

	rows, err := s.pool.Query(ctx, dailyQuery, pgconv.UUID(userID), loc.String(),
		pgconv.Timestamptz(start), pgconv.Timestamptz(end))
	if err != nil {
		return nil, fmt.Errorf("challenge daily steps: %w", err)
	}
	defer rows.Close()

	out := []DayTotal{}
	for rows.Next() {
		var day pgtype.Timestamptz
		var steps *float64
		if err := rows.Scan(&day, &steps); err != nil {
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
// The milestones are the user's, they are editable, and they live on the phone —
// nothing syncs them. But every monthly badge carries the row that was IN FORCE
// when it was earned (`achievements.thresholds`, and the upsert refreshes that
// snapshot), so the most recently written badge is the most recent thing the
// phone has said about them. It is not a settings feed and it is not pretending
// to be one: the response says the milestones came from a badge, so a page can
// tell the reader as much.
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
// phone last recorded, else the factory row.
func (s *Service) resolveThresholds(ctx context.Context, userID uuid.UUID, given *Thresholds) (
	Thresholds, api.ChallengeResponseThresholdsSource, error) {

	if given != nil {
		return *given, api.ChallengeResponseThresholdsSourceRequest, nil
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
