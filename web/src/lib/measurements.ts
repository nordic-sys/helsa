// The Measurements page — the web's copy of the phone's Health tab card grid
// (`HelsaKit/Health/UI/HealthSection.swift`, `MetricGroupSectionView.swift`,
// `MetricSnapshot.swift`).
//
// # Sections come from the catalog, not from a hand list
//
// The phone paid for this lesson: until 2026-08-14 its Health tab had five
// hand-listed sections, and six of the catalog's ten groups existed only in the
// Trends picker — weeks of noise-exposure data went unnoticed because nobody
// opens a 120-item picker without knowing what to look for. So the sections here
// are `METRIC_GROUPS` minus the three nutrition groups (which have their own
// page), and the cards of a section are its catalog group — a metric added to
// `lib/metrics.ts` tomorrow lands on a card tomorrow. `measurements.test.ts`
// fails if that ever stops being true.
//
// Within a section, the phone's hand-picked partitions ("Daily movement",
// "Body temperature"…) are copied, with the same safety net: **a leftover group
// catches every metric not named**, so a curated list can never silently hide a
// new type.
//
// # Two kinds of metric are taken OUT of the grid, on purpose
//
//  - **Blood pressure.** Side by side as two ordinary cards, a systolic value
//    without its diastolic reads as a measurement and nobody notices the missing
//    half. `BloodPressureCard` renders them as one reading (`lib/bloodPressure.ts`).
//  - **The five gait series.** They are read against each other and against the
//    person's own four weeks, on one time axis (`lib/gait.ts`); five loose cards
//    would be the Health app's view again.
//
// Both are an explicit allowlist (`BESPOKE`), and the test pins it — the same
// shape as the phone's `HealthSectionTests` allowlist.
//
// # Honest-data rules this file encodes
//
//  - Unmeasured is not zero: a day without a bucket is `null` in the sparkline,
//    never `0`, and a type that never arrived has no headline at all.
//  - The latest value carries its age, and a latest value older than the span on
//    screen is flagged rather than shown as if it belonged to it.
//  - No trend arrow and no verdict. The card shows the number, its time, the
//    shape of the span, and the person's own usual range; it does not say which
//    way is good.

import type { LatestValue } from '../api/types'
import type { UiKey } from '../i18n'
import { BLOOD_PRESSURE_KEYS } from './bloodPressure'
import { GAIT_KEYS, addDays } from './gait'
import { METRIC_GROUPS, METRIC_LIST, type MetricAgg, type MetricDef, type MetricGroupKey, type ReadSeries } from './metrics'
import { isoDay } from './window'

/** The groups the Nutrition page owns — macros, minerals and vitamins need to be
 * read in the same view, so the phone collapses them into one bespoke section. */
export const NUTRITION_GROUPS: ReadonlySet<MetricGroupKey> = new Set(['macro', 'mineral', 'vitamin'])

/** The sections of the page, in catalog order. */
export const SECTIONS: MetricGroupKey[] = METRIC_GROUPS.map((g) => g.key).filter((g) => !NUTRITION_GROUPS.has(g))

/** Types a bespoke card owns, and the ONLY types allowed to be missing from the grid. */
export const BESPOKE: ReadonlySet<string> = new Set([...BLOOD_PRESSURE_KEYS, ...GAIT_KEYS])

type Curated = { title: UiKey; metrics: string[] }

/**
 * The phone's hand-picked partitions (`HealthSection.curatedGroups`), filtered
 * to the types the web catalog knows. Every list must be a subset of its own
 * catalog group — a stray type would show twice. The test checks it.
 */
const CURATED: Partial<Record<MetricGroupKey, Curated[]>> = {
  // Cut by what somebody opens the section for: the daily numbers first, then
  // the energy, then the sport-specific tails that are empty for anybody who
  // does not do that sport.
  activity: [
    {
      title: 'meas.sub.dailyMovement',
      metrics: ['stepCount', 'distanceWalkingRunning', 'flightsClimbed', 'appleExerciseTime', 'appleMoveTime', 'appleStandTime'],
    },
    { title: 'meas.sub.energy', metrics: ['activeEnergy', 'basalEnergyBurned', 'physicalEffort'] },
    {
      title: 'meas.sub.distancesBySport',
      metrics: ['distanceCycling', 'distanceSwimming', 'distanceWheelchair', 'distanceDownhillSnowSports', 'pushCount', 'swimmingStrokeCount'],
    },
  ],
  // The catalog calls this group "body composition", but three temperatures live
  // in it too — under that heading they would be mislabelled.
  body: [
    { title: 'meas.sub.composition', metrics: ['bodyMass', 'bodyMassIndex', 'bodyFatPercentage', 'leanBodyMass'] },
    { title: 'meas.sub.proportions', metrics: ['waistCircumference', 'height'] },
    { title: 'meas.sub.temperature', metrics: ['bodyTemperature', 'basalBodyTemperature', 'appleSleepingWristTemperature'] },
  ],
  // Walking, stairs and running form come from different sensors in different
  // situations, and for most people two of the three are permanently empty. The
  // five gait series are on their own card (`BESPOKE`); six-minute walk stays.
  mobility: [
    { title: 'meas.sub.walking', metrics: ['sixMinuteWalkTestDistance'] },
    { title: 'meas.sub.stairs', metrics: ['stairAscentSpeed', 'stairDescentSpeed'] },
    {
      title: 'meas.sub.runningForm',
      metrics: ['runningSpeed', 'runningPower', 'runningStrideLength', 'runningVerticalOscillation', 'runningGroundContactTime'],
    },
  ],
  // ⚠️ Nothing in this section is a warning. The page shows the exposure it was
  // given; there is no threshold, no colour and no word that implies one.
  environment: [
    {
      title: 'meas.sub.sound',
      metrics: ['environmentalAudioExposure', 'headphoneAudioExposure', 'environmentalSoundReduction'],
    },
    { title: 'meas.sub.daylight', metrics: ['timeInDaylight', 'uvExposure'] },
  ],
}

/** The leftover's heading when curated groups stand above it. */
const LEFTOVER_TITLE: Partial<Record<MetricGroupKey, UiKey>> = {
  activity: 'meas.sub.moreActivity',
  body: 'meas.sub.moreBody',
  mobility: 'meas.sub.moreMovement',
  environment: 'meas.sub.moreEnvironment',
}

export type CardGroup = {
  /** `null`: the group IS the section (no curated groups), so it needs no heading
   * of its own under the section's. */
  title: UiKey | null
  metrics: MetricDef[]
}

/**
 * How a section's metrics are cut into card groups (`HealthSection.cardGroups`):
 * the curated partition, minus the bespoke types, plus a leftover that catches
 * everything not named. Empty groups are dropped.
 */
export function cardGroups(group: MetricGroupKey): CardGroup[] {
  const inGroup = METRIC_LIST.filter((d) => d.group === group)
  const byKey = new Map(inGroup.map((d) => [d.key, d]))
  const curated = CURATED[group] ?? []
  const claimed = new Set<string>(BESPOKE)
  const result: CardGroup[] = []
  for (const spec of curated) {
    const metrics = spec.metrics
      .filter((k) => !BESPOKE.has(k))
      .map((k) => byKey.get(k))
      .filter((d): d is MetricDef => d != null)
    for (const d of metrics) claimed.add(d.key)
    if (metrics.length > 0) result.push({ title: spec.title, metrics })
  }
  const leftover = inGroup.filter((d) => !claimed.has(d.key))
  if (leftover.length > 0) {
    result.push({ title: curated.length > 0 ? (LEFTOVER_TITLE[group] ?? 'meas.sub.more') : null, metrics: leftover })
  }
  return result
}

/** Every curated list, for the subset test. */
export const CURATED_FOR_TEST = CURATED

/** Every wire name the page asks the server about — keys and aliases, the
 * bespoke types included, nutrition excluded. */
export const PAGE_WIRE_NAMES: string[] = METRIC_LIST.filter((d) => !NUTRITION_GROUPS.has(d.group)).flatMap((d) => [
  d.key,
  ...d.aliases,
])

// --- The headline ---------------------------------------------------------------

/**
 * The newest `/latest` entry among a metric's wire names (`activeEnergy` and
 * `activeEnergyBurned` are one metric). Newest wins: an alias still being written
 * beats a name that stopped.
 */
export function pickLatest(def: MetricDef, metrics?: Record<string, LatestValue>): LatestValue | undefined {
  if (!metrics) return undefined
  let best: LatestValue | undefined
  for (const n of [def.key, ...def.aliases]) {
    const lv = metrics[n]
    if (lv && (!best || Date.parse(lv.ts) > Date.parse(best.ts))) best = lv
  }
  return best
}

/**
 * What the card leads with.
 *
 *  - `sample` — an averaged type's latest reading, at its own instant.
 *  - `dayTotal` — a summed type's latest day; `partial` when that day is today,
 *    because a day still in progress is not a day's total.
 *  - `noFigure` — a summed type arrived but the server could not total its day:
 *    the time is known, the number is not, and no zero is put in its place.
 *  - `bucket` — the fallback for a server without `/latest`: the last measured
 *    daily bucket of the 30-day window (the phone's `MetricSnapshot.latest`).
 *  - `none` — nothing ever arrived (or, on the fallback, nothing in 30 days).
 */
export type Headline =
  | { kind: 'sample'; value: number; at: string; day: string }
  | { kind: 'dayTotal'; value: number; day: string; partial: boolean }
  | { kind: 'noFigure'; at: string; day: string }
  | { kind: 'bucket'; value: number; day: string; agg: MetricAgg; partial: boolean }
  | { kind: 'none' }

export function headlineFromLatest(lv: LatestValue | undefined, today: string): Headline {
  if (!lv) return { kind: 'none' }
  if (lv.value != null) return { kind: 'sample', value: lv.value, at: lv.ts, day: lv.day }
  if (lv.day_total != null) return { kind: 'dayTotal', value: lv.day_total, day: lv.day, partial: lv.day === today }
  return { kind: 'noFigure', at: lv.ts, day: lv.day }
}

/** The older-server fallback: the last MEASURED daily bucket. Missing buckets
 * do not shift it — three silent days make the measurement before them the
 * latest, not a zero. */
export function headlineFromSeries(read: ReadSeries, today: string): Headline {
  for (let i = read.points.length - 1; i >= 0; i--) {
    const p = read.points[i]
    if (p.value == null) continue
    const day = isoDay(new Date(p.t))
    return { kind: 'bucket', value: p.value, day, agg: read.effectiveAgg, partial: day === today }
  }
  return { kind: 'none' }
}

/** The local day a headline belongs to, or `null` when there is none. */
export function headlineDay(h: Headline): string | null {
  return h.kind === 'none' ? null : h.day
}

/** Whole calendar days from `day` to `today` (0 = today). */
export function daysOld(day: string, today: string): number {
  const [y1, m1, d1] = day.split('-').map(Number)
  const [y2, m2, d2] = today.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000)
}

// --- The span and the sparkline ---------------------------------------------------

export type Span = 'week' | 'month' | 'year'
export const SPANS: Span[] = ['week', 'month', 'year']

/**
 * The first day the span covers — the same windows `/summary` cuts for `week`,
 * `month` and `year` (7 days, 30 days, the 12 calendar months to this one).
 */
export function spanStart(span: Span, today: string): string {
  if (span === 'week') return addDays(today, -6)
  if (span === 'month') return addDays(today, -29)
  const [y, m] = today.split('-').map(Number)
  return isoDay(new Date(y, m - 1 - 11, 1))
}

/**
 * Is the latest value older than the span on screen? Then the sparkline is empty
 * for a reason the card must name — "nothing in this span, the latest is from
 * March" — instead of sitting there blank beside a number that looks current.
 */
export function outsideSpan(h: Headline, span: Span, today: string): boolean {
  const day = headlineDay(h)
  return day != null && day < spanStart(span, today)
}

export type SparkPoint = { key: string; value: number | null }

const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

/**
 * The span's buckets, EVERY one of them, with `null` where nothing was measured.
 *
 * ⚠️ The server sends only the buckets that had a measurement; drawing just
 * those would turn a month with three measured days into a three-day chart. The
 * missing days are the information.
 *
 * Week and month come from ONE daily series (the 30-day `/summary`): the week is
 * its last seven days. The year is a separate monthly series.
 */
export function sparkPoints(read: ReadSeries | undefined, span: Span, today: string): SparkPoint[] {
  const byKey = new Map<string, number>()
  for (const p of read?.points ?? []) {
    if (p.value == null || !p.t) continue
    const d = new Date(p.t)
    byKey.set(span === 'year' ? ym(d) : isoDay(d), p.value)
  }
  const out: SparkPoint[] = []
  if (span === 'year') {
    const [y, m] = today.split('-').map(Number)
    for (let i = 11; i >= 0; i--) {
      const key = ym(new Date(y, m - 1 - i, 1))
      out.push({ key, value: byKey.get(key) ?? null })
    }
    return out
  }
  const start = spanStart(span, today)
  for (let day = start; day <= today; day = addDays(day, 1)) out.push({ key: day, value: byKey.get(day) ?? null })
  return out
}

/** Points with no measured neighbour — drawn as a dot, or they would vanish
 * from a line that has nothing to connect them to. */
export function isolatedKeys(points: SparkPoint[]): Set<string> {
  const out = new Set<string>()
  points.forEach((p, i) => {
    if (p.value == null) return
    const prev = points[i - 1]?.value
    const next = points[i + 1]?.value
    if (prev == null && next == null) out.add(p.key)
  })
  return out
}

/**
 * The y domain: the measured values AND the band, padded — a band outside the
 * domain would be clipped into a sliver that looks like a reading. Summed
 * metrics start at zero (bars); averaged ones float, because a resting heart rate
 * pinned to zero flattens 52 → 58 into a straight line.
 */
export function yDomain(
  points: SparkPoint[],
  band: { low: number; high: number } | null,
  agg: MetricAgg,
): [number, number] | null {
  const values = points.map((p) => p.value).filter((v): v is number => v != null)
  if (band) values.push(band.low, band.high)
  if (values.length === 0) return null
  let lo = Math.min(...values)
  let hi = Math.max(...values)
  if (agg === 'sum') lo = Math.min(0, lo)
  if (hi === lo) {
    const pad = Math.abs(hi) * 0.05 || 1
    return [agg === 'sum' ? lo : lo - pad, hi + pad]
  }
  const pad = (hi - lo) * 0.1
  return [agg === 'sum' ? lo : lo - pad, hi + pad]
}

// --- Which cards are shown ----------------------------------------------------------

/**
 * Whether a metric has anything at all. Either source is enough: the
 * availability probe (a year of `/summary`, shared with every picker) or a
 * `/latest` entry — which also knows about a type last written two years ago.
 */
export function hasAnyData(def: MetricDef, has: (key: string) => boolean, latest?: Record<string, LatestValue>): boolean {
  return has(def.key) || pickLatest(def, latest) != null
}
