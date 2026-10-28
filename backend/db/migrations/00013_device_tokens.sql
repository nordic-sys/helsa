-- +goose Up
-- The register of issued tokens (docs/36 §1.3). Until now a token was only a signed
-- JWT: the deny-list knew which ones had been revoked, nothing knew which ones
-- existed, so "Nóri's devices" could not be listed, let alone taken back one by one.
--
-- A token issued from now on carries `jti` = this row's id, and is accepted only
-- while the row says so (not revoked, not expired, the same user). Tokens issued
-- before this migration have no `jti` and no row; they keep working through the
-- hash deny-list, exactly as before.
CREATE TABLE IF NOT EXISTS device_tokens (
    id           uuid PRIMARY KEY,                -- = the JWT's `jti`
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label        text NOT NULL,                   -- "Nóri iPhone", "kitchen Mac"
    kind         text NOT NULL CHECK (kind IN ('device', 'web')),
    created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    -- Written at most once an hour and never read for a decision: it is there to
    -- show "last used", not to grant anything.
    last_used_at timestamptz,
    revoked_at   timestamptz
);
CREATE INDEX IF NOT EXISTS device_tokens_user_live ON device_tokens (user_id) WHERE revoked_at IS NULL;

-- +goose Down
DROP TABLE IF EXISTS device_tokens;
