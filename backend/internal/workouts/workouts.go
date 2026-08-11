// Package workouts serves the read path of /v1/workouts (+ /{id}) with
// HAND-WRITTEN pgx.
//
// Why not sqlc? (1) Keyset pagination by (started_at, id) DESC; (2) the avg/max
// heart rate comes from the linked heartRate samples via a LEFT JOIN, and sqlc
// does not type its nullability correctly (NULL needs *float64). The same
// principle as in summary: whatever sqlc cannot type, we write by hand.
package workouts

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
)

const (
	DefaultLimit = 50
	MaxLimit     = 200
)

type Service struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// The workout columns plus the LEFT JOIN-ed heartRate avg/max. The caller
// appends the WHERE clause.
const baseSelect = `
SELECT w.id, w.source_uuid, w.activity_type, w.started_at, w.ended_at,
       w.total_energy_kcal, w.total_distance_m, w.metadata,
       hr.avg_hr, hr.max_hr
FROM workouts w
LEFT JOIN (
    SELECT s.user_id, s.workout_id, avg(s.value) AS avg_hr, max(s.value) AS max_hr
    FROM samples s
    WHERE s.data_type = 'heartRate' AND s.workout_id IS NOT NULL
    GROUP BY s.user_id, s.workout_id
) hr ON hr.user_id = w.user_id AND hr.workout_id = w.id`

// List returns one keyset-paginated page of workouts. An empty cursor means the
// first page.
func (s *Service) List(ctx context.Context, userID uuid.UUID, cursor string, limit int) (api.WorkoutPage, error) {
	if limit <= 0 {
		limit = DefaultLimit
	}
	if limit > MaxLimit {
		limit = MaxLimit
	}
	beforeTs, beforeID, err := decodeCursor(cursor)
	if err != nil {
		return api.WorkoutPage{}, fmt.Errorf("malformed cursor: %w", err)
	}

	q := baseSelect + `
WHERE w.user_id = $1
  AND (w.started_at < $2 OR (w.started_at = $2 AND w.id < $3))
ORDER BY w.started_at DESC, w.id DESC
LIMIT $4`
	// limit+1: this is what decides whether there is another page.
	rows, err := s.pool.Query(ctx, q, pgconv.UUID(userID), pgconv.Timestamptz(beforeTs), pgconv.UUID(beforeID), limit+1)
	if err != nil {
		return api.WorkoutPage{}, fmt.Errorf("workouts query: %w", err)
	}
	defer rows.Close()

	items := []api.Workout{}
	var lastTs time.Time
	var lastID uuid.UUID
	for rows.Next() {
		w, ts, id, err := scanWorkout(rows)
		if err != nil {
			return api.WorkoutPage{}, err
		}
		items = append(items, w)
		lastTs, lastID = ts, id
	}
	if err := rows.Err(); err != nil {
		return api.WorkoutPage{}, err
	}

	page := api.WorkoutPage{}
	if len(items) > limit {
		items = items[:limit]
		// the next cursor points at the last row we KEPT
		lastTs = *items[len(items)-1].StartedAt
		lastID = uuid.UUID(*items[len(items)-1].Id)
		next := encodeCursor(lastTs, lastID)
		page.NextCursor = &next
	}
	page.Items = &items
	return page, nil
}

// Get returns a single one of the user's workouts; (nil, nil) if there is none.
func (s *Service) Get(ctx context.Context, userID, id uuid.UUID) (*api.Workout, error) {
	q := baseSelect + `
WHERE w.user_id = $1 AND w.id = $2`
	rows, err := s.pool.Query(ctx, q, pgconv.UUID(userID), pgconv.UUID(id))
	if err != nil {
		return nil, fmt.Errorf("workout query: %w", err)
	}
	defer rows.Close()
	if !rows.Next() {
		return nil, nil
	}
	w, _, _, err := scanWorkout(rows)
	if err != nil {
		return nil, err
	}
	return &w, nil
}

// scanWorkout turns one row into an api.Workout, and also returns the keyset key.
func scanWorkout(rows pgx.Rows) (api.Workout, time.Time, uuid.UUID, error) {
	var (
		id                   pgtype.UUID
		sourceUUID           string
		activityType         string
		startedAt, endedAt   pgtype.Timestamptz
		totalEnergy, totalKm *float64
		metadata             []byte
		avgHR, maxHR         *float64
	)
	if err := rows.Scan(&id, &sourceUUID, &activityType, &startedAt, &endedAt,
		&totalEnergy, &totalKm, &metadata, &avgHR, &maxHR); err != nil {
		return api.Workout{}, time.Time{}, uuid.Nil, fmt.Errorf("scan workout: %w", err)
	}
	gid := pgconv.ToUUID(id)
	oid := openapi_types.UUID(gid)
	w := api.Workout{
		Id:              &oid,
		SourceUuid:      &sourceUUID,
		ActivityType:    &activityType,
		TotalEnergyKcal: f64to32(totalEnergy),
		TotalDistanceM:  f64to32(totalKm),
		AvgHeartRate:    f64to32(avgHR),
		MaxHeartRate:    f64to32(maxHR),
	}
	if startedAt.Valid {
		t := startedAt.Time
		w.StartedAt = &t
	}
	if endedAt.Valid {
		t := endedAt.Time
		w.EndedAt = &t
	}
	if len(metadata) > 0 {
		var m map[string]any
		if json.Unmarshal(metadata, &m) == nil {
			w.Metadata = &m
		}
	}
	return w, startedAt.Time, gid, nil
}

// --- cursor: base64url(RFC3339Nano "|" uuid) ---

func encodeCursor(ts time.Time, id uuid.UUID) string {
	raw := ts.UTC().Format(time.RFC3339Nano) + "|" + id.String()
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

// decodeCursor returns an "infinity" sentinel for an empty cursor (on the first
// page every row is < sentinel).
func decodeCursor(cursor string) (time.Time, uuid.UUID, error) {
	if cursor == "" {
		// maximum timestamp + maximum uuid → every real row is "earlier"
		return time.Date(9999, 12, 31, 23, 59, 59, 0, time.UTC), maxUUID(), nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return time.Time{}, uuid.Nil, err
	}
	parts := strings.SplitN(string(raw), "|", 2)
	if len(parts) != 2 {
		return time.Time{}, uuid.Nil, fmt.Errorf("bad cursor format")
	}
	ts, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return time.Time{}, uuid.Nil, err
	}
	id, err := uuid.Parse(parts[1])
	if err != nil {
		return time.Time{}, uuid.Nil, err
	}
	return ts, id, nil
}

func maxUUID() uuid.UUID {
	var u uuid.UUID
	for i := range u {
		u[i] = 0xFF
	}
	return u
}

func f64to32(v *float64) *float32 {
	if v == nil {
		return nil
	}
	f := float32(*v)
	return &f
}
