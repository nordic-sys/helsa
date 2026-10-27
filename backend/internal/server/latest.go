package server

import (
	"fmt"
	"net/http"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/auth"
	"github.com/nordic-sys/helsa/backend/internal/latest"
)

// --- GET /v1/latest — the most recent measurement per type ---
//
// What the figure is for an averaged and for a summed type, and why this is an
// endpoint rather than forty `/samples?limit=1` calls: internal/latest.
//
// ⚠️ A type that is absent from the answer has never reached this server. The
// handler adds nothing for it — no zero, no empty object — because the absence
// IS the answer, the same rule `/coverage` states as `never_arrived`.

func (s *Server) GetLatest(w http.ResponseWriter, r *http.Request, params api.GetLatestParams) {
	uid, ok := auth.UserID(r.Context())
	if !ok {
		problem(w, http.StatusUnauthorized, "Unauthorized", "")
		return
	}
	names := latest.Normalize(splitCSV(params.Metrics))
	if title, detail := checkLatestNames(names); title != "" {
		problem(w, http.StatusBadRequest, title, detail)
		return
	}
	tz := s.resolveLoc(r.Context(), uid, params.Tz).String()
	out, err := s.latest.Compute(r.Context(), uid, latest.Request{Metrics: names, TZ: tz})
	if err != nil {
		problem(w, http.StatusInternalServerError, "Query failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// checkLatestNames refuses an empty list (after trimming) and one over the cap.
// An empty title means the list is fine.
func checkLatestNames(names []string) (title, detail string) {
	if len(names) == 0 {
		return "Missing parameter", "metrics must name at least one type"
	}
	if len(names) > latest.MaxMetrics {
		return "Too many metrics", fmt.Sprintf("at most %d names per request, got %d", latest.MaxMetrics, len(names))
	}
	return "", ""
}
