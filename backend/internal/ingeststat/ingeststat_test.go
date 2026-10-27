package ingeststat

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/nordic-sys/helsa/backend/internal/queue"
)

// 12:30:30 — half a minute into a minute, so the partial-minute arithmetic is exercised.
var now = time.Date(2026, 10, 27, 12, 30, 30, 0, time.UTC)

func depth(ready, consumers, dlq int) *queue.Depth {
	return &queue.Depth{Name: "helsa.ingest", Ready: ready, Consumers: consumers, DLQName: "helsa.ingest.dlq", DLQReady: dlq}
}

// minutes fills `n` minutes ending with the current one, `batches` each.
func minutes(n, batches, items int) map[int64]Bucket {
	out := map[int64]Bucket{}
	cur := unixMinute(now)
	for i := 0; i < n; i++ {
		out[cur-int64(i)] = Bucket{Batches: batches, Items: items}
	}
	return out
}

func worker(startedAgo time.Duration) *WorkerState {
	last := now.Add(-2 * time.Second)
	return &WorkerState{StartedAt: now.Add(-startedAgo), LastBatchAt: &last, Prefetch: 8, Batches: 2400, Items: 9_000_000, Failed: 0}
}

// The first-install drain this endpoint was built for: ~4,000 batches waiting,
// one worker, ~100 batches a minute.
func TestDraining(t *testing.T) {
	snap := &Snapshot{Worker: worker(time.Hour), Minutes: minutes(11, 100, 400_000)}
	got := Build(now, depth(4000, 1, 0), nil, snap, nil)

	if !got.BrokerReachable || !got.StatsReachable {
		t.Fatalf("reachability: %+v", got)
	}
	tp := got.Throughput
	// 10 minutes back aligned to the minute, plus 30 s of the current one.
	if tp.WindowSeconds != 630 {
		t.Errorf("window = %d s, want 630", tp.WindowSeconds)
	}
	if tp.Batches != 1100 {
		t.Errorf("batches = %d", tp.Batches)
	}
	if tp.BatchesPerMinute == nil || *tp.BatchesPerMinute < 104 || *tp.BatchesPerMinute > 105 {
		t.Errorf("batches/min = %v, want ~104.8", tp.BatchesPerMinute)
	}
	if got.Queue.InFlightMax == nil || *got.Queue.InFlightMax != 8 {
		t.Errorf("in-flight bound = %v, want prefetch 8 × 1 consumer", got.Queue.InFlightMax)
	}
	// (4000 + 8) / (1100 / 630 s) ≈ 2296 s.
	if got.EtaSeconds == nil || *got.EtaSeconds < 2290 || *got.EtaSeconds > 2300 {
		t.Errorf("eta = %v, want ~2296", got.EtaSeconds)
	}
}

// A worker that started two minutes ago has a two-minute rate, not a tenth of a
// ten-minute one — and buckets from before its start (a previous worker) do not count.
func TestWindowIsCutAtTheWorkerStart(t *testing.T) {
	snap := &Snapshot{Worker: worker(2 * time.Minute), Minutes: minutes(11, 100, 1)}
	tp := Build(now, depth(500, 1, 0), nil, snap, nil).Throughput
	// Started at 12:28:30 → aligned to 12:28:00, so 150 s and three minutes of buckets.
	if tp.WindowSeconds != 150 || tp.Batches != 300 {
		t.Errorf("window %d s / %d batches, want 150 / 300", tp.WindowSeconds, tp.Batches)
	}
}

// Five seconds and one batch is not a rate of twelve a minute.
func TestAFreshWorkerIsNotABurst(t *testing.T) {
	ws := worker(5 * time.Second)
	ws.StartedAt = time.Date(2026, 10, 27, 12, 30, 25, 0, time.UTC)
	snap := &Snapshot{Worker: ws, Minutes: map[int64]Bucket{unixMinute(now): {Batches: 1, Items: 10}}}
	tp := Build(now, depth(10, 1, 0), nil, snap, nil).Throughput
	if tp.BatchesPerMinute == nil || *tp.BatchesPerMinute != 1 {
		t.Errorf("batches/min = %v, want 1 (divided by the one-minute floor)", tp.BatchesPerMinute)
	}
}

// Nothing waiting and nothing done: no rate, no ETA — and the counts are real zeros.
func TestIdle(t *testing.T) {
	snap := &Snapshot{Worker: worker(time.Hour), Minutes: map[int64]Bucket{}}
	got := Build(now, depth(0, 1, 0), nil, snap, nil)
	if got.EtaSeconds != nil {
		t.Errorf("eta on an empty queue: %d", *got.EtaSeconds)
	}
	if got.Throughput.BatchesPerMinute != nil {
		t.Errorf("a rate from an empty window: %v", *got.Throughput.BatchesPerMinute)
	}
	if got.Queue.Ready != 0 || got.Throughput.Batches != 0 {
		t.Errorf("idle should be measured zeros: %+v %+v", got.Queue, got.Throughput)
	}
}

// "Queued, nobody consuming" looks like slowness. It must not carry an ETA, even
// if the window still holds the rate of a worker that has since died.
func TestNoConsumerHasNoETA(t *testing.T) {
	snap := &Snapshot{Worker: worker(time.Hour), Minutes: minutes(5, 100, 1)}
	got := Build(now, depth(3000, 0, 0), nil, snap, nil)
	if got.EtaSeconds != nil {
		t.Errorf("eta with no consumer: %d", *got.EtaSeconds)
	}
	if got.Queue.Consumers != 0 {
		t.Errorf("consumers: %d", got.Queue.Consumers)
	}
	if got.Queue.InFlightMax == nil || *got.Queue.InFlightMax != 0 {
		t.Errorf("in-flight bound with no consumer = %v, want 0", got.Queue.InFlightMax)
	}
}

// Backlog, a consumer, but nothing finished in ten minutes: a stuck worker. No ETA.
func TestStalledHasNoETA(t *testing.T) {
	snap := &Snapshot{Worker: worker(time.Hour), Minutes: map[int64]Bucket{}}
	if got := Build(now, depth(3000, 1, 0), nil, snap, nil); got.EtaSeconds != nil {
		t.Errorf("eta with no rate: %d", *got.EtaSeconds)
	}
}

func TestDeadLetterAndFailuresAreCounted(t *testing.T) {
	snap := &Snapshot{Worker: worker(time.Hour), Minutes: map[int64]Bucket{unixMinute(now): {Batches: 3, Failed: 2}}}
	got := Build(now, depth(0, 1, 7), nil, snap, nil)
	if got.DeadLetter == nil || got.DeadLetter.Ready != 7 || got.DeadLetter.Name != "helsa.ingest.dlq" {
		t.Errorf("dead letter: %+v", got.DeadLetter)
	}
	if got.Throughput.Failed != 2 {
		t.Errorf("failed in window: %d", got.Throughput.Failed)
	}
}

// ⛔ The rule this endpoint exists to keep: a broker that cannot be asked is not an
// empty queue. On the wire the blocks are ABSENT, not zero.
func TestBrokerUnreachableIsNotZero(t *testing.T) {
	snap := &Snapshot{Worker: worker(time.Hour), Minutes: minutes(3, 10, 1)}
	got := Build(now, nil, errors.New("rabbitmq connection closed"), snap, nil)
	if got.BrokerReachable {
		t.Fatal("reachable with an error")
	}
	if got.BrokerError == nil || !strings.Contains(*got.BrokerError, "closed") {
		t.Errorf("broker_error: %v", got.BrokerError)
	}
	raw, _ := json.Marshal(got)
	var m map[string]any
	_ = json.Unmarshal(raw, &m)
	for _, k := range []string{"queue", "dead_letter", "eta_seconds"} {
		if _, ok := m[k]; ok {
			t.Errorf("%q present while the broker is unreachable: %s", k, raw)
		}
	}
	// What Redis knows is still worth showing.
	if got.Throughput == nil || got.Worker == nil {
		t.Errorf("the worker's tally should survive a broker outage: %s", raw)
	}
	if m["broker_reachable"] != false {
		t.Errorf("broker_reachable must be on the wire as false: %s", raw)
	}
}

func TestStatsUnreachableLeavesThroughputOut(t *testing.T) {
	got := Build(now, depth(100, 1, 0), nil, nil, errors.New("redis: connection refused"))
	raw, _ := json.Marshal(got)
	var m map[string]any
	_ = json.Unmarshal(raw, &m)
	for _, k := range []string{"worker", "throughput", "eta_seconds"} {
		if _, ok := m[k]; ok {
			t.Errorf("%q present while Redis is unreachable: %s", k, raw)
		}
	}
	if m["stats_reachable"] != false || got.Queue == nil {
		t.Errorf("want stats_reachable=false and the queue still shown: %s", raw)
	}
	// Without the worker's prefetch there is no in-flight bound to state.
	if got.Queue.InFlightMax != nil {
		t.Errorf("in-flight bound without a prefetch: %d", *got.Queue.InFlightMax)
	}
}

// No worker of this version ever ran: no worker block, the full window.
func TestNoWorkerRecord(t *testing.T) {
	got := Build(now, depth(10, 0, 0), nil, &Snapshot{Minutes: map[int64]Bucket{}}, nil)
	if got.Worker != nil {
		t.Errorf("worker block without a record: %+v", got.Worker)
	}
	if got.Throughput == nil || got.Throughput.WindowSeconds != 630 {
		t.Errorf("throughput: %+v", got.Throughput)
	}
}

func TestParseWorker(t *testing.T) {
	ws, err := parseWorker(map[string]string{
		"started_at": "2026-10-27T12:00:00Z", "prefetch": "8", "batches": "5", "items": "50", "failed": "1",
		"last_batch_at": "2026-10-27T12:10:00.5Z",
	})
	if err != nil || ws == nil || ws.Prefetch != 8 || ws.Batches != 5 || ws.Failed != 1 || ws.LastBatchAt == nil {
		t.Fatalf("%+v %v", ws, err)
	}
	if ws, err := parseWorker(nil); ws != nil || err != nil {
		t.Errorf("empty hash: %+v %v", ws, err)
	}
	if _, err := parseWorker(map[string]string{"started_at": "yesterday"}); err == nil {
		t.Error("a garbled start time must be an error, not a zero time")
	}
}

func TestKeysAreNamespacedByQueue(t *testing.T) {
	if workerKey("helsa.ingest") == workerKey("helsa.ingest.smoke") ||
		minuteKey("helsa.ingest", 1) == minuteKey("helsa.ingest.smoke", 1) {
		t.Error("the smoke queue would share the real queue's tally")
	}
}
