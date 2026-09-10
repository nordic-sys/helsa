package server

import (
	"net/http"
	"time"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/auth"
	"github.com/nordic-sys/helsa/backend/internal/challenge"
)

// --- GET /v1/challenge — the monthly step challenge ---
//
// The phone's challenge screen, in numbers: the month's total, the user's own
// milestones and which of them that passed, what is left of the month, and the
// daily streak. The trail it is drawn as on the phone is not ported — the web
// needs the numbers behind the picture, not the picture.
//
// Two things this endpoint has to be careful about, both of them ways of
// asserting more than we know:
//
//  1. The milestones live on the phone and nothing syncs them, so the server
//     takes them from the request, from the newest badge's snapshot, or from the
//     factory row — and SAYS which (`thresholds_source`).
//  2. The streak's neutral days (illness, chosen rest) cannot reach the server at
//     all, so the streak it computes is a lower bound on the phone's. The
//     response names the missing inputs rather than presenting a shorter streak
//     as the streak.

func (s *Server) GetChallenge(w http.ResponseWriter, r *http.Request, params api.GetChallengeParams) {
	uid, ok := auth.UserID(r.Context())
	if !ok {
		problem(w, http.StatusUnauthorized, "Unauthorized", "")
		return
	}
	loc := s.resolveLoc(r.Context(), uid, params.Tz)

	// A month is a span in the user's calendar, not an instant: 2026-08-31 22:30
	// UTC is already September in Budapest, and a new challenge runs there.
	month := challenge.MonthContaining(time.Now(), loc)
	if params.Month != nil && *params.Month != "" {
		parsed, err := challenge.ParseMonth(*params.Month)
		if err != nil {
			problem(w, http.StatusBadRequest, "Invalid month", err.Error())
			return
		}
		month = parsed
	}

	var thresholds *challenge.Thresholds
	if params.Thresholds != nil && *params.Thresholds != "" {
		parsed, err := challenge.ParseThresholds(*params.Thresholds)
		if err != nil {
			problem(w, http.StatusBadRequest, "Invalid thresholds", err.Error())
			return
		}
		thresholds = &parsed
	}

	out, err := s.challenge.Get(r.Context(), uid, challenge.Query{
		Month: month, Loc: loc, Thresholds: thresholds,
	})
	if err != nil {
		problem(w, http.StatusInternalServerError, "Challenge failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, out)
}
