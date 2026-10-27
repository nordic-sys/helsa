// The printable health summary — the decisions, without React.
//
// The web's copy of the phone's clinical report (`HelsaKit/Sources/HelsaKit/
// Report/`): `ReportWindow.swift` (the period), `ReportBaseline.swift` (the
// person's own usual range), `ReportChange.swift` (what moved since the period
// before) and the metric-row half of `ReportContent.swift`. The page that lays
// it out is `pages/Report.tsx`; everything a test should be able to reach lives
// here, for the reason the phone gives in `ReportContent.swift`: this page is
// read by a doctor, without the app anywhere near it, with the authority print
// quietly lends to whatever is on it.
//
// # What is ported exactly, and what is the web's own
//
// Exactly, constant for constant: the four offered lengths, the 365-day
// baseline that contains the period, the 10th–90th percentile band with its
// 14-day minimum and R-7 interpolation, the previous period read out of the
// baseline series, its 7-day minimum, the 5% floor and the three-line cap, and
// the unsigned ranking. A doctor holding the phone's printout and this one
// must not find two answers to one question.
//
// The web's own, and only one: **a change is withheld when the two periods were
// measured on very different shares of their days** (`lib/compare.ts`). The
// phone's 7-day minimum already refuses a comparison built from two mornings;
// it does not refuse 30 measured days against 8, which compares a month with a
// week and a bit. The web has stated that rule on every page that compares two
// periods, and the page a doctor reads is the last place to drop it. A withheld
// change is NAMED on the page, not silently left out (see `withheldChange`).
//
// # ⛔️ What this file may NOT become
//
// The same line `ReportBaseline.swift` draws: the band never carries a verdict.
// There is no `isWithin`, no `status`, no colour here — nothing a page could
// render a judgement from. And `ReportChange` compares the person's period with
// their own previous period, never with the band.

import type { SummaryResponse, Workout } from '../api/types'
import { coverageVerdict } from './compare'
import { pickSeries, readSeries, type MetricDef } from './metrics'
import { isoDay } from './window'
import { durationMin, groupSessions, startMs } from './workouts'

// --- The period (`ReportWindow.swift`) ----------------------------------------

/**
 * The periods offered (`ReportWindows.offeredDays`). Deliberately short: a
 * doctor's question is almost always "how has it been lately", and a picker of
 * eleven options is a decision the user did not ask to make.
 */
export const REPORT_DAYS = [30, 90, 180, 365] as const
export type ReportDays = (typeof REPORT_DAYS)[number]

/** The phone's default (`ClinicalReportViewModel.days`). */
export const DEFAULT_REPORT_DAYS: ReportDays = 90

/**
 * The metrics on a report nobody has configured (`ReportMetricSelection.
 * defaultTypes`).
 *
 * ⚠️ **A starting point, not a recommendation** — the phone's words. The app
 * cannot know what the appointment is about, which is why the page lets the
 * reader choose; the default only spares the common case one round of clicking,
 * and blood pressure is on it because that is the case the feature was built for.
 */
export const DEFAULT_REPORT_METRICS = [
  'bloodPressureSystolic',
  'bloodPressureDiastolic',
  'restingHeartRate',
  'bodyMass',
  'oxygenSaturation',
  'stepCount',
]

/**
 * One report's window. Calendar days on the reader's own clock — the same
 * zone `/summary` is asked in (`browserTz()`).
 */
export type ReportWindow = {
  /** How many days it covers, the last day included. */
  days: number
  /** `YYYY-MM-DD`, the `from` of `/summary`. */
  from: string
  /** `YYYY-MM-DD`, the **last included** day — the `to`. */
  to: string
  /** Local midnight of the first day (ms). */
  start: number
  /** **Exclusive** end: local midnight of the day after `to` (ms). */
  end: number
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

function windowOf(first: Date, last: Date, days: number): ReportWindow {
  return {
    days,
    from: isoDay(first),
    to: isoDay(last),
    start: first.getTime(),
    end: addDays(last, 1).getTime(),
  }
}

/**
 * The last `days` days, **today included** (`ReportWindows.window`).
 *
 * ⚠️ Built from the local date parts, not by subtracting 86 400 000 ms: a
 * window that crosses a daylight-saving change would otherwise start an hour
 * off midnight, and its first day would belong to the day before.
 */
export function reportWindow(days: number, now: Date): ReportWindow {
  const span = Math.max(Math.round(days), 1)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return windowOf(addDays(today, -(span - 1)), today, span)
}

/**
 * The window the usual range is read from (`ReportWindows.baseline`): a longer
 * stretch that ends on the same last day.
 *
 * ⚠️ It deliberately **contains the report period itself**, and the page says
 * so. A baseline taken strictly before the period would turn the usual range
 * into an implicit before/after comparison — one short step from a claim that
 * something changed. And it is never shorter than the period: a usual computed
 * from less data than the period would be the smaller sample explaining the
 * larger one.
 */
export function baselineWindow(win: ReportWindow, days: number = BASELINE_WINDOW_DAYS): ReportWindow {
  const span = Math.max(days, win.days)
  if (span <= win.days) return win
  const last = new Date(win.end)
  const lastDay = addDays(last, -1)
  return windowOf(addDays(lastDay, -(span - 1)), lastDay, span)
}

// --- The usual range (`ReportBaseline.swift`) ---------------------------------
//
// ⛔️ NOT A REFERENCE RANGE. NOT A NORMAL RANGE. NOT A LIMIT. A description of
// the person's own recorded values and nothing else: the middle 80% of their own
// daily values over the baseline window. Percentiles rather than mean ± σ,
// because an order statistic assumes no distribution and is a value that
// actually occurred. (The dashboard's band is the server's mean ± σ over 60 days
// — `GET /baseline` — and it is a different statement for a different page; the
// report's band is the phone's, so both printouts say the same thing.)

/**
 * How many measured days the baseline needs before we say anything
 * (`ReportBaseline.minDays` = `InsightThresholds.minBaselineDays`).
 */
export const BASELINE_MIN_DAYS = 14

/**
 * How far back the usual is read from (`ReportBaseline.windowDays`). A year,
 * because several metrics a doctor asks about are measured sporadically — blood
 * pressure, body mass — and a 90-day window would rarely hold enough of them.
 */
export const BASELINE_WINDOW_DAYS = 365

/** The middle 80% — not min–max, which one mis-typed entry would define. */
export const LOW_PERCENTILE = 0.1
export const HIGH_PERCENTILE = 0.9

export type ReportBand = {
  /** The 10th percentile of the person's own daily values. */
  low: number
  /** The 90th. */
  high: number
  /** The middle — printed beside the band, because a band alone does not say
   * where inside it the ordinary day sits. */
  median: number
  /** How many measured days it rests on. **Printed**: a band from 18 days and
   * one from 340 are not the same statement. */
  dayCount: number
}

/**
 * The linearly interpolated percentile of an **already sorted** array — the
 * "R-7" definition (Excel's `PERCENTILE.INC`, NumPy's default), as
 * `ReportBaseline.percentile` computes it. Interpolated rather than nearest
 * rank: with 20 days the nearest-rank 90th percentile jumps in visible steps as
 * days are added, and two reports printed a week apart would show a band that
 * moved for no reason the reader could see.
 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]
  const rank = (sorted.length - 1) * Math.min(Math.max(p, 0), 1)
  const lower = Math.floor(rank)
  const upper = Math.ceil(rank)
  if (upper >= sorted.length) return sorted[sorted.length - 1]
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower)
}

/**
 * The band of a series of daily values, or `null` below the data minimum —
 * and `null` is then **printed as words**, never as an empty cell
 * (`ReportMetricRow.usualNote`): a blank column reads as "nothing unusual",
 * when the truth is that we did not look.
 *
 * @param values the MEASURED daily values. A missing day must not arrive as a
 *   zero: a zero-step day that never happened would drag the band down, and no
 *   reader of the page could spot it.
 */
export function makeBand(values: number[]): ReportBand | null {
  if (values.length < BASELINE_MIN_DAYS) return null
  const sorted = [...values].sort((a, b) => a - b)
  return {
    low: percentile(sorted, LOW_PERCENTILE),
    high: percentile(sorted, HIGH_PERCENTILE),
    median: percentile(sorted, 0.5),
    dayCount: sorted.length,
  }
}

// --- What moved (`ReportChange.swift`) ----------------------------------------

/** The movement of one metric between two adjacent periods of equal length. */
export type ReportChange = {
  /** The daily average over the report window. */
  current: number
  /** The daily average over the period immediately before it, same length. */
  previous: number
  /** How many days of the previous period carried a measurement. */
  previousDays: number
}

export function changeDelta(c: ReportChange): number {
  return c.current - c.previous
}

/**
 * The signed relative change (`0.07` = +7%). `null` when the previous period sat
 * at zero — there is no meaningful percentage of nothing, the rule
 * `TrendComparison.ratio` keeps.
 */
export function changeRatio(c: ReportChange): number | null {
  if (c.previous === 0) return null
  return changeDelta(c) / c.previous
}

/**
 * How far it moved, used only to RANK. Unsigned on purpose: a fall and a rise of
 * the same size are equally interesting to a reader who has not been told which
 * direction is good — and ranking rises first would be the page deciding.
 */
export function changeMagnitude(c: ReportChange): number {
  return Math.abs(changeRatio(c) ?? 0)
}

/**
 * How many days of the previous period must carry a measurement
 * (`ReportChanges.minPreviousDays`). Without it, a previous period of two
 * measured mornings would produce a confident "62 → 41 bpm".
 */
export const MIN_PREVIOUS_DAYS = 7

/**
 * Below this relative movement we say nothing (`ReportChanges.minRelativeChange`).
 * A resting heart rate from 58.2 to 58.6 did not change; printing it would teach
 * the reader that these lines mean nothing.
 */
export const MIN_RELATIVE_CHANGE = 0.05

/**
 * How many lines the block may take (`ReportChanges.maxLines`). This is where
 * the reader's eye lands first; eight movements is not an opening, it is
 * another table.
 */
export const MAX_CHANGE_LINES = 3

/** One measured day: the value the band and the averages are made of. */
export type DayPoint = {
  /** Local midnight of the day (ms). */
  ms: number
  value: number
  /** The bucket's own extremes — for an averaged metric the min/max of the
   * individual measurements that day. `null` for a summed one. */
  min: number | null
  max: number | null
}

/**
 * The measured days of one metric out of a `/summary` answer.
 *
 * ⚠️ Only the buckets that carry a value. An absent bucket is a day nothing
 * arrived, and it has to stay absent — never a zero (`readSeries` keeps the same
 * distinction from the wire).
 */
export function dayPoints(def: MetricDef, summary: SummaryResponse | null | undefined): {
  points: DayPoint[]
  unit: string
  agg: 'sum' | 'avg'
  degraded: boolean
} {
  const read = readSeries(def, pickSeries(def, summary?.metrics))
  const points: DayPoint[] = []
  for (const p of read.points) {
    if (p.value == null) continue
    const ms = Date.parse(p.t)
    if (Number.isNaN(ms)) continue
    points.push({
      ms,
      value: p.value,
      // A summed bucket's min/max (if a server ever sent one) are single samples,
      // not days — the page's "extremes" of a cumulative metric are the daily
      // totals' (`ReportContent.provenanceLines`).
      min: read.effectiveAgg === 'avg' ? p.min : null,
      max: read.effectiveAgg === 'avg' ? p.max : null,
    })
  }
  points.sort((a, b) => a.ms - b.ms)
  return { points, unit: read.unit, agg: read.effectiveAgg, degraded: read.degraded }
}

/**
 * The previous period's daily average, taken from the **baseline** series
 * (`ReportChanges.previous`) — no query of its own: the baseline window already
 * holds the period before the report window, as long as twice the window fits
 * in a year, which is true for every offered length but the longest.
 *
 * @returns `null` when there is no baseline, when the previous period is not
 *   inside it, or when fewer than `MIN_PREVIOUS_DAYS` of its days carry data.
 */
export function previousAverage(
  baseline: DayPoint[] | null,
  win: ReportWindow,
  base: ReportWindow | null,
): { average: number; days: number } | null {
  if (!baseline || !base) return null
  const previousStart = addDays(new Date(win.start), -win.days).getTime()
  // ⚠️ The phone gets this for free: its baseline series simply has no points
  // before its own start. Ours could (a test double, a server that answers a
  // wider window than asked), so the boundary is stated: a previous period that
  // reaches before the baseline window is not covered by it, and a 365-day
  // report must not be compared with whatever fortnight happens to be there.
  if (previousStart < base.start) return null
  const values = baseline.filter((p) => p.ms >= previousStart && p.ms < win.start).map((p) => p.value)
  if (values.length < MIN_PREVIOUS_DAYS) return null
  return { average: values.reduce((s, v) => s + v, 0) / values.length, days: values.length }
}

/**
 * The rows whose change goes under the header: the biggest movers, by size,
 * at most three (`ReportChanges.summaryLines`). Ordered by movement rather than
 * by the table's order, because the space is capped: if only three fit, they
 * should be the three a reader would have asked about.
 */
export function topChanges<T extends { change: ReportChange | null }>(rows: T[]): (T & { change: ReportChange })[] {
  return rows
    .filter((r): r is T & { change: ReportChange } => r.change != null && changeMagnitude(r.change) >= MIN_RELATIVE_CHANGE)
    .map((r, i) => ({ r, i }))
    // Stable on a tie, so the page does not reshuffle between two prints.
    .sort((a, b) => changeMagnitude(b.r.change) - changeMagnitude(a.r.change) || a.i - b.i)
    .slice(0, MAX_CHANGE_LINES)
    .map((x) => x.r)
}

/** "+7%" / "−12%" / "0%" — `TrendFormat.signedPercent`, a minus sign and not a
 * hyphen. */
export function signedPercent(ratio: number): string {
  const percent = Math.round(ratio * 100)
  if (percent > 0) return `+${percent}%`
  if (percent < 0) return `−${Math.abs(percent)}%`
  return '0%'
}

/**
 * One change line (`ReportChanges.line`). Both numbers are printed, not just
 * the difference: a doctor cannot use "+4 bpm" without knowing whether it moved
 * from 54 or from 84.
 *
 * ⚠️ The unit rides on the SECOND number only — "58 bpm → 62 bpm" repeats a word
 * the reader already has.
 *
 * @param template `{name}: {from} → {to}` with an optional ` ({pct})` — the
 *   sentence belongs to the dictionary, the numbers to this function.
 */
export function changeLine(
  name: string,
  unit: string,
  c: ReportChange,
  num: (v: number) => string,
  templates: { withPercent: string; withoutPercent: string },
): string {
  const from = num(c.previous)
  const to = unit ? `${num(c.current)} ${unit}` : num(c.current)
  const ratio = changeRatio(c)
  const template = ratio == null ? templates.withoutPercent : templates.withPercent
  const pct = ratio == null ? '' : signedPercent(ratio)
  return template.replace('{name}', name).replace('{from}', from).replace('{to}', to).replace('{pct}', pct)
}

/**
 * Decimals by magnitude (`TrendFormat.fractionDigits`): 8 432 · 62.4 · 1.23,
 * and an exact zero is "0".
 */
export function reportDigits(v: number): number {
  if (v === 0) return 0
  const a = Math.abs(v)
  return a >= 100 ? 0 : a >= 10 ? 1 : 2
}

// --- Units on paper (`ReportUnit.swift`) --------------------------------------

/**
 * Where the wire unit alone would be ambiguous or bare on paper. The same
 * `count/min` is heartbeats for a heart rate and breaths for a respiratory rate;
 * "/min" beside a number is not a unit to a reader who has never seen the app.
 * The value is the dictionary key's last segment (`report.unit.*`).
 */
export type ReportUnitWord = 'bpm' | 'breaths' | 'steps' | 'floors' | 'mmHg' | 'minutes'

const UNIT_BY_METRIC: Record<string, ReportUnitWord | { raw: string }> = {
  heartRate: 'bpm',
  restingHeartRate: 'bpm',
  walkingHeartRateAverage: 'bpm',
  respiratoryRate: 'breaths',
  stepCount: 'steps',
  flightsClimbed: 'floors',
  bloodPressureSystolic: 'mmHg',
  bloodPressureDiastolic: 'mmHg',
  hrv: { raw: 'ms' },
  oxygenSaturation: { raw: '%' },
  bodyFatPercentage: { raw: '%' },
  bodyMass: { raw: 'kg' },
  leanBodyMass: { raw: 'kg' },
  bodyTemperature: { raw: '°C' },
  basalBodyTemperature: { raw: '°C' },
  appleSleepingWristTemperature: { raw: '°C' },
  bodyMassIndex: { raw: '' },
  appleExerciseTime: 'minutes',
  appleStandTime: 'minutes',
  appleMoveTime: 'minutes',
}

/**
 * The unit to print beside a value of this metric (`ReportUnit.label`): a word
 * to translate, or a token that reads the same in both languages. Anything not
 * worth spelling out falls through to the web's own unit table — a future unit
 * should show up raw rather than disappear.
 */
export function reportUnit(key: string, wire: string): { word: ReportUnitWord } | { raw: string } | { wire: string } {
  const special = UNIT_BY_METRIC[key]
  if (special) return typeof special === 'string' ? { word: special } : special
  switch (wire) {
    case 'count':
    case '':
      return { raw: '' }
    case 'mmHg':
      return { word: 'mmHg' }
    case 'min':
      return { word: 'minutes' }
    default:
      return { wire }
  }
}

// --- One measurement row (`ReportContent.row`) --------------------------------

export type ReportRow = {
  key: string
  def: MetricDef
  /** The wire unit the numbers are in (what the server sent, or the catalog's). */
  wireUnit: string
  /** The average of the measured days. `null` = **not one measurement** — the
   * page prints "no measurement", never a 0 and never a bare dash. */
  average: number | null
  /** Lowest and highest of the period, only when they differ. */
  extremes: { low: number; high: number } | null
  /** The most recent measurement and its day — the number the doctor usually
   * asked about, which a period average hides. */
  latest: { value: number; ms: number } | null
  /** The usual range. `null` = not enough of the person's own data. */
  band: ReportBand | null
  /** How many measured days the band WOULD have rested on — the number the
   * "little data (n days)" note prints when there is no band. */
  bandSourceDays: number
  /** For a summed metric, the period total the daily average hides. `null` for
   * an averaged one, where a "sum of resting heart rates" means nothing. */
  total: number | null
  measuredDays: number
  periodDays: number
  /** The movement since the previous period, or `null` (no baseline, too few
   * previous days, or withheld — see the next field). */
  change: ReportChange | null
  /**
   * A change the phone's rules would have printed, held back by the web's
   * coverage rule (`lib/compare.ts`): the two periods were measured on very
   * different shares of their days. Kept so the page can NAME it — a block that
   * silently lost a line would read as "nothing else moved".
   */
  withheldChange: (ReportChange & { currentDays: number }) | null
  /** The catalog sums this type but the server sent only averages — the daily
   * figures are per-sample averages, and the page must say so. */
  degraded: boolean
}

/**
 * Builds one row. **Pure** — this is what the tests pin down.
 *
 * @param baseline the `/summary` answer for the baseline window. `null` = the
 *   usual range is read from the report period itself (a weaker statement, and
 *   the honesty block's day count says which it is), and there is no change.
 */
export function buildRow(
  def: MetricDef,
  summary: SummaryResponse | null | undefined,
  baseline: SummaryResponse | null | undefined,
  win: ReportWindow,
  base: ReportWindow | null,
): ReportRow {
  const cur = dayPoints(def, summary)
  // Only the days inside the window: a server answering a wider window than
  // asked must not leak days into the period's own figures.
  const measured = cur.points.filter((p) => p.ms >= win.start && p.ms < win.end)
  const values = measured.map((p) => p.value)
  const average = values.length ? values.reduce((s, v) => s + v, 0) / values.length : null

  // The extremes: the individual measurements' for an averaged metric, the
  // daily figures' otherwise — which of the two, the honesty block says once.
  const lows = measured.map((p) => p.min ?? p.value)
  const highs = measured.map((p) => p.max ?? p.value)
  const low = lows.length ? Math.min(...lows) : null
  const high = highs.length ? Math.max(...highs) : null
  const extremes = low != null && high != null && high > low ? { low, high } : null

  const last = measured[measured.length - 1]
  const latest = last ? { value: last.value, ms: last.ms } : null

  const basePoints = baseline ? dayPoints(def, baseline).points : null
  const bandPoints = basePoints && base ? basePoints.filter((p) => p.ms >= base.start && p.ms < base.end) : measured
  const band = makeBand(bandPoints.map((p) => p.value))

  const total = cur.agg === 'sum' && values.length ? values.reduce((s, v) => s + v, 0) : null

  let change: ReportChange | null = null
  let withheldChange: ReportRow['withheldChange'] = null
  if (average != null) {
    const prev = previousAverage(basePoints, win, baseline ? base : null)
    if (prev) {
      const c = { current: average, previous: prev.average, previousDays: prev.days }
      const verdict = coverageVerdict(
        { measured: values.length, total: win.days },
        { measured: prev.days, total: win.days },
      )
      if (verdict === 'comparable') change = c
      // Only worth naming if the phone's rules would have PRINTED it — a
      // withheld 1% movement is not a line anybody lost.
      else if (changeMagnitude(c) >= MIN_RELATIVE_CHANGE) withheldChange = { ...c, currentDays: values.length }
    }
  }

  return {
    key: def.key,
    def,
    wireUnit: cur.unit,
    average,
    extremes,
    latest,
    band,
    bandSourceDays: bandPoints.length,
    total,
    measuredDays: values.length,
    periodDays: win.days,
    change,
    withheldChange,
    degraded: cur.degraded,
  }
}

// --- Workouts (`ReportContent.maxWorkouts`) -----------------------------------

/**
 * How many workout rows the page lists at most. Not what fits on a sheet — the
 * browser paginates — but a bound on how much a reader can be handed at once
 * (the phone's reasoning since `ReportPagination`). What is over it is named in
 * a sentence, not dropped.
 */
export const MAX_REPORT_WORKOUTS = 40

export type ReportWorkouts = {
  /** The sessions listed, oldest first — at most `MAX_REPORT_WORKOUTS`, the
   * most recent ones. */
  shown: Workout[]
  /** Sessions in the window, a second device's recording of the same session
   * counted once (`groupSessions`, as the Workouts page does). */
  sessions: number
  /** The recordings folded into an already counted session. Said in a
   * sentence, because a count that silently differs from the phone's is a
   * count nobody can check. */
  extraRecordings: number
  /** Total minutes over the sessions that have an end. */
  durationMin: number
  durationKnown: number
  /** ⚠️ `null`, not 0, when no session carried a distance: an indoor month is
   * not a month of standing still (`ReportContent.workoutTotal`). */
  distanceM: number | null
}

export function reportWorkouts(items: Workout[], win: ReportWindow): ReportWorkouts {
  const inWindow = items.filter((w) => {
    const ms = startMs(w)
    return !Number.isNaN(ms) && ms >= win.start && ms < win.end
  })
  const primaries = groupSessions(inWindow)
    .map((g) => g.primary)
    .sort((a, b) => startMs(a) - startMs(b))
  let durationMinTotal = 0
  let durationKnown = 0
  let distance = 0
  let distanceKnown = 0
  for (const w of primaries) {
    const min = durationMin(w)
    if (min != null) {
      durationMinTotal += min
      durationKnown += 1
    }
    if (w.total_distance_m != null && w.total_distance_m > 0) {
      distance += w.total_distance_m
      distanceKnown += 1
    }
  }
  return {
    shown: primaries.slice(-MAX_REPORT_WORKOUTS),
    sessions: primaries.length,
    extraRecordings: inWindow.length - primaries.length,
    durationMin: durationMinTotal,
    durationKnown,
    distanceM: distanceKnown > 0 ? distance : null,
  }
}

// --- The address ----------------------------------------------------------------

/**
 * `?d=90&m=bloodPressureSystolic,restingHeartRate` → the report's choices. The
 * report is a link, so the page that is printed next month can be the same one.
 *
 * ⚠️ An absent `m` is the default set; a PRESENT but empty one is "nothing
 * chosen", and the page then asks for a measurement (the phone's "Choose at
 * least one measurement.") rather than quietly putting the defaults back.
 * Unknown keys are dropped — a catalog key that no longer exists is not a
 * metric the page can name.
 */
export function parseReportParams(
  params: URLSearchParams,
  known: (key: string) => boolean,
): { days: ReportDays; metrics: string[] } {
  const d = Number(params.get('d'))
  const days = (REPORT_DAYS as readonly number[]).includes(d) ? (d as ReportDays) : DEFAULT_REPORT_DAYS
  const raw = params.get('m')
  if (raw == null) return { days, metrics: [...DEFAULT_REPORT_METRICS] }
  const metrics: string[] = []
  for (const k of raw.split(',')) {
    const key = k.trim()
    if (key && known(key) && !metrics.includes(key)) metrics.push(key)
  }
  return { days, metrics }
}
