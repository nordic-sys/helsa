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
// The server's own four settings sit on the users row. time_zone is not
// cosmetic: the daily bucketing of summary/activity/sleep cuts days in this zone
// (read.go: resolveLoc), so a wrong tz shifts every daily aggregate — which is
// why we validate it before writing.
//
// The phone's three blocks (challenge, hydration, journey) live in their own
// table and follow their own rules — replaced as a whole, absent until the phone
// first sends them. See phonesettings.go.

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
	phone, err := phoneBlocks(r.Context(), s.q, pgconv.UUID(uid))
	if err != nil {
		problem(w, http.StatusInternalServerError, "Reading settings failed", err.Error())
		return
	}
	out := settingsDTO(row.TimeZone, row.Locale, row.UnitSystem, row.NotifPrefs)
	phone.apply(&out)
	writeJSON(w, http.StatusOK, out)
}

// PutSettings is a PARTIAL update: only the fields that were sent change (the
// SQL COALESCEs), and notif_prefs is merged field by field — so flipping a
// single switch does not zero out the rest. The phone's blocks are the
// exception: a sent block replaces the stored one whole (phonesettings.go).
//
// Everything is validated before anything is written, and the writes share one
// transaction: a request with one bad field changes nothing, rather than the
// half of it that happened to come first.
func (s *Server) PutSettings(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok {
		problem(w, http.StatusUnauthorized, "Unauthorized", "")
		return
	}
	var body api.Settings
	if !decodeBody(w, r, &body, "Invalid settings") {
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

	phoneWrite, err := cleanPhoneSettings(&body)
	var bad *settingsError
	if errors.As(err, &bad) {
		problem(w, http.StatusBadRequest, bad.title, bad.detail)
		return
	}

	ctx := r.Context()
	tx, err := s.store.DB.Begin(ctx)
	if err != nil {
		problem(w, http.StatusInternalServerError, "Saving settings failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(ctx) }() // a no-op after Commit
	q := s.q.WithTx(tx)

	row, err := q.UpdateSettings(ctx, params)
	if errors.Is(err, pgx.ErrNoRows) {
		problem(w, http.StatusNotFound, "No such user", "")
		return
	}
	if err != nil {
		problem(w, http.StatusInternalServerError, "Saving settings failed", err.Error())
		return
	}
	if !phoneWrite.empty() {
		if err := phoneWrite.store(ctx, q, pgconv.UUID(uid)); err != nil {
			problem(w, http.StatusInternalServerError, "Saving settings failed", err.Error())
			return
		}
	}
	phone, err := phoneBlocks(ctx, q, pgconv.UUID(uid))
	if err != nil {
		problem(w, http.StatusInternalServerError, "Saving settings failed", err.Error())
		return
	}
	if err := tx.Commit(ctx); err != nil {
		problem(w, http.StatusInternalServerError, "Saving settings failed", err.Error())
		return
	}
	out := settingsDTO(row.TimeZone, row.Locale, row.UnitSystem, row.NotifPrefs)
	phone.apply(&out)
	writeJSON(w, http.StatusOK, out)
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
