package queue

import (
	"strings"
	"testing"
)

// 2026-10-27: a base64 password pasted raw into HELSA_RABBITMQ_URL made the dial
// fail at parse time, and the error carried the whole password into the logs.
// The parse fails before any network traffic, so this needs no broker.
func TestOpenDoesNotPrintThePassword(t *testing.T) {
	const pass = "q8/Zk+3vR1x9/TbE+uWm7nA2pL0sYc4dHf6gJe5iKo=="
	_, err := Open("amqp://helsa:"+pass+"@rabbitmq:5672/", "helsa.ingest")
	if err == nil {
		t.Fatal("expected the raw URL to be refused")
	}
	for _, piece := range []string{"q8/Zk", "Zk+3vR1x9", "TbE+uWm7nA2pL0sYc4dHf6gJe5iKo"} {
		if strings.Contains(err.Error(), piece) {
			t.Fatalf("password piece %q in the error: %v", piece, err)
		}
	}
	if !strings.Contains(err.Error(), "amqp://helsa:xxxxx@rabbitmq:5672/") {
		t.Errorf("the redacted URL should still say where it tried to go: %v", err)
	}
}
