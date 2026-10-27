// What the ingest-queue page decides before it draws anything.
//
// Kept apart from the page so each state is a plain unit test: the page is a
// handful of tiles, but which sentence goes above them is the whole point of it.

import type { IngestStatus } from '../api/types'

/**
 * The one headline state of the pipeline.
 *
 *  - `unreachable` — the API could not ask RabbitMQ. The depth is UNKNOWN, and
 *    nothing on the page may read as zero.
 *  - `noConsumer` — batches waiting and no worker connected. This is the failure
 *    that looks like slowness, so it outranks everything but `unreachable`.
 *  - `stalled` — waiting, a worker connected, but nothing finished in the window
 *    (or the window could not be read): no rate, so no estimate.
 *  - `draining` — waiting, and being worked through.
 *  - `idle` — nothing waiting.
 */
export type IngestPhase = 'unreachable' | 'noConsumer' | 'stalled' | 'draining' | 'idle'

export function phase(s: IngestStatus): IngestPhase {
  const q = s.queue
  if (!s.broker_reachable || !q) return 'unreachable'
  if (q.ready === 0) return 'idle'
  if (q.consumers === 0) return 'noConsumer'
  if (!s.throughput?.batches_per_minute) return 'stalled'
  return 'draining'
}

/** Batches the dead-letter queue holds; `undefined` when it could not be read. */
export function deadLetters(s: IngestStatus): number | undefined {
  return s.broker_reachable ? s.dead_letter?.ready : undefined
}

/**
 * The estimate, in minutes, rounded UP — "about 1 minute" for 20 seconds says
 * less than it knows, but "about 0 minutes" with batches still waiting is false.
 * `undefined` whenever the server sent no estimate; it is never derived here.
 */
export function etaMinutes(s: IngestStatus): number | undefined {
  if (s.eta_seconds == null || phase(s) !== 'draining') return undefined
  return Math.max(1, Math.ceil(s.eta_seconds / 60))
}

/** How many decimals a rate gets: 0.4 a minute must not print as "0". */
export function rateDigits(v: number): number {
  return v < 10 ? 1 : 0
}
