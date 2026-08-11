package workouts

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
)

// The route query. A LEFT JOIN FROM `workouts`, because a single question has to
// settle two things at once:
//
//	zero rows           → no such workout (or it is not this user's) → the caller answers 404,
//	one all-NULL row    → the workout exists but has no route        → an empty point list,
//	n rows              → the route itself.
//
// Two separate queries could only do the same at the price of the "does it
// exist" and the "what are its points" answers coming from two different
// moments.
//
// The ordering is (ts, seq) and not ts alone: without seq, the order of points
// sharing a timestamp (standing still, `CLLocation` stamps can land on top of
// each other) would be decided by the execution plan, differently from query to
// query — on the map that is a stretch jumping back and forth.
const routeQuery = `
SELECT p.ts, p.lat, p.lon, p.altitude_m, p.speed_mps, p.accuracy_m
FROM workouts w
LEFT JOIN workout_route_points p ON p.workout_id = w.id
WHERE w.user_id = $1 AND w.id = $2
ORDER BY p.ts, p.seq`

// Route returns a workout's GPS route. (nil, nil) if the user has no such
// workout.
//
// An EMPTY point list is a full answer, not a sign of something missing: an
// indoor workout has no route, and neither do entries predating route recording
// — yet the workout itself exists, so a 404 would not be justified either.
func (s *Service) Route(ctx context.Context, userID, workoutID uuid.UUID) (*api.WorkoutRoute, error) {
	rows, err := s.pool.Query(ctx, routeQuery, pgconv.UUID(userID), pgconv.UUID(workoutID))
	if err != nil {
		return nil, fmt.Errorf("route query: %w", err)
	}
	defer rows.Close()

	points := []api.RoutePoint{}
	exists := false
	for rows.Next() {
		exists = true
		var (
			ts                   pgtype.Timestamptz
			lat, lon             *float64
			altitude, speed, acc *float64
		)
		if err := rows.Scan(&ts, &lat, &lon, &altitude, &speed, &acc); err != nil {
			return nil, fmt.Errorf("scan route point: %w", err)
		}
		if p, ok := routePoint(ts, lat, lon, altitude, speed, acc); ok {
			points = append(points, p)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if !exists {
		return nil, nil
	}
	return &api.WorkoutRoute{Points: points}, nil
}

// routePoint turns one row into a contract-level point. The second return value
// is false for the LEFT JOIN's all-NULL row: that is not a point but the "the
// workout exists, without a route" answer — letting it through as a point would
// draw a single marker on Null Island (lat=0, lon=0) for every routeless
// workout.
//
// A missing altitude/speed/accuracy goes back as a missing field, not as zero:
// for the first two, 0 is a genuine measurement (sea level, and a full stop).
func routePoint(ts pgtype.Timestamptz, lat, lon, altitude, speed, acc *float64) (api.RoutePoint, bool) {
	if !ts.Valid || lat == nil || lon == nil {
		return api.RoutePoint{}, false
	}
	return api.RoutePoint{
		Ts: ts.Time,
		// Coordinates stay `float64` end to end — `float32` would quantise to 0.5–1.2
		// metres at Budapest's latitude, which visibly stair-steps when you zoom into a
		// slow walk. The other fields (altitude, speed, accuracy) may stay `float32`:
		// there, sub-metre precision buys nothing.
		Lat:       *lat,
		Lon:       *lon,
		AltitudeM: f64to32(altitude),
		SpeedMps:  f64to32(speed),
		AccuracyM: f64to32(acc),
	}, true
}
