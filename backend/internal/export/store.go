package export

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nordic-sys/helsa/backend/internal/pgconv"
)

// DBSource is the export's database source. It hands rows on one by one from a
// pgx cursor — which is why even a several-hundred-thousand-row export never
// piles up in memory.
type DBSource struct {
	pool *pgxpool.Pool
}

func NewDBSource(pool *pgxpool.Pool) *DBSource { return &DBSource{pool: pool} }

const samplesQuery = `
SELECT ts, data_type, value, unit, source_device, source_uuid
FROM samples
WHERE user_id = $1
  AND ts >= $2 AND ts < $3
  AND (cardinality($4::text[]) = 0 OR data_type = ANY($4::text[]))
ORDER BY ts, data_type, source_uuid`

func (s *DBSource) Samples(ctx context.Context, userID uuid.UUID, req Request, fn func(SampleRow) error) error {
	// An empty metric list means EVERYTHING — the question is the time span, not
	// the type.
	types := req.Metrics
	if types == nil {
		types = []string{}
	}
	rows, err := s.pool.Query(ctx, samplesQuery,
		pgconv.UUID(userID), pgconv.Timestamptz(req.Start), pgconv.Timestamptz(req.End), types)
	if err != nil {
		return fmt.Errorf("export samples: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			ts  pgtype.Timestamptz
			row SampleRow
		)
		if err := rows.Scan(&ts, &row.DataType, &row.Value, &row.Unit, &row.SourceDevice, &row.SourceUUID); err != nil {
			return fmt.Errorf("scan sample: %w", err)
		}
		row.Ts = ts.Time
		if err := fn(row); err != nil {
			return err
		}
	}
	return rows.Err()
}

const workoutsQuery = `
SELECT source_uuid, activity_type, started_at, ended_at, total_energy_kcal, total_distance_m
FROM workouts
WHERE user_id = $1 AND started_at >= $2 AND started_at < $3
ORDER BY started_at`

func (s *DBSource) Workouts(ctx context.Context, userID uuid.UUID, req Request, fn func(WorkoutRow) error) error {
	rows, err := s.pool.Query(ctx, workoutsQuery,
		pgconv.UUID(userID), pgconv.Timestamptz(req.Start), pgconv.Timestamptz(req.End))
	if err != nil {
		return fmt.Errorf("export workouts: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			started, ended pgtype.Timestamptz
			row            WorkoutRow
		)
		if err := rows.Scan(&row.SourceUUID, &row.ActivityType, &started, &ended,
			&row.TotalEnergyKcal, &row.TotalDistanceM); err != nil {
			return fmt.Errorf("scan workout: %w", err)
		}
		row.StartedAt = started.Time
		if ended.Valid {
			t := ended.Time
			row.EndedAt = &t
		}
		if err := fn(row); err != nil {
			return err
		}
	}
	return rows.Err()
}

const sleepQuery = `
SELECT started_at, ended_at, stage
FROM sleep_segments
WHERE user_id = $1 AND started_at >= $2 AND started_at < $3
ORDER BY started_at`

func (s *DBSource) Sleep(ctx context.Context, userID uuid.UUID, req Request, fn func(SleepRow) error) error {
	rows, err := s.pool.Query(ctx, sleepQuery,
		pgconv.UUID(userID), pgconv.Timestamptz(req.Start), pgconv.Timestamptz(req.End))
	if err != nil {
		return fmt.Errorf("export sleep: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var started, ended pgtype.Timestamptz
		var row SleepRow
		if err := rows.Scan(&started, &ended, &row.Stage); err != nil {
			return fmt.Errorf("scan sleep: %w", err)
		}
		row.StartedAt, row.EndedAt = started.Time, ended.Time
		if err := fn(row); err != nil {
			return err
		}
	}
	return rows.Err()
}
