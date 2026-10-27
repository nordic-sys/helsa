package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/nordic-sys/helsa/backend/internal/auth"
	"github.com/nordic-sys/helsa/backend/internal/config"
)

func TestIntensityWindow(t *testing.T) {
	t0 := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	cases := []struct {
		name   string
		from   time.Time
		to     time.Time
		reject bool
	}{
		{"a year of weeks", t0.AddDate(0, 0, -53*7), t0, false},
		{"exactly the cap", t0.Add(-400 * 24 * time.Hour), t0, false},
		{"one second over the cap", t0.Add(-400*24*time.Hour - time.Second), t0, true},
		{"empty", t0, t0, true},
		{"backwards", t0, t0.Add(-time.Hour), true},
	}
	for _, c := range cases {
		title, _ := checkIntensityWindow(c.from, c.to)
		if (title != "") != c.reject {
			t.Errorf("%s: title %q, reject want %v", c.name, title, c.reject)
		}
	}
}

// The new path sits behind the same token gate as every other /v1 route, and a
// caller without a token is not told what parameters it takes.
func TestIntensityRequiresToken(t *testing.T) {
	cfg := &config.Config{JWTSecret: "test-secret"}
	s := &Server{cfg: cfg, auth: auth.New(cfg, nil, nil)}
	rec := httptest.NewRecorder()
	s.Router().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/workout-intensity", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("without a token: %d %q, want 401", rec.Code, rec.Body.String())
	}
}
