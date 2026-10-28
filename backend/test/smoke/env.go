//go:build smoke

package smoke

import (
	"context"
	"fmt"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/nordic-sys/helsa/backend/internal/auth"
	"github.com/nordic-sys/helsa/backend/internal/config"
	"github.com/nordic-sys/helsa/backend/internal/db"
	"github.com/nordic-sys/helsa/backend/internal/ingest"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
	"github.com/nordic-sys/helsa/backend/internal/queue"
	"github.com/nordic-sys/helsa/backend/internal/server"
	"github.com/nordic-sys/helsa/backend/internal/store"
)

// env is a running, in-process Helsa: the API and the worker against the REAL
// local infrastructure (TimescaleDB/Redis/RabbitMQ from the deploy/ compose
// stack). Every caller gets a fresh user, so the tests never see each other's
// data.
type env struct {
	cfg    *config.Config
	client *apiClient
	token  string
	handle string
	// store and userID are what the tests that bypass HTTP need — the Home
	// Assistant publisher reads the database directly, exactly as it does in the
	// worker.
	store  *store.Store
	userID uuid.UUID
	// api is the API's own connection (helsa_app): what the database lets the API
	// see, with no application code in between.
	api *store.Store
}

func newEnv(t *testing.T) *env {
	t.Helper()
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

	// Three connections, as production has them: the owner only for the fixtures
	// (creating users, flipping roles), the API as helsa_app, the worker as
	// helsa_worker. Row-level security binds the last two and not the first.
	st, err := store.Open(ctx, cfg)
	must(t, err, "store open (owner, fixtures)")
	t.Cleanup(st.Close)
	apiStore := openAs(t, ctx, cfg, "HELSA_SMOKE_API_DATABASE_URL", "helsa_app")
	workerStore := openAs(t, ctx, cfg, "HELSA_SMOKE_WORKER_DATABASE_URL", "helsa_worker")

	q, err := queue.Open(cfg.RabbitMQURL, cfg.IngestQueue)
	must(t, err, "queue open")
	t.Cleanup(func() { q.Close() })

	// The worker in-process: it consumes from the queue and writes to the database.
	go func() {
		_ = q.Consume(ctx, 4, func(ctx context.Context, body []byte, _ int) error {
			_, err := ingest.Process(ctx, workerStore.DB, workerStore.Redis, body)
			return err
		})
	}()

	srv := server.New(cfg, apiStore, q)
	ts := httptest.NewServer(srv.Router())
	t.Cleanup(ts.Close)

	// There is no interactive login: an install-time step issues the device token.
	// The test therefore asks the service for it — from the HTTP surface it is the
	// same Bearer token.
	handle := fmt.Sprintf("smoke-%d", time.Now().UnixNano())
	u, err := db.New(st.DB).UpsertUserByHandle(ctx, db.UpsertUserByHandleParams{Handle: handle})
	must(t, err, "creating the user")
	sess, err := auth.New(cfg, st.DB, st.Redis).IssueDeviceToken(ctx, pgconv.ToUUID(u.ID), "smoke", uuid.Nil)
	must(t, err, "issuing the device token")

	return &env{
		cfg:    cfg,
		client: &apiClient{base: ts.URL, hc: ts.Client()},
		token:  sess.AccessToken,
		handle: handle,
		store:  st,
		api:    apiStore,
		userID: sess.UserID,
	}
}

// openAs opens a store that logs in as role, from the URL in env. It refuses to run
// without one: falling back to the owner would make every policy invisible.
func openAs(t *testing.T, ctx context.Context, cfg *config.Config, env, role string) *store.Store {
	t.Helper()
	url := os.Getenv(env)
	if url == "" {
		t.Fatalf("%s is not set: the smoke test runs as %s, not as the owner. Run it through `make smoke`.", env, role)
	}
	c := *cfg
	c.DatabaseURL = url
	st, err := store.Open(ctx, &c)
	must(t, err, "store open as "+role)
	t.Cleanup(st.Close)
	var who string
	must(t, st.DB.QueryRow(ctx, "SELECT current_user").Scan(&who), "current_user")
	if who != role {
		t.Fatalf("%s logs in as %q, want %q", env, who, role)
	}
	return st
}
