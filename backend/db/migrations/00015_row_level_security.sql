-- +goose Up
-- The database's own line behind the application's `WHERE user_id = …` (docs/36
-- §4.8, decided as D14 on 2026-10-28 after the F0 measurement, §4.8.8).
--
-- `helsa.user_id` is set on every connection the pool hands out, from the context
-- that asked for it (internal/store): the request's user, or the queued batch's, or
-- "" for nobody. Unset or "", every policy here returns NO rows — an empty screen,
-- never somebody else's data.
--
-- ⚠️ Three things the measurement taught, each of which is a rule below:
--   1. The condition is written as a scalar subquery — `(SELECT NULLIF(…))` — not
--      as a bare function call. As a subquery it is an InitPlan, evaluated once per
--      query; as a call, current_setting() is evaluated on every row, and on the
--      compressed chunks that halved the yearly trends.
--   2. NULLIF(…, ''): once a transaction-local setting has been used, the session
--      keeps the name with the value "", and ''::uuid is an ERROR, not "nobody".
--   3. The condition sits IN the policy, never in a SECURITY DEFINER function: a
--      function in a policy does not see the row an INSERT … RETURNING has just
--      written (measured in Auður, docs/36 §4.8.1).
--
-- The owner (migrations, pg_dump, local development) is not bound by row-level
-- security; that is deliberate. The table is not FORCEd.

-- ── samples: no row-level security, a view instead ─────────────────────────
-- TimescaleDB refuses row security on a compressed hypertable, in either order
-- (docs/36 §9.1). So the API's role gets no right on the table at all (see
-- deploy/init/timescaledb/03-app-role.sql) and reads through this view, which the
-- owner owns and which filters on the setting. Only the worker writes the table.
--
-- Not security_barrier, on purpose: the barrier stops a caller's leaky function
-- from seeing rows before the filter — a defence against arbitrary SQL, which is not
-- this layer's job (§9, C17) — and it cost the "newest N" queries a factor of 175
-- to 300 (§4.8.8).
CREATE OR REPLACE VIEW my_samples AS
  SELECT * FROM samples
  WHERE user_id = (SELECT NULLIF(current_setting('helsa.user_id', true), '')::uuid);

-- ── every table that holds a user's rows ─────────────────────────────────────
-- +goose StatementBegin
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'devices', 'workouts', 'sync_state', 'sleep_segments', 'goals', 'activity_summary',
    'push_tokens', 'achievements', 'phone_settings', 'journal_entries', 'device_tokens'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS own_rows ON %I', t);
    EXECUTE format($p$
      CREATE POLICY own_rows ON %I
        USING      (user_id = (SELECT NULLIF(current_setting('helsa.user_id', true), '')::uuid))
        WITH CHECK (user_id = (SELECT NULLIF(current_setting('helsa.user_id', true), '')::uuid))
    $p$, t);
  END LOOP;
END $$;
-- +goose StatementEnd

-- Route points have no user_id of their own: they belong to whoever owns the
-- workout, and the workout's own policy answers that inside this one.
ALTER TABLE workout_route_points ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_rows ON workout_route_points;
CREATE POLICY own_rows ON workout_route_points
  USING      (EXISTS (SELECT 1 FROM workouts w WHERE w.id = workout_route_points.workout_id))
  WITH CHECK (EXISTS (SELECT 1 FROM workouts w WHERE w.id = workout_route_points.workout_id));

-- +goose Down
-- +goose StatementBegin
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'devices', 'workouts', 'sync_state', 'sleep_segments', 'goals', 'activity_summary',
    'push_tokens', 'achievements', 'phone_settings', 'journal_entries', 'device_tokens',
    'workout_route_points'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS own_rows ON %I', t);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
-- +goose StatementEnd
DROP VIEW IF EXISTS my_samples;
