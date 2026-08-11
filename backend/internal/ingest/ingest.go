// Package ingest is the write path for HealthKit batches: validation and the
// queue-message format (API side), plus the transactional, idempotent database
// write (worker side).
//
// The API answers 202 quickly and publishes; the worker consumes and writes.
// See docs/05 §4.
package ingest

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/db"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
	"github.com/nordic-sys/helsa/backend/internal/summary"
)

// Payload limits (behind the 413). Local dev MVP values.
const (
	MaxSamples = 50000
	MaxItems   = 50000
)

// Message is the envelope that goes on the queue: the authenticated user_id
// plus the batch.
type Message struct {
	UserID uuid.UUID       `json:"user_id"`
	Batch  api.IngestBatch `json:"batch"`
}

// Validate checks the batch size (400/413 in the API).
func Validate(b *api.IngestBatch) error {
	// Route points count as items too: the track of a single long hike is bigger
	// than an entire helping of samples, which is why the contract requires the
	// client to count them against its chunk budget (see routePoints).
	n := count(b.Samples) + count(b.Workouts) + routePoints(b.Workouts) +
		count(b.SleepSegments) + count(b.ActivitySummaries) + count(b.Deletions)
	if n == 0 {
		return fmt.Errorf("empty batch")
	}
	if count(b.Samples) > MaxSamples {
		return fmt.Errorf("too many samples (max %d)", MaxSamples)
	}
	if n > MaxItems {
		return fmt.Errorf("batch too large (max %d items)", MaxItems)
	}
	return nil
}

// Process decodes the message and writes it out in a single transaction. It is
// idempotent (ON CONFLICT DO NOTHING), so a retry or a duplicate does not
// duplicate rows. After the commit it invalidates the user's summary cache
// (docs/05 §5), so fresh data shows up immediately.
func Process(ctx context.Context, pool *pgxpool.Pool, rdb *redis.Client, body []byte) error {
	var msg Message
	if err := json.Unmarshal(body, &msg); err != nil {
		return fmt.Errorf("decode message: %w", err)
	}
	uid := pgconv.UUID(msg.UserID)

	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint: a no-op after a successful Commit
	q := db.New(pool).WithTx(tx)
	b := msg.Batch

	// ⚠️ ORDER MATTERS: workouts first, samples only after them.
	//
	// Alongside a sample the client sends the HealthKit HKWorkout.uuid
	// (workout_source_uuid); it cannot know the server-side workouts.id.
	// InsertSample resolves that with a subquery — which only finds a match if the
	// workout is ALREADY stored. If it arrived in the same chunk, this ordering is
	// enough; if it came in an earlier chunk, it is in the database. The reverse
	// case (the workout arrives LATER than its samples) is closed by the
	// LinkSamplesToWorkouts backfill.
	if b.Workouts != nil {
		srcUUIDs := make([]string, 0, len(*b.Workouts))
		for _, w := range *b.Workouts {
			p, err := workoutParams(uid, w)
			if err != nil {
				return err
			}
			if err := q.UpsertWorkout(ctx, p); err != nil {
				return fmt.Errorf("upsert workout %s: %w", w.SourceUuid, err)
			}
			// The route goes AFTER its own workout: the points hang off the
			// server-side workouts.id, which can only be resolved from the stored
			// workout row.
			if err := writeRoute(ctx, tx, q, uid, w); err != nil {
				return err
			}
			srcUUIDs = append(srcUUIDs, w.SourceUuid)
		}
		// Backfill: wire up the samples orphaned by earlier chunks.
		if len(srcUUIDs) > 0 {
			if err := q.LinkSamplesToWorkouts(ctx, db.LinkSamplesToWorkoutsParams{
				UserID:      uid,
				SourceUuids: srcUUIDs,
			}); err != nil {
				return fmt.Errorf("link samples to workouts: %w", err)
			}
		}
	}
	if b.Samples != nil {
		for _, s := range *b.Samples {
			if err := q.InsertSample(ctx, sampleParams(uid, s)); err != nil {
				return fmt.Errorf("insert sample %s: %w", s.SourceUuid, err)
			}
		}
	}
	if b.SleepSegments != nil {
		for _, sl := range *b.SleepSegments {
			if err := q.UpsertSleepSegment(ctx, sleepParams(uid, sl)); err != nil {
				return fmt.Errorf("upsert sleep %s: %w", sl.SourceUuid, err)
			}
		}
	}
	if b.ActivitySummaries != nil {
		for _, a := range *b.ActivitySummaries {
			if err := q.UpsertActivitySummary(ctx, activityParams(uid, a)); err != nil {
				return fmt.Errorf("upsert activity: %w", err)
			}
		}
	}
	if b.Deletions != nil && len(*b.Deletions) > 0 {
		ids := *b.Deletions
		if err := q.DeleteSamplesByUUID(ctx, db.DeleteSamplesByUUIDParams{UserID: uid, SourceUuids: ids}); err != nil {
			return fmt.Errorf("delete samples: %w", err)
		}
		if err := q.DeleteWorkoutsByUUID(ctx, db.DeleteWorkoutsByUUIDParams{UserID: uid, SourceUuids: ids}); err != nil {
			return fmt.Errorf("delete workouts: %w", err)
		}
		if err := q.DeleteSleepByUUID(ctx, db.DeleteSleepByUUIDParams{UserID: uid, SourceUuids: ids}); err != nil {
			return fmt.Errorf("delete sleep: %w", err)
		}
	}

	// The device's "sign of life": the arriving data IS the heartbeat, no separate
	// POST /devices is needed. This is what the sync-freshness alert watches
	// (docs/16 §2). For an unknown device_id the UPDATE touches zero rows — that is
	// not an error, the batch is still valid.
	if b.DeviceId != nil {
		if err := q.TouchDevice(ctx, db.TouchDeviceParams{
			ID:       pgconv.UUID(*b.DeviceId),
			UserID:   uid,
			TimeZone: b.TimeZone,
		}); err != nil {
			return fmt.Errorf("touch device: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	// Cache busting: the fresh data makes the user's range keys stale.
	if rdb != nil {
		_ = summary.InvalidateUser(ctx, rdb, msg.UserID)
	}
	return nil
}

func sampleParams(uid pgtype.UUID, s api.SampleIn) db.InsertSampleParams {
	p := db.InsertSampleParams{
		UserID:            uid,
		Ts:                pgconv.Timestamptz(s.Ts),
		DataType:          string(s.DataType),
		Value:             f32ptr(s.Value),
		Unit:              s.Unit,
		SourceUuid:        s.SourceUuid,
		SourceBundle:      s.SourceBundle,
		WorkoutSourceUuid: s.WorkoutSourceUuid,
	}
	if s.SourceDevice != nil {
		v := string(*s.SourceDevice)
		p.SourceDevice = &v
	}
	return p
}

func workoutParams(uid pgtype.UUID, w api.WorkoutIn) (db.UpsertWorkoutParams, error) {
	var meta []byte
	if w.Metadata != nil {
		var err error
		meta, err = json.Marshal(*w.Metadata)
		if err != nil {
			return db.UpsertWorkoutParams{}, fmt.Errorf("workout metadata: %w", err)
		}
	}
	p := db.UpsertWorkoutParams{
		UserID:          uid,
		SourceUuid:      w.SourceUuid,
		ActivityType:    w.ActivityType,
		StartedAt:       pgconv.Timestamptz(w.StartedAt),
		TotalEnergyKcal: f32ptr(w.TotalEnergyKcal),
		TotalDistanceM:  f32ptr(w.TotalDistanceM),
		Metadata:        meta,
	}
	if w.EndedAt != nil {
		p.EndedAt = pgconv.Timestamptz(*w.EndedAt)
	}
	return p, nil
}

func sleepParams(uid pgtype.UUID, sl api.SleepSegmentIn) db.UpsertSleepSegmentParams {
	return db.UpsertSleepSegmentParams{
		UserID:     uid,
		SourceUuid: sl.SourceUuid,
		StartedAt:  pgconv.Timestamptz(sl.StartedAt),
		EndedAt:    pgconv.Timestamptz(sl.EndedAt),
		Stage:      string(sl.Stage),
	}
}

func activityParams(uid pgtype.UUID, a api.ActivitySummary) db.UpsertActivitySummaryParams {
	p := db.UpsertActivitySummaryParams{
		UserID:           uid,
		ActiveEnergy:     f32ptr(a.ActiveEnergy),
		ActiveEnergyGoal: f32ptr(a.ActiveEnergyGoal),
		ExerciseMinutes:  f32ptr(a.ExerciseMinutes),
		ExerciseGoal:     f32ptr(a.ExerciseGoal),
		StandHours:       f32ptr(a.StandHours),
		StandGoal:        f32ptr(a.StandGoal),
	}
	if a.Day != nil {
		p.Day = pgconv.Date(a.Day.Time)
	}
	return p
}

// f32ptr lifts the OpenAPI *float32 to *float64 (the DB column is double precision).
func f32ptr(v *float32) *float64 {
	if v == nil {
		return nil
	}
	f := float64(*v)
	return &f
}

func count[T any](s *[]T) int {
	if s == nil {
		return 0
	}
	return len(*s)
}
