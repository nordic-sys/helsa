//go:build smoke

// The zone-3+ endpoint against a REAL database.
//
// The rules are pure Go and tested in intensity_test.go; what only a database
// can show is the part in SQL: that the window is matched by TIME (an unlinked
// reading counts), that both ends are inclusive and one second past the end is
// out, that a zero reading is dropped, that a workout with no heart rate still
// comes back (as null, not missing), and that the maximum comes from the linked
// readings the list endpoint reports.
package workouts

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nordic-sys/helsa/backend/internal/pgconv"
	"github.com/nordic-sys/helsa/backend/internal/store"
	"github.com/nordic-sys/helsa/backend/internal/tenant"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("HELSA_DATABASE_URL")
	if url == "" {
		url = "postgres://helsa:helsa_local_dev@localhost:5433/helsa?sslmode=disable"
	}
	pool, err := store.NewPool(context.Background(), url)
	if err != nil {
		t.Fatalf("open the database: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("the database is not reachable (%s): %v — start it with `cd deploy && make up`", url, err)
	}
	return pool
}

var dbSeq int

func TestIntensityAgainstTheDatabase(t *testing.T) {
	ctx := context.Background()
	pool := testPool(t)

	var uid uuid.UUID
	if err := pool.QueryRow(ctx, `INSERT INTO users (apple_sub) VALUES ($1) RETURNING id`,
		fmt.Sprintf("intensity-db-test-%d", time.Now().UnixNano())).Scan(&uid); err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, pgconv.UUID(uid)) })

	workout := func(kind string, start time.Time, end *time.Time) uuid.UUID {
		dbSeq++
		var id uuid.UUID
		if err := pool.QueryRow(ctx,
			`INSERT INTO workouts (user_id, source_uuid, activity_type, started_at, ended_at)
			 VALUES ($1, $2, $3, $4, $5) RETURNING id`,
			pgconv.UUID(uid), fmt.Sprintf("w-%d", dbSeq), kind, start, end).Scan(&id); err != nil {
			t.Fatalf("insert workout: %v", err)
		}
		return id
	}
	hr := func(ts time.Time, bpm float64, linked *uuid.UUID) {
		dbSeq++
		var wid any
		if linked != nil {
			wid = pgconv.UUID(*linked)
		}
		if _, err := pool.Exec(ctx,
			`INSERT INTO samples (user_id, ts, data_type, value, unit, workout_id, source_uuid)
			 VALUES ($1, $2, 'heartRate', $3, 'count/min', $4, $5)`,
			pgconv.UUID(uid), ts, bpm, wid, fmt.Sprintf("s-%d", dbSeq)); err != nil {
			t.Fatalf("insert sample: %v", err)
		}
	}
	at := func(tm time.Time) *time.Time { return &tm }

	now := time.Now().UTC().Truncate(time.Second)
	// Five past sessions whose LINKED readings give the maximum: 190, 185, 180,
	// 175, 170 → the second highest is 185, threshold 129.5.
	for i, peak := range []float64{190, 185, 180, 175, 170} {
		start := now.AddDate(0, 0, -100-i*7)
		id := workout("running", start, at(start.Add(30*time.Minute)))
		hr(start.Add(time.Minute), peak, &id)
	}
	// A spike of 260 on a sixth session is a sensor error, not a maximum.
	spikeStart := now.AddDate(0, 0, -50)
	spike := workout("running", spikeStart, at(spikeStart.Add(30*time.Minute)))
	hr(spikeStart.Add(time.Minute), 260, &spike)
	// A session older than the look-back does not count.
	old := now.AddDate(0, 0, -400)
	oldID := workout("running", old, at(old.Add(30*time.Minute)))
	hr(old.Add(time.Minute), 220, &oldID)

	// The window under test: one week, ending a day ago.
	from := now.AddDate(0, 0, -8)
	to := now.AddDate(0, 0, -1)

	// Measured by time window, the readings NOT linked to it.
	s1 := now.AddDate(0, 0, -5)
	measured := workout("cycling", s1, at(s1.Add(10*time.Minute)))
	hr(s1, 140, nil)                                   // the start: in
	hr(s1.Add(5*time.Second), 140, nil)                // 5 s at ≥ 129.5
	hr(s1.Add(10*time.Second), 120, nil)               // below
	hr(s1.Add(10*time.Minute-5*time.Second), 150, nil) // 5 s to the next
	hr(s1.Add(10*time.Minute), 150, nil)               // the end itself: in, 0 s to the end
	hr(s1.Add(10*time.Minute+time.Second), 200, nil)   // one second past: out
	hr(s1.Add(2*time.Minute), 0, nil)                  // a zero reading: dropped
	// Expected: 5 (140→140) + 5 (140→120) + 5 (150→150) + 0 (150→end) = 15.

	// One reading: unmeasured.
	s2 := now.AddDate(0, 0, -4)
	single := workout("running", s2, at(s2.Add(20*time.Minute)))
	hr(s2.Add(time.Minute), 170, nil)

	// None at all: still listed, as null.
	s3 := now.AddDate(0, 0, -3)
	blind := workout("strength", s3, at(s3.Add(20*time.Minute)))

	// Outside the window: not listed.
	workout("running", now.AddDate(0, 0, -9), nil)

	svc := New(pool)
	got, err := svc.Intensity(tenant.With(ctx, uid), uid, from, to, now)
	if err != nil {
		t.Fatal(err)
	}
	if got.Maximum == nil || got.Maximum.Bpm != 185 || got.Maximum.Workouts != 5 {
		t.Fatalf("maximum %+v, want 185 from 5", got.Maximum)
	}
	byID := map[uuid.UUID]*float32{}
	for _, w := range got.Workouts {
		byID[uuid.UUID(w.Id)] = w.Seconds
	}
	if len(byID) != 3 {
		t.Fatalf("workouts in the window: %d, want 3 (%+v)", len(byID), got.Workouts)
	}
	if s := byID[measured]; s == nil || *s != 15 {
		t.Errorf("measured: %v, want 15", s)
	}
	if s, ok := byID[single]; !ok || s != nil {
		t.Errorf("single reading: present=%v value=%v, want present and null", ok, s)
	}
	if s, ok := byID[blind]; !ok || s != nil {
		t.Errorf("no heart rate: present=%v value=%v, want present and null", ok, s)
	}
}
