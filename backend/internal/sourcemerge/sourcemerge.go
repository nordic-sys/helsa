// Package sourcemerge holds the ONE aggregation that turns raw samples into
// bucket totals — for /v1/summary, the insight rules, the step challenge and the
// Home Assistant daily summary alike.
//
// Why it exists (docs/25 F9): several apps write the same steps into HealthKit.
// On 2026-10-24 the iPhone, the Watch and the Huawei Health app each recorded
// the same walk (22 101, 21 811 and 23 494 steps), and a plain `sum(value)` made
// it 67 406 — while Apple's own merged figure for the day was 21 874. HealthKit
// merges overlapping sources by a priority list over each sample's [start, end]
// interval; the server stores only the start (`ts`, docs/25 F12) and knows no
// priority list, so it CANNOT replay that merge. What it can do is refuse to
// multiply.
//
// ⚠️ The rule, for every sum-aggregated metric (metrics.Sum):
//
//  1. per HOUR (in the user's timezone) and per SOURCE, sum the samples —
//     a source is `source_bundle`, or `source_device` when the bundle is empty;
//  2. the hour's value is the LARGEST of those per-source sums;
//  3. any wider bucket (day, month) is the SUM of its merged hours.
//
// Why hourly-max-then-sum and not max-of-the-day-per-source:
//
//   - It is additive. A day is the sum of its hours, a month the sum of its days,
//     so the 24 bars of the day view add up to the day's total, the web's
//     sum-of-buckets agrees with the server's `total`, and the challenge's
//     month equals the sum of its days. Max-of-day would make the day view and
//     the week view tell two different stories about the same day.
//   - It survives complementary coverage. Phone in the morning, Watch in the
//     afternoon (one left on the desk): max-of-day keeps only the larger half
//     and silently drops the rest; per-hour max keeps both halves. On the real
//     data this is a 46% difference on some days (2026-09-25: 6 752 vs 4 616).
//   - It is still cheap: one extra GROUP BY over rows already filtered by the
//     (user_id, data_type, ts) index.
//
// The price: within an hour where sources trade the lead it can only round UP,
// so it sits a few percent above max-of-day (2026-10-24: 24 200 against the
// day-max 23 494 and Apple's 21 874). It is an approximation of HealthKit's
// merge, never an exact replay — but it can no longer double or triple a day.
//
// A day with a single source is untouched: the per-hour max of one source is
// that source's sum, so the result equals the old plain sum exactly.
//
// Average-type metrics (heart rate & co.) are NOT merged: their avg is the
// sample-weighted mean over all sources, exactly the `avg(value)` the queries
// used before; min and max likewise.
package sourcemerge

// SourceExpr is what "one source" means: the writing app's bundle id, falling
// back to the device label when an older client sent no bundle. The empty string
// is a source too (both missing) — it must not vanish, or a sample with no
// provenance would silently drop out of every total.
const SourceExpr = `COALESCE(NULLIF(source_bundle, ''), NULLIF(source_device, ''), '')`

// BucketQuery is the aggregation. Parameters:
//
//	$1 user_id uuid
//	$2 data types   text[]
//	$3 bucket width interval — ONE HOUR OR WIDER, a whole number of hours
//	                (the merge happens per hour; a narrower bucket would
//	                be cut out of an already merged hour)
//	$4 timezone     text (IANA)
//	$5, $6          the [from, to) window — should start on a local hour
//
// Columns: data_type, bucket, sum_value (source-merged, for metrics.Sum),
// avg_value, min_value, max_value (all sources, for metrics.Avg).
//
// ⚠️ The hour is cut in the user's timezone, not in UTC: in a +05:30 zone a UTC
// hour straddles local midnight and would split one hour's merge across two days.
// The one cost is the autumn DST night, where Timescale folds the repeated local
// hour into one bucket — the merge then spans two real hours at 2 a.m., which
// for summed activity metrics is noise.
const BucketQuery = `
WITH per_source AS (
    SELECT data_type,
           time_bucket('1 hour'::interval, ts, $4::text) AS hour,
           ` + SourceExpr + ` AS source,
           sum(value)   AS sum_value,
           count(value) AS n,
           min(value)   AS min_value,
           max(value)   AS max_value
    FROM samples
    WHERE user_id = $1
      AND data_type = ANY($2::text[])
      AND ts >= $5 AND ts < $6
    GROUP BY data_type, hour, source
), per_hour AS (
    SELECT data_type, hour,
           max(sum_value) AS merged_sum,
           sum(sum_value) AS raw_sum,
           sum(n)         AS n,
           min(min_value) AS min_value,
           max(max_value) AS max_value
    FROM per_source
    GROUP BY data_type, hour
)
SELECT data_type,
       time_bucket($3::interval, hour, $4::text) AS bucket,
       sum(merged_sum)                  AS sum_value,
       sum(raw_sum) / NULLIF(sum(n), 0)::double precision AS avg_value,
       min(min_value)                   AS min_value,
       max(max_value)                   AS max_value
FROM per_hour
GROUP BY data_type, bucket
ORDER BY data_type, bucket`
