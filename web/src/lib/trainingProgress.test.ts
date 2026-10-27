// The phone's `WorkoutProgressTests`, `WorkoutProgressIntensityTests` and
// `WorkoutVitalsTests` (HelsaKit/Tests/HelsaKitTests/WorkoutProgressTests.swift),
// case for case, with the same dates and the same expected numbers. The test
// names are the Swift ones; if one of these has to change, so does its twin.
//
// The one suite not mirrored: effort. The ratings live in HealthKit and do not
// reach the server, so the web has none to average.

import { describe, expect, it } from 'vitest'
import type { MetricSeries, Workout } from '../api/types'
import {
  buildProgress,
  canCompare,
  categoryOf,
  intensitySegments,
  shade,
  unmeasuredSessions,
  weeklyVitals,
  type TrainingWeek,
} from './trainingProgress'

/** Monday — a Hungarian week, as the Swift tests pin `firstWeekday = 2`. */
const MONDAY = 1

function day(y: number, m: number, d: number, h = 18): Date {
  return new Date(y, m - 1, d, h)
}

function workout(id: string, start: Date, type = 'strength', minutes: number | null = 60): Workout {
  return {
    id,
    source_uuid: id,
    activity_type: type,
    started_at: start.toISOString(),
    ended_at: minutes == null ? undefined : new Date(start.getTime() + minutes * 60_000).toISOString(),
  }
}

/** Wednesday 2026-10-14, evening — the current week is Mon 12 … Sun 18 October. */
const now = day(2026, 10, 14, 20)

const build = (workouts: Workout[], weekCount: number, extra: { endingWeeksAgo?: number; intensity?: Map<string, number> } = {}) =>
  buildProgress(workouts, { weekCount, now, firstDay: MONDAY, ...extra })

describe('training progress (WorkoutProgressTests)', () => {
  it('A week without a workout stays in the list as a gap', () => {
    const p = build([workout('a', day(2026, 9, 22)), workout('b', day(2026, 10, 6))], 4)
    expect(p.weeks).toHaveLength(4)
    expect(p.weeks.map((w) => w.sessions)).toEqual([1, 0, 1, 0])
    expect(p.weeks[1].sessions).toBe(0)
    expect(p.weeks[1].start).toBe(day(2026, 9, 28, 0).getTime())
  })

  it('The rest week counts in the per-week average, the current week does not', () => {
    const p = build(
      [
        workout('a', day(2026, 9, 22)),
        workout('b', day(2026, 9, 24)),
        workout('c', day(2026, 10, 6)),
        workout('now', day(2026, 10, 13)),
      ],
      4,
    )
    // Three complete weeks: 2 + 0 + 1 sessions. Leaving the rest week out would say 1.5.
    expect(p.elapsedWeeks).toBe(3)
    expect(p.activeWeeks).toBe(2)
    expect(p.sessionsPerWeek).toBe(1)
    expect(p.totalSessions).toBe(4)
    const current = p.weeks.at(-1)!
    expect(current.sessions).toBe(1)
    expect(current.isPartial).toBe(true)
  })

  it('⚠️ A Sunday session belongs to the week that ends on that Sunday', () => {
    const p = build([workout('sun', day(2026, 10, 11, 10))], 2)
    expect(p.weeks.map((w) => w.sessions)).toEqual([1, 0])
    // …and on a Sunday-first calendar the same session opens the NEXT week.
    const sundayFirst = buildProgress([workout('sun', day(2026, 10, 11, 10))], { weekCount: 2, now, firstDay: 0 })
    expect(sundayFirst.weeks.map((w) => w.sessions)).toEqual([0, 1])
  })

  it('Two recordings of one session count once', () => {
    const start = day(2026, 10, 7)
    const p = build([workout('watch', start), workout('phone', new Date(start.getTime() + 60_000))], 2)
    expect(p.weeks[0].sessions).toBe(1)
    expect(p.weeks[0].seconds).toBe(3600)
  })

  it('A running workout counts as a session but adds no time', () => {
    const p = build([workout('open', day(2026, 10, 14, 19), 'strength', null)], 1)
    expect(p.weeks[0].sessions).toBe(1)
    expect(p.weeks[0].seconds).toBe(0)
  })

  it('Workouts outside the window are ignored, on both ends', () => {
    const p = build([workout('old', day(2026, 9, 1)), workout('future', day(2026, 10, 16))], 3)
    expect(p.isEmpty).toBe(true)
    expect(p.activities).toEqual([])
  })

  it('Activities are ranked by time, not by count', () => {
    const p = build(
      [
        workout('s1', day(2026, 10, 5), 'strength', 45),
        workout('s2', day(2026, 10, 7), 'strength', 45),
        workout('r1', day(2026, 10, 9), 'running', 120),
      ],
      2,
    )
    expect(p.activities.map((a) => a.activityType)).toEqual(['running', 'strength'])
    expect(p.activities.at(-1)!.sessions).toBe(2)
    expect(p.activities.at(-1)!.seconds).toBe(90 * 60)
  })

  it('No typical week below three complete weeks', () => {
    const p = build([workout('a', day(2026, 10, 6))], 3)
    expect(p.elapsedWeeks).toBe(2)
    expect(p.typicalWeek).toBeNull()
  })

  it('The typical week is a median — one big week does not move it', () => {
    const list: Workout[] = []
    for (const [week, count] of [
      [0, 2],
      [1, 2],
      [2, 2],
      [3, 8],
    ]) {
      const monday = day(2026, 9, 14 + 7 * week)
      for (let n = 0; n < count; n++) list.push(workout(`w${week}-${n}`, new Date(monday.getTime() + n * 3 * 3600_000)))
    }
    const p = build(list, 5)
    expect(p.typicalWeek?.sessions).toBe(2)
    expect(p.typicalWeek?.weeks).toBe(4)
    expect(p.sessionsPerWeek).toBe(3.5)
  })

  it('Rest weeks are part of the typical week (Bob, 2026-10-13)', () => {
    const p = build(
      [
        workout('a', day(2026, 9, 8)),
        workout('b', day(2026, 9, 10)),
        workout('c', day(2026, 9, 22)),
        workout('d', day(2026, 9, 24)),
      ],
      6,
    )
    expect(p.typicalWeek?.weeks).toBe(5)
    expect(p.typicalWeek?.sessions).toBe(0)
  })

  it('The longest break counts finished weeks only, and picks the longest run', () => {
    const p = build([workout('a', day(2026, 9, 8)), workout('b', day(2026, 9, 22))], 6)
    expect(p.longestRest?.weeks).toBe(2)
    expect(p.longestRest?.firstWeek).toBe(day(2026, 9, 28, 0).getTime())
    expect(p.longestRest?.lastWeek).toBe(day(2026, 10, 5, 0).getTime())
  })

  it('A window in the past has no partial week and ignores later sessions', () => {
    const p = build([workout('old', day(2026, 9, 22)), workout('new', day(2026, 10, 6))], 2, { endingWeeksAgo: 2 })
    expect(p.weeks.map((w) => w.start)).toEqual([day(2026, 9, 21, 0).getTime(), day(2026, 9, 28, 0).getTime()])
    expect(p.weeks.map((w) => w.sessions)).toEqual([1, 0])
    expect(p.weeks.some((w) => w.isPartial)).toBe(false)
  })

  it('Sessions are split into strength, cardio and other for the stacked bar', () => {
    const p = build(
      [
        workout('s', day(2026, 10, 5), 'strength'),
        workout('r', day(2026, 10, 6), 'running'),
        workout('y', day(2026, 10, 7), 'yoga'),
      ],
      2,
    )
    expect(p.weeks[0].categorySessions).toEqual({ strength: 1, cardio: 1, other: 1 })
    // Exact keys only, as on the phone.
    expect(categoryOf('strengthTraining')).toBe('other')
  })

  it('A zero or negative week count is an empty result, not a crash', () => {
    expect(build([], 0).weeks).toEqual([])
    expect(build([], -3).weeks).toEqual([])
  })

  it('the window is the first week’s start to the start of the week after the last', () => {
    const p = build([], 2)
    expect(p.windowStart).toBe(day(2026, 10, 5, 0).getTime())
    expect(p.windowEnd).toBe(day(2026, 10, 19, 0).getTime())
  })
})

describe('intensity per week (WorkoutProgressIntensityTests)', () => {
  const run = (id: string, start: Date) => workout(id, start, 'running')

  it('Unknown is not zero: an unmeasured week is nil, a rest week is 0', () => {
    const p = build(
      [run('measured', day(2026, 9, 22)), run('unmeasured', day(2026, 9, 24)), run('blind', day(2026, 10, 6))],
      4,
      { intensity: new Map([['measured', 1200]]) },
    )
    expect(p.weeks[0].intenseSeconds).toBe(1200)
    expect(p.weeks[0].measuredSessions).toBe(1)
    expect(p.weeks[1].intenseSeconds).toBe(0)
    expect(p.weeks[2].intenseSeconds).toBeNull()
    // Two known weeks (1200, 0) — below the three a typical value needs.
    expect(p.typicalWeek?.intenseSeconds).toBeNull()
    expect(unmeasuredSessions(p)).toBe(2)
  })

  it('The typical intensity is a median over the known weeks, rest weeks included', () => {
    const p = build([run('a', day(2026, 9, 15)), run('b', day(2026, 9, 22)), run('c', day(2026, 10, 6))], 5, {
      intensity: new Map([
        ['a', 600],
        ['b', 1800],
        ['c', 3000],
      ]),
    })
    // Complete weeks: 600, 1800, 0 (rest), 3000 → median (600 + 1800) / 2.
    expect(p.typicalWeek?.intenseSeconds).toBe(1200)
  })

  it('a duplicate’s figure stands in when the primary has none', () => {
    const start = day(2026, 10, 7)
    const p = build([run('watch', start), run('phone', new Date(start.getTime() + 60_000))], 2, {
      intensity: new Map([['phone', 900]]),
    })
    expect(p.weeks[0].intenseSeconds).toBe(900)
    expect(p.weeks[0].measuredSessions).toBe(1)
  })
})

describe('resting heart rate and HRV (WorkoutVitalsTests)', () => {
  const weekStart = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime()

  it('Daily values are averaged per week; a week without a measurement is skipped', () => {
    const series: MetricSeries = {
      agg: 'avg',
      unit: 'count/min',
      buckets: [
        { t: '2026-09-28T00:00:00+02:00', avg: 56 },
        { t: '2026-09-30T00:00:00+02:00', avg: 58 },
        { t: '2026-10-12T00:00:00+02:00', avg: 54 },
        { t: '2026-01-01T00:00:00+01:00', avg: 99 }, // outside
      ],
    }
    const weeks = [weekStart(2026, 9, 28), weekStart(2026, 10, 5), weekStart(2026, 10, 12)]
    const points = weeklyVitals(series, weeks, MONDAY)
    expect(points.map((p) => p.weekStart)).toEqual([weekStart(2026, 9, 28), weekStart(2026, 10, 12)])
    expect(points[0].value).toBe(57)
    expect(points.at(-1)!.value).toBe(54)
  })

  it('One week is not a trend', () => {
    const points = weeklyVitals({ buckets: [{ t: '2026-10-12', avg: 54 }] }, [weekStart(2026, 10, 12)], MONDAY)
    expect(points).toHaveLength(1)
  })

  it('a `v` is taken at its word when there is no `avg`', () => {
    const points = weeklyVitals({ buckets: [{ t: '2026-10-12', v: 61 }] }, [weekStart(2026, 10, 12)], MONDAY)
    expect(points[0].value).toBe(61)
  })

  it('The zone line breaks at rest weeks and unmeasured weeks', () => {
    const week = (n: number, sessions: number, intense: number | null): TrainingWeek => ({
      start: n * 604_800_000,
      sessions,
      seconds: 0,
      isPartial: false,
      intenseSeconds: intense,
      measuredSessions: intense == null ? 0 : sessions,
      categorySessions: { strength: 0, cardio: 0, other: 0 },
    })
    const weeks = [week(0, 1, 600), week(1, 1, 300), week(2, 0, 0), week(3, 2, null), week(4, 1, 900)]
    expect(intensitySegments(weeks).map((s) => s.segment)).toEqual([0, 0, 1])
  })
})

describe('the comparison guard and the grid shade', () => {
  it('compares only when the history reaches the previous window', () => {
    const recent = [
      workout('a', day(2026, 9, 1)),
      workout('b', day(2026, 9, 8)),
      workout('c', day(2026, 9, 15)),
    ]
    const previous = build(recent, 4, { endingWeeksAgo: 4 })
    // The previous window starts 24 Aug; the oldest workout is 1 Sep — after its
    // first week, so the weeks before it would be counted as rest that never was.
    expect(previous.typicalWeek).not.toBeNull()
    expect(canCompare(previous, recent)).toBe(false)
    const longer = [workout('z', day(2026, 8, 25)), ...recent]
    expect(canCompare(build(longer, 4, { endingWeeksAgo: 4 }), longer)).toBe(true)
  })

  it('shades as the phone does', () => {
    expect([0, 1, 2, 3, 4, 9].map(shade)).toEqual([0, 0.28, 0.55, 0.8, 1, 1])
  })
})
