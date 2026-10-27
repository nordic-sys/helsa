// What the ingest-queue page decides before it draws anything.
//
// Kept apart from the page so each state is a plain unit test: the page is a
// handful of tiles, but which sentence goes above them is the whole point of it.

import type { IngestFailure, IngestStatus } from '../api/types'

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

// --- The queue, seen from outside the queue page ------------------------------
//
// The sidebar badge and the Today page's header pill both summarise the same
// snapshot, and they must never disagree with each other or with the page they
// link to — so both read one function, and the order of its checks is the same
// order of severity the queue page uses for its alerts.

/** The severity the badge and the pill are coloured by. */
export type QueueTone = 'busy' | 'stalled' | 'error'

/**
 * The one-word state of the pipeline as the rest of the site shows it.
 *
 *  - `unknown`    — the broker could not be asked: no number, and not zero.
 *  - `setAside`   — the dead-letter queue holds batches. Outranks the backlog,
 *                   because it is data that will not arrive without action.
 *  - `noConsumer` / `stalled` — waiting, and not moving.
 *  - `writing`    — waiting, and being worked through.
 *  - `upToDate`   — nothing waiting and nothing set aside. ⚠️ The ONLY state in
 *                   which anything may say "up to date".
 */
export type SyncState = 'unknown' | 'setAside' | 'noConsumer' | 'stalled' | 'writing' | 'upToDate'

export function syncState(s: IngestStatus): SyncState {
  const p = phase(s)
  if (p === 'unreachable') return 'unknown'
  const dlq = deadLetters(s)
  if (dlq != null && dlq > 0) return 'setAside'
  if (p === 'noConsumer') return 'noConsumer'
  if (p === 'stalled') return 'stalled'
  if (p === 'draining') return 'writing'
  return 'upToDate'
}

export function toneOf(state: SyncState): QueueTone | 'ok' {
  switch (state) {
    case 'setAside':
      return 'error'
    case 'unknown':
    case 'noConsumer':
    case 'stalled':
      return 'stalled'
    case 'writing':
      return 'busy'
    case 'upToDate':
      return 'ok'
  }
}

/**
 * What the sidebar badge on the queue link says, or `null` for no badge.
 *
 * The count is the dead-letter count when there is one (that is the number that
 * needs a person), otherwise the waiting batches. An unreachable broker is a
 * badge with no number at all — a "?" — and never a 0.
 */
export type QueueBadge =
  | { tone: QueueTone; kind: 'setAside' | 'waiting'; count: number }
  | { tone: 'stalled'; kind: 'unknown' }

export function queueBadge(s: IngestStatus | undefined): QueueBadge | null {
  if (!s) return null
  const state = syncState(s)
  if (state === 'upToDate') return null
  if (state === 'unknown') return { tone: 'stalled', kind: 'unknown' }
  if (state === 'setAside') return { tone: 'error', kind: 'setAside', count: deadLetters(s) ?? 0 }
  return {
    tone: toneOf(state) as QueueTone,
    kind: 'waiting',
    count: s.queue?.ready ?? 0,
  }
}

/**
 * True when an endpoint this page relies on answered 404.
 *
 * ⚠️ **That is version skew, not a missing page.** Every route the web calls is
 * in the contract, so a 404 from one of them means the server's API predates
 * this build of the web — which is exactly what happens when the web image is
 * pulled before the backend image. Saying "HTTP 404" sends the reader looking for
 * a broken link; saying "the server is older than this page" tells them what to
 * update.
 */
export function isApiTooOld(error: unknown): boolean {
  return (error as { status?: number } | null)?.status === 404
}

// --- Why something was set aside -------------------------------------------

/**
 * The dead-letter queue's reasons, read honestly out of a LOG.
 *
 * `recent_failures` is the worker's log of failures, not a listing of the queue:
 * an entry stays after its batch was redriven, and a batch parked by a worker
 * older than the log has no entry at all. So:
 *
 *  - `current` — entries newer than the last redrive: these batches can still be
 *    in the queue. Capped at the queue's depth (newest first).
 *  - `movedBack` — entries at or before the last redrive: that redrive moved
 *    them back, whatever happened to them since.
 *  - `unrecorded` — how many of the queued batches have no entry. Said as
 *    "reason not recorded", never guessed.
 */
export type DeadLetterReasons = {
  current: IngestFailure[]
  movedBack: IngestFailure[]
  unrecorded: number
}

export function deadLetterReasons(s: IngestStatus): DeadLetterReasons {
  const ready = deadLetters(s) ?? 0
  const log = s.dead_letter?.recent_failures ?? []
  const cut = s.dead_letter?.last_redrive?.at
  const cutMs = cut ? new Date(cut).getTime() : Number.NEGATIVE_INFINITY
  const after = log.filter((f) => new Date(f.failed_at).getTime() > cutMs)
  const movedBack = log.filter((f) => new Date(f.failed_at).getTime() <= cutMs)
  const current = after.slice(0, ready)
  return { current, movedBack, unrecorded: Math.max(0, ready - current.length) }
}

/** From this many redrives on, retrying has not helped so far (the contract's 3). */
export const REPEATED_REDRIVES = 3

/**
 * A plain-language reading of a worker error, for the line above the raw one.
 *
 * Deliberately coarse, and only where the error says so in words a database or
 * a network uses — anything else is `other`, and the raw message (always shown,
 * in a disclosure) is the authority.
 *
 *  - `undecodable` — the batch held nothing the worker could read (0 items).
 *  - `transient` — the database or the network was not there at that moment;
 *    a retry after it is back usually goes through.
 *  - `rejected` — the database refused the content; retrying the same batch
 *    will fail the same way until the cause is fixed.
 */
export type FailureKind = 'undecodable' | 'transient' | 'rejected' | 'other'

export function failureKind(f: IngestFailure): FailureKind {
  if (f.items === 0) return 'undecodable'
  const e = f.error
  if (
    /SQLSTATE 57P0\d|SQLSTATE 08\w{3}|connection refused|starting up|shutting down|no such host|i\/o timeout|broken pipe|unexpected EOF|context deadline exceeded/i.test(
      e,
    )
  )
    return 'transient'
  if (/SQLSTATE 2[23]\w{3}|violates|invalid input/i.test(e)) return 'rejected'
  return 'other'
}
