package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/auth"
	"github.com/nordic-sys/helsa/backend/internal/db"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
)

// --- GET/PUT /v1/settings ---
//
// All four settings sit on the users row. time_zone is not cosmetic: the daily
// bucketing of summary/activity/sleep cuts days in this zone (read.go:
// resolveLoc), so a wrong tz shifts every daily aggregate — which is why we
// validate it before writing.

func (s *Server) GetSettings(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok {
		problem(w, http.StatusUnauthorized, "Unauthorized", "")
		return
	}
	row, err := s.q.GetSettings(r.Context(), pgconv.UUID(uid))
	if err != nil {
		problem(w, http.StatusNotFound, "No such user", "")
		return
	}
	writeJSON(w, http.StatusOK, settingsDTO(row.TimeZone, row.Locale, row.UnitSystem, row.NotifPrefs))
}

// PutSettings is a PARTIAL update: only the fields that were sent change (the
// SQL COALESCEs), and notif_prefs is merged field by field — so flipping a
// single switch does not zero out the rest.
func (s *Server) PutSettings(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok {
		problem(w, http.StatusUnauthorized, "Unauthorized", "")
		return
	}
	var body api.Settings
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		problem(w, http.StatusBadRequest, "Malformed JSON", err.Error())
		return
	}
	params := db.UpdateSettingsParams{ID: pgconv.UUID(uid)}

	if body.TimeZone != nil {
		if !validTimeZone(*body.TimeZone) {
			problem(w, http.StatusBadRequest, "Invalid time zone",
				fmt.Sprintf("%q is not a known IANA zone", *body.TimeZone))
			return
		}
		params.TimeZone = body.TimeZone
	}
	if body.Locale != nil {
		if !body.Locale.Valid() {
			problem(w, http.StatusBadRequest, "Invalid locale", "locale ∈ {hu, en}")
			return
		}
		v := string(*body.Locale)
		params.Locale = &v
	}
	if body.UnitSystem != nil {
		if !body.UnitSystem.Valid() {
			problem(w, http.StatusBadRequest, "Invalid unit system", "unit_system ∈ {metric, imperial}")
			return
		}
		v := string(*body.UnitSystem)
		params.UnitSystem = &v
	}
	if body.NotifPrefs != nil {
		cur, err := s.q.GetSettings(r.Context(), pgconv.UUID(uid))
		if err != nil {
			problem(w, http.StatusNotFound, "No such user", "")
			return
		}
		merged, err := mergeNotifPrefs(cur.NotifPrefs, body.NotifPrefs)
		if err != nil {
			problem(w, http.StatusBadRequest, "Malformed notif_prefs", err.Error())
			return
		}
		params.NotifPrefs = merged
	}

	row, err := s.q.UpdateSettings(r.Context(), params)
	if errors.Is(err, pgx.ErrNoRows) {
		problem(w, http.StatusNotFound, "No such user", "")
		return
	}
	if err != nil {
		problem(w, http.StatusInternalServerError, "Saving settings failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, settingsDTO(row.TimeZone, row.Locale, row.UnitSystem, row.NotifPrefs))
}

// --- helpers ---

func settingsDTO(tz, locale, unitSystem string, notifPrefs []byte) api.Settings {
	loc := api.SettingsLocale(locale)
	unit := api.SettingsUnitSystem(unitSystem)
	prefs := notifPrefsFromJSON(notifPrefs)
	return api.Settings{
		TimeZone:   &tz,
		Locale:     &loc,
		UnitSystem: &unit,
		NotifPrefs: &prefs,
	}
}

// notifPrefsFromJSON fills the stored (possibly partial or empty) jsonb up into a
// COMPLETE object using the contract's defaults — the client should not have to
// interpret a missing field.
func notifPrefsFromJSON(raw []byte) api.NotifPrefs {
	out := defaultNotifPrefs()
	if len(raw) == 0 {
		return out
	}
	var stored api.NotifPrefs
	if err := json.Unmarshal(raw, &stored); err != nil {
		return out // corrupted jsonb: the default is the safe answer
	}
	overlayNotifPrefs(&out, &stored)
	return out
}

// mergeNotifPrefs lays the patch's non-nil fields over the stored values and
// returns jsonb. It deliberately does NOT write the defaults in: the defaults
// belong to the contract, not to the database.
func mergeNotifPrefs(raw []byte, patch *api.NotifPrefs) ([]byte, error) {
	var stored api.NotifPrefs
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &stored); err != nil {
			stored = api.NotifPrefs{} // corrupted jsonb: overwrite it
		}
	}
	overlayNotifPrefs(&stored, patch)
	return json.Marshal(stored)
}

func overlayNotifPrefs(dst, src *api.NotifPrefs) {
	if src == nil {
		return
	}
	if src.SyncErrors != nil {
		dst.SyncErrors = src.SyncErrors
	}
	if src.WeeklySummary != nil {
		dst.WeeklySummary = src.WeeklySummary
	}
	if src.GoalNudges != nil {
		dst.GoalNudges = src.GoalNudges
	}
	if src.Insights != nil {
		dst.Insights = src.Insights
	}
}

// defaultNotifPrefs holds the NotifPrefs defaults from openapi.yaml.
func defaultNotifPrefs() api.NotifPrefs {
	return api.NotifPrefs{
		SyncErrors:    boolPtr(true),
		WeeklySummary: boolPtr(true),
		GoalNudges:    boolPtr(false),
		Insights:      boolPtr(false),
	}
}

func boolPtr(b bool) *bool { return &b }
