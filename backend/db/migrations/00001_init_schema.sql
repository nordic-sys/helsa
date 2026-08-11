-- +goose Up
-- Helsa's canonical relational schema (the counterpart of the local bootstrap in
-- deploy/). Source: docs/03-adatmodell.md. The Timescale layer (hypertable,
-- compression, continuous aggregates) lives in migration 00002 — that way sqlc
-- only reads this file (it does not know the Timescale functions).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    apple_sub    text UNIQUE NOT NULL,
    email        text,
    display_name text,
    time_zone    text NOT NULL DEFAULT 'UTC',
    locale       text NOT NULL DEFAULT 'en',
    unit_system  text NOT NULL DEFAULT 'metric',
    notif_prefs  jsonb NOT NULL DEFAULT '{}'::jsonb,
    consent_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devices (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform     text NOT NULL,
    model        text,
    name         text,
    time_zone    text,
    last_seen_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);

CREATE TABLE IF NOT EXISTS workouts (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_uuid       text NOT NULL,
    activity_type     text NOT NULL,
    started_at        timestamptz NOT NULL,
    ended_at          timestamptz,
    total_energy_kcal double precision,
    total_distance_m  double precision,
    metadata          jsonb,
    UNIQUE (user_id, source_uuid)
);
CREATE INDEX IF NOT EXISTS idx_workouts_user_time ON workouts(user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS sync_state (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    data_type  text NOT NULL,
    anchor     text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, data_type)
);

CREATE TABLE IF NOT EXISTS sleep_segments (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_uuid text NOT NULL,
    started_at  timestamptz NOT NULL,
    ended_at    timestamptz NOT NULL,
    stage       text NOT NULL,
    ingested_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, source_uuid)
);
CREATE INDEX IF NOT EXISTS idx_sleep_user_time ON sleep_segments(user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS goals (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    metric       text NOT NULL,
    target_value double precision NOT NULL,
    unit         text NOT NULL,
    source       text NOT NULL DEFAULT 'user',
    hk_value     double precision,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, metric)
);

CREATE TABLE IF NOT EXISTS activity_summary (
    user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day                date NOT NULL,
    active_energy      double precision,
    active_energy_goal double precision,
    exercise_minutes   double precision,
    exercise_goal      double precision,
    stand_hours        double precision,
    stand_goal         double precision,
    ingested_at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, day)
);

-- samples is created here as a plain table; 00002 turns it into a hypertable.
-- ⚠️ The PK contains the partitioning columns (user_id, ts) — a Timescale
-- constraint.
CREATE TABLE IF NOT EXISTS samples (
    user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ts            timestamptz NOT NULL,
    data_type     text        NOT NULL,
    value         double precision,
    unit          text,
    workout_id    uuid,
    source_uuid   text        NOT NULL,
    source_device text,
    source_bundle text,
    ingested_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, ts, source_uuid)
);
CREATE INDEX IF NOT EXISTS idx_samples_user_type_time ON samples (user_id, data_type, ts DESC);

-- +goose Down
DROP TABLE IF EXISTS samples;
DROP TABLE IF EXISTS activity_summary;
DROP TABLE IF EXISTS goals;
DROP TABLE IF EXISTS sleep_segments;
DROP TABLE IF EXISTS sync_state;
DROP TABLE IF EXISTS workouts;
DROP TABLE IF EXISTS devices;
DROP TABLE IF EXISTS users;
