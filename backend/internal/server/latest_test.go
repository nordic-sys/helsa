package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/nordic-sys/helsa/backend/internal/auth"
	"github.com/nordic-sys/helsa/backend/internal/config"
	"github.com/nordic-sys/helsa/backend/internal/latest"
)

func TestLatestNames(t *testing.T) {
	many := make([]string, latest.MaxMetrics+1)
	for i := range many {
		many[i] = "t" + strings.Repeat("x", i)
	}
	cases := []struct {
		name   string
		names  []string
		reject bool
	}{
		{"one", []string{"heartRate"}, false},
		{"empty after trimming", nil, true},
		{"exactly the cap", many[:latest.MaxMetrics], false},
		{"one over the cap", many, true},
	}
	for _, c := range cases {
		title, _ := checkLatestNames(c.names)
		if (title != "") != c.reject {
			t.Errorf("%s: title %q, reject want %v", c.name, title, c.reject)
		}
	}
}

// The new path sits behind the same token gate as every other /v1 route.
func TestLatestRequiresToken(t *testing.T) {
	cfg := &config.Config{JWTSecret: "test-secret"}
	s := &Server{cfg: cfg, auth: auth.New(cfg, nil, nil)}
	rec := httptest.NewRecorder()
	s.Router().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/latest?metrics=heartRate", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("without a token: %d %q, want 401", rec.Code, rec.Body.String())
	}
}
