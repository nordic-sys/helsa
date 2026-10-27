// Year by year — the web's copy of the phone's long view.
//
// Ported from `HelsaKit/Sources/HelsaKit/Retrospective/` (`RetrospectiveEngine.swift`,
// `RetrospectiveYear.swift`, `RetrospectiveSelection.swift`); `longView.test.ts`
// mirrors `HelsaKit/Tests/HelsaKitTests/RetrospectiveTests.swift`.
//
// # Why this is worth having on the web at all
//
// On the phone the long view is a thing a person has to PRESS: five years read
// out of HealthKit, year by year, with a progress bar and a stop button, because
// it costs battery on a device in somebody's hand (`RetrospectiveViewModel`:
// "nothing here starts on its own"). On the server the same answer is one query
// over rows that are already there. So the web drops the button, the progress
// bar and the cache — and keeps every rule about what a year may claim.
//
// # ⚠️ One request, not five
//
// The phone asks `/summary` once per year (`range: "year"`, one calendar year's
// `from`/`to`), because a year is the unit it can stop between. The server has
// no such reason: `range` sets only the bucket WIDTH (`summary.window()`), and
// `from`/`to` may span as many years as asked — so five years of monthly buckets
// come back in a single response, and are split by year here. Five round trips
// over WireGuard to fetch what one returns would be the browser hammering the
// server for nothing. `backend/internal/summary/summary_test.go` pins that the
// window really does stretch.

import type { SummaryResponse } from '../api/types'
import { coverageVerdict } from './compare'
import { METRIC_LIST, METRICS, pickSeries, readSeries, type MetricAgg, type MetricDef, type MetricGroupKey } from './metrics'
import { bucketKey, isoDay } from './window'

// --- The limits (`RetrospectiveLimits`) ---------------------------------------

/**
 * How many calendar years back it looks, at most.
 *
 * ⚠️ A bound on the work, not a promise about the data: whether five years of
 * measurements exist is a question about the person's history, and
 * `measuredYears` is what answers it. Kept at the phone's five so the two
 * devices answer the same question — the server could afford more, and the
 * owner may want it (see the report that came with this page).
 */
export const MAX_YEARS = 5

/**
 * A year needs at least this many measured months before it is compared with
 * another.
 *
 * ⚠️ Two months of a year is not a year. Without this, the first year anyone
 * owned a watch — bought in November, worn twice — would stand beside a full
 * one as though the two were the same kind of fact.
 */
export const MIN_MEASURED_MONTHS = 3

// --- The window ---------------------------------------------------------------

/** The calendar years covered, newest first. */
export function yearsBack(now: Date): number[] {
  const y = now.getFullYear()
  return Array.from({ length: MAX_YEARS }, (_, i) => y - i)
}

/**
 * The one window the page asks for: January 1st of the oldest year, to TODAY.
 *
 * ⚠️ Clipped to today, like the phone's `RetrospectiveEngine.window`: months that
 * have not happened come back as empty buckets, and an empty bucket counted
 * into the running year's average would drag it down as though the person had
 * stopped moving in the autumn. (Empty buckets are not sent at all, so here the
 * clip is about not ASKING; the average below is over measured months anyway.)
 */
export function longViewWindow(now: Date): { from: string; to: string } {
  const oldest = yearsBack(now)[MAX_YEARS - 1]
  return { from: `${oldest}-01-01`, to: isoDay(now) }
}

/** How many months of `year` have begun by `now` — 12 for a finished year. */
export function elapsedMonths(year: number, now: Date): number {
  const y = now.getFullYear()
  if (year < y) return 12
  if (year > y) return 0
  return now.getMonth() + 1
}

// --- One metric, year by year -------------------------------------------------

/** One metric's figure for one calendar year (`RetrospectiveMetricYear`). */
export type YearFigure = {
  year: number
  /**
   * The average MONTH for a summed metric, the average level for an averaged
   * one — over the measured months only. `null` below `MIN_MEASURED_MONTHS`.
   *
   * ⚠️ **The average month, not the year's total — the decision that makes the
   * page honest.** A year's step total beside a part-year's says only that one
   * of them is shorter. The average month is comparable between a full year and
   * the ten months of the current one, and the count beside it says how much to
   * trust it. ⚠️ And not divided further into a day: that would invent a daily
   * figure out of months of unequal length.
   */
  value: number | null
  measuredMonths: number
  elapsedMonths: number
  /** The year still running — never put beside full ones without saying so. */
  isPartial: boolean
}

export type LongViewRow = {
  def: MetricDef
  /** What the RECEIVED data carries (`readSeries`), not what the catalogue intended. */
  agg: MetricAgg
  /** The server's unit wins, as everywhere (`ReadSeries.unit`). */
  unit: string
  /** A summed metric the server answered with averages only — the page must say so. */
  degraded: boolean
  /** Newest first, one per year of `yearsBack`. */
  years: YearFigure[]
}

/**
 * Splits one multi-year response into rows of years.
 *
 * The year a bucket belongs to is read on the LOCAL clock (`bucketKey`): the
 * server stamps a Budapest January as `…-12-31T23:00:00Z`, and slicing the
 * string would hand that month to the previous year.
 */
export function buildRows(defs: MetricDef[], resp: SummaryResponse | undefined, now: Date): LongViewRow[] {
  const years = yearsBack(now)
  return defs.map((def) => {
    const series = readSeries(def, pickSeries(def, resp?.metrics))
    const byYear = new Map<number, number[]>()
    for (const p of series.points) {
      if (p.value == null) continue
      const ms = new Date(p.t).getTime()
      if (Number.isNaN(ms)) continue
      const year = Number(bucketKey(ms, 'year').slice(0, 4))
      const list = byYear.get(year)
      if (list) list.push(p.value)
      else byYear.set(year, [p.value])
    }
    return {
      def,
      agg: series.effectiveAgg,
      unit: series.unit,
      degraded: series.degraded,
      years: years.map((year) => {
        const values = byYear.get(year) ?? []
        const measured = values.length
        return {
          year,
          value: measured >= MIN_MEASURED_MONTHS ? values.reduce((s, v) => s + v, 0) / measured : null,
          measuredMonths: measured,
          elapsedMonths: elapsedMonths(year, now),
          isPartial: year === now.getFullYear(),
        }
      }),
    }
  })
}

/**
 * The years that actually carried a figure, oldest first — the span the page
 * may CLAIM (`Retrospective.measuredYears`).
 *
 * ⚠️ This is what the page prints, never the span it asked for. A watch three
 * years old answers a five-year question with two empty years, and printing
 * "five years" over them would be a promise the data cannot keep.
 */
export function measuredYears(rows: LongViewRow[]): number[] {
  const out = new Set<number>()
  for (const r of rows) for (const y of r.years) if (y.value != null) out.add(y.year)
  return [...out].sort((a, b) => a - b)
}

/** "2023–2026" / "2026" / `null` when nothing was measured. */
export function spanText(years: number[]): string | null {
  if (years.length === 0) return null
  const first = Math.min(...years)
  const last = Math.max(...years)
  return first === last ? String(first) : `${first}–${last}`
}

/**
 * The columns to draw: from the first measured year up to THIS year, oldest
 * first.
 *
 * Years before the first measurement are left off (they would be a claim about
 * a history that does not exist); this year is always on, even below the
 * threshold, so January says "two months — too few" instead of the column
 * silently vanishing.
 */
export function columnYears(rows: LongViewRow[], now: Date): number[] {
  const measured = measuredYears(rows)
  if (measured.length === 0) return []
  const first = measured[0]
  const out: number[] = []
  for (let y = first; y <= now.getFullYear(); y++) out.push(y)
  return out
}

export type YearChange = {
  /** Fraction, first measured year → last. */
  ratio: number
  from: number
  to: number
  /**
   * The two years' measured shares differ by more than half (`lib/compare.ts`).
   *
   * ⚠️ The figure is still shown: an average month is an AVERAGE, and an average
   * over fewer months is noisier, not biased by the count — the same line
   * `coverageVerdict` draws for Trends. The page prints the coverage beside it.
   */
  uneven: boolean
}

/**
 * How a metric moved from the first measured year to the last
 * (`Retrospective.change`). `null` with fewer than two measured years, or when
 * the first sat at zero.
 */
export function change(row: LongViewRow): YearChange | null {
  const measured = row.years.filter((y) => y.value != null).sort((a, b) => a.year - b.year)
  if (measured.length < 2) return null
  const first = measured[0]
  const last = measured[measured.length - 1]
  if (first.value === 0 || first.value == null || last.value == null) return null
  const verdict = coverageVerdict(
    { measured: last.measuredMonths, total: last.elapsedMonths },
    { measured: first.measuredMonths, total: first.elapsedMonths },
  )
  return { ratio: (last.value - first.value) / first.value, from: first.year, to: last.year, uneven: verdict === 'uneven' }
}

// --- The selection (`RetrospectiveSelection`) ----------------------------------

/**
 * What the "Recommended" button ticks — the phone's eight, word for word.
 *
 * Each earns its place by being worth comparing ACROSS YEARS: the slow movers
 * (fitness, resting heart rate, body mass) and the two that show effort.
 *
 * ⚠️ **Sleep is deliberately absent.** It does not come from `/summary` at all —
 * it has its own endpoint and its own arithmetic — so a sleep row here would be
 * permanently, silently empty. It is not in the catalogue this page picks from
 * either, for the same reason.
 */
export const RECOMMENDED: string[] = [
  'stepCount',
  'restingHeartRate',
  'hrv',
  'vo2Max',
  'bodyMass',
  'activeEnergy',
  'appleExerciseTime',
  'respiratoryRate',
]

/**
 * Where the choice is kept.
 *
 * ⚠️ localStorage, per browser, and only the CHOICE — metric names, no figures.
 * The phone mirrors its choice through iCloud and keeps its result on the
 * device; the web has no result to keep (the server recomputes it on every
 * open), and the choice is a per-viewer convenience, so it stays where the
 * language and the map source already live.
 */
export const SELECTION_KEY = 'helsa.longView.selection'

/**
 * The stored choice, or the recommendation.
 *
 * ⚠️ Never touched, unreadable, or empty all resolve to the RECOMMENDATION, not
 * to an empty set (`RetrospectiveViewModel.init`): an empty long view would be a
 * page whose whole content is nothing. Names the catalogue no longer knows are
 * dropped rather than drawn as blank rows.
 */
export function loadSelection(): string[] {
  try {
    const raw = localStorage.getItem(SELECTION_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        const known = parsed.filter((k): k is string => typeof k === 'string' && k in METRICS)
        if (known.length > 0) return orderByCatalogue(known)
      }
    }
  } catch {
    /* blocked storage or a corrupt value — the recommendation stands */
  }
  return [...RECOMMENDED]
}

export function saveSelection(keys: string[]): void {
  try {
    localStorage.setItem(SELECTION_KEY, JSON.stringify(keys))
  } catch {
    /* the choice still holds for this visit */
  }
}

/** Catalogue order — the order every row and every picker lists them in. */
export function orderByCatalogue(keys: Iterable<string>): string[] {
  const set = new Set(keys)
  return METRIC_LIST.filter((d) => set.has(d.key)).map((d) => d.key)
}

export function toggle(selection: string[], key: string): string[] {
  return selection.includes(key)
    ? selection.filter((k) => k !== key)
    : orderByCatalogue([...selection, key])
}

export function keysIn(group: MetricGroupKey): string[] {
  return METRIC_LIST.filter((d) => d.group === group).map((d) => d.key)
}

export function isFullySelected(selection: string[], group: MetricGroupKey): boolean {
  const inGroup = keysIn(group)
  return inGroup.length > 0 && inGroup.every((k) => selection.includes(k))
}

export function selectedCount(selection: string[], group: MetricGroupKey): number {
  return keysIn(group).filter((k) => selection.includes(k)).length
}

/**
 * Ticks a whole group, or clears it if it was already whole.
 *
 * ⚠️ Partly selected counts as NOT selected, so the first click on a half-ticked
 * group fills it rather than emptying it: the other way round would throw away
 * choices made one by one, the more annoying mistake to undo.
 */
export function toggleGroup(selection: string[], group: MetricGroupKey): string[] {
  const inGroup = keysIn(group)
  if (isFullySelected(selection, group)) return selection.filter((k) => !inGroup.includes(k))
  return orderByCatalogue([...selection, ...inGroup])
}

export function selectAll(): string[] {
  return METRIC_LIST.map((d) => d.key)
}

export function isRecommended(selection: string[]): boolean {
  return selection.length === RECOMMENDED.length && RECOMMENDED.every((k) => selection.includes(k))
}

/** Every wire name to ask for: each key and its aliases (`activeEnergyBurned`…). */
export function wireNames(selection: string[]): string[] {
  return selection.flatMap((k) => {
    const d = METRICS[k]
    return d ? [d.key, ...d.aliases] : [k]
  })
}
