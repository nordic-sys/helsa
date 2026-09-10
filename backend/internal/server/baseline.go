package server

import (
	"net/http"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/auth"
	"github.com/nordic-sys/helsa/backend/internal/baseline"
)

// --- GET /v1/baseline — the person's own usual range ---
//
// A sibling of /summary rather than a field on it: the reference window is 60 days
// with daily buckets whatever the chart is showing, so a single response would
// have to say `from`/`to` about two different windows at once. The contract's own
// description carries the rest of the reasoning.
//
// ⚠️ A response with no `mean` is a FULL answer — it means fewer than 14 of the
// reference days carried a measurement, and the honest thing to draw then is no
// band at all. It is not an error, and it is not a zero.

func (s *Server) GetBaseline(w http.ResponseWriter, r *http.Request, params api.GetBaselineParams) {
	uid, ok := auth.UserID(r.Context())
	if !ok {
		problem(w, http.StatusUnauthorized, "Unauthorized", "")
		return
	}
	// The same resolution order as everywhere else on the read path (param →
	// user.time_zone → UTC); the name is what the bucketing needs, not the location.
	tz := s.resolveLoc(r.Context(), uid, params.Tz).String()

	resp, err := s.baseline.Compute(r.Context(), uid, baseline.Request{
		Range:   string(params.Range),
		Metrics: splitCSV(params.Metrics),
		TZ:      tz,
		From:    datePtr(params.From),
		To:      datePtr(params.To),
	})
	if err != nil {
		problem(w, http.StatusBadRequest, "Baseline failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, resp)
}
