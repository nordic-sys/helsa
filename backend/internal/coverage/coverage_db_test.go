//go:build smoke

// The completeness report against a REAL database.
//
// Why it cannot be a unit test: everything risky here lives in the seam between
// SQL and Go. The day grid is cut by Postgres (`ts AT TIME ZONE $tz`), the rhythm
// is derived in Go from the days that come back, and the two only agree if a
// "day" means the same thing on both sides. A pure test can pin the arithmetic
// and still miss the case where the database hands back a day in UTC while the
// user lives in Budapest — and the whole point of this report is that a metric
// which arrives every evening must not look as though it arrives twice a day, or
// misses one.
//
// The second thing only a real database shows: `state`. `never_arrived` is a
// claim about the ABSENCE of a row, and no fixture can prove that the query
// distinguishes it from a row that exists outside the window.
package coverage

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nordic-sys/helsa/backend/internal/api"
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

// freshUser creates its own user, so the test never sees anybody else's samples
// and never leaves any behind.
func freshUser(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(context.Background(),
		`INSERT INTO users (apple_sub, time_zone) VALUES ($1, 'Europe/Budapest') RETURNING id`,
		fmt.Sprintf("coverage-db-test-%d", time.Now().UnixNano())).Scan(&id)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, pgconv.UUID(id))
	})
	return id
}

func insert(t *testing.T, pool *pgxpool.Pool, uid uuid.UUID, dataType string, ts time.Time,
	bundle string, device *string) {
	t.Helper()
	_, err := pool.Exec(context.Background(),
		`INSERT INTO samples (user_id, ts, data_type, value, unit, source_uuid, source_device, source_bundle)
		 VALUES ($1, $2, $3, 1, 'count', $4, $5, $6)`,
		pgconv.UUID(uid), ts, dataType,
		fmt.Sprintf("%s-%d", dataType, ts.UnixNano()), device, bundle)
	if err != nil {
		t.Fatalf("insert %s: %v", dataType, err)
	}
}

func find(t *testing.T, resp api.CoverageResponse, dataType string) api.CoverageType {
	t.Helper()
	for _, r := range *resp.Types {
		if r.DataType != nil && *r.DataType == dataType {
			return r
		}
	}
	t.Fatalf("%s is missing from the report", dataType)
	return api.CoverageType{}
}

// The seam itself: a sample at 23:30 Budapest time on the 5th is a sample from
// the 5th, not from the 6th. If the day were cut in UTC it would land on the
// 5th too — 22:30 UTC — so the case that actually separates the two zones is a
// sample at 00:30 local, which is the PREVIOUS day in UTC.
func TestTheDayGridIsCutInTheUsersTimeZone(t *testing.T) {
	pool := testPool(t)
	uid := freshUser(t, pool)
	budapest, err := time.LoadLocation("Europe/Budapest")
	if err != nil {
		t.Fatal(err)
	}

	// 00:30 on 6 June in Budapest = 22:30 on 5 June UTC.
	local := time.Date(2026, 6, 6, 0, 30, 0, 0, budapest)
	insert(t, pool, uid, "stepCount", local, "com.nordic-sys.Helsa", nil)

	svc := New(pool)
	resp, err := svc.Compute(context.Background(), uid, Request{
		From:   time.Date(2026, 6, 1, 0, 0, 0, 0, budapest),
		ToExcl: time.Date(2026, 6, 30, 0, 0, 0, 0, budapest),
		TZ:     "Europe/Budapest",
	})
	if err != nil {
		t.Fatalf("compute: %v", err)
	}

	row := find(t, resp, "stepCount")
	if row.LastDay == nil {
		t.Fatal("no last_day for the sample we just inserted")
	}
	if got := row.LastDay.Format("2006-01-02"); got != "2026-06-06" {
		t.Errorf("last_day = %s, expected 2026-06-06 — the day was cut in the wrong zone", got)
	}
}

// `never_arrived` versus `outside_window`: the distinction the extra query buys,
// and the one no fixture can prove.
func TestTheStatesComeOutOfTheDatabaseCorrectly(t *testing.T) {
	pool := testPool(t)
	uid := freshUser(t, pool)
	budapest, _ := time.LoadLocation("Europe/Budapest")

	from := time.Date(2026, 6, 1, 0, 0, 0, 0, budapest)
	toExcl := time.Date(2026, 7, 1, 0, 0, 0, 0, budapest)

	insert(t, pool, uid, "stepCount", time.Date(2026, 6, 10, 9, 0, 0, 0, budapest),
		"com.nordic-sys.Helsa", nil)
	// …and one from well before the window.
	insert(t, pool, uid, "bodyMass", time.Date(2025, 11, 3, 7, 0, 0, 0, budapest),
		"com.example.scale", nil)

	svc := New(pool)
	resp, err := svc.Compute(context.Background(), uid, Request{From: from, ToExcl: toExcl, TZ: "Europe/Budapest"})
	if err != nil {
		t.Fatalf("compute: %v", err)
	}

	if got := string(*find(t, resp, "stepCount").State); got != stateMeasured {
		t.Errorf("stepCount state = %q, expected %q", got, stateMeasured)
	}

	weight := find(t, resp, "bodyMass")
	if got := string(*weight.State); got != stateOutsideWindow {
		t.Errorf("bodyMass state = %q, expected %q", got, stateOutsideWindow)
	}
	if weight.LastDay == nil || weight.LastDay.Format("2006-01-02") != "2025-11-03" {
		t.Errorf("bodyMass last_day = %v, expected 2025-11-03", weight.LastDay)
	}
	if weight.MeasuredDays != nil {
		t.Error("a metric with nothing in the window reported measured days")
	}

	if got := string(*find(t, resp, "vo2Max").State); got != stateNeverArrived {
		t.Errorf("vo2Max state = %q, expected %q", got, stateNeverArrived)
	}
}

// Provenance, as thin as it actually is: which app wrote it, plus the coarse
// device kind IF the client said one. A sample that arrived without a device must
// come back without a device — never as "the phone".
func TestSourcesComeBackPerAppAndDeviceKind(t *testing.T) {
	pool := testPool(t)
	uid := freshUser(t, pool)
	budapest, _ := time.LoadLocation("Europe/Budapest")
	watch := "watch"

	base := time.Date(2026, 6, 10, 9, 0, 0, 0, budapest)
	for i := range 5 {
		insert(t, pool, uid, "heartRate", base.Add(time.Duration(i)*time.Minute),
			"com.nordic-sys.Helsa", &watch)
	}
	insert(t, pool, uid, "heartRate", base.Add(time.Hour), "com.example.strap", nil)

	svc := New(pool)
	resp, err := svc.Compute(context.Background(), uid, Request{
		From:   time.Date(2026, 6, 1, 0, 0, 0, 0, budapest),
		ToExcl: time.Date(2026, 7, 1, 0, 0, 0, 0, budapest),
		TZ:     "Europe/Budapest",
	})
	if err != nil {
		t.Fatalf("compute: %v", err)
	}

	row := find(t, resp, "heartRate")
	if row.Sources == nil || len(*row.Sources) != 2 {
		t.Fatalf("sources = %v, expected two", row.Sources)
	}
	sources := *row.Sources
	if sources[0].BundleId == nil || *sources[0].BundleId != "com.nordic-sys.Helsa" {
		t.Errorf("first source = %v, expected the biggest contributor", sources[0].BundleId)
	}
	if sources[0].Device == nil || string(*sources[0].Device) != "watch" {
		t.Errorf("device = %v, expected watch", sources[0].Device)
	}
	if sources[1].Device != nil {
		t.Errorf("device = %v — a sample that arrived without one must not be given one",
			*sources[1].Device)
	}
	if row.SampleCount == nil || *row.SampleCount != 6 {
		t.Errorf("sample_count = %v, expected 6", row.SampleCount)
	}
	if row.MeasuredDays == nil || *row.MeasuredDays != 1 {
		t.Errorf("measured_days = %v, expected 1 — six samples still arrived on one day", row.MeasuredDays)
	}
}

// A user with no samples at all gets the whole catalog back, every row absent
// rather than zeroed. This is the state a brand new server is in, and it is also
// the state that would look most like a bug if the counts were filled in with 0.
func TestAnEmptyDatabaseReportsAbsenceNotZeroes(t *testing.T) {
	pool := testPool(t)
	uid := freshUser(t, pool)
	budapest, _ := time.LoadLocation("Europe/Budapest")

	svc := New(pool)
	resp, err := svc.Compute(context.Background(), uid, Request{
		From:   time.Date(2026, 6, 1, 0, 0, 0, 0, budapest),
		ToExcl: time.Date(2026, 7, 1, 0, 0, 0, 0, budapest),
		TZ:     "Europe/Budapest",
	})
	if err != nil {
		t.Fatalf("compute: %v", err)
	}
	for _, row := range *resp.Types {
		if string(*row.State) != stateNeverArrived {
			t.Errorf("%s: state = %q on an empty database", *row.DataType, *row.State)
		}
		if row.MeasuredDays != nil || row.SampleCount != nil || row.LastDay != nil {
			t.Errorf("%s: a count or a date was filled in where nothing arrived", *row.DataType)
		}
	}
	if resp.Days == nil || *resp.Days != 30 {
		t.Errorf("days = %v, expected 30", resp.Days)
	}
}
