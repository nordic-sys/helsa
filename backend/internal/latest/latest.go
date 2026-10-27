// Package latest answers GET /v1/latest: the most recent measurement of each
// requested type, and the figure that belongs to it.
//
// # Why an endpoint of its own
//
// The web's Measurements page is a card grid, and every card leads with "the
// latest value, and when". The only way to learn that from the existing read
// paths was one `/samples?limit=1` per metric — forty-odd requests for a grid
// that otherwise needs four. `/coverage` knows the latest DAY of every type, but
// deliberately not the value (its contract explains why a timestamp would claim
// a precision a completeness row does not have).
//
// # What "the figure" is — decided here, from the server's own catalog
//
//   - An AVERAGED type (heart rate, body mass, walking speed) gets the latest
//     sample's value. That is what "my latest weight" means.
//   - A SUMMED type (steps, energy) gets the total of the local day its latest
//     sample fell on — source-merged by `sourcemerge.BucketQuery`, the very query
//     `/summary` cuts its buckets with, so the number is the one that day's daily
//     bucket carries. Its last sample alone is a five-minute fragment that nobody
//     means by a figure, so the DTO leaves `value` out for these types rather than
//     hand the client a trap.
//
// ⚠️ A plain `sum(value)` over the day would have been simpler and wrong: three
// apps writing the same walk tripled the day before docs/25 F9, and a second
// aggregation here would quietly re-open that hole for exactly one screen.
//
// # Cost
//
// One index lookup per type (`idx_samples_user_type_time`, user + type + ts DESC,
// LIMIT 1 through a LATERAL join), plus one merged-day aggregation per DISTINCT
// day among the summed types — in practice one or two, because most summed types
// were last written today. No Redis cache: the lookups are cheaper than the
// cache-key bookkeeping, and a "latest" that lags by the cache TTL would be the
// one number on the page that is stale by design.
package latest

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/metrics"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
	"github.com/nordic-sys/helsa/backend/internal/sourcemerge"
)

// MaxMetrics caps one request. The web catalog is ~120 wire names, aliases
// included; 200 leaves room for it to grow without letting one call turn into a
// few thousand index probes.
const MaxMetrics = 200

type Request struct {
	Metrics []string
	TZ      string
}

type Service struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// Row is one type's most recent sample, as read.
type Row struct {
	DataType string
	Ts       time.Time
	// Value is RAW (as stored); the wire scaling happens in Build, once.
	Value float64
	// StoredUnit is the unit the client sent with the sample — only a fallback for
	// a type the catalog does not know, the same rule as `/samples`.
	StoredUnit string
}

// latestQuery: the newest non-null sample per requested type.
//
// The LATERAL form, not `DISTINCT ON (data_type)`: DISTINCT ON has to read every
// row of every requested type to pick the first of each, which on a hypertable
// holding years of heart rate is a scan of years. LATERAL ... LIMIT 1 is one
// backwards step down the (user_id, data_type, ts DESC) index per type.
const latestQuery = `
SELECT t.name, s.ts, s.value, COALESCE(s.unit, '')
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

// Compute answers one request.
func (s *Service) Compute(ctx context.Context, userID uuid.UUID, req Request) (api.LatestResponse, error) {
	loc, err := time.LoadLocation(req.TZ)
	if err != nil {
		return api.LatestResponse{}, fmt.Errorf("unknown tz %q: %w", req.TZ, err)
	}
	names := Normalize(req.Metrics)
	if len(names) == 0 {
		return Build(nil, nil, loc), nil
	}

	rows, err := s.pool.Query(ctx, latestQuery, pgconv.UUID(userID), names)
	if err != nil {
		return api.LatestResponse{}, fmt.Errorf("latest query: %w", err)
	}
	var latest []Row
	for rows.Next() {
		var r Row
		if err := rows.Scan(&r.DataType, &r.Ts, &r.Value, &r.StoredUnit); err != nil {
			rows.Close()
			return api.LatestResponse{}, fmt.Errorf("scan latest: %w", err)
		}
		latest = append(latest, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return api.LatestResponse{}, err
	}

	totals := map[string]float64{}
	for _, d := range SumDays(latest, loc) {
		if err := s.dayTotals(ctx, userID, req.TZ, d, totals); err != nil {
			return api.LatestResponse{}, err
		}
	}
	return Build(latest, totals, loc), nil
}

// dayTotals runs the shared merged aggregation over one local day for the
// summed types whose latest sample fell on it, and writes their totals (raw).
func (s *Service) dayTotals(ctx context.Context, userID uuid.UUID, tz string, d Day, out map[string]float64) error {
	rows, err := s.pool.Query(ctx, sourcemerge.BucketQuery,
		pgconv.UUID(userID), d.Types, "1 day", tz,
		pgconv.Timestamptz(d.Start), pgconv.Timestamptz(d.Start.AddDate(0, 0, 1)),
	)
	if err != nil {
		return fmt.Errorf("day total query: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var dataType string
		var bucket time.Time
		var sum, avg, mn, mx *float64
		if err := rows.Scan(&dataType, &bucket, &sum, &avg, &mn, &mx); err != nil {
			return fmt.Errorf("scan day total: %w", err)
		}
		if sum != nil {
			// One bucket per type for a one-day window; adding rather than
			// assigning is only a guard against the DST night folding a bucket.
			out[dataType] += *sum
		}
	}
	return rows.Err()
}

// Normalize trims, drops empties and duplicates, and keeps the order of first
// appearance — the request's list is a query-string CSV, and `a,,b, a` must not
// cost four lookups or answer twice.
func Normalize(names []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, n := range names {
		n = strings.TrimSpace(n)
		if n == "" || seen[n] {
			continue
		}
		seen[n] = true
		out = append(out, n)
	}
	return out
}

// Day is one local calendar day and the summed types whose latest sample fell on it.
type Day struct {
	Start time.Time
	Types []string
}

// SumDays groups the summed types by the local day of their latest sample.
//
// ⚠️ The day is cut in the REQUEST's zone, not UTC: a walk at 00:30 in Budapest
// is 22:30 UTC the evening before, and totalling the UTC day would hand back
// yesterday's steps under today's date. Averaged types are left out — they need
// no total.
//
// Sorted by day, and the types within a day by name, so the queries (and the
// tests) are deterministic.
func SumDays(rows []Row, loc *time.Location) []Day {
	byDay := map[time.Time][]string{}
	for _, r := range rows {
		if metrics.Meta(r.DataType).Agg != metrics.Sum {
			continue
		}
		start := localMidnight(r.Ts, loc)
		byDay[start] = append(byDay[start], r.DataType)
	}
	out := make([]Day, 0, len(byDay))
	for start, types := range byDay {
		sort.Strings(types)
		out = append(out, Day{Start: start, Types: types})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Start.Before(out[j].Start) })
	return out
}

// Build turns the rows into the wire answer.
//
// `totals` holds the merged day totals of the summed types (raw, as the
// aggregation returned them). A summed type whose total is missing gets no
// `day_total` rather than a zero: it can only happen if the sample vanished
// between the two queries, and "we could not total it" is not "nothing happened".
func Build(rows []Row, totals map[string]float64, loc *time.Location) api.LatestResponse {
	out := map[string]api.LatestValue{}
	for _, r := range rows {
		meta := metrics.Meta(r.DataType)
		ts := r.Ts.UTC()
		lv := api.LatestValue{
			Agg: api.LatestValueAgg(meta.Agg),
			Ts:  ts,
			Day: openapi_types.Date{Time: localDate(r.Ts, loc)},
		}
		unit := meta.Unit
		if unit == "" && !metrics.Known(r.DataType) {
			unit = r.StoredUnit
		}
		if unit != "" {
			lv.Unit = &unit
		}
		if meta.Agg == metrics.Sum {
			if t, ok := totals[r.DataType]; ok {
				v := float32(metrics.ToWire(r.DataType, t))
				lv.DayTotal = &v
			}
		} else {
			v := float32(metrics.ToWire(r.DataType, r.Value))
			lv.Value = &v
		}
		out[r.DataType] = lv
	}
	return api.LatestResponse{Tz: loc.String(), Metrics: out}
}

// localMidnight is 00:00 of the local day `t` falls on.
func localMidnight(t time.Time, loc *time.Location) time.Time {
	l := t.In(loc)
	return time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, loc)
}

// localDate is the same day as a zone-free date (what `format: date` carries) —
// UTC midnight of the local calendar date, so serialising it cannot shift it.
func localDate(t time.Time, loc *time.Location) time.Time {
	l := t.In(loc)
	return time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, time.UTC)
}
