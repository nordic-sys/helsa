-- +goose Up
-- 2A.3 — levelling out schema drift. The `CREATE TABLE IF NOT EXISTS devices` in
-- 00001 is a no-op if the table was created by the bootstrap script in deploy/
-- (init/timescaledb/02-schema.sql) — and that one has NO time_zone column, while
-- 00001 does. An idempotent ALTER levels it out, so that a database bootstrapped
-- either way ends up in the same place.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS time_zone text;

-- 2A.3 — the key for the device upsert. The same physical device should not get
-- duplicated when the client registers or heartbeats without an `id`. `model` is
-- nullable, hence an expression index with COALESCE: NULL and the empty string
-- count as the same thing (a plain UNIQUE would not catch it, because
-- NULL != NULL).
CREATE UNIQUE INDEX IF NOT EXISTS uq_devices_user_platform_model
    ON devices (user_id, platform, (COALESCE(model, '')));

-- +goose Down
DROP INDEX IF EXISTS uq_devices_user_platform_model;
