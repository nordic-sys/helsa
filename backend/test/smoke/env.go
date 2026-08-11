//go:build smoke

package smoke

import (
	"context"
	"fmt"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/nordic-sys/helsa/backend/internal/auth"
	"github.com/nordic-sys/helsa/backend/internal/config"
	"github.com/nordic-sys/helsa/backend/internal/ingest"
	"github.com/nordic-sys/helsa/backend/internal/queue"
	"github.com/nordic-sys/helsa/backend/internal/server"
	"github.com/nordic-sys/helsa/backend/internal/store"
)

// env is a running, in-process Helsa: the API and the worker against the REAL
// local infrastructure (TimescaleDB/Redis/RabbitMQ from the deploy/ compose
// stack). Every caller gets a fresh user, so the tests never see each other's
// data.
type env struct {
	cfg      *config.Config
	client   *apiClient
	token    string
	appleSub string
}

func newEnv(t *testing.T) *env {
	t.Helper()
	setIfEmpty("HELSA_AUTH_DEV_MODE", "true")
	setIfEmpty("HELSA_DATABASE_URL", "postgres://helsa:helsa_local_dev@localhost:5433/helsa?sslmode=disable")
	setIfEmpty("HELSA_REDIS_ADDR", "localhost:6380")
	setIfEmpty("HELSA_REDIS_PASSWORD", "helsa_local_dev")
	setIfEmpty("HELSA_RABBITMQ_URL", "amqp://helsa:helsa_local_dev@localhost:5672/")
	setIfEmpty("HELSA_JWT_SECRET", "smoke-secret")
	// A separate queue for the smoke test, so it does not get mixed up with a running
	// worker.
	//
	// ⚠️ NOT setIfEmpty here: `make smoke` loads AND exports .env from the Makefile,
	// and that file says HELSA_INGEST_QUEUE=helsa.ingest — so setIfEmpty never took
	// effect and the test published onto the shared queue. If a `make run-worker` was
	// running there, THAT one took the batch: the smoke test would then silently be
	// measuring another (possibly stale) binary rather than its own. This isolation is
	// not optional, hence the unconditional override.
	_ = os.Setenv("HELSA_INGEST_QUEUE", "helsa.ingest.smoke")

	cfg, err := config.Load()
	must(t, err, "config")

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	st, err := store.Open(ctx, cfg)
	must(t, err, "store open")
	t.Cleanup(st.Close)

	q, err := queue.Open(cfg.RabbitMQURL, cfg.IngestQueue)
	must(t, err, "queue open")
	t.Cleanup(func() { q.Close() })

	// The worker in-process: it consumes from the queue and writes to the database.
	go func() {
		_ = q.Consume(ctx, 4, func(ctx context.Context, body []byte) error {
			return ingest.Process(ctx, st.DB, st.Redis, body)
		})
	}()

	srv := server.New(cfg, st, q)
	ts := httptest.NewServer(srv.Router())
	t.Cleanup(ts.Close)

	// There is no interactive login: an install-time step issues the device token.
	// The test therefore asks the service for it — from the HTTP surface it is the
	// same Bearer token.
	appleSub := fmt.Sprintf("smoke-%d", time.Now().UnixNano())
	sess, err := auth.New(cfg, st.DB, st.Redis).LoginWithApple(ctx, "dev:"+appleSub, "")
	must(t, err, "issuing the device token")

	return &env{
		cfg:      cfg,
		client:   &apiClient{base: ts.URL, hc: ts.Client()},
		token:    sess.AccessToken,
		appleSub: appleSub,
	}
}
