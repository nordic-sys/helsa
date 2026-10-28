// cmd/api is the HTTP API server: it serves the contract-first routes and
// connects to the running local infrastructure (TimescaleDB/Redis/RabbitMQ).
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/nordic-sys/helsa/backend/internal/config"
	"github.com/nordic-sys/helsa/backend/internal/queue"
	"github.com/nordic-sys/helsa/backend/internal/server"
	"github.com/nordic-sys/helsa/backend/internal/startup"
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

	srv := server.New(cfg, st, q)
	httpServer := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           srv.Router(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Info("api listening", "addr", cfg.HTTPAddr)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("listen", "err", err)
			stop()
		}
	}()

	<-ctx.Done()
	log.Info("shutting down...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(shutdownCtx)
}
