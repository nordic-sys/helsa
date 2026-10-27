-- +goose Up
-- docs/25 F9: the continuous aggregates summed every source on top of each other.
--
-- When the iPhone, the Watch and a third-party app all write the same walk into
-- HealthKit, `sum(value)` per bucket counts it three times (2026-10-24: 67 406
-- steps against Apple's 21 874). The read path now merges sources in
-- internal/sourcemerge — per HOUR the largest per-source sum, wider buckets sum
-- their hours — and the aggregates here must say the same thing, or the first
-- query that reads them would bring the inflation back.
--
-- ⚠️ Nothing in the backend reads these objects today (the API aggregates the raw
-- hypertable in the user's timezone; these are cut in UTC). They are rebuilt
-- rather than dropped because docs/03 and the restore runbook describe them.
--
-- Shape after this migration:
--   samples_hourly  — CONTINUOUS aggregate, one row per (user, type, SOURCE, UTC
--                     hour). The source is the only way to merge later: a
--                     pre-summed hour can never be un-summed.
--   samples_daily   — PLAIN view: per hour max over sources, then summed per day.
--                     A continuous aggregate cannot nest aggregates (max inside
--                     sum), and a hierarchical one would sum per source, which is
--                     the wrong order. Reading it is cheap: it scans the hourly
--                     materialisation (a few rows per type per hour), never the
--                     raw samples.
--   samples_weekly  — PLAIN view over samples_daily, as before.
--
-- avg_value is now the sample-WEIGHTED mean (sum / n) rather than an average of
-- averages (docs/25 F13/F19) — it falls out of keeping sum and n per source.
--
-- Operator note: like the aggregates it replaces, samples_hourly is created WITH
-- NO DATA and its policy fills the last 7 days within the hour. Nothing in the
-- API depends on older history being materialised. To materialise all of it
-- anyway (optional; outside a transaction, can take minutes on millions of rows):
--   CALL refresh_continuous_aggregate('samples_hourly', NULL, now() - INTERVAL '1 hour');

DROP VIEW IF EXISTS samples_weekly;
DROP MATERIALIZED VIEW IF EXISTS samples_daily;
DROP MATERIALIZED VIEW IF EXISTS samples_hourly;

CREATE MATERIALIZED VIEW samples_hourly
WITH (timescaledb.continuous) AS
SELECT user_id, data_type,
       COALESCE(NULLIF(source_bundle, ''), NULLIF(source_device, ''), '') AS source,
       time_bucket(INTERVAL '1 hour', ts) AS bucket,
       sum(value) AS sum_value, count(value) AS n,
       min(value) AS min_value, max(value) AS max_value
FROM samples
GROUP BY user_id, data_type,
         COALESCE(NULLIF(source_bundle, ''), NULLIF(source_device, ''), ''),
         time_bucket(INTERVAL '1 hour', ts)
WITH NO DATA;

-- 7 days back, not 3: samples_daily is derived from this one now, and it used to
-- be refreshed a week back (late syncs from a phone that was offline for days).
-- +goose StatementBegin
SELECT add_continuous_aggregate_policy('samples_hourly',
    start_offset => INTERVAL '7 days', end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour', if_not_exists => TRUE);
-- +goose StatementEnd

CREATE VIEW samples_daily AS
WITH per_hour AS (
    SELECT user_id, data_type, bucket,
           max(sum_value) AS merged_sum,
           sum(sum_value) AS raw_sum,
           sum(n)         AS n,
           min(min_value) AS min_value,
           max(max_value) AS max_value
    FROM samples_hourly
    GROUP BY user_id, data_type, bucket
)
SELECT user_id, data_type,
       time_bucket(INTERVAL '1 day', bucket) AS bucket,
       sum(merged_sum)                                   AS sum_value,
       sum(raw_sum) / NULLIF(sum(n), 0)::double precision AS avg_value,
       min(min_value)                                    AS min_value,
       max(max_value)                                    AS max_value,
       sum(n)                                            AS n
FROM per_hour
GROUP BY user_id, data_type, time_bucket(INTERVAL '1 day', bucket);

CREATE VIEW samples_weekly AS
SELECT user_id, data_type,
       time_bucket(INTERVAL '7 days', bucket) AS bucket,
       sum(sum_value)                                              AS sum_value,
       sum(avg_value * n) / NULLIF(sum(n), 0)::double precision    AS avg_value,
       min(min_value)                                              AS min_value,
       max(max_value)                                              AS max_value,
       sum(n)                                                      AS n
FROM samples_daily
GROUP BY user_id, data_type, time_bucket(INTERVAL '7 days', bucket);

-- +goose Down
-- Back to the 00002 definitions (source-blind sums), WITH NO DATA like the
-- originals; their policies refill the recent window.
DROP VIEW IF EXISTS samples_weekly;
DROP VIEW IF EXISTS samples_daily;
DROP MATERIALIZED VIEW IF EXISTS samples_hourly;

CREATE MATERIALIZED VIEW samples_hourly
WITH (timescaledb.continuous) AS
SELECT user_id, data_type,
       time_bucket(INTERVAL '1 hour', ts) AS bucket,
       sum(value) AS sum_value, avg(value) AS avg_value,
       min(value) AS min_value, max(value) AS max_value, count(*) AS n
FROM samples
GROUP BY user_id, data_type, bucket
WITH NO DATA;

-- +goose StatementBegin
SELECT add_continuous_aggregate_policy('samples_hourly',
    start_offset => INTERVAL '3 days', end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour', if_not_exists => TRUE);
-- +goose StatementEnd

CREATE MATERIALIZED VIEW samples_daily
WITH (timescaledb.continuous) AS
SELECT user_id, data_type,
       time_bucket(INTERVAL '1 day', ts) AS bucket,
       sum(value) AS sum_value, avg(value) AS avg_value,
       min(value) AS min_value, max(value) AS max_value, count(*) AS n
FROM samples
GROUP BY user_id, data_type, bucket
WITH NO DATA;

-- +goose StatementBegin
SELECT add_continuous_aggregate_policy('samples_daily',
    start_offset => INTERVAL '7 days', end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour', if_not_exists => TRUE);
-- +goose StatementEnd

CREATE VIEW samples_weekly AS
SELECT user_id, data_type,
       time_bucket(INTERVAL '7 days', bucket) AS bucket,
       sum(sum_value) AS sum_value, avg(avg_value) AS avg_value,
       min(min_value) AS min_value, max(max_value) AS max_value, sum(n) AS n
FROM samples_daily
GROUP BY user_id, data_type, time_bucket(INTERVAL '7 days', bucket);
