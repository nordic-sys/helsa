package server

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/nordic-sys/helsa/backend/internal/auth"
	"github.com/nordic-sys/helsa/backend/internal/config"
)

// An unauthenticated caller hears 401 and nothing else — not a 400 that names the
// parameter it forgot. The generated wrapper validates parameters before its own
// middlewares run, so the gate has to sit outside it (Router). No database or
// Redis is needed: a request without a bearer token is turned away before either
// would be asked.
func TestUnauthenticatedCallerGets401BeforeValidation(t *testing.T) {
	cfg := &config.Config{JWTSecret: "test-secret"}
	s := &Server{cfg: cfg, auth: auth.New(cfg, nil, nil)}
	h := s.Router()

	for _, path := range []string{
		"/v1/summary?range=day",       // `metrics` missing — the walkthrough's request
		"/v1/summary",                 // every required parameter missing
		"/v1/summary?range=century",   // an invalid enum value
		"/v1/samples?from=not-a-date", // a parameter of the wrong format
		"/v1/no-such-endpoint",        // and one that does not exist at all
	} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("GET %s without a token: %d %q, want 401", path, rec.Code, rec.Body.String())
		}
	}

	// The public probe stays public.
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if rec.Code != http.StatusOK {
		t.Errorf("/healthz: %d, want 200", rec.Code)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/healthz", nil))
	if rec.Code != http.StatusOK {
		t.Errorf("/v1/healthz: %d, want 200", rec.Code)
	}
}
