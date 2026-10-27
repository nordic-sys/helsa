//go:build smoke

// GET /v1/latest against a REAL database.
//
// The two things a Go fixture cannot check are both SQL: that the LATERAL lookup
// returns the newest sample per type (and skips a NULL value), and that a summed
// type's day total is the SOURCE-MERGED one — the same figure `/summary`'s daily
// bucket gives — rather than a plain sum that would triple a day three apps wrote.
package latest

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nordic-sys/helsa/backend/internal/pgconv"
)

const tz = "Europe/Budapest"

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("HELSA_DATABASE_URL")
	if url == "" {
		url = "postgres://helsa:helsa_local_dev@localhost:5433/helsa?sslmode=disable"
	}
	pool, err := pgxpool.New(context.Background(), url)
	if err != nil {
		t.Fatalf("open the database: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("the database is not reachable (%s): %v — start it with `cd deploy && make up`", url, err)
	}
	return pool
}

func freshUser(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(context.Background(),
		`INSERT INTO users (apple_sub, time_zone) VALUES ($1, $2) RETURNING id`,
		fmt.Sprintf("latest-db-test-%d", time.Now().UnixNano()), tz).Scan(&id)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, pgconv.UUID(id))
	})
	return id
}

var seq int

func insert(t *testing.T, pool *pgxpool.Pool, uid uuid.UUID, dataType string, ts time.Time, value *float64, bundle string) {
	t.Helper()
	seq++
	_, err := pool.Exec(context.Background(),
		`INSERT INTO samples (user_id, ts, data_type, value, unit, source_uuid, source_bundle)
		 VALUES ($1, $2, $3, $4, 'x', $5, $6)`,
		pgconv.UUID(uid), ts, dataType, value, fmt.Sprintf("lt-%d-%d", time.Now().UnixNano(), seq), bundle)
	if err != nil {
		t.Fatalf("insert %s: %v", dataType, err)
	}
}

func f(v float64) *float64 { return &v }

func TestLatestAgainstTheDatabase(t *testing.T) {
	pool := testPool(t)
	uid := freshUser(t, pool)
	loc, _ := time.LoadLocation(tz)
	day := time.Date(2026, 10, 24, 0, 0, 0, 0, loc)

	// Body mass: three weighings; the newest wins. A later row with a NULL value
	// must not hide it.
	insert(t, pool, uid, "bodyMass", day.Add(-48*time.Hour), f(83.0), "scale")
	insert(t, pool, uid, "bodyMass", day.Add(7*time.Hour), f(82.4), "scale")
	insert(t, pool, uid, "bodyMass", day.Add(-24*time.Hour), f(82.9), "scale")
	insert(t, pool, uid, "bodyMass", day.Add(9*time.Hour), nil, "scale")

	// Steps: the same walk written by two apps in the same hour, plus an
	// earlier-day sample that must not leak into the latest day's total.
	insert(t, pool, uid, "stepCount", day.Add(10*time.Hour), f(1000), "phone")
	insert(t, pool, uid, "stepCount", day.Add(10*time.Hour+5*time.Minute), f(1100), "watch")
	insert(t, pool, uid, "stepCount", day.Add(15*time.Hour), f(500), "phone")
	insert(t, pool, uid, "stepCount", day.Add(-20*time.Hour), f(9999), "phone")

	svc := New(pool)
	resp, err := svc.Compute(context.Background(), uid, Request{
		Metrics: []string{"bodyMass", "stepCount", "bloodGlucose"},
		TZ:      tz,
	})
	if err != nil {
		t.Fatal(err)
	}

	mass, ok := resp.Metrics["bodyMass"]
	if !ok || mass.Value == nil || *mass.Value != float32(82.4) {
		t.Fatalf("bodyMass = %+v, want the newest non-null weighing 82.4", mass)
	}
	if !mass.Ts.Equal(day.Add(7 * time.Hour)) {
		t.Errorf("bodyMass ts = %v", mass.Ts)
	}

	steps := resp.Metrics["stepCount"]
	if steps.DayTotal == nil {
		t.Fatalf("stepCount has no day_total: %+v", steps)
	}
	// Hour 10: max(1000, 1100) = 1100; hour 15: 500 → 1600. A plain sum says 2600.
	if *steps.DayTotal != 1600 {
		t.Errorf("stepCount day_total = %v, want the merged 1600 (a plain sum would be 2600)", *steps.DayTotal)
	}
	if got := steps.Day.Format("2006-01-02"); got != "2026-10-24" {
		t.Errorf("stepCount day = %s", got)
	}
	if _, ok := resp.Metrics["bloodGlucose"]; ok {
		t.Error("a type with no sample must be absent")
	}
}
