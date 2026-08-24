package insights

import (
	"encoding/json"
	"os"
	"testing"
	"time"
)

// TestEmitWirePayload is not an assertion — it writes one real response to a file so
// the Swift side can be run against BYTES this server actually produces, rather than
// against a fixture somebody typed. It only writes when asked:
//
//	HELSA_WIRE_OUT=/tmp/insights.json go test ./internal/insights -run EmitWire
func TestEmitWirePayload(t *testing.T) {
	path := os.Getenv("HELSA_WIRE_OUT")
	if path == "" {
		t.Skip("HELSA_WIRE_OUT not set")
	}
	raised := append(alternate(55, 1, MinBaselineDays), 75, 76, 77)
	in := Input{Today: today, Daily: map[string]Series{
		"restingHeartRate": seriesFrom(len(raised), raised...),
	}}
	out := Evaluate(in, time.Date(2026, 8, 11, 6, 0, 0, 0, time.UTC))
	blob, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, blob, 0o600); err != nil {
		t.Fatal(err)
	}
}
