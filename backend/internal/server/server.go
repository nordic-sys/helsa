// Package server is the hand-written implementation of the generated
// api.ServerInterface.
//
// Every endpoint of the contract is implemented. Who may call which one is in
// authz.go — the table the isolation test reads too.
package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/auth"
	"github.com/nordic-sys/helsa/backend/internal/baseline"
	"github.com/nordic-sys/helsa/backend/internal/challenge"
	"github.com/nordic-sys/helsa/backend/internal/config"
	"github.com/nordic-sys/helsa/backend/internal/coverage"
	"github.com/nordic-sys/helsa/backend/internal/db"
	"github.com/nordic-sys/helsa/backend/internal/export"
	"github.com/nordic-sys/helsa/backend/internal/ingest"
	"github.com/nordic-sys/helsa/backend/internal/insights"
	"github.com/nordic-sys/helsa/backend/internal/journal"
	"github.com/nordic-sys/helsa/backend/internal/latest"
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
	baseline *baseline.Service
	workouts *workouts.Service
	samples  *samples.Service
	export   *export.DBSource
	insights *insights.Service
	// challenge: the monthly step challenge (GET /v1/challenge) — the same
	// milestones and streak the phone shows, as far as the server can honestly
	// compute them.
	challenge *challenge.Service
	coverage  *coverage.Service
	// latest: the newest measurement per type (GET /v1/latest) — one call for a
	// whole card grid instead of a /samples walk per metric.
	latest *latest.Service
	// journal: the phone's opt-in journal and events (/v1/journal) — symptoms,
	// moods and the heart-rate alerts, mirrored from HealthKit.
	journal *journal.Store
	q       *db.Queries
}

func New(cfg *config.Config, st *store.Store, q *queue.Queue) *Server {
	// One summary service, shared: the baseline reads THROUGH it rather than
	// straight from the pool, so the band rests on the same daily buckets the client
	// is looking at.
	sum := summary.New(st.DB, st.Redis)
	return &Server{
		cfg:       cfg,
		store:     st,
		queue:     q,
		auth:      auth.New(cfg, st.DB, st.Redis),
		summary:   sum,
		baseline:  baseline.New(sum),
		workouts:  workouts.New(st.DB),
		samples:   samples.New(st.DB),
		export:    export.NewDBSource(st.DB),
		insights:  insights.New(st.DB),
		challenge: challenge.New(st.DB),
		coverage:  coverage.New(st.DB),
		latest:    latest.New(st.DB),
		journal:   journal.New(st.DB),
		q:         db.New(st.DB),
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
	r.Use(noStore)

	// Root-level health probes (the k8s liveness/readiness convention). The contract
	// also offers /v1/healthz|readyz; both are served by the same logic.
	r.Get("/healthz", s.GetHealthz)
	r.Get("/readyz", s.GetReadyz)

	// The map-tile proxy — hand-wired for the same kind of reason the probes are:
	// it is not part of the phone's contract. The whole argument is at the top of
	// tiles.go. It is registered BEFORE the mount so chi matches the explicit
	// pattern rather than handing /v1/* to the generated router, and it carries
	// the same device-token gate as every other /v1 route.
	r.With(s.auth.Middleware).Get("/v1/tiles/{z}/{x}/{y}", s.GetTile)

	// The ServerInterface routes are served under a /v1 prefix.
	// Bearer protection is resolved per path (see the public-route list below).
	//
	// ⚠️ The gate wraps the WHOLE generated handler, not the per-route
	// `Middlewares` of ChiServerOptions. The generated wrapper binds and validates
	// the query parameters first and only then calls those middlewares, so an
	// unauthenticated `GET /v1/summary?range=day` used to get a 400 naming the
	// missing `metrics` parameter — the API describing its own shape to a caller
	// with no token. Outside the generated code, the token is checked first and a
	// caller without one hears 401 and nothing else.
	apiHandler := api.HandlerWithOptions(s, api.ChiServerOptions{BaseURL: "/v1"})
	r.Mount("/", s.authGate(apiHandler))
	return r
}

// authGate puts the session middleware on every /v1 path except the public ones.
// That includes /v1 paths no route matches: without a token, an unknown endpoint
// and a known one look the same (401) — which endpoints exist is not for a caller
// without a token to find out.
func (s *Server) authGate(next http.Handler) http.Handler {
	protected := s.auth.Middleware(requireAccess(next))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isPublic(r.Method, r.URL.Path) || !strings.HasPrefix(r.URL.Path, "/v1/") {
			next.ServeHTTP(w, r)
			return
		}
		protected.ServeHTTP(w, r)
	})
}

// isPublic: the root probes, and the /v1 operations the table (authz.go) marks
// Public. One list, so the gate and the table cannot disagree.
func isPublic(method, path string) bool {
	if path == "/healthz" || path == "/readyz" {
		return true
	}
	rl, ok := ruleFor(method, path)
	return ok && rl.Access == Public
}

// --- Auth ---
//
// There is no interactive login: access is layered — an mTLS client certificate
// at the proxy (transport), and above it a long-lived device token
// (application), see docs/ADR-0003. What remains here: revoking one's own token.

// PostAuthRefresh is retired: nothing issues refresh tokens any more.
//
// ⚠️ The phone was handed one with every token and never used it; the web never did
// either. Kept, it was a second, independent credential: revoking a device token
// left its refresh token able to mint a new one, and two concurrent refreshes could
// both succeed (docs/36 §9, C6). 410 rather than 404, so that a client still holding
// one hears that the route existed and is gone.
func (s *Server) PostAuthRefresh(w http.ResponseWriter, r *http.Request) {
	problem(w, http.StatusGone, "Refresh retired",
		"device tokens are long-lived and are not refreshed; ask the server's admin for a new one")
}

// PostAuthLogout ends this device's session: the access token presented on the
// request is revoked.
//
// It revokes the token on the REQUEST rather than one named in the body, deliberately:
// that way the route can only ever end the caller's own session. A body-named token
// would let anyone holding one valid token revoke somebody else's.
func (s *Server) PostAuthLogout(w http.ResponseWriter, r *http.Request) {
	if tok, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer "); ok && tok != "" {
		if _, err := s.auth.Revoke(r.Context(), tok); err != nil &&
			!errors.Is(err, auth.ErrUnauthorized) {
			// ⛔ The one case that must not answer 204. If the revocation could not be
			// written, the session is NOT over, and a success here would tell somebody
			// with a stolen phone that they had dealt with it.
			problem(w, http.StatusServiceUnavailable, "Not logged out",
				"the token could not be revoked: "+err.Error())
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- Profile: household.go ---

// --- Ingest (write path) ---

func (s *Server) PostIngest(w http.ResponseWriter, r *http.Request) {
	uid, ok := principalID(r)
	if !ok {
		problem(w, http.StatusUnauthorized, "Unauthorized", "")
		return
	}
	var batch api.IngestBatch
	if !decodeBody(w, r, &batch, "Invalid batch") {
		return
	}
	if err := ingest.Validate(&batch); err != nil {
		if errors.Is(err, ingest.ErrTooLarge) {
			problem(w, http.StatusRequestEntityTooLarge, "Batch too large", err.Error())
			return
		}
		problem(w, http.StatusBadRequest, "Invalid batch", err.Error())
		return
	}
	batchID := uuid.New()
	msg, err := json.Marshal(ingest.Message{UserID: uid, BatchID: batchID, Batch: batch})
	if err != nil {
		problem(w, http.StatusInternalServerError, "Serialization failed", err.Error())
		return
	}
	if err := s.queue.Publish(r.Context(), msg); err != nil {
		problem(w, http.StatusServiceUnavailable, "Queue unreachable", err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, ingestAccepted(batchID, ingest.Tally(&batch)))
}

// ingestAccepted is the 202 body the contract promises (IngestAccepted).
//
// ⚠️ It used to be EMPTY — `content-length: 0` — while both the OpenAPI document and
// the public API page described `batch_id`, `received` and `max_items`, and the
// first-sync guide told people to size their chunks from `max_items`. Nothing in the
// iOS client reads it today (it treats any 2xx as done), which is how an empty body
// survived; a script written from the documentation would have found nothing.
//
// `received` is what was TAKEN IN, not what was written: the worker does the writing,
// later, and it is the worker's log line (same batch_id) that says how that went.
func ingestAccepted(batchID uuid.UUID, c ingest.Counts) api.IngestAccepted {
	id := openapi_types.UUID(batchID)
	maxItems := ingest.MaxItems
	out := api.IngestAccepted{BatchId: &id, MaxItems: &maxItems}
	samples, workouts, sleep, rings, deletions := c.Samples, c.Workouts, c.SleepSegments, c.ActivitySummaries, c.Deletions
	out.Received = &struct {
		ActivitySummaries *int `json:"activity_summaries,omitempty"`
		Deletions         *int `json:"deletions,omitempty"`
		Samples           *int `json:"samples,omitempty"`
		SleepSegments     *int `json:"sleep_segments,omitempty"`
		Workouts          *int `json:"workouts,omitempty"`
	}{
		ActivitySummaries: &rings,
		Deletions:         &deletions,
		Samples:           &samples,
		SleepSegments:     &sleep,
		Workouts:          &workouts,
	}
	return out
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

// noStore marks every /v1 answer except the map tiles as not to be kept by a
// browser or anything in between. They are one person's data or account, under URLs
// that are the same for everybody: an HTTP cache that kept Bob's answer could hand
// it to Nóri's next request in the same browser, and clearing the dashboard's own
// cache does not reach it (docs/36 §10.4, S10). The tiles are a map, nobody's.
func noStore(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/v1/") && !strings.HasPrefix(r.URL.Path, "/v1/tiles/") {
			w.Header().Set("Cache-Control", "no-store")
		}
		next.ServeHTTP(w, r)
	})
}
