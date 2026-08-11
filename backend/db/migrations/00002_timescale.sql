-- +goose Up
-- The Timescale layer over the samples table: hypertable + compression +
-- continuous aggregates. A separate migration so that sqlc (which does not know
-- the Timescale functions) only reads 00001. See docs/03-adatmodell.md §3–4.

-- +goose StatementBegin
SELECT create_hypertable(
    'samples', 'ts',
    partitioning_column => 'user_id',
    number_partitions   => 4,
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists       => TRUE
);
-- +goose StatementEnd

ALTER TABLE samples SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'user_id, data_type'
);
-- +goose StatementBegin
SELECT add_compression_policy('samples', INTERVAL '30 days', if_not_exists => TRUE);
-- +goose StatementEnd

CREATE MATERIALIZED VIEW IF NOT EXISTS samples_hourly
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

CREATE MATERIALIZED VIEW IF NOT EXISTS samples_daily
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

CREATE OR REPLACE VIEW samples_weekly AS
SELECT user_id, data_type,
       time_bucket(INTERVAL '7 days', bucket) AS bucket,
       sum(sum_value) AS sum_value, avg(avg_value) AS avg_value,
       min(min_value) AS min_value, max(max_value) AS max_value, sum(n) AS n
FROM samples_daily
GROUP BY user_id, data_type, time_bucket(INTERVAL '7 days', bucket);

-- +goose Down
DROP VIEW IF EXISTS samples_weekly;
DROP MATERIALIZED VIEW IF EXISTS samples_daily;
DROP MATERIALIZED VIEW IF EXISTS samples_hourly;
ALTER TABLE samples SET (timescaledb.compress = false);
