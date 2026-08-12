// Sleep quality — DERIVED figures, not raw HealthKit data.
//
// ⚠️ There is no HealthKit field called "sleep quality" (docs/23 §5). What exists
// is the series of `sleepAnalysis` category segments; total sleep time, the stage
// proportions, the efficiency and the number of awakenings are all DERIVED from
// it. So they are computed here, from the segments `/v1/sleep` returns.
//
// ⚠️ And the segments OVERLAP each other. `inBed` wraps the whole night, and
// since a second source (the watch beside the phone) began writing stages too,
// two sources describe the same night at their own boundaries. Adding up the raw
// lengths therefore gives roughly one and a half times the sleep time — which is
// why everything below is computed from the FLATTENED slices, never from the raw
// segments.
//
// The rules are the same three the phone (`HelsaKit/.../SleepAnalysis.swift`) and
// the backend (`backend/internal/sleep`) follow, and they have to stay the same:
// a night must not be one length on the dashboard and another on the phone.

import type { SleepSegment } from '../api/types'

/**
 * A gap longer than this starts a new sleep session.
 *
 * Grouping by calendar day is not an option: sleep runs across midnight, so the
 * segments before and after it would land on two different days, and every "day"
 * would hold the end of one night plus the beginning of the next — with roughly 24
 * hours of time in bed and a meaningless efficiency.
 */
const SESSION_GAP_MIN = 180

/** The normalized stages. The display names of these live in `i18n/*.ts`. */
export type Stage = 'deep' | 'rem' | 'core' | 'asleep' | 'awake' | 'inBed'

/**
 * Conflict resolution for overlapping stages — the SMALLER number wins.
 *
 * `awake` beats every sleep stage: if one source saw wakefulness, claiming deep
 * sleep in its place would be wrong in the more flattering direction, and
 * overestimating sleep is the worse error. `inBed` loses to everything, because
 * it is an envelope and not a measurement.
 */
const PRIORITY: Record<Stage, number> = {
  awake: 0,
  deep: 1,
  rem: 2,
  core: 3,
  asleep: 4,
  inBed: 5,
}

const ASLEEP: Record<Stage, boolean> = {
  deep: true,
  rem: true,
  core: true,
  asleep: true,
  awake: false,
  inBed: false,
}

/**
 * The raw `stage` string of `/v1/sleep` → a normalized stage.
 *
 * The database holds the same stage under two spellings: the HealthKit-flavoured
 * `asleepCore`/`asleepDeep`/`asleepREM` next to the short legacy
 * `core`/`deep`/`rem`. Anything unrecognized comes back as `null` — it stays
 * visible in the raw list below the night, but it does not silently become sleep.
 */
export function normalizeStage(raw?: string): Stage | null {
  switch ((raw ?? '').toLowerCase()) {
    case 'asleepdeep':
    case 'deep':
      return 'deep'
    case 'asleeprem':
    case 'rem':
      return 'rem'
    case 'asleepcore':
    case 'core':
    case 'asleeplight':
    case 'light':
      return 'core'
    case 'asleep':
    case 'asleepunspecified':
    case 'unspecified':
      return 'asleep'
    case 'awake':
    case 'awakened':
      return 'awake'
    case 'inbed':
    case 'in_bed':
      return 'inBed'
    default:
      return null
  }
}

/** A slice of the flattened timeline: disjoint, in milliseconds since the epoch. */
export type Slice = { start: number; end: number; stage: Stage }

export type Night = {
  /** The day of waking (local time, ISO date) — this identifies the night. */
  key: string
  /** The start of the session (ISO) — a unique identifier and the sort key. */
  startedAt: string
  /** The RAW segments, as they arrived — the "raw data" list is built from these. */
  segments: SleepSegment[]
  /** The overlap-free timeline. Every derived figure below comes from this. */
  slices: Slice[]
  /** How much the raw segments covered each other — the difference between the
   * naive sum and the truth. */
  overlapMin: number
  /** Minutes spent asleep: the UNION of the sleep slices, so an overlap counts once. */
  asleepMin: number
  /** The time-in-bed window: from the start of the first segment to the end of the last. */
  inBedMin: number
  /** time asleep / time in bed — 0..1, or null when it makes no sense. */
  efficiency: number | null
  /** Awakenings: `awake` slices BETWEEN falling asleep and the final wake-up. */
  awakenings: number
  /** Stage → minutes, from the flattened slices. */
  stages: Record<string, number>
  onset?: string
  wakeUp?: string
}

export function segmentMinutes(s: SleepSegment): number {
  if (!s.started_at || !s.ended_at) return 0
  return (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000
}

export function sliceMinutes(s: Slice): number {
  return (s.end - s.start) / 60000
}

/** The local date in ISO form — the calendar day is the one on the user's clock,
 * not the UTC one. */
function localDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Overlapping segments → DISJOINT slices.
 *
 * Every segment boundary is a cut point; between two neighbouring cut points
 * exactly one stage wins (see `PRIORITY`), and neighbouring slices of the same
 * stage are merged, so the hypnogram does not fall apart at invisible cuts.
 */
export function flatten(segments: SleepSegment[]): { slices: Slice[]; overlapMin: number } {
  const spans = segments
    .map((s) => ({
      start: s.started_at ? new Date(s.started_at).getTime() : NaN,
      end: s.ended_at ? new Date(s.ended_at).getTime() : NaN,
      stage: normalizeStage(s.stage),
    }))
    .filter((s): s is Slice => s.stage != null && s.end > s.start)

  if (spans.length === 0) return { slices: [], overlapMin: 0 }

  const cuts = [...new Set(spans.flatMap((s) => [s.start, s.end]))].sort((a, b) => a - b)
  const slices: Slice[] = []
  for (let i = 0; i + 1 < cuts.length; i++) {
    const [from, to] = [cuts[i], cuts[i + 1]]
    const covering = spans.filter((s) => s.start <= from && s.end >= to)
    if (covering.length === 0) continue // a gap: no stage reaches here
    const winner = covering.reduce((best, s) =>
      PRIORITY[s.stage] < PRIORITY[best.stage] ? s : best,
    ).stage

    const last = slices.at(-1)
    if (last && last.stage === winner && last.end === from) last.end = to
    else slices.push({ start: from, end: to, stage: winner })
  }

  const raw = spans.reduce((sum, s) => sum + (s.end - s.start), 0)
  const union = slices.reduce((sum, s) => sum + (s.end - s.start), 0)
  return { slices, overlapMin: Math.max(0, raw - union) / 60000 }
}

/**
 * Threads the segments into sleep sessions (nights): a continuous run of segments
 * is one night, and a gap longer than `SESSION_GAP_MIN` closes it. A daytime nap
 * therefore shows up as its own entry, instead of bleeding into the previous
 * night.
 */
export function groupByNight(segments: SleepSegment[], gapMin = SESSION_GAP_MIN): Night[] {
  const sorted = segments
    .filter((s) => s.started_at && s.ended_at)
    .sort((a, b) => a.started_at!.localeCompare(b.started_at!))

  const sessions: SleepSegment[][] = []
  let current: SleepSegment[] = []
  let lastEnd = 0
  for (const s of sorted) {
    const start = new Date(s.started_at!).getTime()
    const end = new Date(s.ended_at!).getTime()
    if (current.length > 0 && start - lastEnd > gapMin * 60_000) {
      sessions.push(current)
      current = []
      lastEnd = 0
    }
    current.push(s)
    lastEnd = Math.max(lastEnd, end)
  }
  if (current.length > 0) sessions.push(current)

  return sessions.map(analyseNight).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

function analyseNight(input: SleepSegment[]): Night {
  const segments = [...input].sort((a, b) =>
    (a.started_at ?? '').localeCompare(b.started_at ?? ''),
  )
  const startedAt = segments[0]?.started_at ?? ''
  const lastEnd = segments
    .map((s) => s.ended_at)
    .filter((x): x is string => !!x)
    .sort()
    .at(-1)
  const key = lastEnd ? localDate(lastEnd) : localDate(startedAt)

  const { slices, overlapMin } = flatten(segments)

  const stages: Record<string, number> = {}
  let asleepMin = 0
  for (const s of slices) {
    const m = sliceMinutes(s)
    stages[s.stage] = (stages[s.stage] ?? 0) + m
    if (ASLEEP[s.stage]) asleepMin += m
  }

  // Time in bed is the whole spanning interval, not the sum of the segments: the
  // gap between two segments is time in bed too, and that is precisely what drags
  // efficiency down.
  const starts = segments.map((s) => s.started_at).filter((x): x is string => !!x)
  const ends = segments.map((s) => s.ended_at).filter((x): x is string => !!x)
  const inBedMin =
    starts.length && ends.length
      ? (Math.max(...ends.map((e) => new Date(e).getTime())) -
          Math.min(...starts.map((s) => new Date(s).getTime()))) /
        60000
      : 0

  const asleepSlices = slices.filter((s) => ASLEEP[s.stage])
  const onset = asleepSlices[0] ? new Date(asleepSlices[0].start).toISOString() : undefined
  const wakeUp = asleepSlices.at(-1) ? new Date(asleepSlices.at(-1)!.end).toISOString() : undefined

  // Only wakefulness AFTER falling asleep and BEFORE the final wake-up counts as an
  // awakening — tossing and turning before falling asleep does not.
  const awakenings =
    asleepSlices.length > 0
      ? slices.filter(
          (s) =>
            s.stage === 'awake' &&
            s.start >= asleepSlices[0].start &&
            s.end <= asleepSlices.at(-1)!.end,
        ).length
      : 0

  return {
    key,
    startedAt,
    segments,
    slices,
    overlapMin,
    asleepMin,
    inBedMin,
    efficiency: inBedMin > 0 ? Math.min(asleepMin / inBedMin, 1) : null,
    awakenings,
    stages,
    onset,
    wakeUp,
  }
}

export type SleepAverages = {
  nights: number
  asleepMin: number | null
  efficiency: number | null
  awakenings: number | null
  /** The share of deep + REM within total sleep time. */
  deepRemShare: number | null
}

export function averages(nights: Night[]): SleepAverages {
  if (nights.length === 0) {
    return { nights: 0, asleepMin: null, efficiency: null, awakenings: null, deepRemShare: null }
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  const totalAsleep = nights.reduce((s, n) => s + n.asleepMin, 0)
  const deepRem = nights.reduce((s, n) => s + (n.stages.deep ?? 0) + (n.stages.rem ?? 0), 0)
  return {
    nights: nights.length,
    asleepMin: mean(nights.map((n) => n.asleepMin)),
    efficiency: mean(
      nights.map((n) => n.efficiency).filter((x): x is number => x != null),
    ),
    awakenings: mean(nights.map((n) => n.awakenings)),
    deepRemShare: totalAsleep > 0 ? deepRem / totalAsleep : null,
  }
}
