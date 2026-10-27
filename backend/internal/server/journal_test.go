package server

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/nordic-sys/helsa/backend/internal/auth"
	"github.com/nordic-sys/helsa/backend/internal/config"
)

// The most sensitive data the product holds sits behind the same token gate as
// every other /v1 route — all three verbs.
func TestJournalRequiresToken(t *testing.T) {
	cfg := &config.Config{JWTSecret: "test-secret"}
	s := &Server{cfg: cfg, auth: auth.New(cfg, nil, nil)}
	for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodDelete} {
		rec := httptest.NewRecorder()
		s.Router().ServeHTTP(rec, httptest.NewRequest(method, "/v1/journal", nil))
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s without a token: %d %q, want 401", method, rec.Code, rec.Body.String())
		}
	}
}
