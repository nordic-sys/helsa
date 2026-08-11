package server

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/auth"
	"github.com/nordic-sys/helsa/backend/internal/db"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
)

// --- POST /v1/push/register + PUT /v1/push/prefs ---
//
// ⚠️ This is the STORAGE side. Sending via APNs is an open decision (docs/19):
// the output may end up being ntfy or Home Assistant instead of push, and there
// is no Apple Developer membership either. The token, however, has to be
// acceptable already: the client receives it at the moment permission is
// granted, and if it has nowhere to put it, it is lost.
//
// What this endpoint does NOT do: it sends nothing, and it does not claim it
// will.

func (s *Server) PostPushRegister(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok {
		problem(w, http.StatusUnauthorized, "Unauthorized", "")
		return
	}
	var body api.PushRegister
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		problem(w, http.StatusBadRequest, "Malformed JSON", err.Error())
		return
	}
	if body.Token == "" {
		problem(w, http.StatusBadRequest, "Missing token", "token is required")
		return
	}
	if !body.Platform.Valid() {
		problem(w, http.StatusBadRequest, "Invalid platform", "platform ∈ {ios, ipados, macos, watchos}")
		return
	}
	env, ok := pushEnvironment(body.Environment)
	if !ok {
		problem(w, http.StatusBadRequest, "Invalid environment", "environment ∈ {sandbox, prod}")
		return
	}
	params := db.UpsertPushTokenParams{
		UserID:      pgconv.UUID(uid),
		Token:       body.Token,
		Platform:    string(body.Platform),
		Environment: env,
	}
	if body.DeviceId != nil {
		params.DeviceID = pgconv.UUID(*body.DeviceId)
	}
	if _, err := s.q.UpsertPushToken(r.Context(), params); err != nil {
		problem(w, http.StatusInternalServerError, "Saving token failed", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// pushEnvironment returns the requested APNs environment, defaulting to `prod`.
// Sandbox and prod use SEPARATE token spaces: sending to a sandbox token via the
// prod endpoint is a silent delivery failure, which is why the environment is
// stored together with the token.
func pushEnvironment(env *api.PushRegisterEnvironment) (string, bool) {
	if env == nil {
		return "prod", true
	}
	if !env.Valid() {
		return "", false
	}
	return string(*env), true
}

// PutPushPrefs writes the very same users.notif_prefs field as PUT /v1/settings
// — deliberately, so there are not two truths about what the user asked for.
// This endpoint is only a convenience surface: the native client calls it from
// the permission screen instead of sending the whole settings object.
func (s *Server) PutPushPrefs(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok {
		problem(w, http.StatusUnauthorized, "Unauthorized", "")
		return
	}
	var body api.NotifPrefs
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		problem(w, http.StatusBadRequest, "Malformed JSON", err.Error())
		return
	}
	cur, err := s.q.GetSettings(r.Context(), pgconv.UUID(uid))
	if err != nil {
		problem(w, http.StatusNotFound, "No such user", "")
		return
	}
	merged, err := mergeNotifPrefs(cur.NotifPrefs, &body)
	if err != nil {
		problem(w, http.StatusBadRequest, "Malformed notif_prefs", err.Error())
		return
	}
	row, err := s.q.UpdateSettings(r.Context(), db.UpdateSettingsParams{
		ID: pgconv.UUID(uid), NotifPrefs: merged,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		problem(w, http.StatusNotFound, "No such user", "")
		return
	}
	if err != nil {
		problem(w, http.StatusInternalServerError, "Saving preferences failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, notifPrefsFromJSON(row.NotifPrefs))
}
