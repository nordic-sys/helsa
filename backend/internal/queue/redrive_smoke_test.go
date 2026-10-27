//go:build smoke

package queue

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	amqp "github.com/rabbitmq/amqp091-go"
)

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// redriveFixture opens a queue pair of its own (so a live worker is never
// involved) and a raw channel for setting up and inspecting it.
func redriveFixture(t *testing.T) (*Queue, *amqp.Channel, string) {
	t.Helper()
	url := envOr("HELSA_RABBITMQ_URL", "amqp://helsa:helsa_local_dev@localhost:5672/")
	name := "helsa.ingest.redrivesmoke." + uuid.NewString()[:8]
	q, err := Open(url, name)
	if err != nil {
		t.Fatalf("rabbitmq: %v", err)
	}
	conn, err := amqp.Dial(url)
	if err != nil {
		t.Fatal(err)
	}
	ch, err := conn.Channel()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = ch.QueueDelete(name, false, false, false)
		_, _ = ch.QueueDelete(name+".dlq", false, false, false)
		_ = conn.Close()
		_ = q.Close()
	})
	return q, ch, name
}

// deadLetter puts messages on the main queue and nacks them without requeue —
// the way the worker gives up on a batch — so they reach the dead-letter queue
// through the broker's own dead-lettering, x-death header and all.
func deadLetter(t *testing.T, ch *amqp.Channel, name string, bodies []string, headers []amqp.Table) {
	t.Helper()
	ctx := context.Background()
	for i, b := range bodies {
		p := amqp.Publishing{ContentType: "application/json", DeliveryMode: amqp.Persistent, Body: []byte(b),
			MessageId: fmt.Sprintf("m-%d", i)}
		if headers != nil {
			p.Headers = headers[i]
		}
		if err := ch.PublishWithContext(ctx, "", name, false, false, p); err != nil {
			t.Fatal(err)
		}
	}
	for range bodies {
		var d amqp.Delivery
		var ok bool
		for i := 0; i < 50 && !ok; i++ {
			var err error
			if d, ok, err = ch.Get(name, false); err != nil {
				t.Fatal(err)
			}
			if !ok {
				time.Sleep(50 * time.Millisecond)
			}
		}
		if !ok {
			t.Fatal("message never reached the main queue")
		}
		if err := d.Nack(false, false); err != nil {
			t.Fatal(err)
		}
	}
	waitDepth(t, ch, name+".dlq", len(bodies))
}

func waitDepth(t *testing.T, ch *amqp.Channel, queue string, want int) {
	t.Helper()
	var n int
	for i := 0; i < 50; i++ {
		qi, err := ch.QueueDeclarePassive(queue, true, false, false, false, nil)
		if err != nil {
			t.Fatal(err)
		}
		if n = qi.Messages; n == want {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("%s holds %d, want %d", queue, n, want)
}

func TestRedriveMovesEverythingIntact(t *testing.T) {
	q, ch, name := redriveFixture(t)
	ctx := context.Background()
	bodies := []string{`{"batch_id":"a"}`, `{"batch_id":"b"}`, `{"batch_id":"c"}`}
	deadLetter(t, ch, name, bodies, []amqp.Table{nil, {RedriveHeader: int32(2)}, nil})

	res, err := q.Redrive(ctx, 0)
	if err != nil {
		t.Fatal(err)
	}
	if res.Moved != 3 || res.Remaining != 0 || res.Stopped != nil {
		t.Fatalf("result: %+v", res)
	}
	// The one that had been redriven twice is now at 3: counted as a repeat.
	if res.MaxRedriven != 3 || res.Repeated != 1 {
		t.Errorf("repeat accounting: %+v", res)
	}

	// They are on the main queue, byte for byte, with their properties and the count.
	waitDepth(t, ch, name, 3)
	got := map[string]amqp.Delivery{}
	for i := 0; i < 3; i++ {
		d, ok, err := ch.Get(name, true)
		if err != nil || !ok {
			t.Fatalf("get %d: ok=%v err=%v", i, ok, err)
		}
		got[string(d.Body)] = d
	}
	for i, b := range bodies {
		d, ok := got[b]
		if !ok {
			t.Fatalf("body %s missing from the main queue (got %d)", b, len(got))
		}
		if d.ContentType != "application/json" || d.MessageId != fmt.Sprintf("m-%d", i) || d.DeliveryMode != amqp.Persistent {
			t.Errorf("%s: properties changed: %+v", b, d)
		}
		want := 1
		if i == 1 {
			want = 3
		}
		if n := RedriveCount(d.Headers); n != want {
			t.Errorf("%s: redrive count %d, want %d", b, n, want)
		}
	}

	// Empty dead-letter queue: nothing to do, and it says 0 remaining (measured).
	res, err = q.Redrive(ctx, 0)
	if err != nil || res.Moved != 0 || res.Remaining != 0 || res.MaxRedriven != 0 {
		t.Errorf("empty: %+v %v", res, err)
	}
}

func TestRedriveMaxLeavesTheRest(t *testing.T) {
	q, ch, name := redriveFixture(t)
	deadLetter(t, ch, name, []string{`{"n":1}`, `{"n":2}`, `{"n":3}`}, nil)

	res, err := q.Redrive(context.Background(), 2)
	if err != nil {
		t.Fatal(err)
	}
	if res.Moved != 2 || res.Remaining != 1 {
		t.Errorf("result: %+v", res)
	}
	waitDepth(t, ch, name, 2)
}

// Ack only after a confirmed, ROUTED publish: with the main queue gone, the
// mandatory publish comes back unroutable (and is still confirmed by the
// broker), so the dead-letter copy must be put back, not acknowledged.
func TestRedriveNeverAcksAnUnroutedPublish(t *testing.T) {
	q, ch, name := redriveFixture(t)
	deadLetter(t, ch, name, []string{`{"keep":"me"}`, `{"keep":"me too"}`}, nil)
	if _, err := ch.QueueDelete(name, false, false, false); err != nil {
		t.Fatal(err)
	}

	res, err := q.Redrive(context.Background(), 0)
	if err != nil {
		t.Fatalf("redrive: %v", err)
	}
	if res.Moved != 0 || res.Stopped == nil {
		t.Fatalf("result: %+v", res)
	}
	t.Logf("stopped: %v", res.Stopped)
	// Both still in the dead-letter queue, the first one requeued, nothing lost.
	waitDepth(t, ch, name+".dlq", 2)
	if res.Remaining != 2 {
		t.Errorf("remaining = %d, want 2", res.Remaining)
	}
}

func TestRedriveOneAtATime(t *testing.T) {
	q, _, _ := redriveFixture(t)
	q.redriveMu.Lock()
	_, err := q.Redrive(context.Background(), 0)
	q.redriveMu.Unlock()
	if !errors.Is(err, ErrRedriveBusy) {
		t.Errorf("second concurrent redrive: %v, want ErrRedriveBusy", err)
	}
}
