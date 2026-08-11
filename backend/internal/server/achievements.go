package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/google/uuid"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/auth"
	"github.com/nordic-sys/helsa/backend/internal/db"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
)

// --- GET/POST /v1/achievements — badges (monthly, yearly, streak, record, milestone) ---
//
// The phone evaluates, the server STORES. The thresholds live on the client, and
// the iPhone is the only uploader anyway (docs/04) — putting the evaluation
// anywhere else would create a second truth. The row therefore carries the
// numbers as they stood when it was earned (a `value` + `thresholds` snapshot),
// not a reference to today's setting: a badge is a historical fact that a
// later-rewritten threshold cannot take back.

func (s *Server) GetAchievements(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok {
		problem(w, http.StatusUnauthorized, "Unauthorized", "")
		return
	}
	out, err := s.listAchievements(r.Context(), uid)
	if err != nil {
		problem(w, http.StatusInternalServerError, "Query failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// PostAchievements is an idempotent upsert. Whatever is already stored STAYS
// stored even if the client does not send it this time: a reinstalled phone
// starts with an empty local history, and a "replace the list with the submitted
// set" semantics would take that emptiness as an instruction — wiping out badges
// collected over years. So there is no deletion, anywhere.
func (s *Server) PostAchievements(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok {
		problem(w, http.StatusUnauthorized, "Unauthorized", "")
		return
	}
	var body []api.AchievementInput
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		problem(w, http.StatusBadRequest, "Malformed JSON", err.Error())
		return
	}
	params := make([]db.UpsertAchievementParams, 0, len(body))
	for i, in := range body {
		p, err := achievementParams(uid, in)
		if err != nil {
			problem(w, http.StatusBadRequest, "Invalid badge", fmt.Sprintf("[%d]: %v", i, err))
			return
		}
		params = append(params, p)
	}

	// One transaction for the whole batch: a half-written list is worse than a
	// rejected request — the client will resend the lot anyway, and this way the
	// list returned in the response is certainly the complete, consistent state.
	tx, err := s.store.DB.Begin(r.Context())
	if err != nil {
		problem(w, http.StatusInternalServerError, "Transaction failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }() // a no-op after a successful Commit
	q := s.q.WithTx(tx)
	for _, p := range params {
		if err := q.UpsertAchievement(r.Context(), p); err != nil {
			problem(w, http.StatusInternalServerError, "Saving badge failed", err.Error())
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem(w, http.StatusInternalServerError, "Transaction failed", err.Error())
		return
	}

	// The response is the COMPLETE stored list, not just the part submitted now:
	// this is how the client also gets to see the badges it did not know about
	// (after a reinstall).
	out, err := s.listAchievements(r.Context(), uid)
	if err != nil {
		problem(w, http.StatusInternalServerError, "Query failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) listAchievements(ctx context.Context, uid uuid.UUID) ([]api.Achievement, error) {
	rows, err := s.q.ListAchievements(ctx, pgconv.UUID(uid))
	if err != nil {
		return nil, err
	}
	out := make([]api.Achievement, 0, len(rows))
	for _, a := range rows {
		out = append(out, achievementDTO(a))
	}
	return out, nil
}

// achievementParams turns the contract-level input into database parameters, and
// validates along the way. `kind` is a closed set: accepting an unknown family
// would store a badge that no client can draw.
func achievementParams(uid uuid.UUID, in api.AchievementInput) (db.UpsertAchievementParams, error) {
	if in.Id == "" {
		return db.UpsertAchievementParams{}, fmt.Errorf("missing id")
	}
	if !in.Kind.Valid() {
		return db.UpsertAchievementParams{}, fmt.Errorf("invalid kind: %q", in.Kind)
	}
	if in.Code == "" {
		return db.UpsertAchievementParams{}, fmt.Errorf("missing code")
	}
	// The zero timestamp is the JSON footprint of a missing field. Writing it in
	// would park the badge at the end of the list with year 1 — while a tacit "now"
	// would be a lie: the client typically reports a moment in the past, not the
	// time of the sync.
	if in.EarnedAt.IsZero() {
		return db.UpsertAchievementParams{}, fmt.Errorf("missing earned_at")
	}
	var value *float64
	if in.Value != nil {
		v := float64(*in.Value)
		value = &v
	}
	return db.UpsertAchievementParams{
		UserID:     pgconv.UUID(uid),
		ID:         in.Id,
		Kind:       string(in.Kind),
		Code:       in.Code,
		Period:     in.Period,
		Value:      value,
		Unit:       in.Unit,
		Thresholds: thresholdsToDB(in.Thresholds),
		EarnedAt:   pgconv.Timestamptz(in.EarnedAt),
	}, nil
}

func achievementDTO(a db.Achievement) api.Achievement {
	out := api.Achievement{
		Id:       a.ID,
		Kind:     api.AchievementKind(a.Kind),
		Code:     a.Code,
		Period:   a.Period,
		Unit:     a.Unit,
		Value:    f64to32(a.Value),
		EarnedAt: a.EarnedAt.Time,
	}
	if a.Thresholds != nil {
		th := make([]int, 0, len(a.Thresholds))
		for _, v := range a.Thresholds {
			th = append(th, int(v))
		}
		out.Thresholds = &th
	}
	return out
}

// thresholdsToDB: nil stays NULL. "No thresholds" (record, milestone) and "an
// empty threshold list" are not the same thing, so we do not manufacture an
// empty array out of a missing field.
func thresholdsToDB(in *[]int) []int32 {
	if in == nil {
		return nil
	}
	out := make([]int32, 0, len(*in))
	for _, v := range *in {
		out = append(out, int32(v))
	}
	return out
}
