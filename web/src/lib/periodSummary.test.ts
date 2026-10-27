// The period summary's rules — mirrored from
// `HelsaKit/Tests/HelsaKitTests/PeriodSummaryTests.swift`, case for case where the
// case exists on both sides, so the phone and the web cannot drift apart on what
// "2026" covers or when two periods may be compared.
//
// Every date is built with the local constructors, the same way the code under
// test builds them, so the suite means the same thing in any time zone it runs in.

import { describe, expect, it } from 'vitest'
import type { Achievement, SleepSegment, SummaryResponse, Workout } from '../api/types'
import type { Formatters } from './format'
import { metricDef } from './metrics'
import {
  belongs,
  canStepForward,
  comparisonIsEmpty,
  comparisonWindow,
  coverageState,
  elapsedDays,
  fullPeriodWindow,
  metricSummary,
  nextPeriod,
  periodId,
  periodMeasurement,
  periodWindow,
  previousPeriod,
  signedPeriodMeasurement,
  sleepQueryWindow,
  sleepSummary,
  workoutSummary,
  type SummaryPeriod,
} from './periodSummary'

const year = (y: number): SummaryPeriod => ({ unit: 'year', year: y })
const month = (y: number, m: number): SummaryPeriod => ({ unit: 'month', year: y, month: m })
const day = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h)

/** Monthly buckets, stamped the way the server stamps them: local midnight as UTC. */
function monthly(values: Record<number, number>, y: number): SummaryResponse {
  const buckets = Object.entries(values).map(([m, v]) => ({
    t: new Date(y, Number(m) - 1, 1).toISOString(),
    v,
  }))
  return { metrics: { stepCount: { agg: 'sum', unit: 'count', buckets } } }
}

/** Plain formatters — the conversions are under test, not `Intl`. */
const f = {
  fmt: (v?: number | null, digits = 0) => (v == null ? '–' : v.toFixed(digits)),
  unit: (u?: string) => u ?? '',
  duration: (m?: number | null) => {
    const total = Math.round(m ?? 0)
    return `${Math.floor(total / 60)}h ${total % 60}m`
  },
} as unknown as Formatters

describe('the window says how much of the period it is', () => {
  it('a closed year is the whole year, and nothing partial about it', () => {
    const w = periodWindow(year(2025), day(2026, 8, 13))
    expect(w.from).toBe('2025-01-01')
    expect(w.to).toBe('2025-12-31')
    expect(w.extent).toEqual({ kind: 'complete' })
    expect(w.isPartial).toBe(false)
    expect(w.elapsedUnits).toBe(12)
  })

  it('a running year ends TODAY, and says so', () => {
    const w = periodWindow(year(2026), day(2026, 8, 13))
    expect(w.from).toBe('2026-01-01')
    expect(w.to).toBe('2026-08-13')
    expect(w.extent).toEqual({ kind: 'running', through: '2026-08-13' })
    expect(w.elapsedUnits).toBe(8)
    expect(w.totalUnits).toBe(12)
    // The exclusive end is the day after today — `lib/window`'s convention.
    expect(w.end).toBe(new Date(2026, 7, 14).getTime())
  })

  it('a running month counts in days; a closed one covers its real length', () => {
    const running = periodWindow(month(2026, 8), day(2026, 8, 13))
    expect(running.from).toBe('2026-08-01')
    expect(running.to).toBe('2026-08-13')
    expect(running.elapsedUnits).toBe(13)
    expect(running.totalUnits).toBe(31)

    const february = periodWindow(month(2024, 2), day(2026, 8, 13))
    expect(february.totalUnits).toBe(29)
    expect(february.elapsedUnits).toBe(29)
    expect(february.extent.kind).toBe('complete')
  })

  it('a period in the future has not started — not a zero', () => {
    const w = periodWindow(year(2027), day(2026, 8, 13))
    expect(w.extent.kind).toBe('notStarted')
    expect(w.elapsedUnits).toBe(0)
    expect(elapsedDays(w)).toBe(0)
  })

  it('the chart of a running year spans all twelve months', () => {
    const full = fullPeriodWindow(periodWindow(year(2026), day(2026, 8, 13)))
    expect(full.to).toBe('2026-12-31')
    expect(full.end).toBe(new Date(2027, 0, 1).getTime())
  })
})

describe('the comparison is cut to the same extent', () => {
  it('a running year is measured against the same stretch of last year', () => {
    const current = periodWindow(year(2026), day(2026, 8, 13))
    const previous = comparisonWindow(current)
    expect(previous.period).toEqual(year(2025))
    expect(previous.from).toBe('2025-01-01')
    expect(previous.to).toBe('2025-08-13')
    expect(previous.extent).toEqual({ kind: 'matched', through: '2025-08-13' })
    expect(previous.elapsedUnits).toBe(current.elapsedUnits)
  })

  it('a closed period is compared with a whole previous one', () => {
    const previous = comparisonWindow(periodWindow(year(2025), day(2026, 8, 13)))
    expect(previous.from).toBe('2024-01-01')
    expect(previous.to).toBe('2024-12-31')
    expect(previous.extent.kind).toBe('complete')
  })

  it('February 29th does not become March 1st in the previous year', () => {
    const current = periodWindow(year(2024), day(2024, 2, 29))
    expect(current.to).toBe('2024-02-29')
    expect(comparisonWindow(current).to).toBe('2023-02-28')
  })

  it('a running month is compared with the same number of days, clamped to a short month', () => {
    // On the period's last day it counts as complete (`today < periodLast`,
    // the phone's rule), so the 30th is the latest day that is still running.
    expect(periodWindow(month(2026, 3), day(2026, 3, 31)).extent.kind).toBe('complete')
    const current = periodWindow(month(2026, 3), day(2026, 3, 30))
    expect(current.extent.kind).toBe('running')
    const previous = comparisonWindow(current)
    expect(previous.period).toEqual(month(2026, 2))
    expect(previous.to).toBe('2026-02-28')
  })

  it('the month before January is December of the year before', () => {
    expect(previousPeriod(month(2026, 1))).toEqual(month(2025, 12))
    expect(previousPeriod(year(2026))).toEqual(year(2025))
    expect(nextPeriod(month(2025, 12))).toEqual(month(2026, 1))
  })

  it('forward stops at the present', () => {
    expect(canStepForward(year(2025), day(2026, 8, 13))).toBe(true)
    expect(canStepForward(year(2026), day(2026, 8, 13))).toBe(false)
    expect(canStepForward(month(2026, 7), day(2026, 8, 13))).toBe(true)
    expect(canStepForward(month(2026, 8), day(2026, 8, 13))).toBe(false)
  })
})

describe('a headline metric', () => {
  const steps = metricDef('stepCount')
  const now = day(2026, 8, 13)
  const win = periodWindow(year(2026), now)
  const cmp = comparisonWindow(win)

  it('a month without data is left out of the coverage, not counted as zero', () => {
    const m = metricSummary(steps, win, cmp, monthly({ 1: 200_000, 3: 250_000, 7: 220_000 }, 2026), null)
    expect(m.coverage).toEqual({ measured: 3, elapsed: 8, unit: 'month' })
    expect(coverageState(m.coverage)).toBe('some')
    expect(m.series.total).toBe(670_000)
    // The average month is over the three measured months, not the eight elapsed.
    expect(m.perBucket).toBeCloseTo(670_000 / 3)
  })

  it('without a measurement the total stays missing, never zero', () => {
    const m = metricSummary(steps, win, cmp, { metrics: {} }, null)
    expect(m.series.hasData).toBe(false)
    expect(m.series.total).toBeNull()
    expect(m.peak).toBeNull()
    expect(m.perBucket).toBeNull()
    expect(coverageState(m.coverage)).toBe('none')
  })

  it('the peak is the highest measured bucket', () => {
    const m = metricSummary(steps, win, cmp, monthly({ 2: 300_000, 3: 412_000, 4: 280_000 }, 2026), null)
    expect(m.peak?.value).toBe(412_000)
    expect(new Date(m.peak!.t).getMonth()).toBe(2)
  })

  it('an uneven comparison carries its caveat', () => {
    // Two measured months now, four then: the shares are 2/8 and 4/8, a ratio of
    // exactly one half — the web's line (`lib/compare`) still lets it through, and
    // the phone's caveat goes with it.
    const m = metricSummary(
      steps,
      win,
      cmp,
      monthly({ 1: 100_000, 2: 100_000 }, 2026),
      monthly({ 1: 90_000, 2: 90_000, 3: 90_000, 4: 90_000 }, 2025),
    )
    expect(m.comparison.kind).toBe('shown')
    if (m.comparison.kind !== 'shown') return
    expect(m.comparison.delta).toBe(-160_000)
    expect(m.comparison.even).toBe(false)
    expect(m.previousCoverage?.measured).toBe(4)
  })

  it('a wildly uneven SUMMED comparison is withheld — the web rule, stricter than the phone', () => {
    const m = metricSummary(
      steps,
      win,
      cmp,
      monthly({ 1: 100_000 }, 2026),
      monthly({ 1: 90_000, 2: 90_000, 3: 90_000, 4: 90_000, 5: 90_000, 6: 90_000 }, 2025),
    )
    expect(m.comparison).toEqual({ kind: 'withheld', previous: 540_000 })
  })

  it('an even comparison needs no caveat', () => {
    const m = metricSummary(steps, win, cmp, monthly({ 1: 110_000, 2: 110_000 }, 2026), monthly({ 1: 100_000, 2: 100_000 }, 2025))
    expect(m.comparison).toMatchObject({ kind: 'shown', even: true, delta: 20_000, ratio: 0.1 })
  })

  it('a missing previous period is not a −100%', () => {
    const m = metricSummary(steps, win, cmp, monthly({ 1: 110_000 }, 2026), null)
    expect(m.comparison).toEqual({ kind: 'none' })
  })

  it('an empty comparison period is stated, not left silent', () => {
    const empty = metricSummary(steps, win, cmp, monthly({ 1: 110_000 }, 2026), { metrics: {} })
    expect(comparisonIsEmpty([empty])).toBe(true)
    const notLoaded = metricSummary(steps, win, cmp, monthly({ 1: 110_000 }, 2026), null)
    expect(comparisonIsEmpty([notLoaded])).toBe(false)
    const withBoth = metricSummary(steps, win, cmp, monthly({ 1: 1 }, 2026), monthly({ 1: 1 }, 2025))
    expect(comparisonIsEmpty([withBoth])).toBe(false)
  })
})

describe('sleep', () => {
  const seg = (stage: string, from: Date, to: Date): SleepSegment => ({
    stage,
    started_at: from.toISOString(),
    ended_at: to.toISOString(),
  })
  const win = periodWindow(month(2026, 8), day(2026, 8, 13))

  it('the night average is over the measured nights, not over the days of the period', () => {
    const s = sleepSummary(
      [
        seg('asleepCore', new Date(2026, 7, 2, 23), new Date(2026, 7, 3, 6)), // 7 h
        seg('asleepCore', new Date(2026, 7, 5, 23), new Date(2026, 7, 6, 7)), // 8 h
      ],
      win,
    )
    expect(s.nights).toBe(2)
    expect(s.averageMin).toBe(450)
    expect(s.longest).toEqual({ key: '2026-08-06', min: 480 })
    expect(s.coverage).toEqual({ measured: 2, elapsed: 13, unit: 'day' })
  })

  it('a night belongs to the day it ended on — New Year’s night is the new year’s', () => {
    const y = periodWindow(year(2026), day(2026, 8, 13))
    const s = sleepSummary(
      [
        seg('asleepCore', new Date(2025, 11, 31, 23), new Date(2026, 0, 1, 7)),
        seg('asleepCore', new Date(2025, 11, 29, 23), new Date(2025, 11, 30, 7)),
      ],
      y,
    )
    expect(s.nights).toBe(1)
    // …which is why `/sleep` is asked from the day before the window.
    expect(sleepQueryWindow(y)).toEqual({ from: '2025-12-31', to: '2026-08-13' })
  })

  it('no nights loaded-but-empty is an average of nothing, not of zero', () => {
    const s = sleepSummary([], win)
    expect(s.nights).toBe(0)
    expect(s.averageMin).toBeNull()
    expect(s.longest).toBeNull()
  })

  it('an in-bed-only night never measured sleep, so it is not a night here', () => {
    const s = sleepSummary([seg('inBed', new Date(2026, 7, 2, 23), new Date(2026, 7, 3, 6))], win)
    expect(s.nights).toBe(0)
  })
})

describe('workouts', () => {
  const win = periodWindow(month(2026, 8), day(2026, 8, 31))
  const w = (id: string, type: string, start: Date, minutes: number | null, distance?: number): Workout => ({
    id,
    activity_type: type,
    started_at: start.toISOString(),
    ended_at: minutes == null ? undefined : new Date(start.getTime() + minutes * 60000).toISOString(),
    total_distance_m: distance,
  })

  it('without a distance-carrying workout the total distance is missing, not zero', () => {
    const s = workoutSummary([w('1', 'traditionalStrengthTraining', day(2026, 8, 3), 60)], win)
    expect(s.sessions).toBe(1)
    expect(s.distanceM).toBeNull()
    expect(s.durationMin).toBe(60)
    expect(s.farthest).toBeNull()
    expect(s.longest?.id).toBe('1')
    expect(s.activities[0].type).toBe('traditionalStrengthTraining')
  })

  it('a workout without an end time is not counted as zero long', () => {
    const s = workoutSummary([w('1', 'running', day(2026, 8, 3), null, 5000)], win)
    expect(s.sessions).toBe(1)
    expect(s.durationKnown).toBe(0)
    expect(s.durationMin).toBe(0)
    expect(s.longest).toBeNull()
    expect(s.distanceM).toBe(5000)
  })

  it('two recordings of one session count once — the Workouts page folds them too', () => {
    const start = day(2026, 8, 3, 7)
    const s = workoutSummary(
      [w('a', 'running', start, 30, 5000), w('b', 'running', new Date(start.getTime() + 60000), 29, 4990)],
      win,
    )
    expect(s.sessions).toBe(1)
    expect(s.extraRecordings).toBe(1)
  })

  it('only the sessions that started inside the window count', () => {
    const s = workoutSummary([w('1', 'running', day(2026, 7, 31), 30), w('2', 'running', day(2026, 8, 1), 30)], win)
    expect(s.sessions).toBe(1)
  })

  it('activities are ordered by frequency, then by name', () => {
    const s = workoutSummary(
      [
        w('1', 'walking', day(2026, 8, 1), 30),
        w('2', 'cycling', day(2026, 8, 2), 30),
        w('3', 'walking', day(2026, 8, 3), 30),
        w('4', 'archery', day(2026, 8, 4), 30),
      ],
      win,
    )
    expect(s.activities.map((a) => a.type)).toEqual(['walking', 'archery', 'cycling'])
  })
})

describe('medals', () => {
  it('only the medals of the period count, and only those that name a period', () => {
    const march: Achievement = { id: 'm', period: '2026-03' }
    const yearly: Achievement = { id: 'y', period: '2026' }
    const other: Achievement = { id: 'o', period: '2025-03' }
    const milestone: Achievement = { id: 't', kind: 'milestone' }
    const all = [march, yearly, other, milestone]
    expect(all.filter((a) => belongs(a, year(2026))).map((a) => a.id)).toEqual(['m', 'y'])
    expect(all.filter((a) => belongs(a, month(2026, 3))).map((a) => a.id)).toEqual(['m'])
    // `2026-1` must not catch `2026-10`… which is why the id is zero-padded.
    expect(periodId(month(2026, 1))).toBe('2026-01')
  })
})

describe('a period total is read in a readable unit', () => {
  it("a year's distance in kilometres, its exercise time in hours", () => {
    expect(periodMeasurement(1_512_340, 'm', 0, f)).toBe('1512 km')
    expect(periodMeasurement(5_234, 'm', 0, f)).toBe('5.23 km')
    expect(periodMeasurement(520, 'm', 0, f)).toBe('520 m')
    expect(periodMeasurement(12_480, 'min', 0, f)).toBe('208h 0m')
    expect(periodMeasurement(45, 'min', 0, f)).toBe('45 min')
    expect(periodMeasurement(48_210, 'count', 0, f)).toBe('48210 count')
  })

  it('a signed change is converted on its absolute value, with a real minus sign', () => {
    expect(signedPeriodMeasurement(-9_260, 'm', 0, f)).toBe('−9.26 km')
    expect(signedPeriodMeasurement(1_500, '', 0, f)).toBe('+1500')
    expect(signedPeriodMeasurement(0, '', 0, f)).toBe('0')
  })
})
