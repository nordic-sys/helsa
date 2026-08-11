package ingest

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/db"
)

// COPY column order for route points. Kept in one place, because routeRow
// follows it.
var routeColumns = []string{
	"workout_id", "seq", "ts", "lat", "lon", "altitude_m", "speed_mps", "accuracy_m",
}

// writeRoute writes out a workout's GPS route. It runs inside the caller's
// transaction, directly after the workout upsert — the points hang off the
// server-side workouts.id, which only exists once the workout is stored.
//
// IDEMPOTENCY: a route is an ATOMIC object, not an append-only log — the
// incoming series of points REPLACES the stored one (delete + insert in the
// same transaction). Sending the same workout twice therefore yields the same
// route, not a doubled one. This also protects more than a per-row ON CONFLICT
// DO NOTHING would: if the client sends a denser or longer route the second
// time, the sequence numbers would not line up with the old ones, and the two
// recordings would be combed together into a single Frankenstein route that
// jumps back and forth.
//
// ⚠️ An EMPTY route, on the other hand, is NOT a deletion. A missing `route`
// from the client only means "I am making no statement about this right now":
// `HKWorkoutRoute` is a separate, asynchronous query, and a workout's metadata
// can perfectly well arrive without its route (chunking, denied location
// permission, an old entry). Treating that as a deletion would let such a
// resend silently kill an already uploaded route.
//
// The empty point list on GET is an independent statement, and does not
// contradict this one: it means we have NEVER stored a route for this workout
// (an indoor workout, an old entry) — not that an empty input erased one.
func writeRoute(ctx context.Context, tx pgx.Tx, q *db.Queries, uid pgtype.UUID, w api.WorkoutIn) error {
	if w.Route == nil || len(*w.Route) == 0 {
		return nil
	}
	points := *w.Route

	wid, err := q.GetWorkoutIDBySourceUUID(ctx, db.GetWorkoutIDBySourceUUIDParams{
		UserID: uid, SourceUuid: w.SourceUuid,
	})
	if err != nil {
		return fmt.Errorf("route: resolving workout %s: %w", w.SourceUuid, err)
	}
	if err := q.DeleteWorkoutRoute(ctx, wid); err != nil {
		return fmt.Errorf("route delete %s: %w", w.SourceUuid, err)
	}

	// CopyFrom rather than row-by-row INSERT: a three-hour hike is on the order of
	// ten thousand points, and that many round trips on the worker is measured in
	// seconds — all of it stretching the length of the very transaction that every
	// other write in the batch is also sitting in.
	_, err = tx.CopyFrom(ctx, pgx.Identifier{"workout_route_points"}, routeColumns,
		pgx.CopyFromSlice(len(points), func(i int) ([]any, error) {
			return routeRow(wid, i, points[i]), nil
		}))
	if err != nil {
		return fmt.Errorf("route write %s: %w", w.SourceUuid, err)
	}
	return nil
}

// routeRow turns a contract-level point into a COPY row.
//
// `seq` is the SEND order, not a ranking by timestamp: the client's ordering is
// itself data, and it is what breaks the tie between points sharing a timestamp
// on read.
//
// A missing altitude/speed/accuracy stays NULL (f32ptr nil → nil): for the first
// two, 0 is a genuine measurement (sea level, and a full stop), so it cannot
// double as the marker for "no data".
func routeRow(workoutID pgtype.UUID, seq int, p api.RoutePoint) []any {
	return []any{
		workoutID, seq, p.Ts,
		float64(p.Lat), float64(p.Lon),
		f32ptr(p.AltitudeM), f32ptr(p.SpeedMps), f32ptr(p.AccuracyM),
	}
}

// routePoints returns the number of route points in the batch. The contract
// states that the client must count route points against its chunk budget — and
// the server holds it to that here, otherwise a single long hike's route would
// bring back exactly the giant batch that chunking (docs/04 §6.2) set out to
// avoid.
func routePoints(ws *[]api.WorkoutIn) int {
	if ws == nil {
		return 0
	}
	n := 0
	for _, w := range *ws {
		n += count(w.Route)
	}
	return n
}
