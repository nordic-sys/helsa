// Package summary provides the timezone-aware dashboard aggregation
// (GET /v1/summary).
//
// Why hand-written pgx and not sqlc? sqlc cannot type the three-argument
// (timezone-aware) flavour of Timescale's time_bucket(width, ts, tz). "Steps
// today" depends on the user's timezone (docs/03 §6.1), so we cut the buckets in
// that timezone, not in UTC.
//
// Read-path cache: the computed response goes into Redis with a short TTL
// (docs/05 §5).
package summary

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"github.com/redis/go-redis/v9"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/metrics"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
)

const cacheTTL = 60 * time.Second

// bkt is a type alias for the element type of the generated MetricSeries.Buckets
// (an anonymous struct). Because it is an alias (=), []bkt is the same type as
// the generated one and can be assigned to it.
type bkt = struct {
	Avg *float32 `json:"avg,omitempty"`
	Max *float32 `json:"max,omitempty"`
	Min *float32 `json:"min,omitempty"`
	T   *string  `json:"t,omitempty"`
	V   *float32 `json:"v,omitempty"`
}

type Request struct {
	Range   string
	Metrics []string
	TZ      string
	From    *time.Time
	To      *time.Time
}

type Service struct {
	pool  *pgxpool.Pool
	redis *redis.Client
}

func New(pool *pgxpool.Pool, rdb *redis.Client) *Service {
	return &Service{pool: pool, redis: rdb}
}

// Compute returns the timezone-aware aggregate (cached).
func (s *Service) Compute(ctx context.Context, userID uuid.UUID, req Request) (api.SummaryResponse, error) {
	loc, err := time.LoadLocation(req.TZ)
	if err != nil {
		return api.SummaryResponse{}, fmt.Errorf("unknown tz %q: %w", req.TZ, err)
	}
	bucket, start, end := window(req, loc)

	key := cacheKey(userID, req, start, end)
	if cached, err := s.redis.Get(ctx, key).Bytes(); err == nil {
		var resp api.SummaryResponse
		if json.Unmarshal(cached, &resp) == nil {
			return resp, nil
		}
	}

	rows, err := s.pool.Query(ctx, aggQuery,
		pgconv.UUID(userID), req.Metrics, bucket, req.TZ,
		pgconv.Timestamptz(start), pgconv.Timestamptz(end),
	)
	if err != nil {
		return api.SummaryResponse{}, fmt.Errorf("aggregation query: %w", err)
	}
	defer rows.Close()

	series := map[string]*api.MetricSeries{}
	for rows.Next() {
		var dataType string
		var b time.Time
		var sum, avg, mn, mx *float64
		if err := rows.Scan(&dataType, &b, &sum, &avg, &mn, &mx); err != nil {
			return api.SummaryResponse{}, fmt.Errorf("scan: %w", err)
		}
		meta := metrics.Meta(dataType)
		ms := series[dataType]
		if ms == nil {
			a, unit := api.MetricSeriesAgg(meta.Agg), meta.Unit
			ms = &api.MetricSeries{Agg: &a, Unit: &unit, Buckets: &[]bkt{}}
			series[dataType] = ms
		}
		*ms.Buckets = append(*ms.Buckets, makeBucket(dataType, meta.Agg, b, sum, avg, mn, mx))
	}
	if err := rows.Err(); err != nil {
		return api.SummaryResponse{}, err
	}

	out := map[string]api.MetricSeries{}
	for name, ms := range series {
		setTotal(ms, metrics.Meta(name).Agg)
		out[name] = *ms
	}
	fillMissingSeries(out, req)

	rng, tz := req.Range, req.TZ
	fromD := openapi_types.Date{Time: start}
	toD := openapi_types.Date{Time: end.AddDate(0, 0, -1)}
	resp := api.SummaryResponse{Range: &rng, Tz: &tz, From: &fromD, To: &toD, Metrics: &out}

	if buf, err := json.Marshal(resp); err == nil {
		s.redis.Set(ctx, key, buf, cacheTTL)
	}
	return resp, nil
}

// window derives the bucket width and the [start,end) window in the user's
// timezone from range (or from/to).
func window(req Request, loc *time.Location) (bucket string, start, end time.Time) {
	now := time.Now().In(loc)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)

	switch req.Range {
	case "day":
		bucket, start, end = "1 hour", today, today.AddDate(0, 0, 1)
	case "week":
		bucket, start, end = "1 day", today.AddDate(0, 0, -6), today.AddDate(0, 0, 1)
	case "month":
		bucket, start, end = "1 day", today.AddDate(0, 0, -29), today.AddDate(0, 0, 1)
	case "year":
		firstOfMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, loc)
		bucket, start, end = "1 month", firstOfMonth.AddDate(0, -11, 0), firstOfMonth.AddDate(0, 1, 0)
	default:
		bucket, start, end = "1 day", today.AddDate(0, 0, -6), today.AddDate(0, 0, 1)
	}

	if req.From != nil {
		d := *req.From
		start = time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, loc)
	}
	if req.To != nil {
		d := *req.To
		end = time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, loc).AddDate(0, 0, 1)
	}
	return bucket, start, end
}

// makeBucket turns one aggregated SQL row into a wire bucket.
//
// The wire scaling (percent 0…1 → 0…100) happens HERE, ONCE: the buckets already
// hold converted values, so both the `total` computed from them and the copy put
// into Redis stay consistent — a cache hit does not convert a second time.
func makeBucket(dataType string, agg metrics.Agg, t time.Time, sum, avg, mn, mx *float64) bkt {
	ts := t.Format(time.RFC3339)
	row := bkt{T: &ts}
	if agg == metrics.Sum {
		row.V = f64to32(metrics.ToWirePtr(dataType, sum))
		return row
	}
	row.Avg = f64to32(metrics.ToWirePtr(dataType, avg))
	row.Min = f64to32(metrics.ToWirePtr(dataType, mn))
	row.Max = f64to32(metrics.ToWirePtr(dataType, mx))
	return row
}

// fillMissingSeries puts the metrics that were requested but have no data into
// the response as well — with an empty series AND a missing total.
//
// ⚠️ A pointer to zero used to sit in the total here, which cancelled out
// `setTotal`'s missing-total logic: the client once again could not tell "0
// steps" from "no data has arrived yet". The MEANING of total has to be the same
// on both paths, otherwise one branch quietly asserts something different from
// the other.
func fillMissingSeries(out map[string]api.MetricSeries, req Request) {
	for _, name := range req.Metrics {
		if _, ok := out[name]; !ok {
			meta := metrics.Meta(name)
			a, unit := api.MetricSeriesAgg(meta.Agg), meta.Unit
			out[name] = api.MetricSeries{Agg: &a, Unit: &unit, Buckets: &[]bkt{}}
		}
	}
}

// setTotal computes from buckets that are ALREADY wire-scaled, so the total does
// not need converting again (and must not be — that would be a double
// multiplication).
func setTotal(ms *api.MetricSeries, agg metrics.Agg) {
	if ms.Buckets == nil {
		return
	}
	var total float32
	var n int
	for _, b := range *ms.Buckets {
		switch agg {
		case metrics.Sum:
			if b.V != nil {
				total += *b.V
				n++
			}
		case metrics.Avg:
			if b.Avg != nil {
				total += *b.Avg
				n++
			}
		}
	}
	// ⚠️ The field is MISSING when there is not a single measured value — NOT zero.
	//
	// "0 steps today" and "no data has arrived today yet" are two different
	// statements, and in a health app the first is alarming while the second is
	// perfectly normal. If the server returned 0, the client could not tell them
	// apart — and all three clients would have to work it out separately. So it is
	// decided here, once.
	if n == 0 {
		ms.Total = nil
		return
	}
	if agg == metrics.Avg {
		total /= float32(n)
	}
	ms.Total = &total
}

func cacheKey(userID uuid.UUID, req Request, start, end time.Time) string {
	return strings.Join([]string{
		cacheKeyPrefix(userID), req.Range, req.TZ,
		strings.Join(req.Metrics, ","), start.Format(time.RFC3339), end.Format(time.RFC3339),
	}, ":")
}

func cacheKeyPrefix(userID uuid.UUID) string {
	return "summary:" + userID.String()
}

// InvalidateUser throws away all of the user's cached summaries (called after
// ingestion, docs/05 §5). MVP: KEYS+DEL — good enough at local dev size; in
// production this should be swapped for SCAN.
func InvalidateUser(ctx context.Context, rdb *redis.Client, userID uuid.UUID) error {
	keys, err := rdb.Keys(ctx, cacheKeyPrefix(userID)+":*").Result()
	if err != nil {
		return err
	}
	if len(keys) == 0 {
		return nil
	}
	return rdb.Del(ctx, keys...).Err()
}

func f64to32(v *float64) *float32 {
	if v == nil {
		return nil
	}
	f := float32(*v)
	return &f
}

const aggQuery = `
SELECT data_type,
       time_bucket($3::interval, ts, $4::text) AS bucket,
       sum(value)  AS sum_value,
       avg(value)  AS avg_value,
       min(value)  AS min_value,
       max(value)  AS max_value
FROM samples
WHERE user_id = $1
  AND data_type = ANY($2::text[])
  AND ts >= $5 AND ts < $6
GROUP BY data_type, bucket
ORDER BY data_type, bucket`
