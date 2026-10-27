import { describe, expect, it } from 'vitest'
import { averages, flatten, groupByNight, lastNight, nightTitle, normalizeStage } from './sleep'
import type { SleepSegment } from '../api/types'

const seg = (stage: string, from: string, to: string): SleepSegment =>
  ({ stage, started_at: from, ended_at: to }) as SleepSegment

const at = (h: number, m = 0) =>
  new Date(2026, 7, 24, h, m).toISOString()

/**
 * ⚠️ **The rule this file exists for: overlapping segments must not be added up.**
 *
 * `inBed` wraps the whole night, and since a second source started writing stages, two
 * sources describe the same hours at their own boundaries. Summing the raw lengths gives
 * roughly one and a half times the real sleep — a number that looks plausible, is wrong,
 * and disagrees with the phone about the same night.
 *
 * The same three rules live in three places (here, `SleepAnalysis.swift`,
 * `backend/internal/sleep`), and until this file had a test only two of the three were
 * guarded.
 */
describe('overlapping segments flatten instead of accumulating', () => {
  it('an inBed envelope does not add to the stages inside it', () => {
    const { slices, overlapMin } = flatten([
      seg('inBed', at(23), at(23, 0)),
      seg('inBed', at(0), at(6)),
      seg('asleepCore', at(0), at(3)),
      seg('asleepDeep', at(3), at(5)),
    ])
    const total = slices.reduce((sum, s) => sum + (s.end - s.start), 0) / 60000
    // Six hours of wall clock, however many segments describe them.
    expect(total).toBeLessThanOrEqual(6 * 60)
    expect(overlapMin).toBeGreaterThan(0)
  })

  it('two sources describing the same hour count it once', () => {
    const { slices } = flatten([
      seg('asleepCore', at(1), at(2)),
      seg('asleepCore', at(1), at(2)),
    ])
    const total = slices.reduce((sum, s) => sum + (s.end - s.start), 0) / 60000
    expect(total).toBe(60)
  })

  it('a more specific stage wins over a vaguer one on the same minutes', () => {
    const { slices } = flatten([
      seg('inBed', at(1), at(2)),
      seg('asleepDeep', at(1), at(2)),
    ])
    expect(slices.every((s) => s.stage === 'deep')).toBe(true)
  })
})

describe('the stage names arrive in more than one spelling', () => {
  it.each([
    ['asleepDeep', 'deep'], ['deep', 'deep'],
    ['asleepREM', 'rem'], ['rem', 'rem'],
    ['asleepCore', 'core'], ['core', 'core'],
    ['awake', 'awake'], ['inBed', 'inBed'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeStage(raw)).toBe(expected)
  })

  /**
   * ⚠️ The database really does hold both spellings for the same nights. A reader that
   * knows only the long form silently drops half the data and shows LESS sleep — with
   * nothing anywhere looking broken.
   */
  it('an unknown stage is null, not quietly treated as sleep', () => {
    expect(normalizeStage('teleportation')).toBeNull()
    expect(normalizeStage(undefined)).toBeNull()
  })
})

describe('a night is a session, not a calendar day', () => {
  it('does not split at midnight', () => {
    const nights = groupByNight([
      seg('asleepCore', new Date(2026, 7, 23, 23, 0).toISOString(),
          new Date(2026, 7, 24, 2, 0).toISOString()),
      seg('asleepCore', new Date(2026, 7, 24, 2, 0).toISOString(),
          new Date(2026, 7, 24, 6, 0).toISOString()),
    ])
    expect(nights).toHaveLength(1)
  })

  it('a long gap starts a new session', () => {
    const nights = groupByNight([
      seg('asleepCore', at(1), at(5)),
      seg('asleepCore', at(14), at(15)),   // an afternoon nap, nine hours later
    ])
    expect(nights.length).toBeGreaterThan(1)
  })
})

/** ⛔ A night with no sleep segment never measured sleep — that is not zero. */
describe('a night without a sleep segment', () => {
  const inBedOnly = () =>
    groupByNight([
      seg('inBed', new Date(2026, 7, 23, 23, 0).toISOString(), new Date(2026, 7, 24, 7, 0).toISOString()),
    ])[0]

  it('has no asleep duration and no efficiency, rather than zeros', () => {
    const n = inBedOnly()
    expect(n.asleepMin).toBeNull()
    expect(n.efficiency).toBeNull()
    expect(n.inBedMin).toBe(480)
  })

  it('is left out of the averages instead of pulling them down', () => {
    const measured = groupByNight([seg('asleepCore', at(0), at(6))])[0]
    const avg = averages([measured, inBedOnly()])
    expect(avg.asleepMin).toBe(360)
    expect(avg.nights).toBe(2)
  })
})

describe('"last night" on the Today card', () => {
  const night = () => [
    seg('asleepCore', new Date(2026, 7, 23, 23, 0).toISOString(), new Date(2026, 7, 24, 6, 0).toISOString()),
  ]
  const nap = () => [seg('asleepCore', at(14), at(15))]

  it('is the overnight session even when a nap came after it', () => {
    const picked = lastNight(groupByNight([...night(), ...nap()]))
    expect(picked?.overnight).toBe(true)
    expect(picked?.night.asleepMin).toBe(420)
  })

  it('counts a small-hours bedtime as the night', () => {
    const picked = lastNight(groupByNight([seg('asleepCore', at(1), at(8)), ...nap()]))
    expect(picked?.overnight).toBe(true)
    expect(picked?.night.asleepMin).toBe(420)
  })

  it('falls back to the latest session, flagged as not overnight, when there is no night', () => {
    const picked = lastNight(groupByNight(nap()))
    expect(picked?.overnight).toBe(false)
    expect(picked?.night.asleepMin).toBe(60)
  })
})

/**
 * The Sleep page's detail card used to call the newest session "Last night" — a
 * 14:00 nap included, and in a window a month in the past too.
 */
describe('what the Sleep page may call a session', () => {
  // `at` builds 2026-08-24, so that is "today" here.
  const today = '2026-08-24'
  const night = () => [
    seg('asleepCore', new Date(2026, 7, 23, 23, 0).toISOString(), new Date(2026, 7, 24, 6, 0).toISOString()),
  ]
  const nap = () => [seg('asleepCore', at(14), at(15))]

  it('keeps "last night" for the night and calls the nap after it the latest sleep', () => {
    const nights = groupByNight([...night(), ...nap()])
    const [napSession, nightSession] = nights
    expect(nightTitle(nightSession, nights, { current: true, today })).toBe('lastNight')
    expect(nightTitle(napSession, nights, { current: true, today })).toBe('latest')
  })

  it('never calls a nap "last night", even when it is the only session', () => {
    const nights = groupByNight(nap())
    expect(nightTitle(nights[0], nights, { current: true, today })).toBe('latest')
  })

  it('does not call a night from days ago "last night"', () => {
    const nights = groupByNight(night())
    expect(nightTitle(nights[0], nights, { current: true, today: '2026-08-27' })).toBe('latest')
    // The night that ended yesterday morning still counts — before going to bed tonight
    // it is the most recent night there is.
    expect(nightTitle(nights[0], nights, { current: true, today: '2026-08-25' })).toBe('lastNight')
  })

  it('uses plain titles in a window in the past', () => {
    const nights = groupByNight([...night(), ...nap()])
    for (const n of nights) expect(nightTitle(n, nights, { current: false, today })).toBe('plain')
  })
})
