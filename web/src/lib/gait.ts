// Walking and gait — the five series on one time axis.
//
// A value-for-value port of the phone's gait screen rules:
// `HelsaKit/Stability/StabilityRules.swift` (the windows, the band, the change),
// `StabilityMetric.swift` (precision and the absolute thresholds) and
// `StabilityChartSeries.swift` (a line never crosses a missing day).
// `gait.test.ts` mirrors `StabilityRulesTests.swift` case for case.
//
// # What the phone does that this deliberately does not
//
// The phone draws Apple's walking-steadiness NOTIFICATIONS on the same axis
// (`StabilityTimeline`). Those are HealthKit category samples
// (`appleWalkingSteadinessEvent`), and the phone's uploader sends exactly one
// category type to the server — sleep analysis (`HealthKitReader`'s anchored
// query). So they never reach this server, and the card says so in words rather
// than drawing an axis that looks complete without them. Falls DO arrive
// (`numberOfTimesFallen` is a quantity type) and are drawn.
//
// # Units
//
// The phone scales the three percentages from HealthKit's 0…1 fraction here
// (`StabilityMetric.displayValue`). The web never sees the fraction: the server
// scales every `%` type to 0…100 on its read path, once (docs/23 §3.0.1), so
// the values below are already in display units and must NOT be scaled again.
//
// # No verdict
//
// The direction is `up` or `down`, never better or worse. A slower walk may be a
// wet January or a heavy backpack. The comparison is always with the person's
// own previous four weeks, never with a norm.

import { isoDay } from './window'

/** The phone's `StabilityThresholds`. */
export const GAIT_THRESHOLDS = {
  /** The comparison window: the last 7 FINISHED days (today is left out). */
  recentDays: 7,
  /** The baseline: the 28 days before the comparison window. */
  baselineDays: 28,
  /** Measured days needed in the baseline (half of 28 — a rainy week is a
   * normal hole in walking data). */
  minBaselineDays: 14,
  /** Measured days needed in the comparison window. */
  minRecentDays: 4,
  /** The relative change that must be reached, beside the absolute one. */
  minRelativeChange: 0.05,
  /** Below this a spread (or an average) counts as zero. */
  minStdDev: 1e-9,
  /** How far back the card reads: both windows. */
  historyDays: 35,
} as const

/**
 * How a DIFFERENCE is worded. Hungarian puts the measure of a comparison in the
 * instrumental case ("0,06 m/s-mal alacsonyabb"), with a suffix that depends on
 * the unit — so differences and levels are separate strings, exactly as on the
 * phone (`StabilityText.delta` vs `.value`). The percentages are compared in
 * PERCENTAGE POINTS: 4% → 5% asymmetry is one point, not "25% higher".
 */
export type GaitDeltaUnit = 'speed' | 'length' | 'points'

export type GaitMetric = {
  /** The wire name. */
  key: string
  /** Display unit for a LEVEL. */
  unit: string
  /** Not decoration: a step length rounded to one decimal swallows the whole
   * range this card is about. */
  decimals: number
  /** The smallest change called a change, in display units — coarse on purpose,
   * above the day-to-day noise of a wrist-worn sensor. */
  minAbsoluteDelta: number
  deltaUnit: GaitDeltaUnit
}

/**
 * The order is the phone's display order: the two you can feel first, the two
 * mechanical ratios after, and Apple's own composite LAST — it is a conclusion,
 * and a conclusion at the top invites reading it instead of the data.
 */
export const GAIT_METRICS: GaitMetric[] = [
  { key: 'walkingSpeed', unit: 'm/s', decimals: 2, minAbsoluteDelta: 0.05, deltaUnit: 'speed' },
  { key: 'walkingStepLength', unit: 'm', decimals: 2, minAbsoluteDelta: 0.02, deltaUnit: 'length' },
  { key: 'walkingAsymmetryPercentage', unit: '%', decimals: 1, minAbsoluteDelta: 1.0, deltaUnit: 'points' },
  { key: 'walkingDoubleSupportPercentage', unit: '%', decimals: 1, minAbsoluteDelta: 0.5, deltaUnit: 'points' },
  { key: 'appleWalkingSteadiness', unit: '%', decimals: 0, minAbsoluteDelta: 2.0, deltaUnit: 'points' },
]

export const GAIT_KEYS = GAIT_METRICS.map((m) => m.key)

/** The quantity type the falls arrive as — drawn on the same axis. */
export const FALLS_KEY = 'numberOfTimesFallen'

/** One measured day. `day` is a local `YYYY-MM-DD`. Missing days are ABSENT,
 * never zero. */
export type DayPoint = { day: string; value: number }

export type GaitBand = { mean: number; deviation: number; days: number; low: number; high: number }

export type GaitChange =
  | { kind: 'notEnoughData'; baselineDays: number; recentDays: number }
  | { kind: 'notComparable' }
  | { kind: 'unchanged'; recent: number; baseline: number }
  | { kind: 'moved'; recent: number; baseline: number; direction: 'up' | 'down' }

export type GaitSummary = {
  metric: GaitMetric
  points: DayPoint[]
  band: GaitBand | null
  change: GaitChange
  /** The most recent measured day — today included. */
  latest: DayPoint | null
}

/** `YYYY-MM-DD` plus `n` calendar days, on the local calendar — never by adding
 * 86 400 000 ms, which slides a day edge on the two clock-change days. */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return isoDay(new Date(y, m - 1, d + n))
}

const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length)

function sampleSd(xs: number[], m: number): number {
  if (xs.length < 2) return 0
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1))
}

const between = (points: DayPoint[], from: string, to: string) =>
  points.filter((p) => p.day >= from && p.day < to).map((p) => p.value)

/**
 * The person's own band: the baseline's mean ± one sample standard deviation.
 * `null` below the data minimum, and for a zero-width spread — a band drawn as a
 * line would claim a precision the measurement does not have.
 */
export function gaitBand(baseline: number[]): GaitBand | null {
  if (baseline.length < GAIT_THRESHOLDS.minBaselineDays) return null
  const m = mean(baseline)
  const sd = sampleSd(baseline, m)
  if (sd < GAIT_THRESHOLDS.minStdDev) return null
  return { mean: m, deviation: sd, days: baseline.length, low: m - sd, high: m + sd }
}

/**
 * One metric's evaluation (`StabilityRules.summary`).
 *
 * ⚠️ Today is in NEITHER window: a day still being walked is a partial average,
 * and a page opened at 8 a.m. after the walk to the bus stop would otherwise
 * report a change every morning. It is still drawn, and it is still `latest`.
 */
export function gaitSummary(metric: GaitMetric, input: DayPoint[], today: string): GaitSummary {
  const points = [...input].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
  const recentStart = addDays(today, -GAIT_THRESHOLDS.recentDays)
  const baselineStart = addDays(recentStart, -GAIT_THRESHOLDS.baselineDays)
  const recent = between(points, recentStart, today)
  const baseline = between(points, baselineStart, recentStart)
  const band = gaitBand(baseline)
  const latest = points.length > 0 ? points[points.length - 1] : null

  if (baseline.length < GAIT_THRESHOLDS.minBaselineDays || recent.length < GAIT_THRESHOLDS.minRecentDays) {
    return {
      metric,
      points,
      band,
      change: { kind: 'notEnoughData', baselineDays: baseline.length, recentDays: recent.length },
      latest,
    }
  }
  const baselineMean = mean(baseline)
  const recentMean = mean(recent)
  // A zero average makes a relative change undefined — not "0% change".
  if (Math.abs(baselineMean) < GAIT_THRESHOLDS.minStdDev) {
    return { metric, points, band, change: { kind: 'notComparable' }, latest }
  }
  const delta = recentMean - baselineMean
  const relative = delta / Math.abs(baselineMean)
  if (Math.abs(relative) < GAIT_THRESHOLDS.minRelativeChange || Math.abs(delta) < metric.minAbsoluteDelta) {
    return { metric, points, band, change: { kind: 'unchanged', recent: recentMean, baseline: baselineMean }, latest }
  }
  return {
    metric,
    points,
    band,
    change: { kind: 'moved', recent: recentMean, baseline: baselineMean, direction: delta > 0 ? 'up' : 'down' },
    latest,
  }
}

/**
 * Runs of consecutive measured days (`StabilityChartSeries.segments`).
 *
 * The chart draws a line through a run of two or more and a lone dot for a run
 * of one. A single line across a gap would draw a straight segment over days
 * that were never measured — on a card about slow change, the most misleading
 * thing available.
 */
export function segments(points: DayPoint[]): DayPoint[][] {
  const out: DayPoint[][] = []
  let current: DayPoint[] = []
  for (const p of points) {
    const prev = current[current.length - 1]
    if (prev && addDays(prev.day, 1) !== p.day) {
      out.push(current)
      current = []
    }
    current.push(p)
  }
  if (current.length > 0) out.push(current)
  return out
}

/** The days that stand alone, with no measured day on either side. */
export function isolatedDays(points: DayPoint[]): Set<string> {
  return new Set(segments(points).filter((s) => s.length === 1).map((s) => s[0].day))
}

/** Falls on the axis: the days of the window with a fall count above zero.
 * Outside the window they are dropped, not clamped to its edge. */
export function fallDays(points: DayPoint[], from: string, to: string): DayPoint[] {
  return points.filter((p) => p.value > 0 && p.day >= from && p.day <= to)
}
