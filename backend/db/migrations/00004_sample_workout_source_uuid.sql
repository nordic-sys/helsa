-- +goose Up
-- 2A.7 — the client knows the HealthKit `HKWorkout.uuid`, not the server-side
-- `workouts.id`. We store the raw reference alongside the sample, so the link can
-- still be resolved when the workout arrives in a LATER chunk (samples and
-- workouts sit on separate HealthKit anchors, and chunk order is not guaranteed —
-- docs/04 §6).
-- A nullable column with no default → Timescale allows this even on a compressed
-- hypertable.
ALTER TABLE samples ADD COLUMN IF NOT EXISTS workout_source_uuid text;

-- The backfill (LinkSamplesToWorkouts) runs exactly this filter: the user's still
-- unresolved samples. A partial index → it only tracks the orphaned rows.
CREATE INDEX IF NOT EXISTS idx_samples_unlinked_workout
    ON samples (user_id, workout_source_uuid)
    WHERE workout_id IS NULL AND workout_source_uuid IS NOT NULL;

-- +goose Down
DROP INDEX IF EXISTS idx_samples_unlinked_workout;
ALTER TABLE samples DROP COLUMN IF EXISTS workout_source_uuid;
