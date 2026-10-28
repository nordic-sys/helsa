-- +goose Up
-- The operational half of the household (docs/36 F1).

-- When a member's phone last delivered a batch — what the admin's Household page
-- shows instead of anything read out of the member's data. The worker writes it with
-- every batch; the admin cannot read a member's samples or devices (row security),
-- and should not have to.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_upload_at timestamptz;

-- ── removing a deleted member's hourly aggregates (docs/36 §4.8.9) ─────────────
-- Deleting a user cascades through the raw rows in tens of milliseconds, but the
-- materialised hourly aggregate is not a foreign key and keeps every bucket older
-- than its 7-day refresh window. refresh_continuous_aggregate would clear them, but
-- only the aggregate's owner may call it, and the worker is not the owner.
--
-- So: one narrow SECURITY DEFINER function that deletes ONE user's rows from the
-- materialisation table — measured at ~0.2 s for half a million rows. The table is
-- looked up in Timescale's catalog rather than named, because its name is an
-- implementation detail that changes with every re-creation of the aggregate. It
-- refuses to run for a user who still exists: it is for the dead only.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION purge_deleted_user_aggregates(p_user uuid)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mat regclass;
  v_n bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE id = p_user) THEN
    RAISE EXCEPTION 'user % still exists — aggregates are purged only after the user is gone', p_user;
  END IF;
  SELECT format('%I.%I', materialization_hypertable_schema, materialization_hypertable_name)::regclass
    INTO v_mat
    FROM timescaledb_information.continuous_aggregates
    WHERE view_schema = 'public' AND view_name = 'samples_hourly';
  IF v_mat IS NULL THEN
    RETURN 0;
  END IF;
  EXECUTE format('DELETE FROM %s WHERE user_id = $1', v_mat) USING p_user;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION purge_deleted_user_aggregates(uuid) FROM PUBLIC;

-- A member may queue their OWN deletion (DELETE /v1/me); reading and running the
-- jobs stays the admin's and the worker's (00015).
DROP POLICY IF EXISTS own_insert ON deletion_jobs;
CREATE POLICY own_insert ON deletion_jobs FOR INSERT
  WITH CHECK (user_id = (SELECT NULLIF(current_setting('helsa.user_id', true), '')::uuid));

-- +goose Down
DROP POLICY IF EXISTS own_insert ON deletion_jobs;
DROP FUNCTION IF EXISTS purge_deleted_user_aggregates(uuid);
ALTER TABLE users DROP COLUMN IF EXISTS last_upload_at;
