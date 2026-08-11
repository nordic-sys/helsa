package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/auth"
	"github.com/nordic-sys/helsa/backend/internal/db"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
)

// --- GET /v1/devices — the device list, most recently seen first ---
//
// This is the source of the system's ONLY real alert (docs/16 §2): Home
// Assistant polls it, and speaks up if the newest last_seen_at is older than the
// threshold. That is why last_seen_at is never dictated by the client — it is
// always written by the server's clock (see the queries).

func (s *Server) GetDevices(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok {
		problem(w, http.StatusUnauthorized, "Unauthorized", "")
		return
	}
	rows, err := s.q.ListDevices(r.Context(), pgconv.UUID(uid))
	if err != nil {
		problem(w, http.StatusInternalServerError, "Query failed", err.Error())
		return
	}
	out := make([]api.Device, 0, len(rows))
	for _, d := range rows {
		out = append(out, deviceDTO(d))
	}
	writeJSON(w, http.StatusOK, out)
}

// --- POST /v1/devices — registration / heartbeat (upsert) ---
//
// There are two possible keys: if the client knows the server-side id, we write
// against that; if it does not (first registration, reinstalled app), the
// (platform, model) pair identifies it — so "iPhone" does not get duplicated on
// every reinstall.

func (s *Server) PostDevices(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok {
		problem(w, http.StatusUnauthorized, "Unauthorized", "")
		return
	}
	var body api.Device
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		problem(w, http.StatusBadRequest, "Malformed JSON", err.Error())
		return
	}
	if !body.Platform.Valid() {
		problem(w, http.StatusBadRequest, "Invalid platform",
			"platform ∈ {ios, ipados, watchos, macos, web}")
		return
	}
	if body.TimeZone != nil && !validTimeZone(*body.TimeZone) {
		problem(w, http.StatusBadRequest, "Invalid time zone", *body.TimeZone)
		return
	}

	var (
		d   db.Device
		err error
	)
	if body.Id != nil {
		d, err = s.q.UpsertDeviceByID(r.Context(), db.UpsertDeviceByIDParams{
			ID:       pgconv.UUID(*body.Id),
			UserID:   pgconv.UUID(uid),
			Platform: string(body.Platform),
			Model:    body.Model,
			Name:     body.Name,
			TimeZone: body.TimeZone,
		})
		// No returned row → the ownership filter on DO UPDATE caught it: the id exists,
		// but it is not this user's.
		if errors.Is(err, pgx.ErrNoRows) {
			problem(w, http.StatusConflict, "Device id already taken", "")
			return
		}
	} else {
		d, err = s.q.UpsertDevice(r.Context(), db.UpsertDeviceParams{
			UserID:   pgconv.UUID(uid),
			Platform: string(body.Platform),
			Model:    body.Model,
			Name:     body.Name,
			TimeZone: body.TimeZone,
		})
	}
	if err != nil {
		problem(w, http.StatusInternalServerError, "Saving device failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, deviceDTO(d))
}

// validTimeZone resolves the tz from Go's tzdata, because that is exactly what
// the read path will do too (time.LoadLocation). The empty string is not
// accepted: LoadLocation would return UTC for it, which here would be a silent
// overwrite rather than "not specified".
func validTimeZone(tz string) bool {
	if tz == "" {
		return false
	}
	_, err := time.LoadLocation(tz)
	return err == nil
}

func deviceDTO(d db.Device) api.Device {
	id := openapi_types.UUID(pgconv.ToUUID(d.ID))
	out := api.Device{
		Id:       &id,
		Platform: api.DevicePlatform(d.Platform),
		Model:    d.Model,
		Name:     d.Name,
		TimeZone: d.TimeZone,
	}
	if d.LastSeenAt.Valid {
		t := d.LastSeenAt.Time
		out.LastSeenAt = &t
	}
	return out
}
