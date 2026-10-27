// What the ingest-queue page decides before it draws anything.
//
// Kept apart from the page so each state is a plain unit test: the page is a
// handful of tiles, but which sentence goes above them is the whole point of it.

import type { IngestFailure, IngestStatus } from '../api/types'

/**
 * How long nothing may have finished, with nothing waiting, before the page says
 * "nothing left to write".
 *
 * ⚠️ **Why a quiet period at all.** `ready` counts the batches WAITING to be
 * handed to a worker. A batch the worker has taken and not yet acknowledged is
 * not in it — the API only knows an upper bound of those (`in_flight_max`). So
 * `ready === 0` means "nothing waiting for delivery", never "everything written".
 * The one piece of completion evidence the snapshot carries is the time of the
 * last finished batch: when nothing has finished for this long and nothing is
 * waiting, a batch still being written would have to be taking longer than any
 * batch the worker writes, and "nothing left to write" becomes defensible.
 * Measured on the server's own clocks (`checked_at` against the worker's
 * timestamps), so the browser's clock cannot skew it.
 */
export const QUIET_MS = 30_000

/**
 * How recent the last finished batch must be for a backlog to count as moving.
 * The rate is a ten-minute average: one batch nine minutes ago still makes a
 * rate, and must not keep the worker labelled "working".
 */
export const PROGRESS_MS = 2 * 60_000

/**
 * The one headline state of the pipeline.
 *
 *  - `unreachable` — the API could not ask RabbitMQ. The depth is UNKNOWN, and
 *    nothing on the page may read as zero.
 *  - `noConsumer` — batches waiting and no worker connected. This is the failure
 *    that looks like slowness, so it outranks everything but `unreachable`.
 *  - `rateUnknown` — waiting, a worker connected, but the worker's counters
 *    could not be read (Redis down) or this worker is too old to report them:
 *    whether it is moving is not known, which is not the same as "not moving".
 *  - `stalled` — waiting, a worker connected and reporting, and nothing finished
 *    recently (none in the window, or the last one older than `PROGRESS_MS`).
 *  - `draining` — waiting, and finished batches recently: connected and progressing.
 *  - `settling` — nothing waiting, but a connected worker may still be writing
 *    what it took (no completion evidence yet: see `QUIET_MS`).
 *  - `idle` — nothing waiting, and either no worker (a batch a worker held goes
 *    back to `ready` when it disconnects, so nothing can be in flight) or nothing
 *    finished for `QUIET_MS`.
 */
export type IngestPhase =
  | 'unreachable'
  | 'noConsumer'
  | 'rateUnknown'
  | 'stalled'
  | 'draining'
  | 'settling'
  | 'idle'

const ms = (iso: string | undefined) => (iso ? new Date(iso).getTime() : NaN)

/** Milliseconds between the snapshot and the worker's last sign of work, or NaN. */
function sinceLastWork(s: IngestStatus): number {
  const last = s.worker?.last_batch_at ?? s.worker?.started_at
  return ms(s.checked_at) - ms(last)
}

export function phase(s: IngestStatus): IngestPhase {
  const q = s.queue
  if (!s.broker_reachable || !q) return 'unreachable'
  if (q.ready === 0) {
    if (q.consumers === 0) return 'idle'
    // Completion evidence: the worker reports, and has been quiet long enough.
    if (s.stats_reachable && s.worker && sinceLastWork(s) >= QUIET_MS) return 'idle'
    return 'settling'
  }
  if (q.consumers === 0) return 'noConsumer'
  if (!s.stats_reachable || !s.worker) return 'rateUnknown'
  if (!s.throughput?.batches_per_minute) return 'stalled'
  const last = ms(s.worker.last_batch_at)
  if (!(ms(s.checked_at) - last <= PROGRESS_MS)) return 'stalled'
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
 *  - `unknown`     — the broker could not be asked: no number, and not zero.
 *  - `setAside`    — the dead-letter queue holds batches. Outranks the backlog,
 *                    because it is data that will not arrive without action.
 *  - `noConsumer` / `stalled` — waiting, and not moving.
 *  - `rateUnknown` — waiting, a worker connected, and whether it moves unknown.
 *  - `writing`     — waiting, and being worked through.
 *  - `settling`    — nothing waiting; the worker may still be finishing what it took.
 *  - `upToDate`    — nothing waiting, nothing set aside, and nothing finished for
 *                    `QUIET_MS`. ⚠️ The ONLY state in which anything may say
 *                    "nothing left to write".
 */
export type SyncState =
  | 'unknown'
  | 'setAside'
  | 'noConsumer'
  | 'stalled'
  | 'rateUnknown'
  | 'writing'
  | 'settling'
  | 'upToDate'

export function syncState(s: IngestStatus): SyncState {
  const p = phase(s)
  if (p === 'unreachable') return 'unknown'
  const dlq = deadLetters(s)
  if (dlq != null && dlq > 0) return 'setAside'
  switch (p) {
    case 'noConsumer':
    case 'stalled':
    case 'rateUnknown':
    case 'settling':
      return p
    case 'draining':
      return 'writing'
    default:
      return 'upToDate'
  }
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
    case 'rateUnknown':
    case 'settling':
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
  // Nothing waiting: a "0" badge would be noise, and settling is not a problem.
  if (state === 'upToDate' || state === 'settling') return null
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
 * The worker's recent failures, newest first — presented as the LOG they are.
 *
 * ⚠️ `recent_failures` is not a listing of the dead-letter queue: an entry stays
 * after its batch was redriven, a redrive can move only some of the batches
 * (it is capped, and it can stop part-way), and a batch parked by a worker older
 * than the log has no entry at all. And `last_redrive.at` is stamped when the
 * redrive FINISHED, so even "failed before the last retry" does not say the
 * retry moved it. Nothing here can tell which entry is still in the queue, so
 * the page does not try: it lists the log, says what it is, and says when the
 * last retry ran.
 */
export function failureLog(s: IngestStatus): IngestFailure[] {
  return s.dead_letter?.recent_failures ?? []
}

/**
 * From this many redrives on, retrying has not helped so far (the contract's 3).
 *
 * The same number means two different things in the two places it is read, and
 * the copy has to follow the backend exactly (`backend/internal/queue/redrive.go`):
 *
 *  - `IngestFailure.redriven` is the count BEFORE that failure: 3 means it had
 *    been retried three times and failed again — "failed after 3 retries".
 *  - `IngestRedriveResult.repeated` counts moved batches whose NEW count is ≥ 3:
 *    the backend raises the count before comparing, so a batch moved for the
 *    third time counts, and it had failed after only 2 earlier retries. The copy
 *    says "now on their third retry or later", not "failed after 3 retries".
 */
export const REPEATED_REDRIVES = 3

/** What one call of the retry endpoint can move at most (`MaxRedrivePerCall`). */
export const REDRIVE_MAX_PER_CALL = 1000

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

// --- What a failed retry call means -------------------------------------------

/**
 * How a retry request that did not answer 200 ended, as far as it is KNOWN.
 *
 *  - `busy` (409) and `brokerDown` (503) — the server said so: nothing moved.
 *  - `tooOld` (404) — the server has no such endpoint (version skew).
 *  - `rejected` — any other 4xx: the server refused the request before running it.
 *  - `unknown` — a 5xx other than 503, or no HTTP status at all (the connection
 *    dropped, a proxy timed out). ⚠️ The request may have run to completion and
 *    only its answer was lost, so the page must not say "it did not run".
 */
export type RedriveErrorKind = 'busy' | 'brokerDown' | 'tooOld' | 'rejected' | 'unknown'

export function redriveErrorKind(error: unknown): RedriveErrorKind {
  const status = (error as { status?: number } | null)?.status
  if (status === 409) return 'busy'
  if (status === 503) return 'brokerDown'
  if (status === 404) return 'tooOld'
  if (status != null && status >= 400 && status < 500) return 'rejected'
  return 'unknown'
}
