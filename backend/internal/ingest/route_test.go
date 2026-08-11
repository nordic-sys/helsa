package ingest

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
)

// A 0 altitude (sea level) and a 0 speed (a full stop) are REAL measurements,
// while a missing measurement is NULL — if the two blurred together, the
// elevation profile would draw a mountain hike sinking to sea level, and the speed
// curve a runner constantly coming to a halt.
func TestRouteRowKeepsZeroAndMissingApart(t *testing.T) {
	wid := pgconv.UUID(uuid.New())
	ts := time.Date(2026, 8, 11, 6, 30, 0, 0, time.UTC)

	zero := float32(0)
	row := routeRow(wid, 7, api.RoutePoint{
		Ts: ts, Lat: 47.4979, Lon: 19.0402,
		AltitudeM: &zero, SpeedMps: &zero,
	})
	if len(row) != len(routeColumns) {
		t.Fatalf("the row does not fit the columns: %d vs %d", len(row), len(routeColumns))
	}
	alt, ok := row[5].(*float64)
	if !ok || alt == nil || *alt != 0 {
		t.Errorf("the 0 altitude turned into NULL: %#v", row[5])
	}
	speed, ok := row[6].(*float64)
	if !ok || speed == nil || *speed != 0 {
		t.Errorf("the 0 speed turned into NULL: %#v", row[6])
	}
	if acc, ok := row[7].(*float64); !ok || acc != nil {
		t.Errorf("a missing accuracy must not become a value: %#v", row[7])
	}

	bare := routeRow(wid, 0, api.RoutePoint{Ts: ts, Lat: 47.4979, Lon: 19.0402})
	for i, name := range []string{"altitude_m", "speed_mps", "accuracy_m"} {
		v, ok := bare[5+i].(*float64)
		if !ok || v != nil {
			t.Errorf("a missing %s must be NULL: %#v", name, bare[5+i])
		}
	}
}

// seq is the SEND order, not a ranking by timestamp: it is what breaks the tie
// between points sharing a stamp on read, so it must not be reordered.
func TestRouteRowSeqFollowsClientOrder(t *testing.T) {
	wid := pgconv.UUID(uuid.New())
	ts := time.Date(2026, 8, 11, 6, 30, 0, 0, time.UTC)
	points := []api.RoutePoint{
		{Ts: ts, Lat: 47.1, Lon: 19.1},
		{Ts: ts, Lat: 47.2, Lon: 19.2}, // the same stamp, a different place
		{Ts: ts.Add(time.Second), Lat: 47.3, Lon: 19.3},
	}
	for i, p := range points {
		row := routeRow(wid, i, p)
		if row[1] != i {
			t.Errorf("point %d: seq=%v", i, row[1])
		}
		if row[0] != any(wid) {
			t.Errorf("point %d ended up on a different workout: %v", i, row[0])
		}
		if lat, ok := row[3].(float64); !ok || lat != p.Lat {
			t.Errorf("point %d lat: %#v", i, row[3])
		}
	}
}

// An empty or missing route must not touch the stored one: a missing `route` from
// the client means "I am making no statement about this" (HKWorkoutRoute is a
// separate, asynchronous query), not an instruction to delete. If writeRoute did
// try to write, this call would blow up on the nil tx.
func TestWriteRouteLeavesStoredRouteAloneWhenEmpty(t *testing.T) {
	ctx := context.Background()
	uid := pgconv.UUID(uuid.New())
	empty := []api.RoutePoint{}

	cases := []struct {
		name string
		in   api.WorkoutIn
	}{
		{"no route field", api.WorkoutIn{SourceUuid: "wk-1"}},
		{"empty route", api.WorkoutIn{SourceUuid: "wk-1", Route: &empty}},
	}
	for _, c := range cases {
		if err := writeRoute(ctx, nil, nil, uid, c.in); err != nil {
			t.Errorf("%s: %v", c.name, err)
		}
	}
}

// The contract states that the client must count route points against its chunk
// budget. The server holds it to that: without this, the track of a single long
// hike would slip through as "one item", and back would come exactly the giant
// batch that chunking set out to avoid.
func TestValidateCountsRoutePoints(t *testing.T) {
	ts := time.Now()
	fits := []api.WorkoutIn{{SourceUuid: "wk-1", ActivityType: "hiking", StartedAt: ts,
		Route: &[]api.RoutePoint{{Ts: ts, Lat: 47.5, Lon: 19.0}}}}
	if err := Validate(&api.IngestBatch{Workouts: &fits}); err != nil {
		t.Errorf("a one-point route is valid: %v", err)
	}

	huge := make([]api.RoutePoint, MaxItems+1)
	over := []api.WorkoutIn{{SourceUuid: "wk-2", ActivityType: "hiking", StartedAt: ts, Route: &huge}}
	if err := Validate(&api.IngestBatch{Workouts: &over}); err == nil {
		t.Error("a route that exceeds the budget cannot be valid as a single workout")
	}
	if n := routePoints(&over); n != MaxItems+1 {
		t.Errorf("routePoints=%d", n)
	}
	if n := routePoints(nil); n != 0 {
		t.Errorf("without a workout there are no points: %d", n)
	}
}

// The points are born and die with their workout: they are meaningless on their
// own, and the HealthKit deletion (DeleteWorkoutsByUUID) only knows the workout's
// row. The cascade is therefore not a convenience but the only thing that also
// takes away a deleted workout's route.
func TestRouteMigrationCascadesAndKeepsOrderKey(t *testing.T) {
	raw, err := os.ReadFile("../../db/migrations/00008_workout_routes.sql")
	if err != nil {
		t.Fatalf("migration: %v", err)
	}
	src := string(raw)
	if !strings.Contains(src, "REFERENCES workouts(id) ON DELETE CASCADE") {
		t.Error("the route does not go with its workout — orphaned points would remain")
	}
	if !strings.Contains(src, "PRIMARY KEY (workout_id, seq)") {
		t.Error("a point's identity is its sequence number within the workout (duplication guard)")
	}
	if !strings.Contains(src, "(workout_id, ts, seq)") {
		t.Error("the index that serves the read order is missing")
	}
	// Altitude/speed/accuracy must NOT be NOT NULL: for them, 0 is a real measurement.
	for _, col := range []string{"altitude_m", "speed_mps", "accuracy_m"} {
		for _, line := range strings.Split(src, "\n") {
			if strings.HasPrefix(strings.TrimSpace(line), col) && strings.Contains(line, "NOT NULL") {
				t.Errorf("%s must not be NOT NULL: a missing measurement cannot be written as zero", col)
			}
		}
	}
}

// pgtype.UUID goes to the database as a COPY value; if somebody swapped it for a
// bare uuid.UUID, the NULL handling would fall out of line with the other columns.
func TestRouteRowWorkoutIDType(t *testing.T) {
	wid := pgconv.UUID(uuid.New())
	row := routeRow(wid, 0, api.RoutePoint{Ts: time.Now(), Lat: 1, Lon: 2})
	if _, ok := row[0].(pgtype.UUID); !ok {
		t.Errorf("workout_id type: %T", row[0])
	}
}
