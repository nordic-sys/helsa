package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/nordic-sys/helsa/backend/internal/queue"
)

func TestRedriveMax(t *testing.T) {
	cases := []struct {
		name   string
		body   string
		want   int
		status int // 0 = accepted
	}{
		{"no body → everything", "", 0, 0},
		{"empty object → everything", "{}", 0, 0},
		{"null max → everything", `{"max": null}`, 0, 0},
		{"a max", `{"max": 5}`, 5, 0},
		{"the cap itself", `{"max": 1000}`, 1000, 0},
		{"zero is not 'all'", `{"max": 0}`, 0, http.StatusBadRequest},
		{"over the cap is refused, not clamped", `{"max": 1001}`, 0, http.StatusBadRequest},
		{"wrong type", `{"max": "ten"}`, 0, http.StatusBadRequest},
		{"not JSON", `{max`, 0, http.StatusBadRequest},
	}
	for _, c := range cases {
		r := httptest.NewRequest(http.MethodPost, "/v1/ingest/dead-letter/redrive", strings.NewReader(c.body))
		w := httptest.NewRecorder()
		got, ok := redriveMax(w, r)
		if c.status == 0 {
			if !ok || got != c.want {
				t.Errorf("%s: got (%d, %v), want (%d, true); body %s", c.name, got, ok, c.want, w.Body)
			}
			continue
		}
		if ok || w.Code != c.status {
			t.Errorf("%s: ok=%v status=%d, want %d", c.name, ok, w.Code, c.status)
		}
	}
}

func TestRedriveResultJSON(t *testing.T) {
	raw, _ := json.Marshal(redriveResult(queue.RedriveResult{Moved: 0, Remaining: 0}))
	if string(raw) != `{"max_redriven":0,"moved":0,"remaining":0,"repeated":0}` {
		t.Errorf("empty DLQ: %s", raw)
	}
	// Remaining unknown → absent, never a 0 that says "empty".
	raw, _ = json.Marshal(redriveResult(queue.RedriveResult{Moved: 2, Remaining: -1, MaxRedriven: 3, Repeated: 1,
		Stopped: errors.New("confirm: timeout")}))
	var m map[string]any
	_ = json.Unmarshal(raw, &m)
	if _, ok := m["remaining"]; ok {
		t.Errorf("unknown remaining was sent: %s", raw)
	}
	if m["stopped_early"] != "confirm: timeout" || m["moved"] != float64(2) || m["repeated"] != float64(1) {
		t.Errorf("partial run: %s", raw)
	}
}

// Without a broker connection nothing can move: a 503, not a 200 with moved 0
// (which would read as "the dead-letter queue is empty").
func TestRedriveWithoutQueue(t *testing.T) {
	s := &Server{}
	w := httptest.NewRecorder()
	s.PostIngestDeadLetterRedrive(w, httptest.NewRequest(http.MethodPost, "/v1/ingest/dead-letter/redrive", nil))
	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d", w.Code)
	}
}
