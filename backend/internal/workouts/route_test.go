package workouts

import (
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/nordic-sys/helsa/backend/internal/pgconv"
)

// A routeless workout comes back from the LEFT JOIN as a single all-NULL row. That
// is NOT a point: letting it through as one would draw a single marker on Null
// Island (lat=0, lon=0) for an indoor workout — the correct answer is an empty
// point list.
func TestRoutePointRejectsTheNoRouteSentinel(t *testing.T) {
	if _, ok := routePoint(pgtype.Timestamptz{}, nil, nil, nil, nil, nil); ok {
		t.Error("the all-NULL row turned into a point")
	}
	// Half data is not a point either: without a coordinate there is nothing to draw.
	ts := pgconv.Timestamptz(time.Now())
	lat := 47.4979
	if _, ok := routePoint(ts, &lat, nil, nil, nil, nil); ok {
		t.Error("a row without a longitude turned into a point")
	}
}

// A 0 altitude (sea level) and a 0 speed (a full stop) are real measurements; a
// missing measurement, on the other hand, goes back as an absent field, not a zero.
func TestRoutePointKeepsZeroAndMissingApart(t *testing.T) {
	ts := time.Date(2026, 8, 11, 6, 30, 0, 0, time.UTC)
	zero, acc := 0.0, 4.5
	lat, lon := 47.4979, 19.0402

	p, ok := routePoint(pgconv.Timestamptz(ts), &lat, &lon, &zero, &zero, &acc)
	if !ok {
		t.Fatal("a valid point was rejected")
	}
	if !p.Ts.Equal(ts) {
		t.Errorf("ts: %v", p.Ts)
	}
	// The coordinate is `float64` — exactly the value written in has to come back,
	// with no rounding.
	if p.Lat != lat || p.Lon != lon {
		t.Errorf("coordinate: %v, %v", p.Lat, p.Lon)
	}
	if p.AltitudeM == nil || *p.AltitudeM != 0 {
		t.Errorf("the 0 altitude turned into an absent field: %v", p.AltitudeM)
	}
	if p.SpeedMps == nil || *p.SpeedMps != 0 {
		t.Errorf("the 0 speed turned into an absent field: %v", p.SpeedMps)
	}
	if p.AccuracyM == nil || *p.AccuracyM != float32(acc) {
		t.Errorf("accuracy: %v", p.AccuracyM)
	}

	bare, ok := routePoint(pgconv.Timestamptz(ts), &lat, &lon, nil, nil, nil)
	if !ok {
		t.Fatal("a coordinate-only point is a point too")
	}
	if bare.AltitudeM != nil || bare.SpeedMps != nil || bare.AccuracyM != nil {
		t.Errorf("the missing measurements turned into values: %+v", bare)
	}
}

// Three properties of the query are all matters of data or of authorisation, which
// is why they are guarded here: the ownership check, telling a 404 apart from an
// empty list (the LEFT JOIN), and the deterministic ordering.
func TestRouteQueryShape(t *testing.T) {
	if !strings.Contains(routeQuery, "ORDER BY p.ts, p.seq") {
		t.Error("without the seq tie-breaker, the order of points sharing a stamp would jump from query to query")
	}
	if !strings.Contains(routeQuery, "LEFT JOIN workout_route_points") ||
		!strings.Contains(strings.ToUpper(routeQuery), "FROM WORKOUTS W") {
		t.Error("the LEFT JOIN from workouts is what tells a 404 apart from an empty route")
	}
	if !strings.Contains(routeQuery, "w.user_id = $1") {
		t.Error("a route belongs only to your own workout — the ownership check is missing")
	}
}
