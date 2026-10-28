// Package deletion runs the member-deletion jobs (docs/36 §4.6; the review §9
// C20–C21): everything of one member removed from the live server, in stages that
// survive a crash.
//
// The API only disables the member and queues the job (deletion_jobs); the worker
// does the rest, here, one stage at a time, recording each before the next:
//
//	queued     → rows:       DELETE the user; every foreign key cascades. Measured
//	                          at 86 ms for half a million compressed samples
//	                          (§4.8.9) — Timescale drops whole compressed batches.
//	rows       → aggregates: the hourly aggregate is no foreign key and keeps the
//	                          member's old buckets; purge_deleted_user_aggregates
//	                          (00016) removes them.
//	aggregates → cache:      the summary cache in Redis.
//	cache      → mqtt:       the member's retained Home Assistant topics, through
//	                          a hook the publisher provides (none when it is off).
//	mqtt       → queue:      the member's batches stuck in the dead-letter queue.
//	                          Batches still in the main queue are dropped by the
//	                          ingest itself (internal/ingest: no such user).
//	queue      → done.
//
// Every stage is idempotent: run twice, it finds nothing the second time. A failed
// stage is retried on the next pass, with its error kept on the job.
package deletion

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/nordic-sys/helsa/backend/internal/db"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
	"github.com/nordic-sys/helsa/backend/internal/queue"
	"github.com/nordic-sys/helsa/backend/internal/summary"
)

// Runner holds what the stages need. MQTT may be nil (the publisher is off).
type Runner struct {
	Pool  *pgxpool.Pool // the worker's (helsa_worker: BYPASSRLS)
	Redis *redis.Client
	Queue *queue.Queue
	// MQTT clears a member's retained topics and discovery documents.
	MQTT func(ctx context.Context, userID uuid.UUID, handle string) error
	Log  *slog.Logger
}

var order = []string{"queued", "rows", "aggregates", "cache", "mqtt", "queue", "done"}

func next(stage string) string {
	for i, s := range order {
		if s == stage && i+1 < len(order) {
			return order[i+1]
		}
	}
	return "done"
}

// Loop runs pending jobs every interval until ctx ends.
func (r *Runner) Loop(ctx context.Context, interval time.Duration) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		for {
			worked, err := r.RunOne(ctx)
			if err != nil {
				r.Log.Warn("member deletion", "err", err)
			}
			if !worked || err != nil {
				break
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// RunOne advances one open job by every stage it can, and reports whether there
// was one.
func (r *Runner) RunOne(ctx context.Context) (bool, error) {
	q := db.New(r.Pool)
	var job db.DeletionJob
	err := pgx.BeginFunc(ctx, r.Pool, func(tx pgx.Tx) error {
		var err error
		job, err = q.WithTx(tx).NextDeletionJob(ctx)
		return err
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	user := pgconv.ToUUID(job.UserID)
	stage := job.Stage
	for stage != "done" {
		if err := r.stage(ctx, stage, user, job.Handle); err != nil {
			_ = q.FailDeletionJob(ctx, db.FailDeletionJobParams{ID: job.ID, LastError: ptr(fmt.Sprintf("%s: %v", stage, err))})
			return true, fmt.Errorf("job %s, stage %s: %w", pgconv.ToUUID(job.ID), stage, err)
		}
		stage = next(stage)
		if err := q.AdvanceDeletionJob(ctx, db.AdvanceDeletionJobParams{ID: job.ID, Stage: stage}); err != nil {
			return true, err
		}
	}
	r.Log.Info("member deleted", "user_id", user, "handle", job.Handle)
	return true, nil
}

func (r *Runner) stage(ctx context.Context, stage string, user uuid.UUID, handle string) error {
	switch stage {
	case "queued":
		return nil
	case "rows":
		return pgx.BeginFunc(ctx, r.Pool, func(tx pgx.Tx) error {
			// The cascade reaches compressed chunks; lift the per-transaction
			// decompression limit for this one statement's transaction.
			if _, err := tx.Exec(ctx, "SET LOCAL timescaledb.max_tuples_decompressed_per_dml_transaction = 0"); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, "DELETE FROM users WHERE id = $1", user)
			return err
		})
	case "aggregates":
		_, err := db.New(r.Pool).PurgeDeletedUserAggregates(ctx, pgconv.UUID(user))
		return err
	case "cache":
		return summary.InvalidateUser(ctx, r.Redis, user)
	case "mqtt":
		if r.MQTT == nil {
			return nil
		}
		return r.MQTT(ctx, user, handle)
	case "queue":
		if r.Queue == nil {
			return nil
		}
		n, err := r.Queue.PurgeDeadLetters(ctx, func(body []byte) bool {
			var m struct {
				UserID uuid.UUID `json:"user_id"`
			}
			return json.Unmarshal(body, &m) == nil && m.UserID == user
		})
		if n > 0 {
			r.Log.Info("member deletion: dead-lettered batches removed", "user_id", user, "batches", n)
		}
		return err
	}
	return fmt.Errorf("unknown stage %q", stage)
}

func ptr[T any](v T) *T { return &v }
