// "The year in numbers" — the web's copy of the phone's period summary.
//
// Ported from `HelsaKit/Sources/HelsaKit/Summary/` (`SummaryPeriod.swift`,
// `PeriodWindow.swift`, `PeriodSummary.swift`), and the tests in
// `periodSummary.test.ts` mirror `HelsaKit/Tests/HelsaKitTests/PeriodSummaryTests.swift`
// case for case where the case exists on both sides. Pure functions, no I/O and
// no React, so every rule can be pinned against a fixed `now`.
//
// A summary is the most tempting screen there is to round things off on. The
// phone's three rules hold here word for word, each with a test:
//
// 1. **A month with no data is left out, it is not a zero.** The average is over
//    the measured buckets only, and the page says how many carried data.
// 2. **The extent of the period is stated out loud.** A running year is not a
//    year, and the comparison period is cut to the same length.
// 3. **An uneven comparison is flagged.** Even between two equally long windows,
//    six measured months against eleven are not two comparable sums.
//
// ⚠️ **One rule is stricter here than on the phone, on purpose.** The phone shows
// a summed delta with a caveat whenever the measured counts differ; the web
// already has a sharper rule for that (`lib/compare.ts`, used by Trends): when
// the measured SHARES differ by more than half, a summed delta is withheld
// altogether. Two pages of one dashboard must not disagree about when a total
// may be compared, so the summary follows the web's rule and keeps the phone's
// caveat for the milder case.

import type { Achievement, SleepSegment, SummaryResponse, Workout } from '../api/types'
import { coverageVerdict } from './compare'
import type { Formatters } from './format'
import { pickSeries, readSeries, type MetricDef, type ReadSeries } from './metrics'
import { groupByNight, isOvernight } from './sleep'
import { bucketKey, isoDay, type TrendWindow } from './window'
import { durationMin, groupSessions, startMs } from './workouts'

// --- The period ---------------------------------------------------------------

/**
 * One calendar **year** or one calendar **month** — `month` is 1…12.
 *
 * ⚠️ Deliberately a CALENDAR period, not a rolling window (`SummaryPeriod.swift`).
 * "The last 12 months" is a fine thing to chart, and Trends charts it; "2026 in
 * numbers" is a claim about a named period, and a summary titled with a year has
 * to cover exactly that year, from January 1st.
 */
export type SummaryPeriod = { unit: 'year'; year: number } | { unit: 'month'; year: number; month: number }

export type PeriodUnit = SummaryPeriod['unit']

/** `2026` / `2026-08` — the same shape as `Achievement.period`, so the medals
 * of a period can be found by prefix. */
export function periodId(p: SummaryPeriod): string {
  const y = String(p.year).padStart(4, '0')
  return p.unit === 'year' ? y : `${y}-${String(p.month).padStart(2, '0')}`
}

/** The previous period of the same kind (January's is December of the year before). */
export function previousPeriod(p: SummaryPeriod): SummaryPeriod {
  if (p.unit === 'year') return { unit: 'year', year: p.year - 1 }
  return p.month > 1
    ? { unit: 'month', year: p.year, month: p.month - 1 }
    : { unit: 'month', year: p.year - 1, month: 12 }
}

export function nextPeriod(p: SummaryPeriod): SummaryPeriod {
  if (p.unit === 'year') return { unit: 'year', year: p.year + 1 }
  return p.month < 12
    ? { unit: 'month', year: p.year, month: p.month + 1 }
    : { unit: 'month', year: p.year + 1, month: 1 }
}

/** The period a moment falls in, on the reader's own clock. */
export function containing(date: Date, unit: PeriodUnit): SummaryPeriod {
  return unit === 'year'
    ? { unit: 'year', year: date.getFullYear() }
    : { unit: 'month', year: date.getFullYear(), month: date.getMonth() + 1 }
}

/** Forward stops at the present: a period that has not started has nothing to show. */
export function canStepForward(p: SummaryPeriod, now: Date): boolean {
  return firstDay(nextPeriod(p)).getTime() <= startOfDay(now).getTime()
}

/** The bucket width the summary is asked in: a year in months, a month in days. */
export function rangeOf(p: SummaryPeriod): 'year' | 'month' {
  return p.unit
}

// --- Local-time calendar arithmetic -------------------------------------------
//
// ⚠️ Local constructors throughout, never milliseconds: the boundary of a month
// in Budapest is two hours away from the UTC one in summer, and the last day of
// the period would slide onto its neighbour (`SummaryPeriod.calendar`).

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

function firstDay(p: SummaryPeriod): Date {
  return new Date(p.year, p.unit === 'year' ? 0 : p.month - 1, 1)
}

/** The day AFTER the period. */
function endExclusive(p: SummaryPeriod): Date {
  return p.unit === 'year' ? new Date(p.year + 1, 0, 1) : new Date(p.year, p.month, 1)
}

function lastDay(p: SummaryPeriod): Date {
  return addDays(endExclusive(p), -1)
}

/** 12 months, or the month's real length — a February counted as 30 would
 * report 28/30 coverage in a leap year. */
function totalUnits(p: SummaryPeriod): number {
  return p.unit === 'year' ? 12 : lastDay(p).getDate()
}

/** Buckets covered by `[start, last]`, inclusive at both ends. */
function unitsBetween(start: Date, last: Date, unit: PeriodUnit): number {
  if (last < start) return 0
  if (unit === 'year') {
    return (last.getFullYear() - start.getFullYear()) * 12 + (last.getMonth() - start.getMonth()) + 1
  }
  return Math.round((last.getTime() - start.getTime()) / 86_400_000) + 1
}

// --- The window ---------------------------------------------------------------

/**
 * How much of the named period the data covers (`PeriodExtent` in
 * `PeriodWindow.swift`).
 *
 * ⚠️ **The reason this type exists.** A summary headed "2026" that in fact ends
 * on the 13th of August is the most believable lie the page can tell: every
 * number on it is correct, only the title claims a year where there are seven
 * and a half months. The extent travels with the window, so nothing can forget
 * to say it.
 *
 * - `complete` — a closed period, covered whole.
 * - `running` — still going; the data reaches `through` (ISO day, inclusive).
 * - `matched` — a closed period deliberately cut to the length of the running
 *   one it is compared with.
 * - `notStarted` — nothing can be said about it, not even a zero.
 */
export type PeriodExtent =
  | { kind: 'complete' }
  | { kind: 'running'; through: string }
  | { kind: 'matched'; through: string }
  | { kind: 'notStarted' }

/**
 * The queryable window of one period, plus what the page needs to say how much
 * of the period this actually is.
 *
 * It IS a `TrendWindow` (calendar kind), so `windowDates`, `bucketStarts` and
 * the rest of `lib/window` work on it unchanged — one ruler for both pages.
 */
export type PeriodWindow = TrendWindow & {
  period: SummaryPeriod
  extent: PeriodExtent
  /** Buckets (months / days) already elapsed inside the window. */
  elapsedUnits: number
  totalUnits: number
}

function makeWindow(
  period: SummaryPeriod,
  start: Date,
  last: Date,
  extent: PeriodExtent,
  elapsed: number,
): PeriodWindow {
  return {
    period,
    from: isoDay(start),
    to: isoDay(last),
    start: start.getTime(),
    end: addDays(last, 1).getTime(),
    isPartial: extent.kind !== 'complete',
    kind: 'calendar',
    extent,
    elapsedUnits: elapsed,
    totalUnits: totalUnits(period),
  }
}

/**
 * The period's window as it stands today.
 *
 * A running period is cut at TODAY: asking for the rest of the year brings back
 * nothing but empty buckets, and empty buckets on a summary read as "there was
 * no data" when the truth is "that has not happened yet".
 */
export function periodWindow(period: SummaryPeriod, now: Date): PeriodWindow {
  const today = startOfDay(now)
  const start = firstDay(period)
  const periodLast = lastDay(period)
  if (today < start) return makeWindow(period, start, start, { kind: 'notStarted' }, 0)
  const last = periodLast < today ? periodLast : today
  const extent: PeriodExtent =
    today < periodLast ? { kind: 'running', through: isoDay(last) } : { kind: 'complete' }
  return makeWindow(period, start, last, extent, unitsBetween(start, last, period.unit))
}

/**
 * The previous period, cut to the same extent as `current`
 * (`PeriodWindows.comparisonWindow`).
 *
 * ⚠️ Not a nicety. A running year against the previous FULL year shows a drop
 * of a third in August purely because the year is not over. So the comparison
 * ends at the same point: the same month and day for a year (February 29th
 * becomes the 28th, never March 1st), the same number of days for a month.
 */
export function comparisonWindow(current: PeriodWindow): PeriodWindow {
  const period = previousPeriod(current.period)
  const start = firstDay(period)
  const periodLast = lastDay(period)

  if (current.extent.kind !== 'running' && current.extent.kind !== 'matched') {
    return makeWindow(period, start, periodLast, { kind: 'complete' }, unitsBetween(start, periodLast, period.unit))
  }

  let last: Date
  if (period.unit === 'year') {
    const cur = addDays(new Date(current.end), -1)
    const month = cur.getMonth()
    // Clamped to the month's real length: in a non-leap year Feb 29 → Feb 28.
    const length = new Date(period.year, month + 1, 0).getDate()
    last = new Date(period.year, month, Math.min(cur.getDate(), length))
  } else {
    last = addDays(start, Math.max(current.elapsedUnits - 1, 0))
  }
  if (last > periodLast) last = periodLast
  return makeWindow(period, start, last, { kind: 'matched', through: isoDay(last) }, unitsBetween(start, last, period.unit))
}

/** How many DAYS the window covers — nights are counted per day even in a
 * year's summary, where `elapsedUnits` counts months. */
export function elapsedDays(win: PeriodWindow): number {
  if (win.extent.kind === 'notStarted') return 0
  return Math.round((win.end - win.start) / 86_400_000)
}

/** The whole period as a window, future included — the x axis of its chart, so
 * a running year is drawn as eight months of twelve rather than as a full width
 * of eight. */
export function fullPeriodWindow(win: PeriodWindow): TrendWindow {
  const end = endExclusive(win.period)
  return { ...win, to: isoDay(addDays(end, -1)), end: end.getTime() }
}

// --- Coverage -----------------------------------------------------------------

/** How much of the ELAPSED period carries data. `elapsed`, not the length of
 * the period: only what has happened can be expected to have data. */
export type PeriodCoverage = { measured: number; elapsed: number; unit: 'month' | 'day' }

/** Which of the phone's four coverage sentences applies (`PeriodCoverage.sentence`). */
export type CoverageState = 'nothingElapsed' | 'none' | 'all' | 'some'

export function coverageState(c: PeriodCoverage): CoverageState {
  if (c.elapsed <= 0) return 'nothingElapsed'
  if (c.measured <= 0) return 'none'
  return c.measured >= c.elapsed ? 'all' : 'some'
}

export function coverageUnit(p: SummaryPeriod): 'month' | 'day' {
  return p.unit === 'year' ? 'month' : 'day'
}

// --- One headline metric ------------------------------------------------------

/**
 * The headline metrics: four cumulative types whose period total means
 * something on its own (`PeriodSummary.headlineTypes`). An averaged metric is
 * not here — its yearly number is a level, not an achievement, and Trends and
 * the year-by-year page show levels better.
 */
export const HEADLINE_KEYS = ['stepCount', 'activeEnergy', 'appleExerciseTime', 'distanceWalkingRunning']

export type Comparison =
  /** No previous figure: two windows, one of which we know nothing about. Not −100%. */
  | { kind: 'none' }
  /** The summed delta is withheld: the measured shares differ by more than half. */
  | { kind: 'withheld'; previous: number }
  | { kind: 'shown'; delta: number; ratio: number | null; previous: number; even: boolean }

export type PeriodMetric = {
  def: MetricDef
  series: ReadSeries
  previous: ReadSeries | null
  coverage: PeriodCoverage
  previousCoverage: PeriodCoverage | null
  /** The highest measured bucket — a bucket the chart draws, so it can be checked. */
  peak: { t: string; value: number } | null
  /** The total over the measured buckets, per measured bucket. `null` for an
   * averaged metric, whose total already is the average. */
  perBucket: number | null
  comparison: Comparison
  /** Bucket key → value, for drawing the chart over the full period. */
  byBucket: Map<string, number>
}

function measuredIn(series: ReadSeries, win: PeriodWindow, range: 'year' | 'month'): Map<string, number> {
  const out = new Map<string, number>()
  for (const p of series.points) {
    if (p.value == null) continue
    const ms = new Date(p.t).getTime()
    if (Number.isNaN(ms) || ms < win.start || ms >= win.end) continue
    out.set(bucketKey(ms, range), p.value)
  }
  return out
}

/**
 * One headline metric, from the two `/summary` responses.
 *
 * @param previous `undefined`/`null` = the comparison period was not loaded,
 *   which is not the same as loaded and empty.
 */
export function metricSummary(
  def: MetricDef,
  win: PeriodWindow,
  cmp: PeriodWindow,
  current: SummaryResponse | undefined,
  previous: SummaryResponse | null | undefined,
): PeriodMetric {
  const range = rangeOf(win.period)
  const unit = coverageUnit(win.period)
  const series = readSeries(def, pickSeries(def, current?.metrics))
  const prevSeries = previous ? readSeries(def, pickSeries(def, previous.metrics)) : null

  const byBucket = measuredIn(series, win, range)
  const coverage: PeriodCoverage = { measured: byBucket.size, elapsed: win.elapsedUnits, unit }
  const previousCoverage: PeriodCoverage | null = prevSeries
    ? { measured: measuredIn(prevSeries, cmp, range).size, elapsed: cmp.elapsedUnits, unit }
    : null

  let peak: PeriodMetric['peak'] = null
  for (const p of series.points) {
    if (p.value != null && (peak == null || p.value > peak.value)) peak = { t: p.t, value: p.value }
  }

  const perBucket =
    series.effectiveAgg === 'sum' && series.total != null && coverage.measured > 0
      ? series.total / coverage.measured
      : null

  let comparison: Comparison = { kind: 'none' }
  if (series.total != null && prevSeries?.total != null && previousCoverage) {
    const verdict = coverageVerdict(
      { measured: coverage.measured, total: coverage.elapsed },
      { measured: previousCoverage.measured, total: previousCoverage.elapsed },
    )
    if (verdict === 'uneven' && series.effectiveAgg === 'sum') {
      comparison = { kind: 'withheld', previous: prevSeries.total }
    } else {
      const delta = series.total - prevSeries.total
      comparison = {
        kind: 'shown',
        delta,
        ratio: prevSeries.total !== 0 ? delta / prevSeries.total : null,
        previous: prevSeries.total,
        // ⚠️ Equal-length windows are not enough (`isComparisonEven`): if the
        // watch was off for two months last spring, a sum meets a sum measured
        // over fewer months, and the number goes out with a sentence attached.
        even: previousCoverage.measured === coverage.measured,
      }
    }
  }

  return { def, series, previous: prevSeries, coverage, previousCoverage, peak, perBucket, comparison, byBucket }
}

/**
 * Whether the comparison period was loaded and carries no measurement at all.
 *
 * ⚠️ Worth stating (`comparisonIsEmpty`): otherwise the comparison simply is not
 * there, and a missing line is indistinguishable from a forgotten feature.
 */
export function comparisonIsEmpty(metrics: PeriodMetric[]): boolean {
  if (metrics.length === 0) return false
  if (metrics.some((m) => m.previous == null)) return false
  return metrics.every((m) => !m.previous?.hasData)
}

// --- Sleep --------------------------------------------------------------------

export type PeriodSleep = {
  nights: number
  /** Over the MEASURED nights — `null` when there is not one. */
  averageMin: number | null
  totalMin: number
  longest: { key: string; min: number } | null
  coverage: PeriodCoverage
}

/**
 * The period's nights (`PeriodSummary.sleepSummary`).
 *
 * A night belongs to the day the reader WOKE UP on (`Night.key`, the same
 * convention Apple Health uses) — so a night from December 31st to January 1st
 * is the new year's, and it is not counted in both. That is also why the caller
 * asks `/sleep` from the day BEFORE the window: the server filters segments by
 * their start, and New Year's night starts in the old year.
 *
 * ⚠️ The average is over the measured nights, never over the days of the
 * period: a night not recorded is not a zero-hour night.
 */
export function sleepSummary(segments: SleepSegment[], win: PeriodWindow): PeriodSleep {
  // ⚠️ Overnight sessions only (`isOvernight`, the Sleep page's rule): a nap is
  // its own session, and counting it as a night halved that day's average and
  // could count one day twice against the elapsed days.
  const nights = groupByNight(segments)
    .filter(isOvernight)
    .filter((n) => n.key >= win.from && n.key <= win.to)
  // `asleepMin` is `null` for an in-bed-only night — never measured, so not counted.
  const measured = nights.filter((n) => n.asleepMin != null && n.asleepMin > 0)
  const total = measured.reduce((s, n) => s + (n.asleepMin ?? 0), 0)
  let longest: PeriodSleep['longest'] = null
  for (const n of measured) {
    if (longest == null || (n.asleepMin ?? 0) > longest.min) longest = { key: n.key, min: n.asleepMin ?? 0 }
  }
  return {
    nights: measured.length,
    averageMin: measured.length ? total / measured.length : null,
    totalMin: total,
    longest,
    coverage: { measured: measured.length, elapsed: elapsedDays(win), unit: 'day' },
  }
}

/** The `/sleep` window that catches every night ending inside `win`. */
export function sleepQueryWindow(win: PeriodWindow): { from: string; to: string } {
  return { from: isoDay(addDays(new Date(win.start), -1)), to: win.to }
}

// --- Workouts -----------------------------------------------------------------

export type PeriodWorkouts = {
  /** Sessions — recordings of one session by two devices count once. */
  sessions: number
  /** Recordings that were folded into another session's row. */
  extraRecordings: number
  /** Total length of the sessions that HAVE an end time. */
  durationMin: number
  durationKnown: number
  /** `null` when not one session carried a distance — not 0 km. */
  distanceM: number | null
  longest: Workout | null
  farthest: Workout | null
  activities: { type: string; count: number }[]
}

/**
 * The period's workouts (`PeriodSummary.workoutSummary`).
 *
 * ⚠️ **One deliberate difference from the phone: duplicates count once.** The
 * phone counts what HealthKit hands it; the web already folds two recordings of
 * one session (watch + a third-party app) into one row on the Workouts page
 * (`groupSessions`), and a summary that counted them twice would disagree with
 * the list it summarises. The figures below are the primary recordings'.
 */
export function workoutSummary(items: Workout[], win: PeriodWindow): PeriodWorkouts {
  const inWindow = items.filter((w) => {
    const ms = startMs(w)
    return !Number.isNaN(ms) && ms >= win.start && ms < win.end
  })
  const groups = groupSessions(inWindow)
  let duration = 0
  let durationKnown = 0
  let distance = 0
  let distanceKnown = 0
  let longest: Workout | null = null
  let longestMin = 0
  let farthest: Workout | null = null
  const counts = new Map<string, number>()

  for (const g of groups) {
    const w = g.primary
    const type = w.activity_type ?? 'other'
    counts.set(type, (counts.get(type) ?? 0) + 1)
    // A recording without an end did not last no time — it is left out of the
    // total rather than added as zero.
    const min = durationMin(w)
    if (min != null) {
      duration += min
      durationKnown += 1
      if (min > longestMin) {
        longestMin = min
        longest = w
      }
    }
    const m = w.total_distance_m
    if (m != null && m > 0) {
      distance += m
      distanceKnown += 1
      if (farthest == null || m > (farthest.total_distance_m ?? 0)) farthest = w
    }
  }

  return {
    sessions: groups.length,
    extraRecordings: inWindow.length - groups.length,
    durationMin: duration,
    durationKnown,
    // ⚠️ An indoor month is not a month of standing still.
    distanceM: distanceKnown > 0 ? distance : null,
    longest,
    farthest,
    // Most frequent first; on a tie the wire name decides, so the order is stable.
    activities: [...counts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => (a.count === b.count ? a.type.localeCompare(b.type) : b.count - a.count)),
  }
}

// --- Medals -------------------------------------------------------------------

/**
 * Whether a medal belongs to the period (`PeriodSummary.belongs`). A year keeps
 * its months' medals too — they are part of the year's story.
 *
 * ⚠️ A medal with no period (a cumulative milestone) is left out on purpose: its
 * `earned_at` is the moment of the FIRST EVALUATION, not of the achievement — a
 * reinstalled phone stamps years of badges with one second — so it cannot be
 * assigned to a period honestly.
 */
export function belongs(a: Achievement, p: SummaryPeriod): boolean {
  if (!a.period) return false
  const id = periodId(p)
  return p.unit === 'year' ? a.period === id || a.period.startsWith(`${id}-`) : a.period === id
}

// --- Displaying a period total ------------------------------------------------

/** Above this many metres a total is read in kilometres. */
export const KILOMETRE_THRESHOLD = 1000
/** Above this many minutes a total is read in hours and minutes. */
export const HOUR_THRESHOLD = 120

/**
 * Decimals by magnitude — 5.23 km, 62.4 km, 1 512 km — the phone's
 * `TrendFormat.number` rule, rather than a fifth per-metric table.
 */
export function magnitudeDigits(v: number): number {
  const a = Math.abs(v)
  return a < 10 ? 2 : a < 100 ? 1 : 0
}

/**
 * A period total in a readable form (`PeriodValueFormat`).
 *
 * ⚠️ A year's sum is one or two orders of magnitude larger than a day's, and in
 * the wire unit it becomes unreadable: 1 512 340 m and 12 480 min are both
 * correct and both meaningless at a glance. Only the DISPLAY is converted; the
 * value underneath is untouched, and the conversion lives in one place.
 */
export function periodValue(
  value: number,
  unit: string,
  digits: number,
  f: Formatters,
): { value: string; unit: string } {
  if (unit === 'm' && Math.abs(value) >= KILOMETRE_THRESHOLD) {
    const km = value / 1000
    return { value: f.fmt(km, magnitudeDigits(km)), unit: 'km' }
  }
  if (unit === 'min' && Math.abs(value) >= HOUR_THRESHOLD) {
    return { value: f.duration(value), unit: '' }
  }
  return { value: f.fmt(value, digits), unit: f.unit(unit) }
}

/** The two parts joined: "1 512 km". */
export function periodMeasurement(value: number, unit: string, digits: number, f: Formatters): string {
  const p = periodValue(value, unit, digits, f)
  return p.unit ? `${p.value} ${p.unit}` : p.value
}

/** A signed change, converted on the absolute value — "−9.26 km", not "−9260".
 * A minus sign, not a hyphen: the hyphen gets lost next to the number. */
export function signedPeriodMeasurement(value: number, unit: string, digits: number, f: Formatters): string {
  if (value === 0) return '0'
  return `${value > 0 ? '+' : '−'}${periodMeasurement(Math.abs(value), unit, digits, f)}`
}
