-- +goose Up
-- The settings the PHONE decides and the web wants to show (docs/35): the
-- monthly challenge's milestones and chosen rest days, the water goal, and the
-- virtual journey. Until now they lived only in the phone's App Group defaults,
-- so GET /v1/challenge had to guess the milestones from a badge snapshot and
-- could not apply a rest day at all.
--
-- Their own table rather than more columns on `users`, for two reasons. The
-- author is different: `users` holds what the server or the web decides (time
-- zone, locale, notifications), this holds what one phone said, and keeping the
-- two apart keeps "who wrote this" answerable. And the write is different: each
-- block (challenge / hydration / journey) is REPLACED as a whole when the phone
-- sends it — a cleared water goal has to be able to become NULL, which the
-- COALESCE-based partial update of `users` cannot express.
--
-- Typed columns, not jsonb: the shapes are fixed, and the rule of this schema is
-- that jsonb is for shapes that are genuinely open (see 00007). The database then
-- refuses a malformed day or a goal outside the phone's bracket by itself.
--
-- Each block has its own `*_at`. NULL there means "the phone never sent this
-- block" — an older phone, or none at all — which is a different statement from
-- "the phone sent it, and it is empty", and the API reports the two differently.
CREATE TABLE IF NOT EXISTS phone_settings (
    user_id               uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

    -- NULL = the user never touched the milestones (the phone uses its factory
    -- row); '{}' = they deleted every one of them. Both are real states.
    challenge_thresholds  integer[],
    -- The chosen rest days as day KEYS: a `date`, not a timestamptz, because the
    -- phone stores the day the user meant, and an instant read back in another
    -- zone could land on the neighbouring day.
    challenge_rest_days   date[],
    challenge_at          timestamptz,

    -- Only a goal the user CHOSE; the phone's body-mass suggestion is never stored.
    hydration_goal_ml     integer CHECK (hydration_goal_ml BETWEEN 500 AND 6000),
    hydration_at          timestamptz,

    journey_route_id      text,
    journey_started_on    date,
    journey_at            timestamptz,
    -- A route without a start day (or the reverse) cannot be drawn and is not a
    -- state the phone can be in.
    CONSTRAINT phone_settings_journey_pair
        CHECK ((journey_route_id IS NULL) = (journey_started_on IS NULL))
);

-- +goose Down
DROP TABLE IF EXISTS phone_settings;
