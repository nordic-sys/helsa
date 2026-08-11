package server

import (
	"net/http"

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/nordic-sys/helsa/backend/internal/auth"
)

// --- GET /v1/workouts/{id}/route — a workout's GPS route ---
//
// A separate endpoint rather than a field on `/workouts/{id}`: a three-hour hike
// is on the order of ten thousand points, and the workout list should never have
// to drag that along for a map almost nobody opens.
//
// An EMPTY point list is a full 200 response. A 404 means there is no such
// workout; an indoor workout and entries predating route recording simply have
// no route, while existing perfectly well themselves.

func (s *Server) GetWorkoutsIdRoute(w http.ResponseWriter, r *http.Request, id openapi_types.UUID) {
	uid, ok := auth.UserID(r.Context())
	if !ok {
		problem(w, http.StatusUnauthorized, "Unauthorized", "")
		return
	}
	route, err := s.workouts.Route(r.Context(), uid, uuid.UUID(id))
	if err != nil {
		problem(w, http.StatusInternalServerError, "Query failed", err.Error())
		return
	}
	if route == nil {
		problem(w, http.StatusNotFound, "No such workout", "")
		return
	}
	writeJSON(w, http.StatusOK, *route)
}
