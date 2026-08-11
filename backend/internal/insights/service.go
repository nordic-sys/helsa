package insights

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/metrics"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
)

// LookbackDays: how many days back we read. The longest requirement among the
// rules is the correlation (60 days); the deviation rule needs 28+3 days.
const LookbackDays = CorrelationDays

// neededMetrics: these are the only ones we read. Running rules over all 120
// metrics would be cheap to declare and expensive to defend — behind every rule
// there has to be a reason why that particular threshold, and not another.
var neededMetrics = []string{"restingHeartRate", "hrv", "stepCount"}

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
	sleep, err := s.sleepHours(ctx, userID, loc, start, end)
	if err != nil {
		return nil, err
	}
	in.SleepHours = sleep

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

// sleepQuery: ACTUAL sleep per night (the sum of the `asleep*` segments) in
// hours.
//
// A night is keyed by the day of "start minus 12 hours": that way a segment
// starting at 23:30 and one starting at 02:00 land in the SAME night. Grouping
// by calendar day cuts the night in half at midnight — which did happen in
// production (the web ended up showing 23 hours 59 minutes of "time in bed").
const sleepQuery = `
SELECT (date_trunc('day', (started_at AT TIME ZONE $2::text) - interval '12 hours'))::date AS night,
       sum(extract(epoch FROM (ended_at - started_at))) / 3600.0 AS hours
FROM sleep_segments
WHERE user_id = $1
  AND stage IN ('asleepCore', 'asleepDeep', 'asleepREM')
  AND started_at >= $3 AND started_at < $4
GROUP BY night
ORDER BY night`

func (s *Service) sleepHours(ctx context.Context, userID uuid.UUID, loc *time.Location,
	start, end time.Time) (Series, error) {
	rows, err := s.pool.Query(ctx, sleepQuery, pgconv.UUID(userID), loc.String(),
		pgconv.Timestamptz(start), pgconv.Timestamptz(end))
	if err != nil {
		return nil, fmt.Errorf("insights sleep series: %w", err)
	}
	defer rows.Close()

	out := Series{}
	for rows.Next() {
		var night pgtype.Date
		var hours *float64
		if err := rows.Scan(&night, &hours); err != nil {
			return nil, fmt.Errorf("scan sleep row: %w", err)
		}
		if hours == nil {
			continue
		}
		d := night.Time
		out = append(out, Point{
			Day:   time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, loc),
			Value: *hours,
		})
	}
	return out, rows.Err()
}
