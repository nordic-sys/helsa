-- +goose Up
-- The phone's journal and events (docs/35 item 8): HealthKit CATEGORY samples
-- (symptoms, the heart-rate / loud-environment / walking-steadiness events) and
-- state-of-mind samples (the daily mood and its tags). Until now none of them
-- ever left the phone; from app 1.0 (7) on the phone sends them, but ONLY when
-- the user switches "Journal and events" on (off by default). This is the most
-- sensitive data the product holds — symptoms, mood, heart-rhythm alerts — and
-- everything below is shaped by that:
--
--  * It is a MIRROR of HealthKit, never a second record (ADR-0007). Every row is
--    an HKSample the phone read, keyed by its HealthKit UUID, and it disappears
--    when the sample is deleted in Health (the anchored query reports it), when
--    the user switches the sync off and asks for deletion (DELETE /v1/journal),
--    or when a backfill's sweep finds it was not re-sent.
--  * ON DELETE CASCADE from users: whatever erases the user erases this.
--  * Not a hypertable. A person writes a handful of these a day; the volume is
--    four orders of magnitude below `samples`, and a plain table keeps the
--    delete-by-uuid and the sweep simple.
--
-- docs/23 §7 asked whether category types go into `samples` (enum → number) or
-- into a table of their own. This answers it: their own table. A category
-- sample has an END (a symptom spans an interval, `samples` has only `ts`), its
-- value is an enum whose meaning depends on the type, and the metadata that
-- makes an event marking an event marking (which event, which follow-up, which
-- workout) has no column in `samples`. Typed columns, not jsonb — the shapes are
-- fixed (see 00007 for the rule).
CREATE TABLE IF NOT EXISTS journal_entries (
    user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- The HealthKit UUID: the dedupe key of a re-send and the key a deletion
    -- arrives with.
    source_uuid        text NOT NULL CHECK (length(source_uuid) BETWEEN 1 AND 64),
    -- `headache`, `highHeartRateEvent`, `stateOfMind`… A pattern, not a list: a
    -- phone one version ahead of this server must not have a new type refused.
    data_type          text NOT NULL CHECK (data_type ~ '^[a-zA-Z][a-zA-Z0-9]{0,63}$'),
    started_at         timestamptz NOT NULL,
    ended_at           timestamptz NOT NULL,

    -- A category sample's raw HKCategoryValue* (its meaning depends on the type:
    -- severity, presence, appetite direction, steadiness level). NULL on a
    -- state-of-mind row.
    value              integer,
    -- A state-of-mind row's valence, −1…1. NULL on a category row.
    valence            double precision CHECK (valence BETWEEN -1 AND 1),
    mood_kind          text CHECK (mood_kind IN ('daily_mood', 'momentary_emotion')),
    labels             text[],
    associations       text[],

    -- Helsa's own metadata on the samples it wrote (HelsaKit `EventAnnotationRules`,
    -- `DailyContextRules`): the event a symptom was marked on, the follow-up stage
    -- (24/48 h), the workout the user attributed it to, the journal day.
    event_key          text CHECK (length(event_key) <= 200),
    follow_up_hours    smallint CHECK (follow_up_hours IN (24, 48)),
    workout_source_uuid text CHECK (length(workout_source_uuid) <= 64),
    day_key            date,
    -- A loud-environment event's level (HKMetadataKeyAudioExposureLevel).
    audio_level_dbaspl double precision,

    source_bundle      text CHECK (length(source_bundle) <= 200),
    source_device      text CHECK (length(source_device) <= 64),
    user_entered       boolean,

    -- When this server last received the row. A re-send refreshes it, which is
    -- what the backfill's sweep keys on (`sweep_before`).
    received_at        timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, source_uuid),
    CONSTRAINT journal_entries_interval CHECK (ended_at >= started_at),
    -- Exactly one of the two kinds: a category value or a mood.
    CONSTRAINT journal_entries_kind CHECK ((value IS NULL) <> (valence IS NULL))
);

CREATE INDEX IF NOT EXISTS journal_entries_user_time
    ON journal_entries (user_id, started_at);

-- +goose Down
DROP TABLE IF EXISTS journal_entries;
