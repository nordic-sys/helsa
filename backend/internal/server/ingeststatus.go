package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/auth"

	"github.com/nordic-sys/helsa/backend/internal/ingeststat"
	"github.com/nordic-sys/helsa/backend/internal/queue"
)

// --- GET /v1/ingest/status — the backlog between POST /ingest and the database ---
//
// Always a 200: when RabbitMQ or Redis cannot be asked, the answer says so in
// `broker_reachable` / `stats_reachable` and leaves the unmeasured blocks out.
// A 503 would make the page show a generic error exactly when the specific one
// ("the broker is gone, the worker's tally is fine") is the useful thing to see.
// What every field means is in internal/ingeststat and the contract.
func (s *Server) GetIngestStatus(w http.ResponseWriter, r *http.Request) {
	now := time.Now()

	var depth *queue.Depth
	var depthErr error
	if s.queue == nil {
		depthErr = errNoQueue
	} else if d, err := s.queue.Inspect(r.Context()); err != nil {
		depthErr = err
	} else {
		depth = &d
	}

	p, ok := auth.PrincipalFrom(r.Context())
	if !ok {
		problem(w, http.StatusUnauthorized, "Unauthorized", "")
		return
	}

	var snap *ingeststat.Snapshot
	sn, snapErr := ingeststat.Read(r.Context(), s.store.Redis, s.cfg.IngestQueue, now)
	if snapErr == nil {
		if !p.IsAdmin() {
			sn.Failures = ingeststat.OwnedBy(sn.Failures, p.UserID)
		}
		snap = &sn
	}

	out := ingeststat.Build(now, depth, depthErr, snap, snapErr)
	if !p.IsAdmin() {
		// The queue is everybody's; a member sees their own batches in it and the
		// rest only as numbers (docs/36 §1.2/1, §5.8).
		out = ingeststat.MemberView(out)
	}
	writeJSON(w, http.StatusOK, out)
}

var errNoQueue = errors.New("the API has no RabbitMQ connection")

// --- POST /v1/ingest/dead-letter/redrive — dead-lettered batches back to the worker ---
//
// Admins only (authz.go): a redrive moves EVERY member's stuck batches, so a member
// pressing it would be acting on other people's data (docs/36 §1.2/2).
//
// The whole argument (why it is safe, how nothing is lost, why one at a time) is
// on queue.Redrive. This handler only reads the optional body, maps the outcomes
// to statuses, and notes a redrive that moved something for the status page.
//
//   - nothing could be moved (no broker, no confirm mode) → 503
//   - another redrive is running in this process → 409
//   - otherwise 200, also when the run stopped part-way: `moved` is exact, and a
//     5xx would hide the batches that did move.
func (s *Server) PostIngestDeadLetterRedrive(w http.ResponseWriter, r *http.Request) {
	want, ok := redriveMax(w, r)
	if !ok {
		return
	}
	if s.queue == nil {
		problem(w, http.StatusServiceUnavailable, "Queue unreachable", errNoQueue.Error())
		return
	}
	res, err := s.queue.Redrive(r.Context(), want)
	if errors.Is(err, queue.ErrRedriveBusy) {
		problem(w, http.StatusConflict, "Redrive already running", err.Error())
		return
	}
	if err != nil {
		problem(w, http.StatusServiceUnavailable, "Queue unreachable", err.Error())
		return
	}
	if res.Moved > 0 {
		if err := ingeststat.RecordRedrive(r.Context(), s.store.Redis, s.cfg.IngestQueue, time.Now(), res.Moved); err != nil {
			slog.Warn("ingest stats: record redrive", "err", err)
		}
	}
	writeJSON(w, http.StatusOK, redriveResult(res))
}

// redriveMax reads the optional body. No body, `{}` and `{"max": null}` all
// mean "everything waiting"; a max outside 1..1000 is a 400 rather than being
// clamped, so a caller who asked for 5000 is not told it got what it asked for.
func redriveMax(w http.ResponseWriter, r *http.Request) (int, bool) {
	var req api.IngestRedriveRequest
	if r.Body != nil && r.ContentLength != 0 {
		err := json.NewDecoder(r.Body).Decode(&req)
		if err != nil && !errors.Is(err, io.EOF) {
			title, detail := decodeProblem(err, "Invalid redrive request")
			problem(w, http.StatusBadRequest, title, detail)
			return 0, false
		}
	}
	if req.Max == nil {
		return 0, true
	}
	if *req.Max < 1 || *req.Max > queue.MaxRedrivePerCall {
		problem(w, http.StatusBadRequest, "Invalid redrive request",
			fmt.Sprintf("max must be between 1 and %d", queue.MaxRedrivePerCall))
		return 0, false
	}
	return *req.Max, true
}

func redriveResult(res queue.RedriveResult) api.IngestRedriveResult {
	out := api.IngestRedriveResult{Moved: res.Moved, MaxRedriven: res.MaxRedriven, Repeated: res.Repeated}
	if res.Remaining >= 0 {
		n := res.Remaining
		out.Remaining = &n
	}
	if res.Stopped != nil {
		msg := res.Stopped.Error()
		out.StoppedEarly = &msg
	}
	return out
}
