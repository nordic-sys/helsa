package server

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/auth"
	"github.com/nordic-sys/helsa/backend/internal/journal"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

// --- /v1/journal — the phone's opt-in journal and events (docs/35 item 8) ---
//
// The most sensitive data the product holds: symptoms, mood, heart-rhythm
// alerts. The phone sends it only when the user turns the switch on, and the
// rules (a mirror of HealthKit, synchronous, swept after a backfill) are in
// internal/journal.
//
// ⚠️ Nothing of an entry is ever logged here — not a type, not a value. A
// failed write logs nothing at all beyond the problem response, whose detail
// names the field that was wrong, never its content.

func (s *Server) PostJournal(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok {
		problem(w, http.StatusUnauthorized, "Unauthorized", "")
		return
	}
	var body api.JournalBatch
	if !decodeBody(w, r, &body, "Invalid journal batch") {
		return
	}
	batch, err := journal.Validate(body)
	switch {
	case errors.Is(err, journal.ErrTooLarge):
		problem(w, http.StatusRequestEntityTooLarge, "Chunk too large", err.Error())
		return
	case err != nil:
		problem(w, http.StatusBadRequest, "Invalid journal batch", err.Error())
		return
	}
	res, err := s.journal.Write(r.Context(), uid, batch)
	if err != nil {
		problem(w, http.StatusInternalServerError, "Storing the journal failed", "")
		return
	}
	writeJSON(w, http.StatusOK, api.JournalAccepted{
		Stored: res.Stored, Deleted: res.Deleted, Swept: res.Swept, ServerTime: res.ServerTime.UTC(),
	})
}

func (s *Server) GetJournal(w http.ResponseWriter, r *http.Request, params api.GetJournalParams) {
	uid, ok := auth.UserID(r.Context())
	if !ok {
		problem(w, http.StatusUnauthorized, "Unauthorized", "")
		return
	}
	loc := s.resolveLoc(r.Context(), uid, params.Tz)
	start, endExcl := dayWindow(loc, params.From, params.To, journal.DefaultDays)
	if !endExcl.After(start) {
		problem(w, http.StatusBadRequest, "Invalid window", "`to` must not be before `from`")
		return
	}
	if days := int(endExcl.Sub(start).Hours()/24 + 0.5); days > journal.MaxWindowDays {
		problem(w, http.StatusBadRequest, "Window too long",
			fmt.Sprintf("at most %d days per request, got %d", journal.MaxWindowDays, days))
		return
	}
	out := api.JournalResponse{
		Tz:      loc.String(),
		From:    openapi_types.Date{Time: start},
		To:      openapi_types.Date{Time: endExcl.AddDate(0, 0, -1)},
		Entries: []api.JournalEntry{},
	}
	err := s.journal.Each(r.Context(), uid, start, endExcl, func(e api.JournalEntry) error {
		out.Entries = append(out.Entries, e)
		return nil
	})
	if err != nil {
		problem(w, http.StatusInternalServerError, "Reading the journal failed", "")
		return
	}
	total, last, err := s.journal.Status(r.Context(), uid)
	if err != nil {
		problem(w, http.StatusInternalServerError, "Reading the journal failed", "")
		return
	}
	out.Total, out.LastReceivedAt = total, last
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) DeleteJournal(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok {
		problem(w, http.StatusUnauthorized, "Unauthorized", "")
		return
	}
	n, err := s.journal.Purge(r.Context(), uid)
	if err != nil {
		problem(w, http.StatusInternalServerError, "Deleting the journal failed", "")
		return
	}
	writeJSON(w, http.StatusOK, api.JournalDeleted{Deleted: n})
}
