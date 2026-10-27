package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/ingest"
)

// The 202 body was empty while the contract and the docs promised one. This pins
// its shape as a client written from the documentation would read it.
func TestIngestAcceptedBody(t *testing.T) {
	id := uuid.New()
	body := ingestAccepted(id, ingest.Counts{Samples: 4, Workouts: 1, SleepSegments: 1, ActivitySummaries: 1})

	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if got["batch_id"] != id.String() {
		t.Errorf("batch_id: %v", got["batch_id"])
	}
	if got["max_items"] != float64(ingest.MaxItems) {
		t.Errorf("max_items: %v (want %d)", got["max_items"], ingest.MaxItems)
	}
	rec, ok := got["received"].(map[string]any)
	if !ok {
		t.Fatalf("received is missing: %s", raw)
	}
	// ⚠️ A zero is reported as 0, not left out: "no deletions arrived" is a
	// statement, and a missing key would leave the client to guess.
	want := map[string]float64{"samples": 4, "workouts": 1, "sleep_segments": 1, "activity_summaries": 1, "deletions": 0}
	for k, v := range want {
		if rec[k] != v {
			t.Errorf("received.%s = %v, want %v (body: %s)", k, rec[k], v, raw)
		}
	}
}

func TestTallyMatchesTheBatch(t *testing.T) {
	samples := make([]api.SampleIn, 3)
	dels := []string{"a", "b"}
	c := ingest.Tally(&api.IngestBatch{Samples: &samples, Deletions: &dels})
	if c.Samples != 3 || c.Deletions != 2 || c.Workouts != 0 {
		t.Fatalf("%+v", c)
	}
}

// "Malformed JSON" means the body is not JSON. A well-formed document with a value
// that does not fit gets the endpoint's validation title — the walkthrough's
// 17-character device_id was told its JSON was malformed.
func TestDecodeBodyTellsMalformedFromInvalid(t *testing.T) {
	cases := []struct {
		name, body, title string
	}{
		{"a non-UUID device_id", `{"device_id":"9a1f-not-a-uuid-x"}`, "Invalid batch"},
		{"a string where a list goes", `{"samples":"many"}`, "Invalid batch"},
		{"a broken document", `{"device_id":`, "Malformed JSON"},
		{"not JSON at all", `device_id=1`, "Malformed JSON"},
		{"no body", ``, "Malformed JSON"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/v1/ingest", strings.NewReader(c.body))
			var batch api.IngestBatch
			if decodeBody(rec, req, &batch, "Invalid batch") {
				t.Fatal("expected a refusal")
			}
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status %d", rec.Code)
			}
			var p api.Problem
			if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
				t.Fatalf("not a problem document: %s", rec.Body)
			}
			if p.Title == nil || *p.Title != c.title {
				t.Fatalf("title %v, want %q (detail %v)", p.Title, c.title, p.Detail)
			}
		})
	}
}
