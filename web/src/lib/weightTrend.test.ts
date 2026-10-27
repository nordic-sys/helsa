// The weight trend, held to the same cases as the phone.
//
// Every `it` below mirrors one `@Test` in
// `HelsaKit/Tests/HelsaKitTests/TrendsTests.swift` ("The weight trend line"
// section), with the same inputs and the same bounds — so the two ports are
// held to one definition rather than drifting apart one fix at a time.

import { describe, expect, it } from 'vitest'
import {
  WEIGHT_TREND,
  makeWeightTrend,
  signedRate,
  trendPoints,
} from './weightTrend'

/** A body-mass series: `values` on consecutive days from `start`, `null` where
 * nothing was weighed — the Swift `weightSeries(from:_:)`. */
function series(start: Date, values: (number | null)[]) {
  return values.flatMap((v, i) =>
    v == null
      ? []
      : [{ date: new Date(start.getFullYear(), start.getMonth(), start.getDate() + i), value: v }],
  )
}

const day = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h)

describe('the weight trend line (WeightTrend.swift)', () => {
  it('smooths the noise the raw weighings carry', () => {
    const values = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 80.5 : 79.5))
    const trend = makeWeightTrend(series(day(2026, 7, 13), values), 'bodyMass', 'kg', true)!
    expect(trend.points).toHaveLength(30)
    expect(trend.shortfall).toBeNull()
    // The seed is the first measurement; from there the line converges on the middle.
    expect(trend.points[0].trend).toBe(80.5)
    const last = trend.points[trend.points.length - 1]
    expect(Math.abs(last.trend - 80)).toBeLessThan(0.2)
    expect(last.measured).toBe(79.5)
  })

  it('does not move by the same step for weighings a fortnight apart as a day apart', () => {
    const start = day(2026, 7, 1)
    const close = trendPoints([
      { date: start, value: 80 },
      { date: day(2026, 7, 2), value: 90 },
    ])
    const far = trendPoints([
      { date: start, value: 80 },
      { date: day(2026, 7, 15), value: 90 },
    ])
    expect(Math.abs(close[1].trend - 81)).toBeLessThan(0.001) // one day → the classic 10%
    // Fourteen days → α = 1 − 0.9¹⁴ ≈ 0.77: the returning weighing mostly re-anchors.
    expect(far[1].trend).toBeGreaterThan(87)
    expect(far[1].trend).toBeLessThan(88)
  })

  it('does not give two weighings on the same day a step each', () => {
    const points = trendPoints([
      { date: day(2026, 7, 1, 7), value: 80 },
      { date: day(2026, 7, 1, 21), value: 90 },
    ])
    expect(points[1].trend).toBe(80)
    expect(points[1].measured).toBe(90)
  })

  it('breaks the line across a hole of weeks and re-seeds it', () => {
    const values: (number | null)[] = Array(60).fill(null)
    for (let d = 0; d < 20; d++) values[d] = 80
    for (let d = 45; d < 60; d++) values[d] = 83
    const trend = makeWeightTrend(series(day(2026, 6, 1), values), 'bodyMass', 'kg', true)!
    expect(new Set(trend.points.map((p) => p.segment))).toEqual(new Set([0, 1]))
    expect(trend.points.find((p) => p.segment === 1)?.trend).toBe(83)
    expect(WEIGHT_TREND.maxGapDays).toBe(21)
  })

  it('keeps a gap shorter than the break threshold inside one line', () => {
    const values: (number | null)[] = [...Array(20).fill(80), ...Array(7).fill(null), 84]
    const trend = makeWeightTrend(series(day(2026, 6, 1), values), 'bodyMass', 'kg', true)!
    expect(new Set(trend.points.map((p) => p.segment))).toEqual(new Set([0]))
    // α over 8 days ≈ 0.57 — most of the way, but not all of it.
    const last = trend.points[trend.points.length - 1].trend
    expect(last).toBeGreaterThan(82)
    expect(last).toBeLessThan(83)
  })

  it('draws nothing below the data minimum, and says why', () => {
    const few = makeWeightTrend(
      series(day(2026, 8, 1), [80, null, 81, null, 80.5, 80]),
      'bodyMass',
      'kg',
      true,
    )!
    expect(few.points).toEqual([])
    expect(few.changePerWeek).toBeNull()
    expect(few.shortfall).toEqual({ kind: 'fewSamples', min: WEIGHT_TREND.minSamples, count: 4 })

    const dense = makeWeightTrend(
      series(day(2026, 8, 1), [80, 80.2, 79.9, 80.1, 80]),
      'bodyMass',
      'kg',
      true,
    )!
    expect(dense.points).toEqual([])
    expect(dense.shortfall).toEqual({ kind: 'shortSpan', span: 4, min: WEIGHT_TREND.minSpanDays })

    const empty = makeWeightTrend([], 'bodyMass', 'kg', true)!
    expect(empty.points).toEqual([])
    expect(empty.changePerWeek).toBeNull()
  })

  it('checks the minimum on one unbroken stretch, not on the series total', () => {
    const values: (number | null)[] = Array(120).fill(null)
    for (let pair = 0; pair < 5; pair++) {
      values[pair * 24] = 80
      values[pair * 24 + 1] = 80.2
    }
    const trend = makeWeightTrend(series(day(2026, 4, 1), values), 'bodyMass', 'kg', true)!
    expect(trend.points).toEqual([])
    expect(trend.shortfall?.kind).toBe('fewSamples')
  })

  it('takes the weekly rate from the trend, not from two weighings', () => {
    const values = Array.from({ length: 28 }, (_, d) => 80 - d * (0.2 / 7) + (d % 2 === 0 ? 0.25 : -0.25))
    const trend = makeWeightTrend(series(day(2026, 7, 15), values), 'bodyMass', 'kg', true)!
    const r = trend.changePerWeek!
    expect(r).toBeLessThan(0)
    expect(Math.abs(r + 0.2)).toBeLessThan(0.06)
    // The phone prints "−0,20 kg/week"; the number part is this.
    expect(signedRate(r, 'hu-HU')).toBe('−0,20')
    expect(signedRate(r, 'en-GB')).toBe('−0.20')
  })

  it('states no rate across a break, nor from too short a stretch', () => {
    const values: (number | null)[] = Array(60).fill(null)
    for (let d = 0; d < 25; d++) values[d] = 80
    for (let d = 56; d < 60; d++) values[d] = 83
    const trend = makeWeightTrend(series(day(2026, 6, 1), values), 'bodyMass', 'kg', true)!
    expect(trend.points.length).toBeGreaterThan(0)
    expect(trend.changePerWeek).toBeNull()
  })

  it('gives a trend line only to the metrics it can label', () => {
    const s = series(day(2026, 7, 13), Array(30).fill(80))
    expect(makeWeightTrend(s, 'stepCount', 'count', true)).toBeNull()
    expect(makeWeightTrend(s, 'restingHeartRate', 'count/min', true)).toBeNull()
    expect(makeWeightTrend(s, 'bodyMass', 'kg', true)).not.toBeNull()
    expect(makeWeightTrend(s, 'leanBodyMass', 'kg', true)).not.toBeNull()
  })

  it('gives the yearly view no line, because its buckets are already averages', () => {
    const monthly = Array.from({ length: 12 }, (_, i) => ({
      date: new Date(2025, 8 + i, 1),
      value: 80 - i * 0.1,
    }))
    const trend = makeWeightTrend(monthly, 'bodyMass', 'kg', false)!
    expect(trend.points).toEqual([])
    expect(trend.shortfall).toEqual({ kind: 'yearly' })
  })

  it('prints a sign only for a real change, and two decimals always', () => {
    expect(signedRate(0.4, 'en-GB')).toBe('+0.40')
    expect(signedRate(0, 'en-GB')).toBe('0.00')
  })
})
