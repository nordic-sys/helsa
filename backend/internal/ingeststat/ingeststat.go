// Package ingeststat records what the ingest worker gets through, and turns it —
// together with the queue depth — into the GET /v1/ingest/status answer.
//
// # Why it exists
//
// On a real first install a phone uploaded years of history in minutes, and the
// worker then needed ~40 minutes to drain ~4,000 queued batches. Nothing on the
// web said so: the only way to see the backlog was `rabbitmqctl list_queues` over
// SSH. The queue depth alone is not enough either — "4,000 waiting" says nothing
// about whether that is ten minutes or never — so the worker writes down every
// batch it finishes, and the API reads that back.
//
// # What is stored, and how much
//
// Counts only — never a byte of health data. Two kinds of Redis key, both
// namespaced by the queue name (so the smoke test's queue does not mix with the
// real one):
//
//   - `helsa:ingest:<queue>:min:<unix minute>` — a hash with `batches`, `items`
//     and `failed` for one wall-clock minute. Each key expires after
//     [bucketTTL], so at most ~120 of them exist at once, whatever the load.
//   - `helsa:ingest:<queue>:worker` — one hash: when the worker started, its
//     prefetch, when it last finished a batch, and its totals since the start.
//     It is overwritten on every worker start.
//   - `helsa:ingest:<queue>:failures` and `…:redrive` — why the last batches
//     were dead-lettered, and the last redrive (see failures.go).
//
// A batch costs one pipelined round trip. A recording failure is logged by the
// caller and never fails the batch: the data is what matters, not its tally.
package ingeststat

import (
	"context"
	"fmt"
	"math"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/queue"
)

const (
	// Window is how far back the rate is measured. Long enough that one large
	// batch does not swing the number, short enough that a drain that has
	// stopped shows up as a falling rate within minutes.
	Window = 10 * time.Minute

	// bucketTTL keeps the per-minute keys bounded. It only has to outlive
	// Window; the slack is for clock drift and for a look by hand.
	bucketTTL = 2 * time.Hour

	// minRateSpan is the shortest span a rate is divided by. A worker that
	// started five seconds ago and finished one batch has not shown a rate of
	// twelve a minute; dividing by at least a minute underestimates the first
	// minute instead of inventing a burst.
	minRateSpan = time.Minute
)

func prefix(q string) string    { return "helsa:ingest:" + q }
func workerKey(q string) string { return prefix(q) + ":worker" }
func minuteKey(q string, m int64) string {
	return prefix(q) + ":min:" + strconv.FormatInt(m, 10)
}
func unixMinute(t time.Time) int64 { return t.Unix() / 60 }

// Recorder is the worker's half.
type Recorder struct {
	rdb   *redis.Client
	queue string
	now   func() time.Time
}

func NewRecorder(rdb *redis.Client, queueName string) *Recorder {
	return &Recorder{rdb: rdb, queue: queueName, now: time.Now}
}

// Start marks a fresh worker: the totals start again from zero, and the window
// is cut to begin here.
func (r *Recorder) Start(ctx context.Context, prefetch int) error {
	key := workerKey(r.queue)
	pipe := r.rdb.TxPipeline()
	pipe.Del(ctx, key)
	pipe.HSet(ctx, key,
		"started_at", r.now().UTC().Format(time.RFC3339Nano),
		"prefetch", prefetch,
		"batches", 0, "items", 0, "failed", 0)
	_, err := pipe.Exec(ctx)
	return err
}

// Done records one finished batch: written (ok) with `items` items, or given up
// on and dead-lettered (!ok). The worker records a dead-lettered batch with
// DeadLettered, which also keeps the reason; !ok is the count alone.
func (r *Recorder) Done(ctx context.Context, items int, ok bool) error {
	now := r.now()
	mk := minuteKey(r.queue, unixMinute(now))
	wk := workerKey(r.queue)
	pipe := r.rdb.Pipeline()
	if ok {
		pipe.HIncrBy(ctx, mk, "batches", 1)
		pipe.HIncrBy(ctx, mk, "items", int64(items))
		pipe.HIncrBy(ctx, wk, "batches", 1)
		pipe.HIncrBy(ctx, wk, "items", int64(items))
		pipe.HSet(ctx, wk, "last_batch_at", now.UTC().Format(time.RFC3339Nano))
	} else {
		pipe.HIncrBy(ctx, mk, "failed", 1)
		pipe.HIncrBy(ctx, wk, "failed", 1)
	}
	pipe.Expire(ctx, mk, bucketTTL)
	_, err := pipe.Exec(ctx)
	return err
}

// Bucket is one minute's tally.
type Bucket struct{ Batches, Items, Failed int }

// WorkerState is what the worker last said about itself.
type WorkerState struct {
	StartedAt   time.Time
	LastBatchAt *time.Time
	Prefetch    int
	Batches     int
	Items       int
	Failed      int
}

// Snapshot is what Read found in Redis.
type Snapshot struct {
	// Worker is nil when no worker of this version has ever started.
	Worker *WorkerState
	// Minutes holds the buckets of the window, by unix minute; a minute with no
	// key is simply missing (nothing was finished in it).
	Minutes map[int64]Bucket
	// Failures are the recorded dead-letterings, newest first (see failures.go).
	Failures []Failure
	// LastRedrive is nil when no redrive has moved anything in FailureTTL.
	LastRedrive *LastRedrive
}

// Read fetches the worker hash, the buckets of the last Window, the failure
// records and the last redrive, in one round trip.
func Read(ctx context.Context, rdb *redis.Client, queueName string, now time.Time) (Snapshot, error) {
	first := unixMinute(now.Add(-Window))
	last := unixMinute(now)
	pipe := rdb.Pipeline()
	w := pipe.HGetAll(ctx, workerKey(queueName))
	fl := pipe.LRange(ctx, failuresKey(queueName), 0, MaxFailures-1)
	rd := pipe.HGetAll(ctx, redriveKey(queueName))
	mins := make(map[int64]*redis.MapStringStringCmd, last-first+1)
	for m := first; m <= last; m++ {
		mins[m] = pipe.HGetAll(ctx, minuteKey(queueName, m))
	}
	if _, err := pipe.Exec(ctx); err != nil {
		return Snapshot{}, err
	}
	snap := Snapshot{
		Minutes:     map[int64]Bucket{},
		Failures:    parseFailures(fl.Val()),
		LastRedrive: parseLastRedrive(rd.Val()),
	}
	for m, cmd := range mins {
		h := cmd.Val()
		if len(h) == 0 {
			continue
		}
		snap.Minutes[m] = Bucket{Batches: atoi(h["batches"]), Items: atoi(h["items"]), Failed: atoi(h["failed"])}
	}
	ws, err := parseWorker(w.Val())
	if err != nil {
		return Snapshot{}, err
	}
	snap.Worker = ws
	return snap, nil
}

func parseWorker(h map[string]string) (*WorkerState, error) {
	if len(h) == 0 {
		return nil, nil
	}
	started, err := time.Parse(time.RFC3339Nano, h["started_at"])
	if err != nil {
		return nil, fmt.Errorf("worker started_at: %w", err)
	}
	ws := &WorkerState{
		StartedAt: started,
		Prefetch:  atoi(h["prefetch"]),
		Batches:   atoi(h["batches"]),
		Items:     atoi(h["items"]),
		Failed:    atoi(h["failed"]),
	}
	if s := h["last_batch_at"]; s != "" {
		if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
			ws.LastBatchAt = &t
		}
	}
	return ws, nil
}

func atoi(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}

// Build assembles the endpoint's answer. It is pure, so every state the page has
// to draw — draining, idle, no consumer, dead letters, broker gone — is a unit test.
//
// ⚠️ A block that was not measured is left out, never zeroed. "RabbitMQ did not
// answer" and "the queue is empty" are opposite situations, and a 0 would draw
// them identically.
func Build(now time.Time, depth *queue.Depth, depthErr error, snap *Snapshot, snapErr error) api.IngestStatus {
	out := api.IngestStatus{CheckedAt: now.UTC()}

	if depthErr == nil && depth != nil {
		out.BrokerReachable = true
		out.Queue = &api.IngestQueueDepth{Name: depth.Name, Ready: depth.Ready, Consumers: depth.Consumers}
		out.DeadLetter = &api.IngestDeadLetter{Name: depth.DLQName, Ready: depth.DLQReady}
	} else {
		msg := "rabbitmq unreachable"
		if depthErr != nil {
			msg = depthErr.Error()
		}
		out.BrokerError = &msg
	}

	var rate float64 // batches per second over the window; 0 = unknown or none
	if snapErr == nil && snap != nil {
		out.StatsReachable = true
		if ws := snap.Worker; ws != nil {
			started := ws.StartedAt.UTC()
			out.Worker = &api.IngestWorkerStats{
				StartedAt:         &started,
				Prefetch:          intp(ws.Prefetch),
				BatchesSinceStart: intp(ws.Batches),
				ItemsSinceStart:   intp(ws.Items),
				FailedSinceStart:  intp(ws.Failed),
			}
			if ws.LastBatchAt != nil {
				t := ws.LastBatchAt.UTC()
				out.Worker.LastBatchAt = &t
			}
			if out.Queue != nil && ws.Prefetch > 0 {
				out.Queue.InFlightMax = intp(ws.Prefetch * out.Queue.Consumers)
			}
		}
		if out.DeadLetter != nil {
			out.DeadLetter.RecentFailures = recentFailures(snap.Failures)
			if lr := snap.LastRedrive; lr != nil {
				out.DeadLetter.LastRedrive = &api.IngestLastRedrive{At: lr.At.UTC(), Moved: lr.Moved}
			}
		}
		var tp *api.IngestThroughput
		tp, rate = throughput(now, snap)
		out.Throughput = tp
	}

	out.EtaSeconds = eta(out.Queue, rate)
	return out
}

// throughput sums the buckets of the window and divides by its real length.
//
// The window is the last Window, plus the current partial minute, and cut short to
// the worker's start when that is later: a worker that has run for two minutes
// has a two-minute rate, not a tenth of one. Only whole minutes are stored, so
// the start is aligned down to its minute — the same minutes are summed as are
// measured.
func throughput(now time.Time, snap *Snapshot) (*api.IngestThroughput, float64) {
	firstMin := unixMinute(now.Add(-Window))
	if snap.Worker != nil {
		if sm := unixMinute(snap.Worker.StartedAt); sm > firstMin {
			firstMin = sm
		}
	}
	start := time.Unix(firstMin*60, 0)
	span := now.Sub(start)
	if span < minRateSpan {
		span = minRateSpan
	}

	var b Bucket
	for m, bk := range snap.Minutes {
		if m < firstMin || m > unixMinute(now) {
			continue
		}
		b.Batches += bk.Batches
		b.Items += bk.Items
		b.Failed += bk.Failed
	}
	tp := &api.IngestThroughput{
		WindowSeconds: int(span.Round(time.Second) / time.Second),
		Batches:       b.Batches,
		Items:         b.Items,
		Failed:        b.Failed,
	}
	if b.Batches == 0 {
		return tp, 0
	}
	perMin := span.Minutes()
	bpm := float32(float64(b.Batches) / perMin)
	ipm := float32(float64(b.Items) / perMin)
	tp.BatchesPerMinute = &bpm
	tp.ItemsPerMinute = &ipm
	return tp, float64(b.Batches) / span.Seconds()
}

// eta is an estimate and is absent whenever it would have to be invented: no
// queue reading, nothing waiting, nobody consuming, or no rate to divide by.
func eta(q *api.IngestQueueDepth, perSecond float64) *int {
	// Ready == 0 leaves only the in-flight bound: at most a prefetch's worth, and
	// "about 5 seconds" for batches that may already be written is a precision this
	// number does not have.
	if q == nil || q.Ready == 0 || q.Consumers == 0 || perSecond <= 0 {
		return nil
	}
	backlog := q.Ready
	if q.InFlightMax != nil {
		backlog += *q.InFlightMax
	}
	s := int(math.Ceil(float64(backlog) / perSecond))
	return &s
}

func intp(v int) *int { return &v }

// recentFailures is the contract's form of the failure records; nil (absent)
// when there are none.
func recentFailures(fs []Failure) *[]api.IngestFailure {
	if len(fs) == 0 {
		return nil
	}
	out := make([]api.IngestFailure, 0, len(fs))
	for _, f := range fs {
		af := api.IngestFailure{
			FailedAt:          f.At.UTC(),
			Error:             f.Error,
			Items:             f.Items(),
			Samples:           f.Samples,
			Workouts:          f.Workouts,
			SleepSegments:     f.SleepSegments,
			ActivitySummaries: f.ActivitySummaries,
			Deletions:         f.Deletions,
			Redriven:          f.Redriven,
		}
		if f.BatchID != uuid.Nil {
			id := f.BatchID
			af.BatchId = &id
		}
		out = append(out, af)
	}
	return &out
}

// MemberView is the status page as a household member sees it (docs/36 §5.8): the
// queue's depth as plain numbers, whether a worker is there, and their OWN failed
// batches — the snapshot's failures are already narrowed by the caller (OwnedBy).
//
// What goes: the throughput window and the ETA derived from it, the worker's
// counters and the time of its last batch, and the last redrive. Each of them says WHEN somebody uploaded and how
// much — on a server shared by a household, that is somebody else's day.
func MemberView(out api.IngestStatus) api.IngestStatus {
	out.Throughput = nil
	// The ETA is depth ÷ the server's rate: with the depth shown, it gives the rate
	// back (Codex R2). A member's view has the depth, not the pace.
	out.EtaSeconds = nil
	if out.Worker != nil {
		out.Worker = &api.IngestWorkerStats{StartedAt: out.Worker.StartedAt, Prefetch: out.Worker.Prefetch}
	}
	if out.DeadLetter != nil {
		dl := *out.DeadLetter
		dl.LastRedrive = nil
		out.DeadLetter = &dl
	}
	return out
}
