//go:build smoke

// The sleep series against a REAL database.
//
// Why it cannot be a unit test: the thing at risk here is the seam between SQL
// and Go. The night key ("start minus 12 hours", cut in the user's timezone) is
// computed by Postgres, the overlap resolution by internal/sleep, and a night is
// only measured correctly if the two agree on which segments belong together.
// Nothing about that is visible from a pure test — and this is exactly the spot
// where the naive `sum(ended_at - started_at)` used to report about one and a
// half times the sleep that was recorded.
package insights

import (
	"context"
	"fmt"
	"math"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nordic-sys/helsa/backend/internal/pgconv"
)

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

// freshUser creates its own user, so the test never sees anybody else's nights
// and never leaves any behind.
func freshUser(t *testing.T, pool *pgxpool.Pool, tz string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(context.Background(),
		`INSERT INTO users (apple_sub, time_zone) VALUES ($1, $2) RETURNING id`,
		fmt.Sprintf("sleep-db-test-%d", time.Now().UnixNano()), tz).Scan(&id)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, pgconv.UUID(id))
	})
	return id
}

func insertSegment(t *testing.T, pool *pgxpool.Pool, userID uuid.UUID, start, end time.Time, stage string) {
	t.Helper()
	_, err := pool.Exec(context.Background(),
		`INSERT INTO sleep_segments (user_id, source_uuid, started_at, ended_at, stage)
		 VALUES ($1, $2, $3, $4, $5)`,
		pgconv.UUID(userID), uuid.NewString(), start, end, stage)
	if err != nil {
		t.Fatalf("insert sleep segment (%s): %v", stage, err)
	}
}

// TestSleepSeriesResolvesOverlapInTheDatabase seeds ONE night the way the real
// data looks — two sources, an `inBed` envelope over everything, a stretch of
// wakefulness in the middle and an unstaged block — and checks the hours that
// come back.
func TestSleepSeriesResolvesOverlapInTheDatabase(t *testing.T) {
	const tz = "Europe/Budapest"
	loc, err := time.LoadLocation(tz)
	if err != nil {
		t.Fatalf("tz: %v", err)
	}
	pool := testPool(t)
	userID := freshUser(t, pool, tz)

	// The night runs from 23:00 to 07:00, three days ago. Its key day is the day
	// it STARTED on (start minus 12 hours), which is what the query has to work
	// out from a timestamp that falls on the next calendar day for most of the
	// night.
	today := time.Now().In(loc)
	day := time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, loc).AddDate(0, 0, -3)
	at := func(h, m int) time.Time { return day.Add(time.Duration(h)*time.Hour + time.Duration(m)*time.Minute) }

	// The phone: eight hours in one stretch, with the envelope around it.
	insertSegment(t, pool, userID, at(22, 30), at(31, 30), "inBed") // 22:30 → 07:30
	insertSegment(t, pool, userID, at(23, 0), at(31, 0), "asleepCore")
	// The watch: the SAME eight hours, in its own words, at its own boundaries and
	// under the legacy short names.
	insertSegment(t, pool, userID, at(23, 0), at(25, 0), "core")
	insertSegment(t, pool, userID, at(25, 0), at(27, 0), "deep")
	insertSegment(t, pool, userID, at(27, 0), at(29, 0), "rem")
	insertSegment(t, pool, userID, at(29, 0), at(31, 0), "asleepUnspecified")
	// And half an hour of lying awake in the middle of the night, which one source
	// still calls core sleep.
	insertSegment(t, pool, userID, at(26, 0), at(26, 30), "awake")

	// The naive sum of all this would be 9 + 8 + 8 + 0.5 = 25.5 hours; the sum of
	// only the `asleep*` stages (the query as it used to be) 10 hours. The truth is
	// eight hours in bed asleep minus the half hour awake.
	const wantHours = 7.5

	svc := New(pool)
	start := day.AddDate(0, 0, -1)
	end := day.AddDate(0, 0, 2)
	hours, nights, err := svc.sleep(context.Background(), userID, loc, start, end)
	if err != nil {
		t.Fatalf("sleep series: %v", err)
	}

	if len(hours) != 1 {
		t.Fatalf("got %d nights in the series, want 1: %v", len(hours), hours)
	}
	if got := hours[0].Value; math.Abs(got-wantHours) > 1e-6 {
		t.Errorf("sleep = %.3f hours, want %.1f", got, wantHours)
	}
	if !hours[0].Day.Equal(day) {
		t.Errorf("night keyed to %s, want %s", hours[0].Day, day)
	}

	// The night's two ends are the ends of the SLEEP, not of the time in bed: the
	// timing rules measure the midpoint from these, and half an hour of lying
	// there would move it.
	if len(nights) != 1 {
		t.Fatalf("got %d night periods, want 1", len(nights))
	}
	if !nights[0].Start.Equal(at(23, 0)) {
		t.Errorf("onset = %s, want %s", nights[0].Start, at(23, 0))
	}
	if !nights[0].End.Equal(at(31, 0)) {
		t.Errorf("wake = %s, want %s", nights[0].End, at(31, 0))
	}
}

// A night of nothing but wakefulness in bed is a MISSING measurement, not a
// zero-hour night: a zero would drag every average down as if it had been a
// sleepless night.
func TestSleeplessNightStaysOutOfTheSeries(t *testing.T) {
	const tz = "Europe/Budapest"
	loc, err := time.LoadLocation(tz)
	if err != nil {
		t.Fatalf("tz: %v", err)
	}
	pool := testPool(t)
	userID := freshUser(t, pool, tz)

	today := time.Now().In(loc)
	day := time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, loc).AddDate(0, 0, -3)
	at := func(h, m int) time.Time { return day.Add(time.Duration(h)*time.Hour + time.Duration(m)*time.Minute) }

	insertSegment(t, pool, userID, at(23, 0), at(27, 0), "inBed")
	insertSegment(t, pool, userID, at(23, 0), at(27, 0), "awake")

	hours, nights, err := New(pool).sleep(context.Background(), userID, loc,
		day.AddDate(0, 0, -1), day.AddDate(0, 0, 2))
	if err != nil {
		t.Fatalf("sleep series: %v", err)
	}
	if len(hours) != 0 || len(nights) != 0 {
		t.Errorf("a sleepless night got into the series: hours=%v nights=%v", hours, nights)
	}
}

// A stage nobody recognizes must not become sleep — the night is then
// incomplete, which is a smaller error than an invented hour.
func TestUnknownStageIsNotCountedAsSleep(t *testing.T) {
	const tz = "Europe/Budapest"
	loc, err := time.LoadLocation(tz)
	if err != nil {
		t.Fatalf("tz: %v", err)
	}
	pool := testPool(t)
	userID := freshUser(t, pool, tz)

	today := time.Now().In(loc)
	day := time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, loc).AddDate(0, 0, -3)
	at := func(h, m int) time.Time { return day.Add(time.Duration(h)*time.Hour + time.Duration(m)*time.Minute) }

	insertSegment(t, pool, userID, at(23, 0), at(29, 0), "asleepCore")
	insertSegment(t, pool, userID, at(29, 0), at(31, 0), "asleepSomethingNew")

	hours, _, err := New(pool).sleep(context.Background(), userID, loc,
		day.AddDate(0, 0, -1), day.AddDate(0, 0, 2))
	if err != nil {
		t.Fatalf("sleep series: %v", err)
	}
	if len(hours) != 1 {
		t.Fatalf("got %d nights, want 1", len(hours))
	}
	if got := hours[0].Value; math.Abs(got-6) > 1e-6 {
		t.Errorf("sleep = %.3f hours, want 6 (the unrecognized stage stays out)", got)
	}
}
