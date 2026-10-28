//go:build rlsbench

// Package rlsbench measures row-level security on Helsa's own queries (docs/36
// §4.8.5, M1–M6). It runs against the throwaway database of README.md — never
// against a real one — and prints a table; the assertions are the security
// checks (M1, M3, M5), the timings are for a person to read.
package rlsbench

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/nordic-sys/helsa/backend/internal/sourcemerge"
)

const (
	userA = "aaaaaaaa-0000-0000-0000-00000000000a" // ≈ 3.5 M samples
	userB = "bbbbbbbb-0000-0000-0000-00000000000b" // ≈ 0.5 M samples
	tz    = "Europe/Budapest"
)

func dsn(user, pass string) string {
	host := os.Getenv("RLSBENCH_HOST")
	if host == "" {
		host = "localhost:5433"
	}
	return fmt.Sprintf("postgres://%s:%s@%s/helsa_rls?sslmode=disable", user, pass, host)
}

func connect(t *testing.T, user, pass string) *pgx.Conn {
	t.Helper()
	c, err := pgx.Connect(context.Background(), dsn(user, pass))
	if err != nil {
		t.Fatalf("connect %s: %v (is the throwaway database set up? see README.md)", user, err)
	}
	t.Cleanup(func() { c.Close(context.Background()) })
	return c
}

// latestQuery is internal/latest's query, with the table name left open.
const latestQuery = `
SELECT t.name, s.ts, s.value
FROM unnest($2::text[]) AS t(name)
CROSS JOIN LATERAL (
    SELECT ts, value, unit
    FROM samples
    WHERE user_id = $1
      AND data_type = t.name
      AND value IS NOT NULL
    ORDER BY ts DESC
    LIMIT 1
) s`

// productionSamples is internal/samples buildQuery without the optional bounds.
const productionSamples = `SELECT ts, data_type, value, unit, source_device, source_uuid
FROM samples
WHERE user_id = $1
  AND data_type = $2
  AND (ts < $3 OR (ts = $3 AND source_uuid < $4))
ORDER BY ts DESC, source_uuid DESC
LIMIT $5`

type query struct {
	name  string
	sql   string
	args  func(user string) []any
	table string // "samples" for the variants to replace; "" for the small tables
}

func queries() []query {
	now := time.Now()
	window := func(d time.Duration, bucket string, types ...string) func(string) []any {
		return func(u string) []any { return []any{u, types, bucket, tz, now.Add(-d), now} }
	}
	ten := []string{"stepCount", "heartRate", "activeEnergyBurned", "restingHeartRate", "heartRateVariabilitySDNN",
		"respiratoryRate", "oxygenSaturation", "walkingSpeed", "vo2Max", "bodyMass"}
	return []query{
		{"Today (hourly, 3 types)", sourcemerge.BucketQuery, window(24*time.Hour, "1 hour", "stepCount", "activeEnergyBurned", "heartRate"), "samples"},
		{"Week (daily, 3 types)", sourcemerge.BucketQuery, window(7*24*time.Hour, "1 day", "stepCount", "activeEnergyBurned", "heartRate"), "samples"},
		{"Trends 1 year (daily, 1 type)", sourcemerge.BucketQuery, window(365*24*time.Hour, "1 day", "stepCount"), "samples"},
		{"Trends 1 year (weekly, 3 types)", sourcemerge.BucketQuery, window(365*24*time.Hour, "168 hours", "stepCount", "heartRate", "restingHeartRate"), "samples"},
		{"Latest (10 types)", latestQuery, func(u string) []any { return []any{u, ten} }, "samples"},
		{"Raw series (500 newest)", `SELECT ts, value FROM samples WHERE user_id = $1 AND data_type = 'heartRate' ORDER BY ts DESC LIMIT 500`,
			func(u string) []any { return []any{u} }, "samples"},
		// The production shape of GET /v1/samples (internal/samples buildQuery): the
		// keyset cursor, the second sort key and the full projection — the parts that
		// decide how the ordered scan crosses chunks (Codex R8).
		{"Samples page, production shape (first)", productionSamples,
			func(u string) []any { return []any{u, "heartRate", now.Add(time.Hour), "", 501} }, "samples"},
		{"Samples page, production shape (cursor, 30 days back)", productionSamples,
			func(u string) []any { return []any{u, "heartRate", now.AddDate(0, 0, -30), "a-zzz", 501} }, "samples"},
		{"Workouts list (50)", `SELECT id, started_at FROM workouts WHERE user_id = $1 ORDER BY started_at DESC LIMIT 50`,
			func(u string) []any { return []any{u} }, ""},
		{"Sleep, 30 days", `SELECT started_at, stage FROM sleep_segments WHERE user_id = $1 AND started_at >= now() - interval '30 days' ORDER BY started_at`,
			func(u string) []any { return []any{u} }, ""},
	}
}

// variant is one way of running a query.
type variant struct {
	name  string
	role  string
	table string // what replaces "FROM samples"
	guc   bool   // run inside a transaction that sets helsa.user_id
	rls   bool   // the small tables' RLS is on in this phase
}

var (
	baseline = variant{"today: direct table", "helsa_rls_base", "samples", false, false}
	baseTx   = variant{"today + transaction/GUC", "helsa_rls_base", "samples", true, false}
	viewA    = variant{"(a) security_barrier view", "helsa_rls_api", "my_samples", true, true}
	viewANB  = variant{"(a') plain view", "helsa_rls_api", "my_samples_nb", true, true}
	viewAIP  = variant{"(a'') plain view, InitPlan", "helsa_rls_api", "my_samples_ip", true, true}
	plainB   = variant{"(b) uncompressed + RLS", "helsa_rls_api", "samples_plain", true, true}
)

var fromSamples = regexp.MustCompile(`FROM samples(\s)`)

func (v variant) sql(q query) string {
	if q.table == "" {
		return q.sql
	}
	// The backend's own queries read my_samples since F1; the variants name their
	// table themselves, so start from the raw table in every case.
	raw := strings.ReplaceAll(q.sql, "FROM my_samples", "FROM samples")
	return fromSamples.ReplaceAllString(raw, "FROM "+v.table+"$1")
}

// run executes one query once, the way the API would: a transaction with the GUC
// when the variant needs one.
func run(ctx context.Context, c *pgx.Conn, v variant, q query, user string) (int, error) {
	sql := v.sql(q)
	if !v.guc {
		rows, err := c.Query(ctx, sql, q.args(user)...)
		if err != nil {
			return 0, err
		}
		n := 0
		for rows.Next() {
			n++
		}
		rows.Close()
		return n, rows.Err()
	}
	n := 0
	err := pgx.BeginFunc(ctx, c, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "SELECT set_config('helsa.user_id', $1, true)", user); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, sql, q.args(user)...)
		if err != nil {
			return err
		}
		for rows.Next() {
			n++
		}
		rows.Close()
		return rows.Err()
	})
	return n, err
}

func setSmallTableRLS(t *testing.T, owner *pgx.Conn, on bool) {
	t.Helper()
	verb := "DISABLE"
	if on {
		verb = "ENABLE"
	}
	for _, tbl := range []string{"workouts", "sleep_segments"} {
		if _, err := owner.Exec(context.Background(), "ALTER TABLE "+tbl+" "+verb+" ROW LEVEL SECURITY"); err != nil {
			t.Fatal(err)
		}
	}
}

// --- the security checks ---------------------------------------------------

// M1 (small tables) + M5: with RLS on, an UNFILTERED select returns only the GUC's
// user; without the GUC — on a fresh connection and on one that has just ended a
// transaction which set it — it returns nothing, and does not error.
func TestM1M5PoliciesAndFailClosed(t *testing.T) {
	ctx := context.Background()
	owner := connect(t, "helsa", "helsa_local_dev")
	setSmallTableRLS(t, owner, true)
	api := connect(t, "helsa_rls_api", "bench")

	countAs := func(user string) map[string]int {
		out := map[string]int{}
		err := pgx.BeginFunc(ctx, api, func(tx pgx.Tx) error {
			if user != "" {
				if _, err := tx.Exec(ctx, "SELECT set_config('helsa.user_id', $1, true)", user); err != nil {
					return err
				}
			}
			// Every candidate view, the chosen InitPlan one above all: the timing queries
			// carry their own WHERE user_id, which would hide a view that filters nothing
			// (Codex R7).
			for _, rel := range []string{"workouts", "sleep_segments", "my_samples", "my_samples_nb", "my_samples_ip", "samples_plain"} {
				var foreign, n int
				// An UNFILTERED select: the policy is the only thing narrowing it.
				if err := tx.QueryRow(ctx, "SELECT count(*) FILTER (WHERE user_id::text <> $1), count(*) FROM "+rel, user).Scan(&foreign, &n); err != nil {
					return fmt.Errorf("%s: %w", rel, err)
				}
				if user != "" && foreign > 0 {
					return fmt.Errorf("%s: %d rows of another user visible", rel, foreign)
				}
				out[rel] = n
			}
			return nil
		})
		if err != nil {
			t.Fatalf("as %q: %v", user, err)
		}
		return out
	}

	fresh := countAs("") // M5, fresh connection: the GUC was never set
	a := countAs(userA)
	after := countAs("") // M5, the same connection after a transaction that set it
	b := countAs(userB)
	for rel := range a {
		if fresh[rel] != 0 || after[rel] != 0 {
			t.Errorf("M5 %s: without a user it returned rows (fresh %d, after a transaction %d)", rel, fresh[rel], after[rel])
		}
		if a[rel] == 0 || b[rel] == 0 {
			t.Errorf("M1 %s: A sees %d, B sees %d — each should see their own rows", rel, a[rel], b[rel])
		}
	}
	t.Logf("M1/M5 rows visible — A: %v, B: %v, no user: %v / %v", a, b, fresh, after)
}

// M3: the API role reaches no raw samples and no aggregate except through the view.
func TestM3NoBypass(t *testing.T) {
	api := connect(t, "helsa_rls_api", "bench")
	for _, rel := range []string{"samples", "samples_hourly", "samples_daily", "samples_weekly"} {
		_, err := api.Exec(context.Background(), "SELECT 1 FROM "+rel+" LIMIT 1")
		var pg *pgconn.PgError
		if !errors.As(err, &pg) || pg.Code != "42501" {
			t.Errorf("M3 %s: want permission denied (42501), got %v", rel, err)
		}
	}
	// The chunks themselves: Timescale keeps them in _timescaledb_internal.
	var chunk string
	owner := connect(t, "helsa", "helsa_local_dev")
	if err := owner.QueryRow(context.Background(),
		`SELECT format('%I.%I', chunk_schema, chunk_name) FROM timescaledb_information.chunks WHERE hypertable_name = 'samples' LIMIT 1`).Scan(&chunk); err != nil {
		t.Fatal(err)
	}
	_, err := api.Exec(context.Background(), "SELECT 1 FROM "+chunk+" LIMIT 1")
	var pg *pgconn.PgError
	if !errors.As(err, &pg) || (pg.Code != "42501" && pg.Code != "3F000") {
		t.Errorf("M3 chunk %s: want permission denied, got %v", chunk, err)
	}
	// Spoofing the GUC is possible for anyone who can run SQL — the model protects
	// against an omitted filter, not against arbitrary SQL (docs/36 §9, C17). This
	// line documents that, it does not test a defence.
	t.Log("M3 note: a role that can run arbitrary SQL can set helsa.user_id itself; RLS here guards forgotten filters, not injection")
}

// --- the timings -----------------------------------------------------------

func TestM4Timings(t *testing.T) {
	ctx := context.Background()
	owner := connect(t, "helsa", "helsa_local_dev")
	const runs, iters, warmup = 3, 40, 5

	type result struct {
		p50, p95 time.Duration
		rows     int
		scans    string
	}
	results := map[string]map[string]result{} // query → variant → result

	for _, v := range []variant{baseline, baseTx, viewA, viewANB, viewAIP, plainB} {
		setSmallTableRLS(t, owner, v.rls)
		c := connect(t, v.role, "bench")
		for _, q := range queries() {
			if q.table == "" && (v == plainB || v == viewANB || v == viewAIP) {
				continue // the small tables are the same in (a), (a') and (b)
			}
			for i := 0; i < warmup; i++ {
				if _, err := run(ctx, c, v, q, userA); err != nil {
					t.Fatalf("%s / %s: %v", v.name, q.name, err)
				}
			}
			var all []time.Duration
			rows := 0
			for r := 0; r < runs; r++ {
				for i := 0; i < iters; i++ {
					start := time.Now()
					n, err := run(ctx, c, v, q, userA)
					all = append(all, time.Since(start))
					if err != nil {
						t.Fatalf("%s / %s: %v", v.name, q.name, err)
					}
					rows = n
				}
			}
			sort.Slice(all, func(i, j int) bool { return all[i] < all[j] })
			if results[q.name] == nil {
				results[q.name] = map[string]result{}
			}
			results[q.name][v.name] = result{
				p50: all[len(all)/2], p95: all[len(all)*95/100], rows: rows,
				scans: scanNodes(t, ctx, c, v, q),
			}
		}
	}
	setSmallTableRLS(t, owner, false)

	var b strings.Builder
	cols := []variant{baseline, baseTx, viewA, viewANB, viewAIP, plainB}
	b.WriteString("\n| Query (user A, ≈3.5 M rows) | rows |")
	for _, v := range cols {
		b.WriteString(" " + v.name + " p50 / p95 |")
	}
	b.WriteString("\n|---|---|" + strings.Repeat("---|", len(cols)) + "\n")
	for _, q := range queries() {
		r := results[q.name]
		base := r[baseline.name]
		fmt.Fprintf(&b, "| %s | %d |", q.name, base.rows)
		for _, v := range cols {
			x, ok := r[v.name]
			switch {
			case !ok:
				b.WriteString(" — |")
			case v == baseline:
				fmt.Fprintf(&b, " %s / %s |", ms(x.p50), ms(x.p95))
			default:
				fmt.Fprintf(&b, " %s / %s (%+.0f%%) |", ms(x.p50), ms(x.p95), pct(base.p95, x.p95))
			}
			if ok && x.rows != base.rows {
				t.Errorf("%s: %s returned %d rows, the table %d — the variants disagree", q.name, v.name, x.rows, base.rows)
			}
		}
		b.WriteString("\n")
	}
	b.WriteString("\nPlan nodes (scan types) per variant:\n")
	for _, q := range queries() {
		for _, v := range cols {
			if r, ok := results[q.name][v.name]; ok {
				fmt.Fprintf(&b, "- %s / %s: %s\n", q.name, v.name, r.scans)
			}
		}
	}
	t.Log(b.String())
}

func ms(d time.Duration) string { return fmt.Sprintf("%.2f ms", float64(d.Microseconds())/1000) }
func pct(base, x time.Duration) float64 {
	return (float64(x) - float64(base)) / float64(base) * 100
}

// scanNodes lists the distinct scan node types of the query's plan, with counts.
func scanNodes(t *testing.T, ctx context.Context, c *pgx.Conn, v variant, q query) string {
	t.Helper()
	var plan []byte
	explain := func(conn interface {
		QueryRow(context.Context, string, ...any) pgx.Row
	}) error {
		return conn.QueryRow(ctx, "EXPLAIN (FORMAT JSON) "+v.sql(q), q.args(userA)...).Scan(&plan)
	}
	var err error
	if v.guc {
		err = pgx.BeginFunc(ctx, c, func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, "SELECT set_config('helsa.user_id', $1, true)", userA); err != nil {
				return err
			}
			return explain(tx)
		})
	} else {
		err = explain(c)
	}
	if err != nil {
		t.Fatalf("explain %s / %s: %v", v.name, q.name, err)
	}
	var doc []map[string]any
	_ = json.Unmarshal(plan, &doc)
	counts := map[string]int{}
	var walk func(n map[string]any)
	walk = func(n map[string]any) {
		if typ, _ := n["Node Type"].(string); strings.Contains(typ, "Scan") {
			if cn, _ := n["Custom Plan Provider"].(string); cn != "" {
				typ += "(" + cn + ")"
			}
			counts[typ]++
		}
		if kids, ok := n["Plans"].([]any); ok {
			for _, k := range kids {
				if m, ok := k.(map[string]any); ok {
					walk(m)
				}
			}
		}
	}
	if len(doc) > 0 {
		if p, ok := doc[0]["Plan"].(map[string]any); ok {
			walk(p)
		}
	}
	var parts []string
	for k, n := range counts {
		parts = append(parts, fmt.Sprintf("%s×%d", k, n))
	}
	sort.Strings(parts)
	return strings.Join(parts, ", ")
}
