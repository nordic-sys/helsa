package server

import (
	"net/http"
	"time"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/auth"
	"github.com/nordic-sys/helsa/backend/internal/workouts"
)

// --- GET /v1/workout-intensity — minutes at or above heart-rate zone 3 ---
//
// The rules and why they live on the server: internal/workouts/intensity.go.
//
// ⚠️ The path is deliberately NOT `/workouts/intensity`. An older server routes
// that to `/workouts/{id}` and answers 400 ("invalid format for parameter id"),
// which a newer web would read as a broken request. A path of its own makes an
// older server answer 404 — the one status the web treats as version skew
// (`isApiTooOld`, the sync-queue page's convention) and explains as such.

func (s *Server) GetWorkoutIntensity(w http.ResponseWriter, r *http.Request, params api.GetWorkoutIntensityParams) {
	uid, ok := auth.UserID(r.Context())
	if !ok {
		problem(w, http.StatusUnauthorized, "Unauthorized", "")
		return
	}
	if title, detail := checkIntensityWindow(params.From, params.To); title != "" {
		problem(w, http.StatusBadRequest, title, detail)
		return
	}
	out, err := s.workouts.Intensity(r.Context(), uid, params.From, params.To, time.Now())
	if err != nil {
		problem(w, http.StatusInternalServerError, "Query failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// checkIntensityWindow refuses an empty, backwards or over-long window. An
// empty title means the window is fine.
func checkIntensityWindow(from, to time.Time) (title, detail string) {
	if !to.After(from) {
		return "Invalid time span", "`to` must be later than `from`"
	}
	if to.Sub(from) > workouts.MaxWindow {
		return "Time span too long", "at most 400 days per request"
	}
	return "", ""
}
