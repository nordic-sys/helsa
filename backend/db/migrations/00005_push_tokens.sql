-- +goose Up
-- Storing APNs push tokens (docs/19).
--
-- ⚠️ This is ONLY the storage side. The actual sending (APNs key, delivery logic)
-- is an open decision — per docs/19 the output may end up being ntfy/HA instead
-- of push. The token, however, has to be acceptable already, because the client
-- receives it at the moment permission is granted, and has nowhere to put it.
--
-- The key is the (user_id, token) pair: the APNs device token IS the identifier,
-- and it changes on reinstall or restore. Keying on `id` would mean the same
-- device multiplies its rows on every token rotation.
CREATE TABLE IF NOT EXISTS push_tokens (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- The device reference is optional: the client does not always know the
    -- server-side device_id at the moment permission is granted. ON DELETE SET
    -- NULL, because the token stays valid even after the device row is deleted.
    device_id   uuid REFERENCES devices(id) ON DELETE SET NULL,
    token       text NOT NULL,
    platform    text NOT NULL,
    -- sandbox vs prod: the two APNs environments use SEPARATE token spaces;
    -- sending to a sandbox token via the prod endpoint is a silent delivery
    -- failure.
    environment text NOT NULL DEFAULT 'prod',
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, token)
);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id);

-- +goose Down
DROP TABLE IF EXISTS push_tokens;
