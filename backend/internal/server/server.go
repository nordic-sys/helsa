// Package server is the hand-written implementation of the generated
// api.ServerInterface.
//
// The MVP's critical path is live: auth (Sign in with Apple) + POST /v1/ingest +
// GET /v1/summary + health. The remaining endpoints answer 501 until they are
// implemented — that way the contract is complete, the surface is stable, and it
// gets filled in gradually.
package server

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/auth"
	"github.com/nordic-sys/helsa/backend/internal/config"
	"github.com/nordic-sys/helsa/backend/internal/db"
	"github.com/nordic-sys/helsa/backend/internal/export"
	"github.com/nordic-sys/helsa/backend/internal/ingest"
	"github.com/nordic-sys/helsa/backend/internal/insights"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
	"github.com/nordic-sys/helsa/backend/internal/queue"
	"github.com/nordic-sys/helsa/backend/internal/samples"
	"github.com/nordic-sys/helsa/backend/internal/store"
	"github.com/nordic-sys/helsa/backend/internal/summary"
	"github.com/nordic-sys/helsa/backend/internal/workouts"
)

// Server holds every dependency and satisfies api.ServerInterface.
type Server struct {
	cfg      *config.Config
	store    *store.Store
	queue    *queue.Queue
	auth     *auth.Service
	summary  *summary.Service
	workouts *workouts.Service
	samples  *samples.Service
	export   *export.DBSource
	insights *insights.Service
	q        *db.Queries
}

func New(cfg *config.Config, st *store.Store, q *queue.Queue) *Server {
	return &Server{
		cfg:      cfg,
		store:    st,
		queue:    q,
		auth:     auth.New(cfg, st.DB, st.Redis),
		summary:  summary.New(st.DB, st.Redis),
		workouts: workouts.New(st.DB),
		samples:  samples.New(st.DB),
		export:   export.NewDBSource(st.DB),
		insights: insights.New(st.DB),
		q:        db.New(st.DB),
	}
}

// Router assembles the chi router: the public routes (auth, health) without
// auth, the rest of /v1/* behind the session middleware. The generated
// HandlerFromMux wires the routes to the ServerInterface; the base URL is /v1.
func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)

	// Root-level health probes (the k8s liveness/readiness convention). The contract
	// also offers /v1/healthz|readyz; both are served by the same logic.
	r.Get("/healthz", s.GetHealthz)
	r.Get("/readyz", s.GetReadyz)

	// The ServerInterface routes are served under a /v1 prefix.
	// Bearer protection is resolved per route (see the public-route list below).
	apiHandler := api.HandlerWithOptions(s, api.ChiServerOptions{
		BaseURL:     "/v1",
		Middlewares: []api.MiddlewareFunc{s.authGate},
	})
	r.Mount("/", apiHandler)
	return r
}

// authGate puts the session middleware on the protected routes, and not on the
// public ones.
func (s *Server) authGate(next http.Handler) http.Handler {
	protected := s.auth.Middleware(next)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isPublic(r.Method, r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		protected.ServeHTTP(w, r)
	})
}

func isPublic(method, path string) bool {
	switch path {
	case "/v1/auth/apple", "/v1/auth/refresh", "/v1/healthz", "/v1/readyz",
		"/healthz", "/readyz":
		return true
	}
	return false
}

// --- Auth ---
//
// There is no interactive login: access is layered — an mTLS client certificate
// at the proxy (transport), and above it a long-lived device token
// (application). Sign in with Apple and its /auth/apple endpoint have been
// retired, see docs/ADR-0003. What remains: refreshing and revoking an existing
// token.

type refreshBody struct {
	RefreshToken string `json:"refresh_token"`
}

func (s *Server) PostAuthRefresh(w http.ResponseWriter, r *http.Request) {
	var body refreshBody
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.RefreshToken == "" {
		body.RefreshToken = r.Header.Get("X-Refresh-Token")
	}
	sess, err := s.auth.Refresh(r.Context(), body.RefreshToken)
	if err != nil {
		problem(w, http.StatusUnauthorized, "Refresh failed", "invalid refresh token")
		return
	}
	writeJSON(w, http.StatusOK, sessionDTO(sess))
}

func (s *Server) PostAuthLogout(w http.ResponseWriter, r *http.Request) {
	var body refreshBody
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.RefreshToken == "" {
		body.RefreshToken = r.Header.Get("X-Refresh-Token")
	}
	_ = s.auth.Logout(r.Context(), body.RefreshToken)
	w.WriteHeader(http.StatusNoContent)
}

// --- Profile ---

func (s *Server) GetMe(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok {
		problem(w, http.StatusUnauthorized, "Unauthorized", "")
		return
	}
	u, err := s.q.GetUser(r.Context(), pgconv.UUID(uid))
	if err != nil {
		problem(w, http.StatusNotFound, "No such user", "")
		return
	}
	id := openapi_types.UUID(pgconv.ToUUID(u.ID))
	created := u.CreatedAt.Time
	set := settingsDTO(u.TimeZone, u.Locale, u.UnitSystem, u.NotifPrefs)
	out := api.User{Id: &id, DisplayName: u.DisplayName, CreatedAt: &created, Settings: &set}
	writeJSON(w, http.StatusOK, out)
}

// --- Ingest (write path) ---

func (s *Server) PostIngest(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok {
		problem(w, http.StatusUnauthorized, "Unauthorized", "")
		return
	}
	var batch api.IngestBatch
	if err := json.NewDecoder(r.Body).Decode(&batch); err != nil {
		problem(w, http.StatusBadRequest, "Malformed JSON", err.Error())
		return
	}
	if err := ingest.Validate(&batch); err != nil {
		problem(w, http.StatusBadRequest, "Invalid batch", err.Error())
		return
	}
	msg, err := json.Marshal(ingest.Message{UserID: uid, Batch: batch})
	if err != nil {
		problem(w, http.StatusInternalServerError, "Serialization failed", err.Error())
		return
	}
	if err := s.queue.Publish(r.Context(), msg); err != nil {
		problem(w, http.StatusServiceUnavailable, "Queue unreachable", err.Error())
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

// --- Summary (read path, timezone-aware) ---

func (s *Server) GetSummary(w http.ResponseWriter, r *http.Request, params api.GetSummaryParams) {
	uid, ok := auth.UserID(r.Context())
	if !ok {
		problem(w, http.StatusUnauthorized, "Unauthorized", "")
		return
	}
	tz := ""
	if params.Tz != nil {
		tz = *params.Tz
	}
	if tz == "" {
		if u, err := s.q.GetUser(r.Context(), pgconv.UUID(uid)); err == nil {
			tz = u.TimeZone
		} else {
			tz = "UTC"
		}
	}
	req := summary.Request{
		Range:   string(params.Range),
		Metrics: splitCSV(params.Metrics),
		TZ:      tz,
		From:    datePtr(params.From),
		To:      datePtr(params.To),
	}
	resp, err := s.summary.Compute(r.Context(), uid, req)
	if err != nil {
		problem(w, http.StatusBadRequest, "Summary failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// --- Health ---

func (s *Server) GetHealthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) GetReadyz(w http.ResponseWriter, r *http.Request) {
	if err := s.store.Ready(r.Context()); err != nil {
		problem(w, http.StatusServiceUnavailable, "Not ready", err.Error())
		return
	}
	if err := s.queue.Ready(); err != nil {
		problem(w, http.StatusServiceUnavailable, "Not ready", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

// The remaining ServerInterface methods live in per-topic files: reads
// (read.go), devices (devices.go), settings (settings.go), export (export.go),
// push (push.go), achievements (achievements.go).

// --- helpers ---

func sessionDTO(s *auth.Session) api.Session {
	at, rt, exp := s.AccessToken, s.RefreshToken, s.ExpiresIn
	return api.Session{AccessToken: &at, RefreshToken: &rt, ExpiresIn: &exp}
}

func splitCSV(s string) []string {
	var out []string
	for _, p := range splitComma(s) {
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func splitComma(s string) []string {
	var out []string
	start := 0
	for i := 0; i <= len(s); i++ {
		if i == len(s) || s[i] == ',' {
			out = append(out, s[start:i])
			start = i + 1
		}
	}
	return out
}

func datePtr(d *openapi_types.Date) *time.Time {
	if d == nil {
		return nil
	}
	t := d.Time
	return &t
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func problem(w http.ResponseWriter, status int, title, detail string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(api.Problem{Status: &status, Title: &title, Detail: &detail})
}
