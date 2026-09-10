// Sessions, months and the filter — the web's copy of the phone's
// `WorkoutDuplicates`, `WorkoutGrouping` and `WorkoutFilter`.
//
// # Why this is a copy and not an approximation
//
// One of these rules is arithmetic that the two surfaces MUST agree on. A
// session recorded by a watch and by a gym machine is one session; if the phone
// folds it into one row and the web shows two, the two screens disagree about
// how many times somebody ran, and about how many hours a month held. Neither
// screen says which one is right, so the web has to be right by construction —
// the constants and the comparison below are the phone's, value for value
// (`HelsaKit/Sources/HelsaKit/Workouts/WorkoutDuplicates.swift`).
//
// The rest — months, the filter — is copied for a weaker but still real reason:
// a person who knows the phone's Workouts tab should not have to learn a second
// idea of what "August" contains.
//
// ⚠️ **Nothing is thrown away.** The fold chooses what to SHOW; every recording
// stays in the group, is counted in `count`, and the row says out loud that it
// is standing for more than one.

import type { Workout } from '../api/types'

/** How much of the two spans **together** has to be shared: overlap ÷ union.
 *
 * ⚠️ Not "how much of the shorter one is covered", which is the obvious measure
 * and is wrong: a twenty-minute run inside a three-hour hike is covered
 * entirely, scores 1.0, and merges two completely separate workouts. Against the
 * union it scores 0.11, which is what it should be. */
export const MINIMUM_OVERLAP = 0.7

/** When neither recording has an end, only the starts can be compared. */
export const START_TOLERANCE_MS = 5 * 60 * 1000

/** Relative tolerance for "the same number" — tight on purpose. It is here for
 * rounding on one value, not for agreement between two sensors. */
export const NUMBER_TOLERANCE = 0.005

/** Below this many sessions the whole list stays open: collapsing three rows
 * into one heading is ceremony rather than help. */
export const SHORT_HISTORY = 20

export function startMs(w: Workout): number {
  return w.started_at ? new Date(w.started_at).getTime() : NaN
}

function endMs(w: Workout): number | null {
  return w.ended_at ? new Date(w.ended_at).getTime() : null
}

/** A workout's length in minutes, or `null` when it has no end.
 *
 * ⚠️ `null`, never `0`. A recording without an end did not last no time; we do
 * not know how long it lasted, and every caller below has to decide that for
 * itself rather than inherit a zero. */
export function durationMin(w: Workout): number | null {
  const start = startMs(w)
  const end = endMs(w)
  if (end == null || Number.isNaN(start)) return null
  const min = (end - start) / 60000
  return min > 0 ? min : null
}

/** One session, and every recording of it. */
export type WorkoutGroup = {
  /** The recording the row shows — the most complete one. */
  primary: Workout
  /** The other recordings of the same session, in the order they started. */
  others: Workout[]
  /** A stable key for React: the primary's id. */
  id: string
  /** How many recordings there are of this one session. */
  count: number
  /** Whether the others say the **same numbers** as the primary.
   *
   * The distinction is worth drawing on screen: two devices measuring one
   * session usually disagree a little, and that disagreement is worth knowing
   * about. Two rows that agree to the digit are a different thing — one session
   * that reached HealthKit by two routes, where there is nothing to compare. */
  identical: boolean
}

/** Whether two recordings are of the same session. */
export function isSameSession(a: Workout, b: Workout): boolean {
  if (a.id != null && a.id === b.id) return false
  if (a.activity_type !== b.activity_type) return false

  const aStart = startMs(a)
  const bStart = startMs(b)
  if (Number.isNaN(aStart) || Number.isNaN(bStart)) return false

  const aEnd = endMs(a)
  const bEnd = endMs(b)
  const startsMatch = Math.abs(aStart - bStart) <= START_TOLERANCE_MS
  // Without an end there is no span to intersect, so the starts carry it alone.
  if (aEnd == null || bEnd == null) return startsMatch
  const aLen = aEnd - aStart
  const bLen = bEnd - bStart
  // A zero- or negative-length recording cannot be judged by overlap.
  if (aLen <= 0 || bLen <= 0) return startsMatch

  const overlap = Math.min(aEnd, bEnd) - Math.max(aStart, bStart)
  if (overlap <= 0) return false
  const union = Math.max(aEnd, bEnd) - Math.min(aStart, bStart)
  if (union <= 0) return false
  return overlap / union >= MINIMUM_OVERLAP
}

/** ⚠️ A value present on one side and missing on the other is **not** the same
 * number. It is the most common shape of a real difference — one device measured
 * distance, the other did not — and calling those identical would hide it. */
function closeEnough(a?: number | null, b?: number | null): boolean {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  const scale = Math.max(Math.abs(a), Math.abs(b))
  if (scale === 0) return true
  return Math.abs(a - b) / scale <= NUMBER_TOLERANCE
}

function sameNumbers(a: Workout, b: Workout): boolean {
  return (
    closeEnough(durationMin(a), durationMin(b)) &&
    closeEnough(a.total_distance_m, b.total_distance_m) &&
    closeEnough(a.total_energy_kcal, b.total_energy_kcal)
  )
}

/** How much a recording has to say. The route is not on the list payload, so the
 * metadata is the closest a row can get to "this one carries extras". */
function completeness(w: Workout): number {
  let score = 0
  if (w.ended_at != null) score += 1
  if (w.total_distance_m != null) score += 1
  if (w.total_energy_kcal != null) score += 1
  if (w.avg_heart_rate != null) score += 1
  if (w.max_heart_rate != null) score += 1
  if (w.metadata && Object.keys(w.metadata).length > 0) score += 1
  return score
}

/** Which recording leads the group. The tie-breaks are there so the same list
 * always produces the same primary — a row that changes identity between two
 * refreshes is worse than one that picks the poorer recording. */
function isMoreComplete(a: Workout, b: Workout): number {
  const byScore = completeness(b) - completeness(a)
  if (byScore !== 0) return byScore
  const byStart = startMs(a) - startMs(b)
  if (byStart !== 0) return byStart
  return (a.id ?? '').localeCompare(b.id ?? '')
}

/**
 * Folds a list of recordings into sessions.
 *
 * ⚠️ The comparison is **against the group's primary**, not pairwise across
 * everything. A chain (A overlaps B, B overlaps C, A and C do not) would
 * otherwise merge three sessions into one, and a long walk containing two short
 * ones is exactly that shape.
 */
export function groupSessions(workouts: Workout[]): WorkoutGroup[] {
  // Sorted first, so the result does not depend on the order the pages arrived in.
  const ordered = [...workouts].sort((a, b) => {
    const byStart = startMs(a) - startMs(b)
    if (byStart !== 0 && !Number.isNaN(byStart)) return byStart
    return (a.id ?? '').localeCompare(b.id ?? '')
  })

  const buckets: Workout[][] = []
  for (const w of ordered) {
    const bucket = buckets.find((members) => isSameSession(members[0], w))
    if (bucket) {
      bucket.push(w)
      // Re-sorted here rather than at the end, so the comparison above stays
      // anchored to a stable first element for the rest of the pass.
      bucket.sort(isMoreComplete)
    } else {
      buckets.push([w])
    }
  }

  return buckets.map((members) => {
    const [primary, ...rest] = members
    const others = rest.sort((a, b) => startMs(a) - startMs(b))
    return {
      primary,
      others,
      id: primary.id ?? primary.source_uuid ?? String(startMs(primary)),
      count: members.length,
      identical: others.every((o) => sameNumbers(o, primary)),
    }
  })
}

// --- Months ------------------------------------------------------------------

export type WorkoutMonth = {
  /** `2026-08` — stable, sortable, and not a display string. */
  id: string
  /** The first day of the month, as an ISO instant, for the header's own
   * formatting through `Intl`. */
  startIso: string
  groups: WorkoutGroup[]
  count: number
  /** What the month adds up to, in minutes.
   *
   * ⚠️ Duration only. Distance and energy would need every session to have them,
   * and a total over a subset is a number that looks complete and is not. A
   * session with no end contributes nothing here and is counted in
   * `withoutDuration`, so the header can say the total is short of something
   * rather than pretending. */
  totalMin: number
  withoutDuration: number
}

/**
 * Groups sessions into months, newest first, and the sessions inside each month
 * newest first too.
 *
 * ⚠️ The grouping is done in the reader's own calendar, not UTC. A workout at
 * 00:30 on the first of the month belongs to that month for the person who did
 * it, and to the previous one for anyone who buckets by the raw timestamp.
 */
export function byMonth(groups: WorkoutGroup[]): WorkoutMonth[] {
  const buckets = new Map<string, WorkoutGroup[]>()
  for (const g of groups) {
    const d = new Date(startMs(g.primary))
    if (Number.isNaN(d.getTime())) continue
    const id = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const list = buckets.get(id)
    if (list) list.push(g)
    else buckets.set(id, [g])
  }

  return [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([id, list]) => {
      const [year, month] = id.split('-').map(Number)
      const sorted = [...list].sort((a, b) => startMs(b.primary) - startMs(a.primary))
      let totalMin = 0
      let withoutDuration = 0
      for (const g of sorted) {
        const min = durationMin(g.primary)
        if (min == null) withoutDuration += 1
        else totalMin += min
      }
      return {
        id,
        startIso: new Date(year, month - 1, 1).toISOString(),
        groups: sorted,
        count: sorted.length,
        totalMin,
        withoutDuration,
      }
    })
}

/**
 * Which months start open.
 *
 * ⚠️ Collapsing everything would hide the newest session — the one a person
 * opened the page to see. Collapsing nothing would leave the page exactly as
 * long as it was. So: the newest month is always open, and a short history stays
 * open entirely.
 */
export function initiallyExpanded(months: WorkoutMonth[]): Set<string> {
  const total = months.reduce((sum, m) => sum + m.count, 0)
  if (total <= SHORT_HISTORY) return new Set(months.map((m) => m.id))
  return new Set(months.slice(0, 1).map((m) => m.id))
}

// --- The filter --------------------------------------------------------------

export type Place = 'any' | 'indoor' | 'outdoor'

/**
 * What the page is showing, and what it is hiding.
 *
 * # ⚠️ A missing value is never treated as zero
 *
 * This is the rule the whole section turns on. A workout recorded without a
 * heart-rate strap has NO average heart rate; a strength session has no
 * distance. Reading those as `0` would quietly drop them from every "at least"
 * filter — the person would be told they have no long sessions when the long
 * ones simply had no distance recorded. **A workout that cannot answer a filter
 * is not excluded by it.** It is excluded only by a filter it answers and fails.
 *
 * That choice has a cost, and it is the honest one: "at least 10 km" can show a
 * session with no distance at all. The alternative is worse.
 */
export type Filter = {
  /** Which activities to show. Empty = all of them.
   *
   * ⚠️ Empty means "no restriction", NOT "nothing". */
  activityTypes: string[]
  place: Place
  minMinutes: number | null
  minKm: number | null
  minKcal: number | null
  minHr: number | null
  maxHr: number | null
}

export const EMPTY_FILTER: Filter = {
  activityTypes: [],
  place: 'any',
  minMinutes: null,
  minKm: null,
  minKcal: null,
  minHr: null,
  maxHr: null,
}

export function isEmptyFilter(f: Filter): boolean {
  return (
    f.activityTypes.length === 0 &&
    f.place === 'any' &&
    f.minMinutes == null &&
    f.minKm == null &&
    f.minKcal == null &&
    f.minHr == null &&
    f.maxHr == null
  )
}

/** The thresholds the menus offer. Discrete steps rather than a slider: nobody
 * wants "between 32 and 37 minutes". The phone's `WorkoutFilter.Steps`. */
export const STEPS = {
  minutes: [15, 30, 45, 60, 90, 120],
  kilometres: [1, 5, 10, 21.1, 42.2],
  energyKcal: [100, 250, 500, 750, 1000],
  heartRate: [100, 120, 140, 160, 180],
}

/** Indoor, outdoor, or unknown — read out of the recording app's metadata. */
export function isIndoor(w: Workout): boolean | null {
  const raw = (w.metadata as Record<string, unknown> | undefined)?.indoor
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'number') return raw !== 0
  if (typeof raw === 'string') return raw === 'true' || raw === '1'
  return null
}

export function matches(f: Filter, w: Workout): boolean {
  if (f.activityTypes.length > 0 && !f.activityTypes.includes(w.activity_type ?? '')) return false

  if (f.place !== 'any') {
    // ⚠️ An unknown indoor/outdoor flag passes BOTH filters rather than neither.
    // The flag is metadata the recording app may simply not have written, and
    // hiding those would make the filter look broken to the one person who knows
    // the session happened.
    const indoor = isIndoor(w)
    if (indoor !== null) {
      if (f.place === 'indoor' && !indoor) return false
      if (f.place === 'outdoor' && indoor) return false
    }
  }

  const min = durationMin(w)
  if (f.minMinutes != null && min != null && min < f.minMinutes) return false
  if (f.minKm != null && w.total_distance_m != null && w.total_distance_m < f.minKm * 1000)
    return false
  if (f.minKcal != null && w.total_energy_kcal != null && w.total_energy_kcal < f.minKcal)
    return false
  if (w.avg_heart_rate != null) {
    if (f.minHr != null && w.avg_heart_rate < f.minHr) return false
    if (f.maxHr != null && w.avg_heart_rate > f.maxHr) return false
  }
  return true
}

/** How many restrictions are on — the number beside the filter's heading. */
export function activeCount(f: Filter): number {
  let n = 0
  if (f.activityTypes.length > 0) n += 1
  if (f.place !== 'any') n += 1
  if (f.minMinutes != null) n += 1
  if (f.minKm != null) n += 1
  if (f.minKcal != null) n += 1
  if (f.minHr != null || f.maxHr != null) n += 1
  return n
}

/** The activity types present in the history, in the order they are most
 * common. The chips are built from the data, so a filter can never offer an
 * activity that would match nothing. */
export function activityTypesIn(workouts: Workout[]): string[] {
  const counts = new Map<string, number>()
  for (const w of workouts) {
    if (!w.activity_type) continue
    counts.set(w.activity_type, (counts.get(w.activity_type) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map((e) => e[0])
}

/** How many sessions arrived more than once, and how many extra recordings sit
 * behind them — the numbers the list-level note is made of. */
export function duplicateTally(groups: WorkoutGroup[]): { sessions: number; extra: number } {
  const duplicated = groups.filter((g) => g.count > 1)
  return {
    sessions: duplicated.length,
    extra: duplicated.reduce((sum, g) => sum + g.others.length, 0),
  }
}
