-- Type-safe queries (sqlc generates Go from these into the internal/db package).
-- The timezone-aware summary aggregation is NOT here: sqlc cannot type the
-- Timescale time_bucket(.., tz) function → hand-written pgx in internal/summary.

-- name: UpsertUserByAppleSub :one
INSERT INTO users (apple_sub, email, display_name)
VALUES ($1, $2, $3)
ON CONFLICT (apple_sub) DO UPDATE
    SET email = COALESCE(EXCLUDED.email, users.email)
RETURNING *;

-- name: GetUser :one
SELECT * FROM users WHERE id = $1;

-- name: GetSettings :one
SELECT time_zone, locale, unit_system, notif_prefs FROM users WHERE id = @id;

-- name: UpdateSettings :one
-- A partial update: thanks to the COALESCE, the fields that were not sent stay
-- untouched.
UPDATE users SET
    time_zone   = COALESCE(sqlc.narg('time_zone'), time_zone),
    locale      = COALESCE(sqlc.narg('locale'), locale),
    unit_system = COALESCE(sqlc.narg('unit_system'), unit_system),
    notif_prefs = COALESCE(sqlc.narg('notif_prefs')::jsonb, notif_prefs)
WHERE id = @id
RETURNING time_zone, locale, unit_system, notif_prefs;

-- name: ListDevices :many
-- The most recently seen device first — the sync-freshness alert looks at this
-- first element (docs/16 §2).
SELECT * FROM devices
WHERE user_id = @user_id
ORDER BY last_seen_at DESC NULLS LAST, platform;

-- name: UpsertDevice :one
-- Registration/heartbeat WITHOUT an id: the (platform, model) pair is the key
-- (uq_devices_user_platform_model). last_seen_at is always the server's clock —
-- this is the alert's source, we do not entrust it to the client.
INSERT INTO devices (user_id, platform, model, name, time_zone, last_seen_at)
VALUES (@user_id, @platform, @model, @name, @time_zone, now())
ON CONFLICT (user_id, platform, (COALESCE(model, ''))) DO UPDATE SET
    name         = COALESCE(EXCLUDED.name, devices.name),
    time_zone    = COALESCE(EXCLUDED.time_zone, devices.time_zone),
    last_seen_at = now()
RETURNING *;

-- name: UpsertDeviceByID :one
-- Registration/heartbeat with an explicit id. The WHERE on the DO UPDATE is an
-- ownership check: we do not write onto another user's device (no returned row →
-- the caller answers 409).
INSERT INTO devices (id, user_id, platform, model, name, time_zone, last_seen_at)
VALUES (@id, @user_id, @platform, @model, @name, @time_zone, now())
ON CONFLICT (id) DO UPDATE SET
    platform     = EXCLUDED.platform,
    model        = COALESCE(EXCLUDED.model, devices.model),
    name         = COALESCE(EXCLUDED.name, devices.name),
    time_zone    = COALESCE(EXCLUDED.time_zone, devices.time_zone),
    last_seen_at = now()
WHERE devices.user_id = EXCLUDED.user_id
RETURNING *;

-- name: TouchDevice :exec
-- The ingest write path's "sign of life": the fresh data IS the heartbeat, no
-- separate POST /devices is needed.
UPDATE devices SET
    last_seen_at = now(),
    time_zone    = COALESCE(sqlc.narg('time_zone'), time_zone)
WHERE id = @id AND user_id = @user_id;

-- name: InsertSample :exec
-- The workout link is resolved from the HealthKit HKWorkout.uuid (2A.7): that is
-- all the client knows. We store the raw reference too, so that a workout chunk
-- arriving later can supply the missing link (see LinkSamplesToWorkouts).
INSERT INTO samples (
    user_id, ts, data_type, value, unit, workout_source_uuid, workout_id, source_uuid, source_device, source_bundle
) VALUES (
    @user_id, @ts, @data_type, @value, @unit, @workout_source_uuid,
    (SELECT w.id FROM workouts w WHERE w.user_id = @user_id AND w.source_uuid = @workout_source_uuid),
    @source_uuid, @source_device, @source_bundle
)
ON CONFLICT (user_id, ts, source_uuid) DO NOTHING;

-- name: LinkSamplesToWorkouts :exec
-- Backfill: wiring up the still-unresolved samples that reference the workouts
-- that have just arrived. (Rows already stored are left alone by InsertSample's
-- ON CONFLICT DO NOTHING.)
UPDATE samples s SET workout_id = w.id
FROM workouts w
WHERE s.user_id = @user_id
  AND s.workout_id IS NULL
  AND s.workout_source_uuid IS NOT NULL
  AND w.user_id = s.user_id
  AND w.source_uuid = s.workout_source_uuid
  AND w.source_uuid = ANY(@source_uuids::text[]);

-- name: UpsertWorkout :exec
INSERT INTO workouts (
    user_id, source_uuid, activity_type, started_at, ended_at, total_energy_kcal, total_distance_m, metadata
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (user_id, source_uuid) DO NOTHING;

-- name: GetWorkoutIDBySourceUUID :one
-- The client only knows the HealthKit `HKWorkout.uuid`, while the route points
-- hang off the server-side `workouts.id` (the same 2A.7 resolution as for
-- samples). `user_id` here is also an ownership check: we do not overwrite
-- another user's workout route even if the source_uuid matches.
SELECT id FROM workouts WHERE user_id = @user_id AND source_uuid = @source_uuid;

-- name: DeleteWorkoutRoute :exec
-- Only the first half of a route replacement, ALWAYS inside one transaction with
-- an incoming series of points (see internal/ingest/route.go). We never call it
-- on its own: a missing route from the client means "I am making no statement",
-- not an instruction to delete.
DELETE FROM workout_route_points WHERE workout_id = @workout_id;

-- name: UpsertSleepSegment :exec
INSERT INTO sleep_segments (user_id, source_uuid, started_at, ended_at, stage)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (user_id, source_uuid) DO NOTHING;

-- name: UpsertActivitySummary :exec
INSERT INTO activity_summary (
    user_id, day, active_energy, active_energy_goal, exercise_minutes, exercise_goal, stand_hours, stand_goal
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (user_id, day) DO UPDATE SET
    active_energy = EXCLUDED.active_energy,
    active_energy_goal = EXCLUDED.active_energy_goal,
    exercise_minutes = EXCLUDED.exercise_minutes,
    exercise_goal = EXCLUDED.exercise_goal,
    stand_hours = EXCLUDED.stand_hours,
    stand_goal = EXCLUDED.stand_goal,
    ingested_at = now();

-- name: ListActivitySummary :many
-- The daily rings (Move/Exercise/Stand), value + goal, over the half-open
-- [from_day, to_day) window.
SELECT * FROM activity_summary
WHERE user_id = @user_id AND day >= @from_day AND day < @to_day
ORDER BY day;

-- (The /v1/workouts + /{id} query is HAND-WRITTEN pgx in internal/workouts: sqlc
--  does not correctly type the keyset plus the nullability of the heartRate
--  avg/max LEFT JOIN.)

-- name: ListSleepSegments :many
-- Sleep segments over the half-open, timezone-aware [from_ts, to_ts) window.
SELECT started_at, ended_at, stage FROM sleep_segments
WHERE user_id = @user_id AND started_at >= @from_ts AND started_at < @to_ts
ORDER BY started_at;

-- name: ListGoals :many
SELECT * FROM goals WHERE user_id = @user_id ORDER BY metric;

-- name: UpsertGoal :one
INSERT INTO goals (user_id, metric, target_value, unit, source, hk_value)
VALUES (@user_id, @metric, @target_value, @unit, @source, @hk_value)
ON CONFLICT (user_id, metric) DO UPDATE SET
    target_value = EXCLUDED.target_value,
    unit = EXCLUDED.unit,
    source = EXCLUDED.source,
    hk_value = COALESCE(EXCLUDED.hk_value, goals.hk_value),
    updated_at = now()
RETURNING *;

-- name: DeleteSamplesByUUID :exec
DELETE FROM samples WHERE user_id = $1 AND source_uuid = ANY(@source_uuids::text[]);

-- name: DeleteWorkoutsByUUID :exec
DELETE FROM workouts WHERE user_id = $1 AND source_uuid = ANY(@source_uuids::text[]);

-- name: DeleteSleepByUUID :exec
DELETE FROM sleep_segments WHERE user_id = $1 AND source_uuid = ANY(@source_uuids::text[]);

-- name: UpsertPushToken :one
-- The key is (user_id, token): the APNs device token IS the identifier, and it
-- changes on reinstall. Registering the same token again is an update, not a new
-- row — otherwise every app launch would grow the table.
INSERT INTO push_tokens (user_id, device_id, token, platform, environment)
VALUES (@user_id, @device_id, @token, @platform, @environment)
ON CONFLICT (user_id, token) DO UPDATE SET
    device_id   = COALESCE(EXCLUDED.device_id, push_tokens.device_id),
    platform    = EXCLUDED.platform,
    environment = EXCLUDED.environment,
    updated_at  = now()
RETURNING *;

-- name: ListAchievements :many
-- Most recently earned badge first; `id` is only a tie-breaker, so that the order
-- of badges earned within the same second does not jump around between pagination
-- or reloads.
SELECT * FROM achievements
WHERE user_id = @user_id
ORDER BY earned_at DESC, id;

-- name: UpsertAchievement :exec
-- An upsert, NEVER a delete: the call does not replace the list's contents with
-- the submitted set. A reinstalled phone starts with an empty local history — a
-- "full replacement" would take that as an instruction, and wipe out badges
-- collected over years.
--
-- On conflict, `earned_at` STAYS as it was: when it was earned is a fact about
-- the past, not about the most recent sync. `value`/`unit`/`thresholds`, on the
-- other hand, are updated, because late-arriving HealthKit data can still raise a
-- month's step count after the badge was born.
--
-- `kind`/`code`/`period` are deliberately left alone: they are encoded by the
-- `id` itself (`<kind>:<code>[:<period>]`), so they could not change for the same
-- id anyway.
INSERT INTO achievements (user_id, id, kind, code, period, value, unit, thresholds, earned_at)
VALUES (@user_id, @id, @kind, @code, @period, @value, @unit, @thresholds, @earned_at)
ON CONFLICT (user_id, id) DO UPDATE SET
    value      = EXCLUDED.value,
    unit       = EXCLUDED.unit,
    thresholds = EXCLUDED.thresholds,
    updated_at = now();
