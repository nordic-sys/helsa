// cmd/worker is the queue-consuming ingestion worker: it takes batches off
// RabbitMQ and writes them idempotently into TimescaleDB. A separate process,
// so that an ingestion spike does not slow down the read API (docs/05 §2, §4).
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/nordic-sys/helsa/backend/internal/config"
	"github.com/nordic-sys/helsa/backend/internal/hass"
	"github.com/nordic-sys/helsa/backend/internal/ingest"
	"github.com/nordic-sys/helsa/backend/internal/ingeststat"
	"github.com/nordic-sys/helsa/backend/internal/queue"
	"github.com/nordic-sys/helsa/backend/internal/startup"
	"github.com/nordic-sys/helsa/backend/internal/store"
)

// prefetch is how many unacknowledged batches the broker hands this worker at
// once. The status endpoint multiplies it by the consumer count for its in-flight
// bound, which is why it is a named value rather than a literal in the call.
const prefetch = 8

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	cfg, err := config.Load()
	if err != nil {
		log.Error("config", "err", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// After a host reboot the databases may still be starting — see internal/startup.
	st, err := startup.Wait(ctx, log, "postgres+redis", startup.Budget, func(ctx context.Context) (*store.Store, error) {
		return store.Open(ctx, cfg)
	})
	if err != nil {
		log.Error("store open", "err", err)
		os.Exit(1)
	}
	defer st.Close()

	q, err := startup.Wait(ctx, log, "rabbitmq", startup.Budget, func(context.Context) (*queue.Queue, error) {
		return queue.Open(cfg.RabbitMQURL, cfg.IngestQueue)
	})
	if err != nil {
		log.Error("queue open", "err", err)
		os.Exit(1)
	}
	defer q.Close()

	// The Home Assistant publisher shares the worker's lifetime. It is OFF unless
	// HELSA_MQTT_URL is set, and a broker that is unreachable costs it a log line,
	// not the process: ingestion must not depend on home automation being up.
	hp := hass.New(st.DB, log, cfg.MQTT)
	hassDone := make(chan struct{})
	go func() {
		defer close(hassDone)
		if err := hp.Run(ctx); err != nil {
			log.Error("home assistant publisher", "err", err)
		}
	}()

	// The tally behind GET /v1/ingest/status (internal/ingeststat): counts only, in
	// Redis. A failure to record is a log line, never a failed batch.
	stats := ingeststat.NewRecorder(st.Redis, cfg.IngestQueue)
	if err := stats.Start(ctx, prefetch); err != nil {
		log.Warn("ingest stats: start", "err", err)
	}
	record := func(ctx context.Context, items int, ok bool) {
		if err := stats.Done(ctx, items, ok); err != nil {
			log.Warn("ingest stats: record", "err", err)
		}
	}
	// A dead-lettered batch is also written down with its reason, so the status page
	// can say why and the owner can decide whether a redrive could help. The record
	// describes the batch from the message (ingest.Peek), not from Process's counts,
	// which stop where the failure did. The error is sanitised inside the recorder.
	deadLettered := func(ctx context.Context, body []byte, redriven int, cause error) {
		c := ingest.Peek(body)
		f := ingeststat.Failure{
			BatchID: c.BatchID, UserID: c.UserID, Redriven: redriven,
			Samples: c.Samples, Workouts: c.Workouts, SleepSegments: c.SleepSegments,
			ActivitySummaries: c.ActivitySummaries, Deletions: c.Deletions,
		}
		if err := stats.DeadLettered(ctx, f, cause); err != nil {
			log.Warn("ingest stats: record failure", "err", err)
		}
	}

	log.Info("worker started", "queue", cfg.IngestQueue)
	err = q.Consume(ctx, prefetch, func(ctx context.Context, body []byte, redriven int) error {
		counts, err := ingest.Process(ctx, st.DB, st.Redis, body)
		if err != nil {
			log.Error("process batch", "err", err, "bytes", len(body),
				"batch_id", counts.BatchID, "redriven", redriven)
			deadLettered(ctx, body, redriven, err)
			return err // → nack → dead-letter
		}
		record(ctx, counts.Items(), true)
		// ⚠️ What ARRIVED, not what changed. The writes are upserts, so a chunk replayed
		// after a failed acknowledgement reports the same numbers and stores nothing new.
		// The alternative — printing a "duplicates skipped" figure — would need a
		// rows-affected count the queries do not return, and a number invented to fill a
		// column is worse than a column that is not there.
		log.Info("batch processed", "batch_id", counts.BatchID, "bytes", len(body),
			"samples", counts.Samples, "workouts", counts.Workouts,
			"sleep_segments", counts.SleepSegments,
			"activity_summaries", counts.ActivitySummaries,
			"deletions", counts.Deletions)
		return nil
	})
	if err != nil && ctx.Err() == nil {
		log.Error("consume", "err", err)
		os.Exit(1)
	}

	// Wait for the publisher to say goodbye to the broker, so that a planned stop
	// leaves `offline` behind rather than looking like a crash.
	stop()
	<-hassDone
}
