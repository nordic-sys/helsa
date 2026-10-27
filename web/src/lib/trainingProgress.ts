// "How am I getting on with training" — the web's copy of the phone's
// `WorkoutProgress`, `WorkoutVitalSeries` and the zone line's segmenting
// (HelsaKit/Sources/HelsaKit/WorkoutProgress/WorkoutProgress.swift,
// WorkoutVitalsTrend.swift, WorkoutProgressView.swift `intensitySegments`).
//
// # Why a copy, value for value
//
// Same reason as `workouts.ts`: these are counts the two surfaces must agree
// on. "In 41 of the 52 weeks there was a session" on the phone and 43 on the web
// would be two answers to one question with nothing to say which is right. So
// the three rules below are the phone's, each with a test in
// `trainingProgress.test.ts` that mirrors a Swift test by name:
//
// 1. **A week without a workout is a gap, not a zero that disappears.** It stays
//    in `weeks` with `sessions === 0` and DOES count in the per-week average and
//    in the typical week — a rest week is part of how often somebody trains
//    (Bob's decision of 2026-10-13).
// 2. **The current week is not over.** It is `isPartial` and kept out of every
//    average, the typical week and the longest break.
// 3. **One session is one session.** Recordings are folded by `groupSessions`
//    first — the web's copy of `WorkoutDuplicates`, the same fold the Workouts
//    list uses — so a watch and a gym machine recording one session count once.
//
// What it deliberately does NOT do (the phone's file header, docs/31): no
// combined score, no advice. It counts what Health already holds.
//
// ⚠️ All date arithmetic is in the reader's LOCAL calendar, and the first day of
// the week comes from the region (`firstWeekday()` in `window.ts`), never a
// hard-coded Monday: the difference silently moves a Sunday run into the wrong
// week.

import type { MetricSeries, Workout } from '../api/types'
import { groupSessions, startMs, type WorkoutGroup } from './workouts'

/** Below this many complete weeks there is no "typical week" — two weeks is a
 * coin toss presented as a habit. */
export const MINIMUM_WEEKS_FOR_TYPICAL = 3

/** The spans the page offers, in weeks — the phone's `Span`. */
export const SPANS = [4, 12, 52] as const
export type Span = (typeof SPANS)[number]

/** The three colours of the weekly bars. A display grouping, not a judgement: a
 * walk is "cardio" because it moves the heart rate, not because it is training. */
export type Category = 'strength' | 'cardio' | 'other'
export const CATEGORIES: Category[] = ['strength', 'cardio', 'other']

/** The phone's `WorkoutActivityCategory(activityType:)`, key for key. ⚠️ Exact
 * keys only — `strengthTraining` is "other" on the phone too. */
export function categoryOf(activityType?: string): Category {
  switch (activityType) {
    case 'strength':
      return 'strength'
    case 'running':
    case 'cycling':
    case 'swimming':
    case 'hiking':
    case 'walking':
    case 'hiit':
      return 'cardio'
    default:
      return 'other'
  }
}

export type TrainingWeek = {
  /** Local midnight of the week's first day, epoch ms. */
  start: number
  /** Sessions that STARTED in this week. */
  sessions: number
  /** Training time; only sessions with an end count. */
  seconds: number
  isPartial: boolean
  /** Time at or above zone 3 over the sessions that had a heart rate. `null` =
   * the week had sessions and NONE was measured (unknown, not zero); a rest week
   * is `0` — nothing was done, so nothing was hard. */
  intenseSeconds: number | null
  measuredSessions: number
  categorySessions: Record<Category, number>
}

export type RestStreak = { firstWeek: number; lastWeek: number; weeks: number }

export type ActivityShare = { activityType: string; sessions: number; seconds: number }

export type TypicalWeek = {
  sessions: number
  seconds: number
  weeks: number
  /** Median over the weeks where it is known (rest weeks are 0, unmeasured
   * weeks are left out); `null` below `MINIMUM_WEEKS_FOR_TYPICAL` such weeks. */
  intenseSeconds: number | null
}

export type TrainingProgress = {
  /** Oldest first; the last one may be the current, partial week. */
  weeks: TrainingWeek[]
  activities: ActivityShare[]
  typicalWeek: TypicalWeek | null
  /** Every session in the window, the current week's included. */
  totalSessions: number
  totalSeconds: number
  /** "In 41 of the 52 weeks" — complete weeks only. */
  activeWeeks: number
  elapsedWeeks: number
  /** Sessions per complete week, rest weeks included; `null` = none complete. */
  sessionsPerWeek: number | null
  /** The longest run of finished rest weeks; `null` if every finished week had one. */
  longestRest: RestStreak | null
  isEmpty: boolean
  /** The window `[start, end)` as epoch ms — the first week's start and the
   * start of the week after the last. */
  windowStart: number
  windowEnd: number
}

// --- Local calendar ----------------------------------------------------------

function addDays(ms: number, n: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime()
}

/** Local midnight of the first day of the week `ms` falls in. */
export function weekStartOf(ms: number, firstDay: number): number {
  const d = new Date(ms)
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const back = (day.getDay() - firstDay + 7) % 7
  return addDays(day.getTime(), -back)
}

export function addWeeks(ms: number, n: number): number {
  return addDays(ms, n * 7)
}

/** `YYYY-MM-DD` → local midnight; anything after the date (a time, an offset)
 * is ignored — a daily bucket names a day in the zone it was cut in, the one
 * `tz` asked for. */
function localDay(t: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t)
  if (!m) return NaN
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
}

// --- Pieces ------------------------------------------------------------------

/** A session's length in seconds. No end, or an end before the start, is no
 * length — not a negative one (and not `null`: the week total counts it as 0,
 * as on the phone). */
export function durationSeconds(w: Workout): number {
  if (!w.ended_at) return 0
  const s = (new Date(w.ended_at).getTime() - startMs(w)) / 1000
  return Number.isFinite(s) ? Math.max(0, s) : 0
}

/** Zone-3+ seconds of a session, from whichever recording was measured — the
 * primary first, because it is the one the list shows. */
export function intenseSecondsOf(group: WorkoutGroup, intensity: Map<string, number>): number | null {
  for (const w of [group.primary, ...group.others]) {
    const v = w.id != null ? intensity.get(w.id) : undefined
    if (v != null) return v
  }
  return null
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 0) return 0
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/** The median week. Rest weeks are in it; a median rather than a mean, so one
 * training camp of ten sessions does not make every ordinary week look lazy. */
export function typical(complete: TrainingWeek[]): TypicalWeek | null {
  if (complete.length < MINIMUM_WEEKS_FOR_TYPICAL) return null
  const known = complete.map((w) => w.intenseSeconds).filter((v): v is number => v != null)
  return {
    sessions: median(complete.map((w) => w.sessions)),
    seconds: median(complete.map((w) => w.seconds)),
    weeks: complete.length,
    intenseSeconds: known.length >= MINIMUM_WEEKS_FOR_TYPICAL ? median(known) : null,
  }
}

export function longestRest(complete: TrainingWeek[]): RestStreak | null {
  let best: RestStreak | null = null
  let runStart: number | null = null
  let runLength = 0
  for (const week of complete) {
    if (week.sessions === 0) {
      if (runStart == null) runStart = week.start
      runLength += 1
      if (runLength > (best?.weeks ?? 0)) {
        best = { firstWeek: runStart, lastWeek: week.start, weeks: runLength }
      }
    } else {
      runStart = null
      runLength = 0
    }
  }
  return best
}

// --- Building ----------------------------------------------------------------

export type BuildOptions = {
  /** How many calendar weeks, the current one included. */
  weekCount: number
  /** Shifts the window into the past: `0` ends with the current week. */
  endingWeeksAgo?: number
  /** Zone-3+ seconds by workout id. A workout missing from it was not measured. */
  intensity?: Map<string, number>
  now: Date
  /** JavaScript weekday index of the week's first day (0 = Sunday). */
  firstDay: number
}

export function buildProgress(workouts: Workout[], opts: BuildOptions): TrainingProgress {
  const { weekCount, endingWeeksAgo = 0, intensity = new Map(), now, firstDay } = opts
  const nowMs = now.getTime()
  const thisWeek = weekStartOf(nowMs, firstDay)
  const lastWeek = addWeeks(thisWeek, -Math.max(0, endingWeeksAgo))
  const count = Math.max(0, Math.floor(weekCount))
  const starts = Array.from({ length: count }, (_, i) => addWeeks(lastWeek, i - count + 1))
  const windowStart = starts[0] ?? lastWeek
  const windowEnd = addWeeks(lastWeek, 1)

  // Rule 3: one session, one row.
  const sessions = groupSessions(workouts).filter((g) => {
    const s = startMs(g.primary)
    return s >= windowStart && s < windowEnd && s <= nowMs
  })

  const byWeek = new Map<number, WorkoutGroup[]>()
  for (const g of sessions) {
    const key = weekStartOf(startMs(g.primary), firstDay)
    const list = byWeek.get(key)
    if (list) list.push(g)
    else byWeek.set(key, [g])
  }

  const weeks: TrainingWeek[] = starts.map((start) => {
    const groups = byWeek.get(start) ?? []
    const measured = groups.map((g) => intenseSecondsOf(g, intensity)).filter((v): v is number => v != null)
    const categorySessions: Record<Category, number> = { strength: 0, cardio: 0, other: 0 }
    for (const g of groups) categorySessions[categoryOf(g.primary.activity_type)] += 1
    return {
      start,
      sessions: groups.length,
      seconds: groups.reduce((sum, g) => sum + durationSeconds(g.primary), 0),
      // Rule 2: the week containing `now` has not ended.
      isPartial: start === thisWeek,
      // A rest week is a known zero; a week of unmeasured sessions is unknown.
      intenseSeconds:
        groups.length === 0 ? 0 : measured.length === 0 ? null : measured.reduce((a, b) => a + b, 0),
      measuredSessions: measured.length,
      categorySessions,
    }
  })

  const shares = new Map<string, { sessions: number; seconds: number }>()
  for (const g of sessions) {
    const key = g.primary.activity_type ?? ''
    const s = shares.get(key) ?? { sessions: 0, seconds: 0 }
    s.sessions += 1
    s.seconds += durationSeconds(g.primary)
    shares.set(key, s)
  }
  const activities = [...shares.entries()]
    .map(([activityType, s]) => ({ activityType, ...s }))
    .sort(
      (a, b) =>
        b.seconds - a.seconds || b.sessions - a.sessions || a.activityType.localeCompare(b.activityType),
    )

  const complete = weeks.filter((w) => !w.isPartial)
  const totalSessions = weeks.reduce((s, w) => s + w.sessions, 0)
  return {
    weeks,
    activities,
    typicalWeek: typical(complete),
    totalSessions,
    totalSeconds: weeks.reduce((s, w) => s + w.seconds, 0),
    activeWeeks: complete.filter((w) => w.sessions > 0).length,
    elapsedWeeks: complete.length,
    sessionsPerWeek: complete.length
      ? complete.reduce((s, w) => s + w.sessions, 0) / complete.length
      : null,
    longestRest: longestRest(complete),
    isEmpty: totalSessions === 0,
    windowStart,
    windowEnd,
  }
}

/** Sessions in the window without a zone figure — "N workouts had no heart rate". */
export function unmeasuredSessions(p: TrainingProgress): number {
  return p.weeks.reduce((s, w) => s + (w.sessions - w.measuredSessions), 0)
}

/**
 * Whether the history reaches back far enough for the "compared with the
 * previous N weeks" line.
 *
 * ⚠️ The phone's guard: only when the oldest recording lies before the END of
 * the previous window's first week. Otherwise the weeks before the first
 * recorded workout count as rest weeks, and someone who started a month ago
 * reads "+1 h 40 min" against a year of zeros.
 */
export function canCompare(previous: TrainingProgress, workouts: Workout[]): boolean {
  if (!previous.typicalWeek || previous.weeks.length === 0) return false
  let oldest = Infinity
  for (const w of workouts) {
    const s = startMs(w)
    if (!Number.isNaN(s)) oldest = Math.min(oldest, s)
  }
  return oldest < addWeeks(previous.weeks[0].start, 1)
}

// --- Resting heart rate and HRV beside the weeks -------------------------------

export type VitalPoint = { weekStart: number; value: number }

/**
 * Daily buckets averaged per week of the window, oldest first, only the weeks
 * that have a measurement.
 *
 * Both are measured whether or not anybody trained, so unlike the training
 * chart there is no gap for a rest week — a week is missing only if the watch
 * recorded nothing in it. A daily value is an average; a server that sent `v`
 * instead is taken at its word rather than dropped (the phone does the same).
 */
export function weeklyVitals(
  series: MetricSeries | undefined,
  weekStarts: number[],
  firstDay: number,
): VitalPoint[] {
  const buckets = series?.buckets ?? []
  if (buckets.length === 0 || weekStarts.length === 0) return []
  const wanted = new Set(weekStarts)
  const sums = new Map<number, { total: number; count: number }>()
  for (const b of buckets) {
    const value = b.avg ?? b.v
    if (value == null || !b.t) continue
    const day = localDay(b.t)
    if (Number.isNaN(day)) continue
    const week = weekStartOf(day, firstDay)
    if (!wanted.has(week)) continue
    const s = sums.get(week) ?? { total: 0, count: 0 }
    s.total += value
    s.count += 1
    sums.set(week, s)
  }
  return weekStarts.flatMap((start) => {
    const s = sums.get(start)
    return s && s.count > 0 ? [{ weekStart: start, value: s.total / s.count }] : []
  })
}

/** Fewer than two weeks is not a trend. */
export function isUsable(points: VitalPoint[]): boolean {
  return points.length >= 2
}

/**
 * The zone line's segments: it breaks wherever a week has no figure — a rest
 * week or a week whose sessions had no heart rate — so no line is drawn across
 * weeks that were not measured. Returns the segment index per drawable week.
 */
export function intensitySegments(weeks: TrainingWeek[]): { week: TrainingWeek; segment: number }[] {
  let segment = 0
  let previousKnown = false
  const out: { week: TrainingWeek; segment: number }[] = []
  for (const week of weeks) {
    if (week.sessions === 0 || week.intenseSeconds == null) {
      if (previousKnown) segment += 1
      previousKnown = false
    } else {
      out.push({ week, segment })
      previousKnown = true
    }
  }
  return out
}

/** The grid's shade per session count — the phone's `WeekGrid.shade`. */
export function shade(sessions: number): number {
  if (sessions <= 0) return 0
  if (sessions === 1) return 0.28
  if (sessions === 2) return 0.55
  if (sessions === 3) return 0.8
  return 1
}
