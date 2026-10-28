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
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/db"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
	"github.com/nordic-sys/helsa/backend/internal/summary"
	"github.com/nordic-sys/helsa/backend/internal/tenant"
)

// Payload limits (behind the 413). Local dev MVP values.
const (
	MaxSamples = 50000
	MaxItems   = 50000
	// MaxRoutePoints is the GPS-point budget of one batch, apart from MaxItems.
	//
	// ⚠️ Route points used to count against MaxItems, and the first real phone to sync hit it at
	// once (2026-10-27, helsa docs/34): the client fetches up to 20 workouts per chunk and assumes
	// ~100 points each, while an hour of running is ~3,600 — twenty real workouts are 60–70k
	// points, every one of them refused. A point is a small row; what bounds a batch is the bytes:
	// ~140–190 a point in JSON, under the proxy's 32 MB body limit and RabbitMQ's message cap
	// (raised to 64 MiB in deploy/rabbitmq/10-helsa.conf — the 16 MiB default is too small).
	MaxRoutePoints = 200000
)

// Message is the envelope that goes on the queue: the authenticated user_id
// plus the batch.
//
// BatchID is the id the 202 response handed the client. It rides along so the
// worker's "batch processed" line carries the same id, which is the whole point
// of giving the client one. A message queued by an older API has none (uuid.Nil).
type Message struct {
	UserID  uuid.UUID       `json:"user_id"`
	BatchID uuid.UUID       `json:"batch_id"`
	Batch   api.IngestBatch `json:"batch"`
}

// Tally counts what a batch holds, per kind — what the 202 response reports as
// `received`. Route points are not a kind of their own: they travel inside their
// workout, and they count against MaxItems (see Validate) but not here.
func Tally(b *api.IngestBatch) Counts {
	return Counts{
		Samples:           count(b.Samples),
		Workouts:          count(b.Workouts),
		SleepSegments:     count(b.SleepSegments),
		ActivitySummaries: count(b.ActivitySummaries),
		Deletions:         count(b.Deletions),
	}
}

// ErrTooLarge marks a batch over the size limit. The API answers it with 413 rather than 400,
// because the two ask different things of the client: a 400 says the batch is wrong and
// resending it will not help, a 413 says "halve it and send it again" — the contract and the
// client's chunking both rest on that distinction (`docs/34`: it used to come back as a 400).
var ErrTooLarge = errors.New("batch too large")

// Validate checks the batch size (400/413 in the API).
func Validate(b *api.IngestBatch) error {
	// Route points have their own budget (MaxRoutePoints) rather than counting against MaxItems.
	n := count(b.Samples) + count(b.Workouts) +
		count(b.SleepSegments) + count(b.ActivitySummaries) + count(b.Deletions)
	if n == 0 {
		return fmt.Errorf("empty batch")
	}
	if p := routePoints(b.Workouts); p > MaxRoutePoints {
		return fmt.Errorf("%w: too many route points (%d, max %d)", ErrTooLarge, p, MaxRoutePoints)
	}
	if count(b.Samples) > MaxSamples {
		return fmt.Errorf("%w: too many samples (max %d)", ErrTooLarge, MaxSamples)
	}
	if n > MaxItems {
		return fmt.Errorf("%w (max %d items)", ErrTooLarge, MaxItems)
	}
	return nil
}

// Process decodes the message and writes it out in a single transaction. It is
// idempotent (ON CONFLICT DO NOTHING), so a retry or a duplicate does not
// duplicate rows. After the commit it invalidates the user's summary cache
// (docs/05 §5), so fresh data shows up immediately.
// Counts is what one batch turned out to contain.
//
// ⚠️ It exists because the documentation promised per-batch counts in the worker log
// and the worker logged only the byte length. Somebody debugging a sync at midnight was
// told to look for lines that did not exist — which is worse than silence, because it
// sends them looking for the fault in the wrong place.
//
// These are ITEMS RECEIVED, not rows changed. The inserts are upserts, so a chunk
// replayed after a failed acknowledgement reports the same numbers and writes nothing
// new; the log says what arrived, and the database decides what that means. Reporting
// "duplicates skipped" would need a rows-affected count the queries do not return, and
// a number invented to fill a column is the thing this project does not do.
type Counts struct {
	Workouts, Samples, SleepSegments, ActivitySummaries, Deletions int

	// BatchID is copied from the message, not counted: it is here so the worker's
	// log line can name the batch the client was told about in its 202.
	BatchID uuid.UUID
	// UserID is whose batch it is — copied from the message, so that a failure
	// record can be shown to its owner and to nobody else (docs/36 §1.2/1).
	UserID uuid.UUID
}

// Items is the batch's size as the status page counts it: every kind added up.
// Route points travel inside their workout and are not counted separately.
func (c Counts) Items() int {
	return c.Samples + c.Workouts + c.SleepSegments + c.ActivitySummaries + c.Deletions
}

// Peek reads what a queued message says about itself — its batch id and what
// the batch holds — without writing anything. The worker uses it to describe a
// batch it is dead-lettering: Process may have failed half-way, and its counts
// are then what it got through, not what the batch held. A message that does
// not decode gives zero counts and uuid.Nil.
func Peek(body []byte) Counts {
	var msg Message
	if err := json.Unmarshal(body, &msg); err != nil {
		return Counts{}
	}
	c := Tally(&msg.Batch)
	c.BatchID = msg.BatchID
	c.UserID = msg.UserID
	return c
}

func Process(ctx context.Context, pool *pgxpool.Pool, rdb *redis.Client, body []byte) (Counts, error) {
	var counts Counts
	var msg Message
	if err := json.Unmarshal(body, &msg); err != nil {
		return counts, fmt.Errorf("decode message: %w", err)
	}
	counts.BatchID = msg.BatchID
	uid := pgconv.UUID(msg.UserID)
	// Everything this batch touches is its user's: the pool sets helsa.user_id from
	// this before handing out the connection (internal/store).
	ctx = tenant.With(ctx, msg.UserID)

	tx, err := pool.Begin(ctx)
	if err != nil {
		return counts, fmt.Errorf("begin tx: %w", err)
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
				return counts, err
			}
			if err := q.UpsertWorkout(ctx, p); err != nil {
				return counts, fmt.Errorf("upsert workout %s: %w", w.SourceUuid, err)
			}
			// The route goes AFTER its own workout: the points hang off the
			// server-side workouts.id, which can only be resolved from the stored
			// workout row.
			if err := writeRoute(ctx, tx, q, uid, w); err != nil {
				return counts, err
			}
			srcUUIDs = append(srcUUIDs, w.SourceUuid)
			counts.Workouts++
		}
		// Backfill: wire up the samples orphaned by earlier chunks.
		if len(srcUUIDs) > 0 {
			if err := q.LinkSamplesToWorkouts(ctx, db.LinkSamplesToWorkoutsParams{
				UserID:      uid,
				SourceUuids: srcUUIDs,
			}); err != nil {
				return counts, fmt.Errorf("link samples to workouts: %w", err)
			}
		}
	}
	if b.Samples != nil {
		for _, s := range *b.Samples {
			if err := q.InsertSample(ctx, sampleParams(uid, s)); err != nil {
				return counts, fmt.Errorf("insert sample %s: %w", s.SourceUuid, err)
			}
			counts.Samples++
		}
	}
	if b.SleepSegments != nil {
		for _, sl := range *b.SleepSegments {
			if err := q.UpsertSleepSegment(ctx, sleepParams(uid, sl)); err != nil {
				return counts, fmt.Errorf("upsert sleep %s: %w", sl.SourceUuid, err)
			}
			counts.SleepSegments++
		}
	}
	if b.ActivitySummaries != nil {
		for _, a := range *b.ActivitySummaries {
			if err := q.UpsertActivitySummary(ctx, activityParams(uid, a)); err != nil {
				return counts, fmt.Errorf("upsert activity: %w", err)
			}
			counts.ActivitySummaries++
		}
	}
	if b.Deletions != nil && len(*b.Deletions) > 0 {
		ids := *b.Deletions
		counts.Deletions = len(ids)
		if err := deleteSamples(ctx, tx, q, uid, ids); err != nil {
			return counts, err
		}
		if err := q.DeleteWorkoutsByUUID(ctx, db.DeleteWorkoutsByUUIDParams{UserID: uid, SourceUuids: ids}); err != nil {
			return counts, fmt.Errorf("delete workouts: %w", err)
		}
		if err := q.DeleteSleepByUUID(ctx, db.DeleteSleepByUUIDParams{UserID: uid, SourceUuids: ids}); err != nil {
			return counts, fmt.Errorf("delete sleep: %w", err)
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
			return counts, fmt.Errorf("touch device: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return counts, fmt.Errorf("commit: %w", err)
	}
	// Cache busting: the fresh data makes the user's range keys stale.
	if rdb != nil {
		_ = summary.InvalidateUser(ctx, rdb, msg.UserID)
	}
	return counts, nil
}

// deleteSamples removes samples by HealthKit UUID without decompressing the
// user's whole history (see LocateSamplesByUUID for the failure this avoids).
//
// The decompression limit is lifted for this transaction only: with the type and
// the span named, the work is bounded by what is actually being deleted, and a
// phone that deleted a source app's years of data is a legitimate large delete —
// it must not dead-letter because of a guard meant for unbounded statements.
func deleteSamples(ctx context.Context, tx pgx.Tx, q *db.Queries, uid pgtype.UUID, ids []string) error {
	spans, err := q.LocateSamplesByUUID(ctx, db.LocateSamplesByUUIDParams{UserID: uid, SourceUuids: ids})
	if err != nil {
		return fmt.Errorf("locate samples to delete: %w", err)
	}
	if len(spans) == 0 {
		return nil
	}
	if _, err := tx.Exec(ctx, `SET LOCAL timescaledb.max_tuples_decompressed_per_dml_transaction = 0`); err != nil {
		return fmt.Errorf("lift the decompression limit: %w", err)
	}
	for _, s := range spans {
		if err := q.DeleteSamplesByUUIDInSpan(ctx, db.DeleteSamplesByUUIDInSpanParams{
			UserID: uid, DataType: s.DataType, FromTs: s.FromTs, ToTs: s.ToTs, SourceUuids: ids,
		}); err != nil {
			return fmt.Errorf("delete samples (%s): %w", s.DataType, err)
		}
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
