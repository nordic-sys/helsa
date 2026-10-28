package store

import (
	"context"
	"fmt"
	"sync"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nordic-sys/helsa/backend/internal/tenant"
)

// # Whose rows a connection works on (docs/36 §4.8.8)
//
// The row-level policies and the my_samples view read `helsa.user_id`. Every time a
// connection leaves the pool, it is set from the context that asked for it
// (internal/tenant) — the user of the request, or of the queued batch, or "" for
// nobody, in which case the policies return no rows.
//
// Why on acquire, and not in a transaction around each request (the Auður pattern,
// and the plan's first draft): the services hold the POOL and run their queries on
// it, often several per request and some streamed (docs/36 §9, C17). A transaction
// would have to be threaded through every one of them, and a query that slipped past
// it would run on another connection — with whatever that connection last held.
// Here a query cannot get a connection without the setting being made for ITS
// context first.
//
// ⚠️ The setting is session-level (set_config(…, false)), so it outlives the
// acquisition. That is safe only because EVERY acquisition overwrites it — "" when
// the context has no user — before the connection is handed out. A connection is
// never used without passing through here.
//
// The last value is remembered per connection, so the common case — the same user
// again — costs no round trip.
type tenantHook struct {
	last sync.Map // *pgx.Conn → string
}

func (h *tenantHook) prepare(ctx context.Context, conn *pgx.Conn) (bool, error) {
	want := tenant.Setting(ctx)
	if prev, ok := h.last.Load(conn); ok && prev.(string) == want {
		return true, nil
	}
	if _, err := conn.Exec(ctx, "SELECT set_config('helsa.user_id', $1, false)", want); err != nil {
		// The connection's state is now unknown: destroy it rather than hand it out.
		h.last.Delete(conn)
		return false, fmt.Errorf("set helsa.user_id: %w", err)
	}
	h.last.Store(conn, want)
	return true, nil
}

func (h *tenantHook) forget(conn *pgx.Conn) { h.last.Delete(conn) }

// NewPool opens a pool with the hook installed. Everything that queries the
// database through policies opens its pool here — the store does, and so must a
// test that talks to the database directly: a pool without the hook never sets
// helsa.user_id, and every policy then returns nothing.
func NewPool(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}
	h := &tenantHook{}
	cfg.PrepareConn = h.prepare
	cfg.BeforeClose = h.forget
	return pgxpool.NewWithConfig(ctx, cfg)
}
