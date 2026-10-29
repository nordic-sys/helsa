//go:build smoke

package queue

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/redis/go-redis/v9"
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

// The dead-letter lock is shared across processes: while one queue client (the
// worker's purge) holds it, another (the API's redrive) is told the queue is busy
// instead of working on it at the same time (docs/36 §10.4, S7).
func TestTheDeadLetterLockIsSharedAcrossClients(t *testing.T) {
	q1, _, name := redriveFixture(t)
	q2, err := Open(envOr("HELSA_RABBITMQ_URL", "amqp://helsa:helsa_local_dev@localhost:5672/"), name)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = q2.Close() })
	rdb := redis.NewClient(&redis.Options{Addr: envOr("HELSA_REDIS_ADDR", "localhost:6380"), Password: envOr("HELSA_REDIS_PASSWORD", "helsa_local_dev")})
	t.Cleanup(func() { _ = rdb.Close() })
	q1.UseSharedLock(rdb)
	q2.UseSharedLock(rdb)

	release, err := q1.acquire(context.Background(), 0)
	if err != nil {
		t.Fatalf("take the lock: %v", err)
	}
	if _, err := q2.Redrive(context.Background(), 0); !errors.Is(err, ErrRedriveBusy) {
		t.Errorf("a redrive while another process holds the lock: %v, want ErrRedriveBusy", err)
	}
	release()
	if _, err := q2.Redrive(context.Background(), 0); err != nil {
		t.Errorf("after the release: %v", err)
	}
}
