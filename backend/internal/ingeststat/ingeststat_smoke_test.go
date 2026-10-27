//go:build smoke

package ingeststat

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	amqp "github.com/rabbitmq/amqp091-go"
	"github.com/redis/go-redis/v9"

	"github.com/nordic-sys/helsa/backend/internal/queue"
)

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// The round trip the unit tests cannot make: the worker's writes land where the
// API's Read looks, and the passive declare reads the real depth of both queues.
// Both run against a queue name of their own, so a live worker is never involved.
func TestRecordReadAndInspect(t *testing.T) {
	ctx := context.Background()
	qname := "helsa.ingest.statsmoke." + uuid.NewString()[:8]

	rdb := redis.NewClient(&redis.Options{
		Addr:     envOr("HELSA_REDIS_ADDR", "localhost:6380"),
		Password: envOr("HELSA_REDIS_PASSWORD", "helsa_local_dev"),
	})
	t.Cleanup(func() { _ = rdb.Close() })
	if err := rdb.Ping(ctx).Err(); err != nil {
		t.Fatalf("redis: %v", err)
	}
	t.Cleanup(func() {
		keys, _ := rdb.Keys(ctx, prefix(qname)+":*").Result()
		if len(keys) > 0 {
			rdb.Del(ctx, keys...)
		}
	})

	rec := NewRecorder(rdb, qname)
	if err := rec.Start(ctx, 8); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		if err := rec.Done(ctx, 100, true); err != nil {
			t.Fatal(err)
		}
	}
	if err := rec.Done(ctx, 0, false); err != nil {
		t.Fatal(err)
	}

	snap, err := Read(ctx, rdb, qname, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if snap.Worker == nil || snap.Worker.Batches != 3 || snap.Worker.Items != 300 ||
		snap.Worker.Failed != 1 || snap.Worker.Prefetch != 8 || snap.Worker.LastBatchAt == nil {
		t.Fatalf("worker: %+v", snap.Worker)
	}
	var b Bucket
	for _, bk := range snap.Minutes {
		b.Batches += bk.Batches
		b.Items += bk.Items
		b.Failed += bk.Failed
	}
	if b != (Bucket{Batches: 3, Items: 300, Failed: 1}) {
		t.Fatalf("buckets: %+v", b)
	}
	// Bounded: the minute key carries a TTL, so the tally cannot grow forever.
	for m := range snap.Minutes {
		if ttl := rdb.TTL(ctx, minuteKey(qname, m)).Val(); ttl <= 0 || ttl > bucketTTL {
			t.Errorf("minute key TTL = %v", ttl)
		}
	}

	// A restart starts the totals again.
	if err := rec.Start(ctx, 4); err != nil {
		t.Fatal(err)
	}
	snap, _ = Read(ctx, rdb, qname, time.Now())
	if snap.Worker.Batches != 0 || snap.Worker.Prefetch != 4 || snap.Worker.LastBatchAt != nil {
		t.Errorf("after restart: %+v", snap.Worker)
	}

	// --- the failure log: sanitised, capped, expiring ---
	id := uuid.New()
	for i := 0; i < MaxFailures+5; i++ {
		f := Failure{BatchID: id, Samples: i, Redriven: 1}
		if err := rec.DeadLettered(ctx, f, errors.New(`insert sample: value 98.6 "x" out of range`)); err != nil {
			t.Fatal(err)
		}
	}
	if err := RecordRedrive(ctx, rdb, qname, time.Now(), 4); err != nil {
		t.Fatal(err)
	}
	snap, err = Read(ctx, rdb, qname, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(snap.Failures) != MaxFailures {
		t.Fatalf("failures kept: %d, want %d", len(snap.Failures), MaxFailures)
	}
	newest := snap.Failures[0]
	if newest.Samples != MaxFailures+4 || newest.BatchID != id || newest.Redriven != 1 || newest.At.IsZero() {
		t.Errorf("newest first: %+v", newest)
	}
	if newest.Error != `insert sample: value # "…" out of range` {
		t.Errorf("not sanitised: %q", newest.Error)
	}
	if snap.Worker.Failed != MaxFailures+5 {
		t.Errorf("failed counter: %d", snap.Worker.Failed)
	}
	if ttl := rdb.TTL(ctx, failuresKey(qname)).Val(); ttl <= 0 || ttl > FailureTTL {
		t.Errorf("failure list TTL = %v", ttl)
	}
	if snap.LastRedrive == nil || snap.LastRedrive.Moved != 4 {
		t.Errorf("last redrive: %+v", snap.LastRedrive)
	}

	// --- the queue depth ---
	url := envOr("HELSA_RABBITMQ_URL", "amqp://helsa:helsa_local_dev@localhost:5672/")
	q, err := queue.Open(url, qname)
	if err != nil {
		t.Fatalf("rabbitmq: %v", err)
	}
	t.Cleanup(func() {
		conn, err := amqp.Dial(url)
		if err == nil {
			ch, _ := conn.Channel()
			_, _ = ch.QueueDelete(qname, false, false, false)
			_, _ = ch.QueueDelete(qname+".dlq", false, false, false)
			_ = conn.Close()
		}
		_ = q.Close()
	})
	for i := 0; i < 2; i++ {
		if err := q.Publish(ctx, []byte(`{}`)); err != nil {
			t.Fatal(err)
		}
	}
	var d queue.Depth
	// The publish is asynchronous; give the broker a moment to count it.
	for i := 0; i < 20; i++ {
		if d, err = q.Inspect(ctx); err != nil {
			t.Fatal(err)
		}
		if d.Ready == 2 {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if d.Ready != 2 || d.Consumers != 0 || d.DLQReady != 0 || d.DLQName != qname+".dlq" {
		t.Fatalf("depth: %+v", d)
	}
	// Inspect runs on its own channel: publishing still works after it.
	if err := q.Publish(ctx, []byte(`{}`)); err != nil {
		t.Fatalf("publish after inspect: %v", err)
	}

	// And a closed connection is an error, not a zero.
	_ = q.Close()
	if _, err := q.Inspect(ctx); err == nil {
		t.Error("inspect on a closed connection reported no error")
	}
}
