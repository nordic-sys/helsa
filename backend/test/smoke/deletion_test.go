//go:build smoke

package smoke

import (
	"context"
	"log/slog"
	"os"
	"testing"

	"github.com/nordic-sys/helsa/backend/internal/deletion"
)

// Deleting a member removes everything of theirs from the live database — the raw
// rows through the cascade, the hourly aggregates the cascade does not reach
// (§4.8.9) — and nothing of anybody else's (docs/36 §4.6).
func TestDeletingAMemberLeavesNothingOfThemAndEverythingElse(t *testing.T) {
	e := newEnv(t)
	covered := map[string]bool{}
	a := addPerson(t, e, "a", "Europe/Budapest", 412347, 61.37, 451.5, 1234.5, 47.1111)
	b := addPerson(t, e, "b", "America/Chicago", 523459, 87.29, 612.75, 2345.5, 46.2222)
	a.upload(t, e.client, covered)
	b.upload(t, e.client, covered)
	waitForSteps(t, e, a)
	waitForSteps(t, e, b)
	ctx := context.Background()

	// Materialise both members' hourly aggregates, as years of the refresh policy
	// would have (owner-only, like the policy itself).
	if _, err := e.store.DB.Exec(ctx, `CALL refresh_continuous_aggregate('samples_hourly', now() - interval '3 days', now())`); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	hourly := func(p *person) int {
		var n int
		must(t, e.store.DB.QueryRow(ctx, `SELECT count(*) FROM samples_hourly WHERE user_id = $1`, p.userID).Scan(&n), "hourly")
		return n
	}
	if hourly(a) == 0 || hourly(b) == 0 {
		t.Fatalf("the fixture has no hourly aggregates: a %d, b %d", hourly(a), hourly(b))
	}
	bBefore := hourly(b)

	if _, err := e.store.DB.Exec(ctx, `INSERT INTO deletion_jobs (user_id, handle) VALUES ($1, $2)`, a.userID, a.sub); err != nil {
		t.Fatal(err)
	}
	worker := openAs(t, ctx, e.cfg, "HELSA_SMOKE_WORKER_DATABASE_URL", "helsa_worker")
	r := &deletion.Runner{Pool: worker.DB, Redis: worker.Redis, Log: slog.New(slog.NewTextHandler(os.Stdout, nil))}
	for {
		worked, err := r.RunOne(ctx)
		if err != nil {
			t.Fatalf("run: %v", err)
		}
		if !worked {
			break
		}
	}

	var left int
	for _, q := range []string{
		`SELECT count(*) FROM users WHERE id = $1`,
		`SELECT count(*) FROM samples WHERE user_id = $1`,
		`SELECT count(*) FROM workouts WHERE user_id = $1`,
		`SELECT count(*) FROM journal_entries WHERE user_id = $1`,
		`SELECT count(*) FROM device_tokens WHERE user_id = $1`,
		`SELECT count(*) FROM samples_hourly WHERE user_id = $1`,
	} {
		must(t, e.store.DB.QueryRow(ctx, q, a.userID).Scan(&left), q)
		if left != 0 {
			t.Errorf("%s → %d left of the deleted member", q, left)
		}
	}
	var stage string
	must(t, e.store.DB.QueryRow(ctx, `SELECT stage FROM deletion_jobs WHERE user_id = $1`, a.userID).Scan(&stage), "job")
	if stage != "done" {
		t.Errorf("job stage %q, want done", stage)
	}
	if got := hourly(b); got != bBefore {
		t.Errorf("the other member's aggregates changed: %d → %d", bBefore, got)
	}
	if st := e.client.do(t, "GET", "/v1/me", b.token, nil, nil); st != 200 {
		t.Errorf("the other member: %d", st)
	}
	// The purge function refuses a user who still exists.
	if _, err := worker.DB.Exec(ctx, `SELECT purge_deleted_user_aggregates($1)`, b.userID); err == nil {
		t.Error("purging a living member's aggregates must be refused")
	}
}
