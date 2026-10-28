//go:build smoke

package smoke

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/nordic-sys/helsa/backend/internal/tenant"
)

// The database's own line (docs/36 §4.8.8): asked by the API's role with NO
// `WHERE user_id = …` at all, it hands out only the current user's rows.
//
// This is what the isolation test cannot show on its own: there the application
// filters too, and a leak needs both lines to fail. Here the application is out of
// the picture. (Validated 2026-10-28: with the user filter removed from the samples
// and workout queries, the isolation test still passed — this is why.)
func TestTheDatabaseKeepsMembersApartWithoutTheApplication(t *testing.T) {
	e := newEnv(t)
	covered := map[string]bool{}
	a := addPerson(t, e, "a", "Europe/Budapest", 412347, 61.37, 451.5, 1234.5, 47.1111)
	b := addPerson(t, e, "b", "America/Chicago", 523459, 87.29, 612.75, 2345.5, 46.2222)
	a.upload(t, e.client, covered)
	b.upload(t, e.client, covered)
	waitForSteps(t, e, a)
	waitForSteps(t, e, b)

	pool := e.api.DB
	rels := []string{"my_samples", "workouts", "workout_route_points", "sleep_segments", "activity_summary",
		"goals", "devices", "push_tokens", "achievements", "journal_entries", "device_tokens"}

	count := func(ctx context.Context, rel string, other uuid.UUID) (mine, foreign int) {
		t.Helper()
		q := "SELECT count(*), 0 FROM " + rel
		args := []any{}
		if rel != "workout_route_points" {
			q = "SELECT count(*) FILTER (WHERE user_id <> $1), count(*) FROM " + rel
			args = append(args, other)
			if err := pool.QueryRow(ctx, q, args...).Scan(&foreign, &mine); err != nil {
				t.Fatalf("%s: %v", rel, err)
			}
			return mine, foreign
		}
		if err := pool.QueryRow(ctx, q).Scan(&mine, &foreign); err != nil {
			t.Fatalf("%s: %v", rel, err)
		}
		return mine, 0
	}

	for _, me := range []*person{a, b} {
		ctx := tenant.With(context.Background(), me.userID)
		for _, rel := range rels {
			mine, foreign := count(ctx, rel, me.userID)
			if foreign != 0 {
				t.Errorf("%s as %s, unfiltered: %d rows of somebody else", rel, me.name, foreign)
			}
			if mine == 0 {
				t.Errorf("%s as %s: none of their own rows either — the check proves nothing", rel, me.name)
			}
		}
		// Route points have no user_id; they are someone else's if their workout is.
		var foreignPoints int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM workout_route_points p WHERE NOT EXISTS
			(SELECT 1 FROM workouts w WHERE w.id = p.workout_id AND w.user_id = $1)`, me.userID).Scan(&foreignPoints); err != nil {
			t.Fatal(err)
		}
		if foreignPoints != 0 {
			t.Errorf("route points as %s: %d of somebody else's", me.name, foreignPoints)
		}
	}

	// Nobody: every one of them is empty, and none of them errors.
	for _, rel := range rels {
		var n int
		if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM "+rel).Scan(&n); err != nil {
			t.Errorf("%s with no user: %v — it must be empty, not an error", rel, err)
		} else if n != 0 {
			t.Errorf("%s with no user: %d rows", rel, n)
		}
	}

	// The raw samples and the aggregates are out of the API's reach altogether.
	for _, rel := range []string{"samples", "samples_hourly", "samples_daily", "samples_weekly"} {
		_, err := pool.Exec(tenant.With(context.Background(), a.userID), "SELECT 1 FROM "+rel+" LIMIT 1")
		var pg *pgconn.PgError
		if !errors.As(err, &pg) || pg.Code != "42501" {
			t.Errorf("%s from the API role: want permission denied, got %v", rel, err)
		}
	}

	// A write the policy refuses: the API writing a row as somebody else.
	_, err := pool.Exec(tenant.With(context.Background(), a.userID),
		`INSERT INTO goals (user_id, metric, target_value) VALUES ($1, 'activeEnergy', 1)`, b.userID)
	var pg *pgconn.PgError
	if !errors.As(err, &pg) || pg.Code != "42501" {
		t.Errorf("an insert into another member's goals: want a policy violation, got %v", err)
	}
}

// Every table that holds a member's rows has row-level security on and a policy —
// a new table cannot slip in without one (docs/36 §4.8.4/3). The exceptions are
// named, each with its reason.
func TestEveryMemberTableHasAPolicy(t *testing.T) {
	e := newEnv(t)
	exempt := map[string]string{
		"users":   "read before a user is known (auth); never returned to anyone but its owner",
		"samples": "compressed hypertable: no RLS possible — the API has no right on it and reads my_samples",
	}
	rows, err := e.store.DB.Query(context.Background(), `
		SELECT c.relname, c.relrowsecurity,
		       EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
		FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
		  AND (EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'user_id' AND NOT a.attisdropped)
		       OR c.relname = 'workout_route_points')
		ORDER BY 1`)
	must(t, err, "list tables")
	defer rows.Close()
	seen := 0
	for rows.Next() {
		var name string
		var rls, policy bool
		must(t, rows.Scan(&name, &rls, &policy), "scan")
		seen++
		if _, ok := exempt[name]; ok {
			continue
		}
		if !rls || !policy {
			t.Errorf("table %s holds members' rows but has row security %v and a policy %v — add it to a migration like 00014", name, rls, policy)
		}
	}
	if seen < 10 {
		t.Fatalf("found only %d member tables — is the query looking at the right schema?", seen)
	}
}
