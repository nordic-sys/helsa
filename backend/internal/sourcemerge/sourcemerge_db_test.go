//go:build smoke

// The source merge against a REAL database (docs/25 F9).
//
// The rule lives entirely in SQL — per-hour, per-source sums, the max of them,
// then a sum per bucket — so a Go fixture could only restate it. These tests feed
// the query the shapes that matter and check the numbers that come out:
//
//   - a single-source day must equal the plain sum (nothing changes for anybody
//     with one device);
//   - the measured 2026-10-24 day (iPhone + Watch + Huawei Health) must come out
//     at the hourly-merged 24 200, not the 67 406 a plain sum gave;
//   - complementary coverage (phone in the morning, Watch in the afternoon) must
//     keep both halves;
//   - the bundle → device fallback, and that a sample with no provenance at all
//     still counts;
//   - average-type metrics keep the plain, all-source mean.
package sourcemerge

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
	"github.com/nordic-sys/helsa/backend/internal/store"
	"github.com/nordic-sys/helsa/backend/internal/tenant"
)

const tz = "Europe/Budapest"

const (
	iphone = "com.apple.health.30B8021B-59FC-42FA-80AD-740518DF8C96"
	watch  = "com.apple.health.1052346F-38EF-4927-ACF9-CA2D4FEF2DB2"
	huawei = "com.aspiegel.health"
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

// ownerPool is the connection for what only the aggregate's OWNER may do: an
// on-demand refresh, which production leaves to Timescale's policy. Point
// HELSA_DATABASE_URL at the application role (helsa_app) and
// HELSA_SMOKE_OWNER_DATABASE_URL at the owner to run this suite as production
// connects; unset, it is the same URL as the test pool.
func ownerPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("HELSA_SMOKE_OWNER_DATABASE_URL")
	if url == "" {
		url = os.Getenv("HELSA_DATABASE_URL")
	}
	if url == "" {
		url = "postgres://helsa:helsa_local_dev@localhost:5433/helsa?sslmode=disable"
	}
	pool, err := store.NewPool(context.Background(), url)
	if err != nil {
		t.Fatalf("open the database as the owner: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func freshUser(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(context.Background(),
		`INSERT INTO users (handle, time_zone) VALUES ($1, $2) RETURNING id`,
		fmt.Sprintf("sourcemerge-db-test-%d", time.Now().UnixNano()), tz).Scan(&id)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, pgconv.UUID(id))
	})
	return id
}

var seq int

func insert(t *testing.T, pool *pgxpool.Pool, uid uuid.UUID, dataType string, ts time.Time,
	value float64, bundle, device *string) {
	t.Helper()
	seq++
	_, err := pool.Exec(context.Background(),
		`INSERT INTO samples (user_id, ts, data_type, value, unit, source_uuid, source_device, source_bundle)
		 VALUES ($1, $2, $3, $4, 'count', $5, $6, $7)`,
		pgconv.UUID(uid), ts, dataType, value, fmt.Sprintf("sm-%d-%d", time.Now().UnixNano(), seq),
		device, bundle)
	if err != nil {
		t.Fatalf("insert %s: %v", dataType, err)
	}
}

func str(s string) *string { return &s }

type row struct {
	bucket             time.Time
	sum, avg, min, max *float64
}

func query(t *testing.T, pool *pgxpool.Pool, uid uuid.UUID, dataType, bucket string, from, to time.Time) []row {
	t.Helper()
	rows, err := pool.Query(tenant.With(context.Background(), uid), BucketQuery, pgconv.UUID(uid), []string{dataType},
		bucket, tz, pgconv.Timestamptz(from), pgconv.Timestamptz(to))
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	defer rows.Close()
	var out []row
	for rows.Next() {
		var r row
		var dt string
		if err := rows.Scan(&dt, &r.bucket, &r.sum, &r.avg, &r.min, &r.max); err != nil {
			t.Fatalf("scan: %v", err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

func budapestDay(t *testing.T) (*time.Location, time.Time) {
	t.Helper()
	loc, err := time.LoadLocation(tz)
	if err != nil {
		t.Fatal(err)
	}
	return loc, time.Date(2026, 10, 24, 0, 0, 0, 0, loc)
}

// dayTotal asks for the day as ONE bucket, and also as 24 hourly buckets — the
// merge is meant to be additive, so the two must agree.
func dayTotal(t *testing.T, pool *pgxpool.Pool, uid uuid.UUID, dataType string, day time.Time) float64 {
	t.Helper()
	end := day.AddDate(0, 0, 1)
	daily := query(t, pool, uid, dataType, "1 day", day, end)
	if len(daily) != 1 || daily[0].sum == nil {
		t.Fatalf("expected exactly one day bucket with a sum, got %+v", daily)
	}
	var hourly float64
	for _, h := range query(t, pool, uid, dataType, "1 hour", day, end) {
		if h.sum != nil {
			hourly += *h.sum
		}
	}
	if math.Abs(hourly-*daily[0].sum) > 1e-6 {
		t.Errorf("the 24 hourly buckets add up to %v but the day bucket says %v — the merge is not additive",
			hourly, *daily[0].sum)
	}
	return *daily[0].sum
}

func TestASingleSourceDayIsThePlainSum(t *testing.T) {
	pool := testPool(t)
	uid := freshUser(t, pool)
	loc, day := budapestDay(t)

	var plain float64
	for h := 7; h <= 22; h++ {
		for _, min := range []int{5, 25, 45} {
			v := float64(h*10 + min)
			plain += v
			insert(t, pool, uid, "stepCount", time.Date(2026, 10, 24, h, min, 0, 0, loc), v, str(iphone), str("iphone"))
		}
	}
	if got := dayTotal(t, pool, uid, "stepCount", day); got != plain {
		t.Errorf("single-source day = %v, expected the plain sum %v", got, plain)
	}
}

// The day measured on a real install, hour by hour per source (local time).
// Plain sum: 67 406. Per-source totals: Huawei 23 494, iPhone 22 101, Watch
// 21 811. Apple's merged figure: 21 874.
var oct24 = []struct {
	hour                  int
	watch, iphone, huawei float64
}{
	{6, 10, 0, 0}, {7, 52, 16, 0}, {8, 23, 0, 0}, {9, 0, 9, 9},
	{10, 1458, 1537, 1746}, {11, 3884, 4367, 3746}, {12, 4503, 4046, 4698},
	{13, 2752, 2640, 2880}, {14, 3727, 3482, 4013}, {15, 3523, 4067, 4198},
	{16, 1742, 1803, 2013}, {17, 94, 80, 94}, {19, 0, 54, 54},
	{22, 29, 0, 29}, {23, 14, 0, 14},
}

func TestTheThreeSourceDayIsNotTripled(t *testing.T) {
	pool := testPool(t)
	uid := freshUser(t, pool)
	loc, day := budapestDay(t)

	var plain float64
	put := func(hour int, v float64, bundle, device string) {
		if v == 0 {
			return
		}
		plain += v
		// Two samples per hour and source, so the per-source SUM inside the hour is
		// exercised too, not only the max across sources.
		half := math.Floor(v / 2)
		insert(t, pool, uid, "stepCount", time.Date(2026, 10, 24, hour, 10, 0, 0, loc), half, str(bundle), str(device))
		insert(t, pool, uid, "stepCount", time.Date(2026, 10, 24, hour, 40, 0, 0, loc), v-half, str(bundle), str(device))
	}
	for _, h := range oct24 {
		put(h.hour, h.watch, watch, "watch")
		put(h.hour, h.iphone, iphone, "iphone")
		put(h.hour, h.huawei, huawei, "iphone")
	}
	if plain != 67406 {
		t.Fatalf("fixture drifted: plain sum %v, expected the measured 67 406", plain)
	}

	got := dayTotal(t, pool, uid, "stepCount", day)
	if got != 24200 {
		t.Errorf("merged day = %v, expected 24 200 (hourly max per source, summed)", got)
	}
	// The bounds the rule promises: never below the largest single source, never
	// anywhere near the plain sum.
	if got < 23494 || got >= plain/2 {
		t.Errorf("merged day %v is outside [largest source 23 494, half the plain sum)", got)
	}
}

// Phone on the desk in the afternoon, Watch off in the morning: a max-of-day rule
// would keep only the larger half. Hourly merging keeps both.
func TestComplementarySourcesKeepBothHalves(t *testing.T) {
	pool := testPool(t)
	uid := freshUser(t, pool)
	loc, day := budapestDay(t)

	for h := 8; h < 12; h++ {
		insert(t, pool, uid, "stepCount", time.Date(2026, 10, 24, h, 30, 0, 0, loc), 1000, str(iphone), str("iphone"))
	}
	for h := 14; h < 18; h++ {
		insert(t, pool, uid, "stepCount", time.Date(2026, 10, 24, h, 30, 0, 0, loc), 800, str(watch), str("watch"))
	}
	if got := dayTotal(t, pool, uid, "stepCount", day); got != 4000+3200 {
		t.Errorf("complementary day = %v, expected 7200 — one half was dropped", got)
	}
}

// An empty or missing bundle falls back to the device; with neither, the sample
// is its own anonymous source and still counts.
func TestSourceFallsBackToTheDevice(t *testing.T) {
	pool := testPool(t)
	uid := freshUser(t, pool)
	loc, day := budapestDay(t)
	at := time.Date(2026, 10, 24, 10, 15, 0, 0, loc)

	insert(t, pool, uid, "stepCount", at, 300, str(""), str("iphone"))
	insert(t, pool, uid, "stepCount", at.Add(time.Minute), 200, nil, str("iphone")) // same source as above → 500
	insert(t, pool, uid, "stepCount", at.Add(2*time.Minute), 450, str(""), str("watch"))
	if got := dayTotal(t, pool, uid, "stepCount", day); got != 500 {
		t.Errorf("hour with iphone=500 and watch=450 by device = %v, expected 500", got)
	}

	insert(t, pool, uid, "stepCount", time.Date(2026, 10, 24, 20, 0, 0, 0, loc), 70, nil, nil)
	if got := dayTotal(t, pool, uid, "stepCount", day); got != 570 {
		t.Errorf("after a provenance-less sample in another hour = %v, expected 570", got)
	}
}

// Average-type metrics are not merged: the mean over every sample of every source,
// min and max across all of them — what avg(value) gave before.
func TestAverageMetricsKeepThePlainMean(t *testing.T) {
	pool := testPool(t)
	uid := freshUser(t, pool)
	loc, day := budapestDay(t)

	// Hour 9: watch 60, 62, 64; iphone 90. Hour 15: watch 70.
	insert(t, pool, uid, "heartRate", time.Date(2026, 10, 24, 9, 1, 0, 0, loc), 60, str(watch), str("watch"))
	insert(t, pool, uid, "heartRate", time.Date(2026, 10, 24, 9, 2, 0, 0, loc), 62, str(watch), str("watch"))
	insert(t, pool, uid, "heartRate", time.Date(2026, 10, 24, 9, 3, 0, 0, loc), 64, str(watch), str("watch"))
	insert(t, pool, uid, "heartRate", time.Date(2026, 10, 24, 9, 4, 0, 0, loc), 90, str(iphone), str("iphone"))
	insert(t, pool, uid, "heartRate", time.Date(2026, 10, 24, 15, 0, 0, 0, loc), 70, str(watch), str("watch"))

	rows := query(t, pool, uid, "heartRate", "1 day", day, day.AddDate(0, 0, 1))
	if len(rows) != 1 {
		t.Fatalf("expected one day bucket, got %d", len(rows))
	}
	r := rows[0]
	if want := (60.0 + 62 + 64 + 90 + 70) / 5; r.avg == nil || math.Abs(*r.avg-want) > 1e-9 {
		t.Errorf("avg = %v, expected the sample-weighted %v", deref(r.avg), want)
	}
	if r.min == nil || *r.min != 60 || r.max == nil || *r.max != 90 {
		t.Errorf("min/max = %v/%v, expected 60/90", deref(r.min), deref(r.max))
	}
}

// The day is cut in the user's zone: 23:30 local belongs to the 24th, 00:30 on
// the 25th does not.
func TestTheDayIsCutInTheUsersZone(t *testing.T) {
	pool := testPool(t)
	uid := freshUser(t, pool)
	loc, day := budapestDay(t)

	insert(t, pool, uid, "stepCount", time.Date(2026, 10, 24, 23, 30, 0, 0, loc), 40, str(iphone), str("iphone"))
	insert(t, pool, uid, "stepCount", time.Date(2026, 10, 25, 0, 30, 0, 0, loc), 99, str(iphone), str("iphone"))
	if got := dayTotal(t, pool, uid, "stepCount", day); got != 40 {
		t.Errorf("24 Oct = %v, expected 40", got)
	}
}

// The continuous aggregate and the views rebuilt by migration 00009 must give the
// same merged number as the read path (they are cut in UTC; this day sits well
// inside one UTC day).
func TestTheAggregatesAgreeWithTheReadPath(t *testing.T) {
	pool := testPool(t)
	uid := freshUser(t, pool)
	loc, day := budapestDay(t)
	for _, h := range oct24 {
		for _, s := range []struct {
			v      float64
			bundle string
		}{{h.watch, watch}, {h.iphone, iphone}, {h.huawei, huawei}} {
			if s.v > 0 {
				insert(t, pool, uid, "stepCount", time.Date(2026, 10, 24, h.hour, 20, 0, 0, loc), s.v, str(s.bundle), nil)
			}
		}
	}
	ctx := context.Background()
	if _, err := ownerPool(t).Exec(ctx, `CALL refresh_continuous_aggregate('samples_hourly', $1::timestamptz, $2::timestamptz)`,
		day.Add(-24*time.Hour), day.Add(48*time.Hour)); err != nil {
		t.Fatalf("refresh samples_hourly: %v", err)
	}
	utcDay := time.Date(2026, 10, 24, 0, 0, 0, 0, time.UTC)
	var got float64
	if err := pool.QueryRow(ctx,
		`SELECT sum_value FROM samples_daily WHERE user_id = $1 AND data_type = 'stepCount' AND bucket = $2`,
		pgconv.UUID(uid), utcDay).Scan(&got); err != nil {
		t.Fatalf("read samples_daily: %v", err)
	}
	if got != 24200 {
		t.Errorf("samples_daily = %v, expected 24 200 like the read path", got)
	}
}

func deref(p *float64) any {
	if p == nil {
		return nil
	}
	return *p
}
