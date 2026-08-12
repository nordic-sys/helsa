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
	"github.com/nordic-sys/helsa/backend/internal/queue"
	"github.com/nordic-sys/helsa/backend/internal/store"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	cfg, err := config.Load()
	if err != nil {
		log.Error("config", "err", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	st, err := store.Open(ctx, cfg)
	if err != nil {
		log.Error("store open", "err", err)
		os.Exit(1)
	}
	defer st.Close()

	q, err := queue.Open(cfg.RabbitMQURL, cfg.IngestQueue)
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

	log.Info("worker started", "queue", cfg.IngestQueue)
	err = q.Consume(ctx, 8, func(ctx context.Context, body []byte) error {
		if err := ingest.Process(ctx, st.DB, st.Redis, body); err != nil {
			log.Error("process batch", "err", err)
			return err // → nack → dead-letter
		}
		log.Info("batch processed", "bytes", len(body))
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
