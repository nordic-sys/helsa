-- The variants of the RLS measurement (docs/36 §4.8.5, §9.3/6). Throwaway database
-- helsa_rls only; run as the owner after seed.sql.
--
--   (a) role separation: helsa_rls_api has NO right on samples; it reads through
--       my_samples, an owner-owned security_barrier view that filters on the
--       transaction's helsa.user_id. The worker would keep writing the table.
--   (b) no compression: samples_plain is an uncompressed copy of samples with RLS.
--   small tables: RLS policies on workouts and sleep_segments (toggled by the bench).
\set ON_ERROR_STOP on

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helsa_rls_api') THEN
    CREATE ROLE helsa_rls_api LOGIN PASSWORD 'bench' NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helsa_rls_base') THEN
    CREATE ROLE helsa_rls_base LOGIN PASSWORD 'bench' NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
GRANT CONNECT ON DATABASE helsa_rls TO helsa_rls_api, helsa_rls_base;
GRANT USAGE ON SCHEMA public TO helsa_rls_api, helsa_rls_base;

-- The baseline: today's model — a plain role with a direct SELECT on the table.
GRANT SELECT ON samples, workouts, sleep_segments TO helsa_rls_base;

-- (a)
CREATE OR REPLACE VIEW my_samples WITH (security_barrier) AS
  SELECT * FROM samples
  WHERE user_id = NULLIF(current_setting('helsa.user_id', true), '')::uuid;
REVOKE ALL ON samples, samples_hourly, samples_daily, samples_weekly FROM helsa_rls_api;
GRANT SELECT ON my_samples TO helsa_rls_api;

-- (b)
DROP TABLE IF EXISTS samples_plain;
CREATE TABLE samples_plain (LIKE samples INCLUDING DEFAULTS);
ALTER TABLE samples_plain ADD PRIMARY KEY (user_id, ts, source_uuid);
CREATE INDEX ON samples_plain (user_id, data_type, ts DESC);
SELECT create_hypertable('samples_plain', 'ts', partitioning_column => 'user_id',
                         number_partitions => 4, chunk_time_interval => INTERVAL '7 days');
\timing on
INSERT INTO samples_plain SELECT * FROM samples;
\timing off
ALTER TABLE samples_plain ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_rows ON samples_plain
  USING (user_id = NULLIF(current_setting('helsa.user_id', true), '')::uuid);
GRANT SELECT ON samples_plain TO helsa_rls_api;

-- small tables (enabled/disabled by the bench between phases)
DROP POLICY IF EXISTS own_rows ON workouts;
CREATE POLICY own_rows ON workouts
  USING (user_id = NULLIF(current_setting('helsa.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('helsa.user_id', true), '')::uuid);
DROP POLICY IF EXISTS own_rows ON sleep_segments;
CREATE POLICY own_rows ON sleep_segments
  USING (user_id = NULLIF(current_setting('helsa.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('helsa.user_id', true), '')::uuid);
GRANT SELECT ON workouts, sleep_segments TO helsa_rls_api;

ANALYZE samples_plain;
SELECT 'samples (compressed)' AS t, pg_size_pretty(hypertable_size('samples')) AS size
UNION ALL SELECT 'samples_plain (uncompressed)', pg_size_pretty(hypertable_size('samples_plain'));

-- (a') the same filter WITHOUT security_barrier. The barrier only matters against a
-- caller who can put a leaky function into the query — arbitrary SQL, which is not
-- the threat here (docs/36 §9, C17). Measured because the barrier costs the ordered
-- LIMIT plans (see README.md).
CREATE OR REPLACE VIEW my_samples_nb AS
  SELECT * FROM samples
  WHERE user_id = NULLIF(current_setting('helsa.user_id', true), '')::uuid;
GRANT SELECT ON my_samples_nb TO helsa_rls_api;

-- (a'') the same filter as a scalar subquery: an InitPlan, evaluated once per query,
-- which Timescale pushes down to the compressed batches like a parameter — instead
-- of a STABLE function call evaluated on every decompressed row, as in (a').
CREATE OR REPLACE VIEW my_samples_ip AS
  SELECT * FROM samples
  WHERE user_id = (SELECT NULLIF(current_setting('helsa.user_id', true), '')::uuid);
GRANT SELECT ON my_samples_ip TO helsa_rls_api;
