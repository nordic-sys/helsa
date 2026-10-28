-- +goose Up
-- A household on one server (docs/36 §1.3, F1; the review's changes §9.3).
--
-- ⚠️ users.apple_sub becomes users.handle IN THIS MIGRATION, together with the
-- regenerated queries: an older binary reading apple_sub fails after it. This is the
-- one change of the household work that is not backwards compatible (§4.2), and the
-- reason a downgrade after it needs the matching binary too.

ALTER TABLE users RENAME COLUMN apple_sub TO handle;
-- A short name people can type: bob, nori. NOT VALID, so that an existing install's
-- older names (a device name the token tool once turned into a user) do not stop the
-- migration; every new or renamed handle is checked.
ALTER TABLE users ADD CONSTRAINT users_handle_shape
    CHECK (handle ~ '^[a-z0-9][a-z0-9_-]{0,63}$') NOT VALID;

-- The member decides whether their daily numbers go to Home Assistant, not the
-- admin (§4.4). An install with exactly one user keeps publishing as it did (§9, C25).
ALTER TABLE users ADD COLUMN IF NOT EXISTS ha_publish boolean NOT NULL DEFAULT false;
UPDATE users SET ha_publish = true WHERE (SELECT count(*) FROM users) = 1;

-- ── one-time codes: join a phone (device), sign in a browser (web) ─────────────
CREATE TABLE IF NOT EXISTS enrolment_codes (
    code_hash  bytea PRIMARY KEY,                 -- SHA-256 of the code; the code is stored nowhere
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose    text NOT NULL CHECK (purpose IN ('device', 'web')),
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    used_at    timestamptz,
    used_label text,
    revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS enrolment_codes_user ON enrolment_codes (user_id);

-- ── what was done with an account — shown to its owner (§2.5) ───────────────────
CREATE TABLE IF NOT EXISTS account_events (
    id       bigserial PRIMARY KEY,
    user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
    kind     text NOT NULL,
    at       timestamptz NOT NULL DEFAULT now(),
    detail   jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS account_events_user_at ON account_events (user_id, at DESC);

-- ── deleting a member: a durable job, independent of the user's row (§9, C20) ───
-- Not a foreign key: the row has to outlive the user it is deleting, so that a crash
-- half-way can be resumed, and so that a restore of an older backup can be compared
-- against it (C22 — the copy that survives a rollback is the one the CLI prints).
CREATE TABLE IF NOT EXISTS deletion_jobs (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL,
    handle       text NOT NULL,
    requested_by uuid,
    requested_at timestamptz NOT NULL DEFAULT now(),
    stage        text NOT NULL DEFAULT 'queued'
                 CHECK (stage IN ('queued', 'rows', 'aggregates', 'cache', 'mqtt', 'queue', 'done')),
    attempts     int NOT NULL DEFAULT 0,
    last_error   text,
    done_at      timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS deletion_jobs_one_open ON deletion_jobs (user_id) WHERE done_at IS NULL;

-- ── row-level security on the new tables ───────────────────────────────────────
-- The owner's own rows, as in 00014 …
ALTER TABLE enrolment_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_events  ENABLE ROW LEVEL SECURITY;
-- A deletion job has no "own" reader: it is the admin's (who asked for it) and the
-- worker's (which bypasses row security). Only the admin policy below.
ALTER TABLE deletion_jobs   ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_rows ON enrolment_codes
  USING      (user_id = (SELECT NULLIF(current_setting('helsa.user_id', true), '')::uuid))
  WITH CHECK (user_id = (SELECT NULLIF(current_setting('helsa.user_id', true), '')::uuid));
CREATE POLICY own_rows ON account_events
  USING      (user_id = (SELECT NULLIF(current_setting('helsa.user_id', true), '')::uuid))
  WITH CHECK (user_id = (SELECT NULLIF(current_setting('helsa.user_id', true), '')::uuid));

-- … and, on the ACCOUNT tables only, everyone's rows for an admin: who has which
-- device, which codes are out, what was done with an account. ⛔ Never on a table of
-- health data — this is the "no looking in" of §2.5 written into the database: an
-- admin manages accounts, and reads nobody's measurements, sleep or journal.
-- The condition reads users, which has no row security, and sits directly in the
-- policy (the Auður trap, §4.8.1).
-- +goose StatementBegin
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['device_tokens', 'enrolment_codes', 'account_events', 'deletion_jobs'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS admin_accounts ON %I', t);
    EXECUTE format($p$
      CREATE POLICY admin_accounts ON %I
        USING (EXISTS (SELECT 1 FROM users a
                       WHERE a.id = (SELECT NULLIF(current_setting('helsa.user_id', true), '')::uuid)
                         AND a.role = 'admin' AND a.disabled_at IS NULL))
        WITH CHECK (EXISTS (SELECT 1 FROM users a
                       WHERE a.id = (SELECT NULLIF(current_setting('helsa.user_id', true), '')::uuid)
                         AND a.role = 'admin' AND a.disabled_at IS NULL))
    $p$, t);
  END LOOP;
END $$;
-- +goose StatementEnd

-- ── redeeming a code: one statement, one transaction (§9, C7) ──────────────────
-- Whoever redeems a code does not know yet whose it is — that is what the code says
-- — so this cannot run under the redeemer's own policies. It is a SECURITY DEFINER
-- function, owned by the owner, that does exactly one thing: consume a live,
-- unrevoked code of the given purpose for an enabled user, register the token, and
-- write the event — or nothing at all. Every failure looks the same to the caller
-- (NULL): unknown, expired, used, revoked, the wrong purpose, a disabled user.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION redeem_code(p_hash bytea, p_purpose text, p_token_id uuid,
                                       p_label text, p_kind text, p_expires timestamptz)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid;
BEGIN
  UPDATE enrolment_codes c SET used_at = now(), used_label = p_label
  WHERE c.code_hash = p_hash AND c.purpose = p_purpose
    AND c.used_at IS NULL AND c.revoked_at IS NULL AND c.expires_at > now()
    AND EXISTS (SELECT 1 FROM users u WHERE u.id = c.user_id AND u.disabled_at IS NULL)
  RETURNING c.user_id INTO v_user;
  IF v_user IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO device_tokens (id, user_id, label, kind, created_by, expires_at)
  VALUES (p_token_id, v_user, p_label, p_kind, NULL, p_expires);
  INSERT INTO account_events (user_id, actor_id, kind, detail)
  VALUES (v_user, v_user, 'code_redeemed',
          jsonb_build_object('purpose', p_purpose, 'label', p_label, 'token_id', p_token_id));
  RETURN v_user;
END $$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION redeem_code(bytea, text, uuid, text, text, timestamptz) FROM PUBLIC;

-- +goose Down
DROP FUNCTION IF EXISTS redeem_code(bytea, text, uuid, text, text, timestamptz);
DROP TABLE IF EXISTS deletion_jobs;
DROP TABLE IF EXISTS account_events;
DROP TABLE IF EXISTS enrolment_codes;
-- +goose StatementBegin
DO $$ BEGIN
  DROP POLICY IF EXISTS admin_accounts ON device_tokens;
END $$;
-- +goose StatementEnd
ALTER TABLE users DROP COLUMN IF EXISTS ha_publish;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_handle_shape;
ALTER TABLE users RENAME COLUMN handle TO apple_sub;
