// Sleep quality — DERIVED figures, not raw HealthKit data.
//
// ⚠️ There is no HealthKit field called "sleep quality" (docs/23 §5). What exists
// is the series of `sleepAnalysis` category segments; total sleep time, the stage
// proportions, the efficiency and the number of awakenings are all DERIVED from
// it. So they are computed here, from the segments `/v1/sleep` returns.

import type { SleepSegment } from '../api/types'
import { isAsleep } from './format'

/**
 * A gap longer than this starts a new sleep session.
 *
 * Grouping by calendar day is not an option: sleep runs across midnight, so the
 * segments before and after it would land on two different days, and every "day"
 * would hold the end of one night plus the beginning of the next — with roughly 24
 * hours of time in bed and a meaningless efficiency.
 */
const SESSION_GAP_MIN = 180

export type Night = {
  /** The day of waking (local time, ISO date) — this identifies the night. */
  key: string
  /** The start of the session (ISO) — a unique identifier and the sort key. */
  startedAt: string
  segments: SleepSegment[]
  /** Minutes spent asleep (every segment that is neither `awake` nor `inBed`). */
  asleepMin: number
  /** The time-in-bed window: from the start of the first segment to the end of the last. */
  inBedMin: number
  /** time asleep / time in bed — 0..1, or null when it makes no sense. */
  efficiency: number | null
  /** Awakenings: `awake` segments BETWEEN falling asleep and the final wake-up. */
  awakenings: number
  /** Stage → minutes. */
  stages: Record<string, number>
  onset?: string
  wakeUp?: string
}

export function segmentMinutes(s: SleepSegment): number {
  if (!s.started_at || !s.ended_at) return 0
  return (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000
}

/** The local date in ISO form — the calendar day is the one on the user's clock,
 * not the UTC one. */
function localDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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

  const stages: Record<string, number> = {}
  let asleepMin = 0
  for (const s of segments) {
    const m = segmentMinutes(s)
    const stage = s.stage ?? 'asleep'
    stages[stage] = (stages[stage] ?? 0) + m
    if (isAsleep(s.stage)) asleepMin += m
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

  const asleepSegs = segments.filter((s) => isAsleep(s.stage))
  const onset = asleepSegs[0]?.started_at
  const wakeUp = asleepSegs.at(-1)?.ended_at

  // Only wakefulness AFTER falling asleep and BEFORE the final wake-up counts as an
  // awakening — tossing and turning before falling asleep does not.
  const awakenings =
    onset && wakeUp
      ? segments.filter(
          (s) =>
            s.stage === 'awake' &&
            (s.started_at ?? '') >= onset &&
            (s.ended_at ?? '') <= wakeUp,
        ).length
      : 0

  return {
    key,
    startedAt,
    segments,
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
