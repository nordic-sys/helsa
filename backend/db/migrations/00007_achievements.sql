-- +goose Up
-- Storing badges (docs/21 2A). The phone evaluates, the server STORES — the
-- thresholds live on the client, server-side evaluation would first require
-- syncing the settings up, and the iPhone is the only uploader anyway (docs/04).
--
-- The row also carries the NUMBERS as they stood when it was earned (a `value` +
-- `thresholds` snapshot), not a reference to today's setting. The thresholds are
-- user-editable: if next year they raise the monthly goal, a month completed long
-- ago would "degrade back" if the card were recomputed from the current setting.
-- A badge is a historical fact.
CREATE TABLE IF NOT EXISTS achievements (
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- A stable identifier formed by the client (`<kind>:<code>[:<period>]`). NOT a
    -- server-side uuid: this is what gives idempotency; without it every sync would
    -- scatter new rows.
    id         text NOT NULL,
    kind       text NOT NULL,
    code       text NOT NULL,
    period     text,
    value      double precision,
    unit       text,
    -- The threshold snapshot is `integer[]` and not jsonb: the contract prescribes
    -- an array of integers, and jsonb is used in this repository only for fields
    -- whose shape is genuinely open (notif_prefs, workouts.metadata). This way the
    -- database rejects the wrong shape too, and pgx hands it back as an array —
    -- no JSON round trip, and no silently accepted junk.
    thresholds integer[],
    -- No DEFAULT now(): the time earned is the client's statement about a moment in
    -- the PAST (it may well be the first sync after the end of the month), not the
    -- time of arrival.
    earned_at  timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    -- The identifier is only unique within a user: `month:complete:2026-08` would
    -- be the same string for everybody.
    PRIMARY KEY (user_id, id)
);

-- The GET reads in exactly this order (most recently earned badge first).
CREATE INDEX IF NOT EXISTS idx_achievements_user_earned
    ON achievements(user_id, earned_at DESC);

-- +goose Down
DROP TABLE IF EXISTS achievements;
