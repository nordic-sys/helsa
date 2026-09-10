package server

import (
	"net/http"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/auth"
	"github.com/nordic-sys/helsa/backend/internal/coverage"
)

// --- GET /v1/coverage — data completeness and provenance ---
//
// "Which of my measurements are actually arriving, and who writes them."
//
// ⚠️ A narrower question than the app's completeness screen, on purpose: the
// phone knows about permissions and the server does not. What the vocabulary may
// and may not claim is written down in `internal/coverage`.
//
// The default window is a YEAR. Shorter would be cheaper, but the thing this
// endpoint is for — a metric that used to arrive and has stopped — cannot be seen
// in a week: a rhythm needs at least a fortnight of history before it is a rhythm
// at all (`coverage.minHistoryDays`), and a report whose window is too short to
// grow one would answer "no observation" every single time and look like it was
// working.
const coverageDefaultDays = 365

func (s *Server) GetCoverage(w http.ResponseWriter, r *http.Request, params api.GetCoverageParams) {
	uid, ok := auth.UserID(r.Context())
	if !ok {
		problem(w, http.StatusUnauthorized, "Unauthorized", "")
		return
	}
	if params.From != nil && params.To != nil && params.To.Before(params.From.Time) {
		problem(w, http.StatusBadRequest, "Invalid time span", "`to` must not be earlier than `from`")
		return
	}
	loc := s.resolveLoc(r.Context(), uid, params.Tz)
	start, endExcl := dayWindow(loc, params.From, params.To, coverageDefaultDays)

	resp, err := s.coverage.Compute(r.Context(), uid, coverage.Request{
		From:   start,
		ToExcl: endExcl,
		TZ:     loc.String(),
	})
	if err != nil {
		problem(w, http.StatusInternalServerError, "Coverage failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, resp)
}
