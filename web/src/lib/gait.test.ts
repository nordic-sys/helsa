import { describe, expect, it } from 'vitest'
import { GAIT_METRICS, GAIT_THRESHOLDS, addDays, fallDays, gaitSummary, isolatedDays, segments, type DayPoint, type GaitMetric } from './gait'

// A mirror of the phone's `StabilityRulesTests.swift`. The numbers are the
// phone's own fixtures, so a threshold moved on one side breaks the other.

const today = '2026-08-14'
const day = (offset: number) => addDays(today, offset)
const metric = (key: string): GaitMetric => GAIT_METRICS.find((m) => m.key === key) as GaitMetric
const speed = metric('walkingSpeed')
const stepLength = metric('walkingStepLength')
const asymmetry = metric('walkingAsymmetryPercentage')
const steadiness = metric('appleWalkingSteadiness')

/** `baselineDays` days before the comparison window, then `recentDays` in it,
 * alternating ± `jitter` — the phone's `series(baseline:recent:…)`. */
function series(baseline: number, recent: number, baselineDays = 28, recentDays = 7, jitter = 0.01): DayPoint[] {
  const out: DayPoint[] = []
  for (let i = 0; i < baselineDays; i++) out.push({ day: day(-35 + i), value: baseline + (i % 2 === 0 ? jitter : -jitter) })
  for (let i = 0; i < recentDays; i++) out.push({ day: day(-7 + i), value: recent + (i % 2 === 0 ? jitter : -jitter) })
  return out
}

describe('the change', () => {
  it('reports a clear drop in walking speed as a drop', () => {
    const r = gaitSummary(speed, series(1.24, 1.16), today)
    expect(r.change.kind).toBe('moved')
    if (r.change.kind !== 'moved') return
    expect(r.change.direction).toBe('down')
    expect(Math.abs(r.change.recent - 1.16)).toBeLessThan(0.005)
    expect(Math.abs(r.change.baseline - 1.24)).toBeLessThan(0.005)
  })

  it('says nothing with too few baseline days, and keeps the counts to say why', () => {
    const r = gaitSummary(speed, series(1.24, 1.1, 13), today)
    expect(r.change).toEqual({ kind: 'notEnoughData', baselineDays: 13, recentDays: 7 })
  })

  it('stays silent with too few recent days too', () => {
    const r = gaitSummary(speed, series(1.24, 1.1, 28, 3), today)
    expect(r.change).toMatchObject({ kind: 'notEnoughData', recentDays: 3 })
  })

  it('needs BOTH thresholds to call it a change', () => {
    // 2.5 points of 60 is 4% — absolute yes, relative no.
    expect(gaitSummary(steadiness, series(60, 62.5, 28, 7, 0.1), today).change.kind).not.toBe('moved')
    // 3 cm of 60 is 5% and over the 2 cm floor — both.
    expect(gaitSummary(stepLength, series(0.6, 0.63, 28, 7, 0.002), today).change.kind).toBe('moved')
    // 0.6 points of 4 is 15% — relative yes, absolute (1 point) no.
    expect(gaitSummary(asymmetry, series(4.0, 4.6, 28, 7, 0.05), today).change.kind).not.toBe('moved')
  })

  it('calls a zero baseline not comparable, rather than unchanged', () => {
    expect(gaitSummary(speed, series(0, 0.9, 28, 7, 0), today).change).toEqual({ kind: 'notComparable' })
  })

  it('draws today but does not judge it', () => {
    const points = [...series(1.24, 1.24), { day: today, value: 0.2 }]
    const r = gaitSummary(speed, points, today)
    expect(r.change.kind).not.toBe('moved')
    expect(r.latest?.day).toBe(today)
  })

  it('still summarises a metric with no data at all', () => {
    const r = gaitSummary(speed, [], today)
    expect(r.change).toEqual({ kind: 'notEnoughData', baselineDays: 0, recentDays: 0 })
    expect(r.latest).toBeNull()
    expect(r.band).toBeNull()
  })
})

describe('the band', () => {
  it('is the person’s own spread over the 28 baseline days', () => {
    const band = gaitSummary(speed, series(1.24, 1.16), today).band
    expect(band).not.toBeNull()
    expect(Math.abs((band?.mean ?? 0) - 1.24)).toBeLessThan(0.001)
    expect(band?.days).toBe(28)
    expect(band!.low).toBeLessThan(band!.mean)
    expect(band!.mean).toBeLessThan(band!.high)
  })

  it('is absent for constant data, while the comparison still happens', () => {
    const r = gaitSummary(speed, series(1.2, 1.1, 28, 7, 0), today)
    expect(r.band).toBeNull()
    expect(r.change.kind).toBe('moved')
  })

  it('excludes the comparison window from the baseline', () => {
    expect(GAIT_THRESHOLDS.historyDays).toBe(GAIT_THRESHOLDS.baselineDays + GAIT_THRESHOLDS.recentDays)
    expect(gaitSummary(speed, series(1.24, 1.24), today).band?.days).toBe(28)
  })
})

describe('the drawing', () => {
  it('cuts the line where days are missing', () => {
    const pts = [
      { day: day(-10), value: 1.2 },
      { day: day(-9), value: 1.21 },
      { day: day(-4), value: 1.19 },
      { day: day(-3), value: 1.18 },
    ]
    expect(segments(pts)).toHaveLength(2)
    expect(isolatedDays(pts).size).toBe(0)
  })

  it('draws a lone measurement as a point rather than dropping it', () => {
    const pts = [
      { day: day(-20), value: 1.3 },
      { day: day(-5), value: 1.1 },
      { day: day(-4), value: 1.12 },
    ]
    expect([...isolatedDays(pts)]).toEqual([day(-20)])
  })

  it('counts consecutive days on the calendar, across the clock change', () => {
    // 25 and 26 October 2026: the night the clocks go back in Europe.
    const pts = [
      { day: '2026-10-24', value: 1 },
      { day: '2026-10-25', value: 1 },
      { day: '2026-10-26', value: 1 },
    ]
    expect(segments(pts)).toHaveLength(1)
  })

  it('drops falls outside the window rather than clamping them to its edge', () => {
    const falls = fallDays(
      [
        { day: day(-60), value: 1 },
        { day: day(-3), value: 1 },
        { day: day(-2), value: 0 },
      ],
      day(-35),
      today,
    )
    expect(falls.map((p) => p.day)).toEqual([day(-3)])
  })
})

describe('the metrics', () => {
  it('keeps the phone’s order: what you feel, the ratios, Apple’s composite last', () => {
    expect(GAIT_METRICS.map((m) => m.key)).toEqual([
      'walkingSpeed',
      'walkingStepLength',
      'walkingAsymmetryPercentage',
      'walkingDoubleSupportPercentage',
      'appleWalkingSteadiness',
    ])
  })

  it('compares the percentages in points', () => {
    for (const m of GAIT_METRICS.filter((m) => m.unit === '%')) expect(m.deltaUnit).toBe('points')
  })
})
