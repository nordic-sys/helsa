-- +goose Up
-- Point-level storage for workout routes (`HKWorkoutRoute`).
--
-- A separate table rather than a jsonb column on `workouts`: a three-hour hike is
-- on the order of ten thousand points, and every read of the workout row (list,
-- /{id}, export) would have to de-TOAST that blob as well, for a map almost
-- nobody opens. This way the route's cost only shows up when it is actually
-- asked for.
--
-- There is no PostGIS, and we deliberately do not introduce one. Plain lat/lon is
-- enough to draw a map; nothing asks for a spatial query (search within a radius,
-- route intersection), and none is in the plan either. An extension, on the other
-- hand, would be a burden of its own on the home Docker image: a custom image
-- build, version tracking across upgrades, and one more pitfall at every
-- backup restore.
CREATE TABLE IF NOT EXISTS workout_route_points (
    -- The route goes when the workout goes: the points are meaningless on their
    -- own, and the HealthKit deletion (DeleteWorkoutsByUUID) only knows the
    -- workout's row.
    workout_id uuid NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    -- The point's sequence number within the route the CLIENT sent. Not
    -- decoration: timestamps can collide (standing still, `CLLocation` stamps can
    -- land on top of each other), and without seq the order of two points sharing
    -- a stamp could change from query to query — on the map that shows up as a
    -- stretch jumping back and forth. The (ts, seq) pair is deterministic.
    seq        integer NOT NULL,
    ts         timestamptz NOT NULL,
    -- double precision, even though the contract sends float32: it is not the
    -- database's job to degrade the value it received any further, and every
    -- measurement in this repository is float8 (`samples.value`).
    lat        double precision NOT NULL,
    lon        double precision NOT NULL,
    -- Nullable, and this is not a matter of convenience: 0 is a REAL measurement
    -- for altitude (sea level) and for speed (a full stop). Writing a missing
    -- measurement in as zero would make the elevation profile draw a mountain hike
    -- sinking to sea level.
    altitude_m double precision,
    speed_mps  double precision,
    -- Horizontal accuracy in metres — this is what lets the client throw the junk
    -- away: in a city, a point with 100 metres of error jumps a whole block.
    accuracy_m double precision,
    -- A point's identity is its sequence number within the workout. This is also
    -- the database-level barrier against duplication: the same route sent twice
    -- lands on exactly these keys.
    PRIMARY KEY (workout_id, seq)
);

-- The read asks for the points in exactly this order (increasing by time, with
-- `seq` as the tie-breaker). The PK's index orders by `seq`, not by `ts` —
-- without this index every map opening would re-sort ten thousand rows.
CREATE INDEX IF NOT EXISTS idx_route_points_workout_ts
    ON workout_route_points (workout_id, ts, seq);

-- +goose Down
DROP TABLE IF EXISTS workout_route_points;
