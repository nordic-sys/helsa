package server

import (
	"errors"
	"net/http"
	"time"

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

	var snap *ingeststat.Snapshot
	sn, snapErr := ingeststat.Read(r.Context(), s.store.Redis, s.cfg.IngestQueue, now)
	if snapErr == nil {
		snap = &sn
	}

	writeJSON(w, http.StatusOK, ingeststat.Build(now, depth, depthErr, snap, snapErr))
}

var errNoQueue = errors.New("the API has no RabbitMQ connection")
