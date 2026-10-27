import { describe, expect, it } from 'vitest'
import type { IngestStatus } from '../api/types'
import { deadLetters, etaMinutes, phase, rateDigits } from './ingest'

const base = (over: Partial<IngestStatus> = {}): IngestStatus => ({
  checked_at: '2026-10-27T12:30:30Z',
  broker_reachable: true,
  queue: { name: 'helsa.ingest', ready: 4000, consumers: 1, in_flight_max: 8 },
  dead_letter: { name: 'helsa.ingest.dlq', ready: 0 },
  stats_reachable: true,
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
  it('is stalled with a consumer and no rate', () => {
    expect(
      phase(base({ throughput: { window_seconds: 630, batches: 0, items: 0, failed: 0 } })),
    ).toBe('stalled')
    expect(phase(base({ stats_reachable: false, throughput: undefined }))).toBe('stalled')
  })
  it('is idle with nothing waiting', () => {
    expect(phase(base({ queue: { name: 'q', ready: 0, consumers: 1 } }))).toBe('idle')
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
