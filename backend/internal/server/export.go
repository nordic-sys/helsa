package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/auth"
	"github.com/nordic-sys/helsa/backend/internal/export"
)

// --- POST /v1/export — synchronous CSV/JSON download ---
//
// The export is SYNCHRONOUS: the response IS the file, streamed. The
// asynchronous branch (docs/13 §3) is deliberately not built — there is no
// object store, and the document itself says the synchronous path is enough
// until exporting the full history starts timing out.

func (s *Server) PostExport(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok {
		problem(w, http.StatusUnauthorized, "Unauthorized", "")
		return
	}
	var body api.ExportRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		problem(w, http.StatusBadRequest, "Malformed JSON", err.Error())
		return
	}

	loc := s.resolveLoc(r.Context(), uid, nil)
	start, endExcl := dayWindow(loc, body.From, body.To, export.DefaultDays)
	req := export.Request{
		Format: export.Format(body.Format),
		Start:  start,
		End:    endExcl,
		TZ:     loc.String(),
	}
	if body.Metrics != nil {
		req.Metrics = *body.Metrics
	}
	if err := req.Validate(); err != nil {
		if errors.Is(err, export.ErrPDFNotSupported) {
			// The request is correct, the server just cannot do it yet — that is a 501,
			// not a 400.
			problem(w, http.StatusNotImplemented, "PDF export",
				"per docs/13 §2 the PDF report is a later phase; use csv or json")
			return
		}
		problem(w, http.StatusBadRequest, "Invalid export request", err.Error())
		return
	}

	// The headers go out BEFORE the body, because from then on we are streaming:
	// the status can no longer be changed mid-flight. An export that breaks off
	// shows up as a truncated file — which is why the error goes into the log, not
	// into the response status.
	w.Header().Set("Content-Type", req.ContentType())
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", req.Filename()))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)

	if err := export.Write(r.Context(), w, s.export, uid, req); err != nil {
		slog.Error("export interrupted", "user", uid, "format", req.Format, "err", err)
	}
}

// --- GET /v1/export/{id} ---
//
// There is no export job: POST /v1/export returns the file directly. The
// endpoint stays in the contract (in case the asynchronous branch is ever
// needed), but today it honestly answers 404 — better than an invented job stuck
// in `pending` forever.

func (s *Server) GetExportId(w http.ResponseWriter, r *http.Request, id openapi_types.UUID) {
	if _, ok := auth.UserID(r.Context()); !ok {
		problem(w, http.StatusUnauthorized, "Unauthorized", "")
		return
	}
	problem(w, http.StatusNotFound, "No such export job",
		fmt.Sprintf("the export is synchronous: POST /v1/export returns the file itself, not a job id "+
			"(requested id: %s). This endpoint wakes up if exporting the full history starts timing out.", id))
}
