// Blood pressure on the Measurements page: the two values as ONE reading, and
// which readings stand out against the person's own.
//
// Two ports from the phone, kept value for value:
//
//  - the pairing and the card's arithmetic — `HelsaKit/Health/UI/MetricSnapshot.swift`
//    (`BloodPressureReading`, `BloodPressureAbsence`, `BloodPressureSeries`) and the
//    timestamp pairing of `Events/BloodPressureOutlier.swift` (`readings(systolic:diastolic:)`);
//  - the unusual-reading rule — `Events/BloodPressureOutlier.swift`, tested by
//    `BloodPressureOutlierTests.swift`, whose cases `bloodPressure.test.ts` mirrors.
//
// # ⛔️ NO CLINICAL LIMIT. NOT 140/90, NOT ANYTHING ELSE.
//
// The phone's file opens with this and so does this one, because it is the one
// decision here that is not a matter of taste. A fixed limit is a medical
// statement about a body, made by software that is not a medical device and
// knows nothing of the person's history or medication. The question asked
// instead is one arithmetic can answer: is this reading unusual compared with
// THIS person's own earlier readings? Nothing below knows what a "high" blood
// pressure is, and nothing may learn.
//
// # Why pairing is by exact timestamp, and not by day
//
// The phone's card pairs by BUCKET (`BloodPressureSeries.readings`), because it
// reads `/summary`. That is a weaker pairing than it looks: two morning and two
// evening readings become one averaged "reading" per day. The web reads the raw
// samples instead (`/samples`, two requests for 90 days), so it can use the
// stricter rule the phone's outlier detector uses — a systolic and a diastolic
// sample that HealthKit wrote as one correlation share their start instant, and
// only those form a reading. Half a measurement is not a reading.

import type { Sample } from '../api/types'

/** The two wire names, upper first. */
export const BLOOD_PRESSURE_KEYS = ['bloodPressureSystolic', 'bloodPressureDiastolic'] as const

export type BpReading = {
  /** The instant, as the server sent it. */
  at: string
  ms: number
  systolic: number
  diastolic: number
}

/**
 * The complete readings: a systolic and a diastolic sample at the SAME instant,
 * oldest first.
 *
 * ⚠️ Matched on the parsed millisecond, not the string: one server can write
 * `07:00:00Z` and `07:00:00.000Z` for the same moment, and a string match would
 * silently drop the pair. A minute apart is two halves, not a reading — the
 * phone's `pairingIsOnTheExactTimestamp`.
 */
export function pairReadings(systolic: Sample[], diastolic: Sample[]): BpReading[] {
  const lower = new Map<number, number>()
  for (const s of diastolic) {
    const ms = Date.parse(s.ts ?? '')
    if (Number.isFinite(ms) && s.value != null) lower.set(ms, s.value)
  }
  const out: BpReading[] = []
  for (const s of systolic) {
    const ms = Date.parse(s.ts ?? '')
    if (!Number.isFinite(ms) || s.value == null) continue
    const dia = lower.get(ms)
    if (dia == null) continue
    out.push({ at: s.ts as string, ms, systolic: s.value, diastolic: dia })
  }
  return out.sort((a, b) => a.ms - b.ms)
}

/**
 * Why there is no number on the card. The card SAYS which — a silent empty card
 * reads as a fault, whereas blood pressure is simply not something the watch
 * measures (the phone's `BloodPressureAbsence`).
 *
 * `systolicOnly` / `diastolicOnly` are the dangerous ones: either half on its own
 * looks like a measurement, and nobody would notice the other half is missing.
 */
export type BpAbsence = 'none' | 'bothMissing' | 'systolicOnly' | 'diastolicOnly' | 'noPairedReading'

export function bpAbsence(readings: BpReading[], hasSystolic: boolean, hasDiastolic: boolean): BpAbsence {
  if (readings.length > 0) return 'none'
  if (!hasSystolic && !hasDiastolic) return 'bothMissing'
  if (hasSystolic && !hasDiastolic) return 'systolicOnly'
  if (!hasSystolic && hasDiastolic) return 'diastolicOnly'
  return 'noPairedReading'
}

/** Pulse pressure — the difference between the two values. */
export const pulsePressure = (r: { systolic: number; diastolic: number }) => r.systolic - r.diastolic

/**
 * Mean arterial pressure, by the usual approximation `dia + (sys − dia) / 3`.
 * The heart spends the larger part of the cycle in diastole, which is why this
 * is not the plain mean of the two.
 */
export const meanArterial = (r: { systolic: number; diastolic: number }) =>
  r.diastolic + pulsePressure(r) / 3

/** Both values averaged over the complete readings; `null` without any. */
export function bpAverage(readings: BpReading[]): { systolic: number; diastolic: number } | null {
  if (readings.length === 0) return null
  const sys = readings.reduce((s, r) => s + r.systolic, 0) / readings.length
  const dia = readings.reduce((s, r) => s + r.diastolic, 0) / readings.length
  return { systolic: sys, diastolic: dia }
}

// --- Unusual readings ---------------------------------------------------------

/**
 * The phone's thresholds (`BloodPressureOutlier` + the two it borrows from
 * `InsightThresholds`). Referenced as one object so the page can print them —
 * "at least 15 readings" on screen is this number plus one, not a copy.
 */
export const BP_OUTLIER = {
  /** How many OTHER readings the baseline needs before anything is said. */
  minBaselineReadings: 14,
  /** How far back the baseline looks — long, because blood pressure is measured
   * sporadically and 28 days would rarely hold 14 readings. */
  baselineDays: 90,
  /** The absolute floor beside the z-score, per axis, in mmHg. Without it a very
   * even measurer is flagged for 6 mmHg, which is two sigmas and means nothing. */
  minSystolicDelta: 8,
  minDiastolicDelta: 5,
  /** `InsightThresholds.zThreshold`. */
  zThreshold: 1.5,
  /** `InsightThresholds.minStdDev` — below it the spread counts as constant. */
  minStdDev: 1e-9,
} as const

export type BpAxis = 'systolic' | 'diastolic'

export type AxisDeviation = {
  axis: BpAxis
  value: number
  /** The mean of the OTHER readings. */
  baseline: number
  /** Their sample standard deviation. */
  deviation: number
  z: number
  /** Signed: value − baseline. */
  delta: number
  isAbove: boolean
}

export type UnusualReading = { reading: BpReading; deviations: AxisDeviation[] }

const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length)

/** The SAMPLE standard deviation (n−1), as `InsightStatistics.standardDeviation`. */
function sampleSd(xs: number[], m: number): number {
  if (xs.length < 2) return 0
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1))
}

function deviation(axis: BpAxis, value: number, baseline: number[], minDelta: number): AxisDeviation | null {
  if (baseline.length < BP_OUTLIER.minBaselineReadings) return null
  const m = mean(baseline)
  const sd = sampleSd(baseline, m)
  if (sd < BP_OUTLIER.minStdDev) return null
  const z = (value - m) / sd
  if (Math.abs(z) < BP_OUTLIER.zThreshold || Math.abs(value - m) < minDelta) return null
  return { axis, value, baseline: m, deviation: sd, z, delta: value - m, isAbove: value - m > 0 }
}

/** The local calendar day `days` before `now`, at the same clock time — the
 * phone's `calendar.date(byAdding: .day, value: -90, to: now)`, which is not
 * 90 × 86 400 seconds on a stretch that crosses a clock change. */
export function daysBefore(now: Date, days: number): Date {
  const d = new Date(now)
  d.setDate(d.getDate() - days)
  return d
}

/**
 * The readings of the last 90 days that stand out against the person's own.
 *
 * Each reading is measured against the mean and spread of **all the others**
 * (leave-one-out), so a genuinely extreme value cannot help define the very
 * "usual" it is compared with. Neighbouring days are deliberately NOT skipped:
 * if the readings have been higher for two weeks, that is the new usual, and
 * flagging every one of them would be nagging about a level already seen
 * fourteen times.
 *
 * A single reading is enough — unlike the dashboard's deviation insights, which
 * want three days in a row. A one-afternoon spike is exactly the case worth a
 * second look, and the cost of a false one here is a highlighted row, not a
 * claim about anybody's health.
 *
 * Readings after `now` are ignored: there is no baseline for them yet.
 */
export function detectUnusual(readings: BpReading[], now: Date): UnusualReading[] {
  const start = daysBefore(now, BP_OUTLIER.baselineDays).getTime()
  const end = now.getTime()
  const window = readings.filter((r) => r.ms >= start && r.ms <= end).sort((a, b) => a.ms - b.ms)
  // `minBaselineReadings` OTHERS are needed, so the window holds one more.
  if (window.length <= BP_OUTLIER.minBaselineReadings) return []
  const out: UnusualReading[] = []
  window.forEach((reading, i) => {
    const others = window.filter((_, j) => j !== i)
    const deviations = [
      deviation('systolic', reading.systolic, others.map((o) => o.systolic), BP_OUTLIER.minSystolicDelta),
      deviation('diastolic', reading.diastolic, others.map((o) => o.diastolic), BP_OUTLIER.minDiastolicDelta),
    ].filter((d): d is AxisDeviation => d != null)
    if (deviations.length > 0) out.push({ reading, deviations })
  })
  return out
}

/** How many readings of the window the rule has to work with — printed when it
 * stays silent, so the silence is not read as "everything was usual". */
export function readingsInWindow(readings: BpReading[], now: Date): number {
  const start = daysBefore(now, BP_OUTLIER.baselineDays).getTime()
  return readings.filter((r) => r.ms >= start && r.ms <= now.getTime()).length
}
