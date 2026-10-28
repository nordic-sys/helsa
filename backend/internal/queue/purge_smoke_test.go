//go:build smoke

package queue

import (
	"context"
	"encoding/json"
	"testing"
)

// A deleted member's stuck batches leave the dead-letter queue; everybody else's
// stay, byte for byte (docs/36 §9, C21).
func TestPurgeDeadLettersTakesOnlyTheNamedMember(t *testing.T) {
	q, ch, name := redriveFixture(t)
	bodies := []string{
		`{"user_id":"aaaaaaaa-0000-0000-0000-00000000000a","batch":{"n":1}}`,
		`{"user_id":"bbbbbbbb-0000-0000-0000-00000000000b","batch":{"n":2}}`,
		`{"user_id":"aaaaaaaa-0000-0000-0000-00000000000a","batch":{"n":3}}`,
		`not json at all`,
	}
	deadLetter(t, ch, name, bodies, nil)
	waitDepth(t, ch, name+".dlq", len(bodies))

	removed, err := q.PurgeDeadLetters(context.Background(), func(b []byte) bool {
		var m struct {
			UserID string `json:"user_id"`
		}
		return json.Unmarshal(b, &m) == nil && m.UserID == "aaaaaaaa-0000-0000-0000-00000000000a"
	})
	if err != nil || removed != 2 {
		t.Fatalf("removed %d, err %v; want 2", removed, err)
	}
	waitDepth(t, ch, name+".dlq", 2)
	kept := map[string]bool{}
	for i := 0; i < 2; i++ {
		d, ok, err := ch.Get(name+".dlq", true)
		if err != nil || !ok {
			t.Fatalf("get: %v %v", ok, err)
		}
		kept[string(d.Body)] = true
	}
	if !kept[bodies[1]] || !kept[bodies[3]] {
		t.Errorf("the other member's batch and the unreadable one must stay unchanged: %v", kept)
	}
}
