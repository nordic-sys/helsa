import { describe, expect, it } from 'vitest'
import type { IngestStatus } from '../api/types'
import {
  QUIET_MS,
  deadLetters,
  failureLog,
  failureKind,
  etaMinutes,
  isApiTooOld,
  phase,
  queueBadge,
  rateDigits,
  redriveErrorKind,
  syncState,
  toneOf,
} from './ingest'

const base = (over: Partial<IngestStatus> = {}): IngestStatus => ({
  checked_at: '2026-10-27T12:30:30Z',
  broker_reachable: true,
  queue: { name: 'helsa.ingest', ready: 4000, consumers: 1, in_flight_max: 8 },
  dead_letter: { name: 'helsa.ingest.dlq', ready: 0 },
  stats_reachable: true,
  worker: {
    started_at: '2026-10-27T11:30:00Z',
    last_batch_at: '2026-10-27T12:30:28Z',
    prefetch: 8,
    batches_since_start: 2400,
    items_since_start: 9_000_000,
    failed_since_start: 0,
  },
  throughput: { window_seconds: 630, batches: 1100, items: 4_400_000, failed: 0, batches_per_minute: 104.8 },
  eta_seconds: 2296,
  ...over,
})

describe('the phase', () => {
  it('is draining with a backlog, a consumer and a rate', () => {
    expect(phase(base())).toBe('draining')
  })
  it('is unreachable when the broker could not be asked, whatever else arrived', () => {
    expect(phase(base({ broker_reachable: false, queue: undefined, dead_letter: undefined }))).toBe(
      'unreachable',
    )
  })
  it('puts "nobody consuming" ahead of the rate a dead worker left behind', () => {
    expect(phase(base({ queue: { name: 'q', ready: 10, consumers: 0 } }))).toBe('noConsumer')
  })
  it('is stalled with a reporting worker and nothing finished in the window', () => {
    expect(
      phase(base({ throughput: { window_seconds: 630, batches: 0, items: 0, failed: 0 } })),
    ).toBe('stalled')
  })
  it('is stalled when the rate is an old average and the last batch is minutes ago', () => {
    // One completion nine minutes ago still makes a ten-minute rate; it must not read as "working".
    const w = { ...base().worker!, last_batch_at: '2026-10-27T12:21:30Z' }
    expect(phase(base({ worker: w }))).toBe('stalled')
  })
  it('says the rate is UNKNOWN — not stalled — without the counters or with an older worker', () => {
    expect(phase(base({ stats_reachable: false, worker: undefined, throughput: undefined }))).toBe('rateUnknown')
    expect(
      phase(base({ worker: undefined, throughput: { window_seconds: 630, batches: 0, items: 0, failed: 0 } })),
    ).toBe('rateUnknown')
  })
})

/**
 * ⛔ `ready === 0` is "nothing waiting for delivery", not "everything written":
 * a connected worker may still hold up to `in_flight_max` unacknowledged parts.
 */
describe('an empty ready queue', () => {
  const empty = (over: Partial<IngestStatus> = {}) =>
    base({ queue: { name: 'q', ready: 0, consumers: 1, in_flight_max: 8 }, eta_seconds: undefined, ...over })
  it('is settling, not idle, while a batch finished moments ago (the reviewer’s repro)', () => {
    expect(phase(empty())).toBe('settling')
    expect(syncState(empty())).toBe('settling')
  })
  it('is idle once nothing has finished for the quiet period', () => {
    const quiet = new Date(Date.parse('2026-10-27T12:30:30Z') - QUIET_MS).toISOString()
    const s = empty({ worker: { ...base().worker!, last_batch_at: quiet } })
    expect(phase(s)).toBe('idle')
    expect(syncState(s)).toBe('upToDate')
  })
  it('stays settling when the worker’s counters cannot be read — there is no completion evidence', () => {
    expect(phase(empty({ stats_reachable: false, worker: undefined, throughput: undefined }))).toBe('settling')
  })
  it('counts a worker that started long ago and never finished anything as quiet', () => {
    const w = { ...base().worker!, last_batch_at: undefined }
    expect(phase(empty({ worker: w }))).toBe('idle')
  })
  it('is idle with no worker connected: a part a worker held goes back to ready', () => {
    expect(phase(base({ queue: { name: 'q', ready: 0, consumers: 0 } }))).toBe('idle')
  })
  it('shows no badge while settling — nothing is waiting', () => {
    expect(queueBadge(empty())).toBeNull()
    expect(toneOf('settling')).toBe('busy')
  })
})

describe('the estimate', () => {
  it('rounds up to whole minutes', () => {
    expect(etaMinutes(base({ eta_seconds: 2296 }))).toBe(39)
    expect(etaMinutes(base({ eta_seconds: 20 }))).toBe(1)
  })
  it('is never derived when the server sent none', () => {
    expect(etaMinutes(base({ eta_seconds: undefined }))).toBeUndefined()
  })
  it('is not shown outside a drain, even if one came along', () => {
    expect(etaMinutes(base({ queue: { name: 'q', ready: 10, consumers: 0 } }))).toBeUndefined()
  })
})

describe('dead letters', () => {
  it('is unknown, not zero, without the broker', () => {
    expect(deadLetters(base({ broker_reachable: false, dead_letter: undefined }))).toBeUndefined()
    expect(deadLetters(base({ dead_letter: { name: 'd', ready: 3 } }))).toBe(3)
  })
})

it('keeps a decimal on a slow rate', () => {
  expect(rateDigits(0.4)).toBe(1)
  expect(rateDigits(104.8)).toBe(0)
})

/**
 * The badge on the sidebar's queue link. Its colour follows severity — busy teal,
 * stalled amber, error red — and its number is the one that needs a person.
 */
describe('the queue badge', () => {
  it('is busy and counts the waiting batches while the worker drains them', () => {
    expect(queueBadge(base())).toEqual({ tone: 'busy', kind: 'waiting', count: 4000 })
  })
  it('is absent when nothing waits and nothing is set aside', () => {
    expect(
      queueBadge(
        base({
          queue: { name: 'q', ready: 0, consumers: 1 },
          worker: { ...base().worker!, last_batch_at: '2026-10-27T12:00:00Z' },
          eta_seconds: undefined,
        }),
      ),
    ).toBeNull()
  })
  it('turns amber when batches wait and nothing consumes them', () => {
    expect(queueBadge(base({ queue: { name: 'q', ready: 12, consumers: 0 } }))).toEqual({
      tone: 'stalled',
      kind: 'waiting',
      count: 12,
    })
  })
  it('turns amber when a worker is connected but nothing finished in the window', () => {
    const b = queueBadge(base({ throughput: { window_seconds: 600, batches: 0, items: 0, failed: 0 } }))
    expect(b?.tone).toBe('stalled')
  })
  it('turns red and shows the dead-letter count rather than the backlog', () => {
    expect(queueBadge(base({ dead_letter: { name: 'dlq', ready: 3 } }))).toEqual({
      tone: 'error',
      kind: 'setAside',
      count: 3,
    })
  })
  it('stays red on an empty queue when something is set aside', () => {
    const s = base({ queue: { name: 'q', ready: 0, consumers: 1 }, dead_letter: { name: 'dlq', ready: 2 } })
    expect(queueBadge(s)?.tone).toBe('error')
  })
  it('is a question mark — never a zero — when the broker cannot be asked', () => {
    const b = queueBadge(base({ broker_reachable: false, queue: undefined, dead_letter: undefined }))
    expect(b).toEqual({ tone: 'stalled', kind: 'unknown' })
    expect(b && 'count' in b).toBe(false)
  })
  it('is absent before the first reading', () => {
    expect(queueBadge(undefined)).toBeNull()
  })
})

describe('the sync state the header pill reads', () => {
  it('says "up to date" only when idle with nothing set aside', () => {
    const quiet = { ...base().worker!, last_batch_at: '2026-10-27T12:00:00Z' }
    expect(syncState(base({ queue: { name: 'q', ready: 0, consumers: 1 }, worker: quiet }))).toBe('upToDate')
    expect(syncState(base({ queue: { name: 'q', ready: 0, consumers: 1 } }))).toBe('settling')
    expect(toneOf('upToDate')).toBe('ok')
    expect(syncState(base())).toBe('writing')
    expect(syncState(base({ queue: { name: 'q', ready: 0, consumers: 1 }, dead_letter: { name: 'd', ready: 1 } }))).toBe(
      'setAside',
    )
    expect(syncState(base({ broker_reachable: false, queue: undefined }))).toBe('unknown')
  })
})

describe('version skew', () => {
  it('reads a 404 from a contract route as an API older than the page', () => {
    expect(isApiTooOld({ status: 404 })).toBe(true)
    expect(isApiTooOld({ status: 500 })).toBe(false)
    expect(isApiTooOld(undefined)).toBe(false)
  })
})

const fail = (over = {}) => ({
  failed_at: '2026-10-27T12:20:00Z',
  error: 'boom',
  items: 10,
  samples: 10,
  workouts: 0,
  sleep_segments: 0,
  activity_summaries: 0,
  deletions: 0,
  redriven: 0,
  ...over,
})

describe('the reasons for set-aside parts', () => {
  it('returns the log as it is — not filtered or capped into a guess at the queue', () => {
    // Three logged failures, a redrive that moved one, two still parked: nothing
    // in the snapshot says which, so the page lists all three as a log.
    const log = [fail({ failed_at: '2026-10-27T12:30:00Z' }), fail(), fail({ failed_at: '2026-10-27T11:00:00Z' })]
    const s = base({
      dead_letter: { name: 'dlq', ready: 2, recent_failures: log, last_redrive: { at: '2026-10-27T12:25:00Z', moved: 1 } },
    })
    expect(failureLog(s)).toEqual(log)
    expect(failureLog(base())).toEqual([])
  })
  it('classifies only what the error says in words', () => {
    expect(failureKind(fail({ items: 0 }))).toBe('undecodable')
    expect(failureKind(fail({ error: 'dial tcp: connection refused' }))).toBe('transient')
    expect(failureKind(fail({ error: 'FATAL: the database system is starting up (SQLSTATE 57P03)' }))).toBe('transient')
    expect(failureKind(fail({ error: 'ERROR: value too long (SQLSTATE 22001)' }))).toBe('rejected')
    expect(failureKind(fail({ error: 'something else' }))).toBe('other')
  })
})

describe('a retry call that did not answer 200', () => {
  it('separates what the server confirmed from what is unknown', () => {
    expect(redriveErrorKind({ status: 409 })).toBe('busy')
    expect(redriveErrorKind({ status: 503 })).toBe('brokerDown')
    expect(redriveErrorKind({ status: 404 })).toBe('tooOld')
    expect(redriveErrorKind({ status: 400 })).toBe('rejected')
    expect(redriveErrorKind({ status: 403 })).toBe('rejected')
    // The request may have run and only the answer was lost.
    expect(redriveErrorKind({ status: 502 })).toBe('unknown')
    expect(redriveErrorKind({ status: 504 })).toBe('unknown')
    expect(redriveErrorKind(new TypeError('Failed to fetch'))).toBe('unknown')
  })
})
