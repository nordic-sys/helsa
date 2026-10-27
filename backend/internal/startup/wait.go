// Package startup waits for the data services when the process starts before
// they do.
//
// ⚠️ Compose's `depends_on: {condition: service_healthy}` does NOT cover the case
// it looks like it covers. It orders `docker compose up`; after a host reboot the
// Docker daemon brings every container back through its restart policy, all at
// once, and depends_on plays no part. The api and the worker then reached for a
// TimescaleDB and a RabbitMQ that were still starting, logged `store open` /
// `queue open` errors, exited, and were restarted — a healthy recovery whose log
// read like an outage. Waiting here makes the log say what is happening.
package startup

import (
	"context"
	"log/slog"
	"time"
)

// Budget is how long a dependency gets to come up. A host reboot takes the
// databases ~15 s on the reference VM; a minute leaves room without hiding a
// real fault for long — and the first failure is logged at once, with its error,
// so a wrong password is visible immediately rather than after the minute.
const Budget = 60 * time.Second

// interval is the pause between attempts.
var interval = 2 * time.Second

// Wait calls open until it succeeds, ctx ends, or budget runs out, and returns
// the last result. It logs once when it starts waiting and once when the wait is
// over, not on every attempt.
func Wait[T any](ctx context.Context, log *slog.Logger, what string, budget time.Duration,
	open func(context.Context) (T, error)) (T, error) {
	start := time.Now()
	deadline := start.Add(budget)
	waiting := false
	for {
		v, err := open(ctx)
		if err == nil {
			if waiting {
				log.Info("dependency ready", "what", what, "waited", time.Since(start).Round(time.Second).String())
			}
			return v, nil
		}
		if ctx.Err() != nil || time.Now().Add(interval).After(deadline) {
			return v, err
		}
		if !waiting {
			waiting = true
			log.Info("waiting for dependency", "what", what, "budget", budget.String(), "err", err)
		}
		select {
		case <-ctx.Done():
			return v, err
		case <-time.After(interval):
		}
	}
}
