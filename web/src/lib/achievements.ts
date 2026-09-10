// Grouping and ordering for the medals list.
//
// The interesting decision is the sort. The endpoint promises descending
// `earned_at`, but a phone that has just been reinstalled uploads years of
// badges in one batch, and then every row carries the SAME timestamp — which is
// what the live dev server does today: 36 of its 42 badges were earned in the
// same second. Ordered by `earned_at` alone the monthly table comes out in
// whatever order the database felt like. So the period, and then the value,
// break the tie.

import type { Achievement, AchievementKind } from '../api/types'

export type AchievementGroupKey = AchievementKind | 'other'

/**
 * Rarest first: a milestone is crossed once ever, a record stands until it is
 * beaten, a streak needs months of them in a row, and the monthly family is the
 * one that grows every month. It also puts the longest table last, where it can
 * be scrolled past.
 */
export const ACHIEVEMENT_KINDS: AchievementKind[] = [
  'milestone',
  'record',
  'streak',
  'year',
  'month',
]

const KNOWN = new Set<string>(ACHIEVEMENT_KINDS)

export function groupKey(a: Achievement): AchievementGroupKey {
  return a.kind && KNOWN.has(a.kind) ? a.kind : 'other'
}

function earnedRank(iso?: string): number {
  if (!iso) return -Infinity
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? -Infinity : t
}

/**
 * `2026-08` sorts after `2026-07` and `2025` before both, as strings — the
 * formats are zero-padded and share a prefix, so no date parsing is needed. An
 * absent period sorts last.
 */
function periodRank(period?: string): string {
  return period ?? ''
}

export type AchievementGroup = {
  key: AchievementGroupKey
  items: Achievement[]
  /** Whether any row in this group carries a threshold snapshot. */
  hasThresholds: boolean
}

export function groupAchievements(items: Achievement[]): AchievementGroup[] {
  const order: AchievementGroupKey[] = [...ACHIEVEMENT_KINDS, 'other']
  const buckets = new Map<AchievementGroupKey, Achievement[]>()

  for (const a of items) {
    const key = groupKey(a)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(a)
    else buckets.set(key, [a])
  }

  return order
    .filter((key) => (buckets.get(key)?.length ?? 0) > 0)
    .map((key) => {
      const group = [...buckets.get(key)!].sort((a, b) => {
        if (earnedRank(a.earned_at) !== earnedRank(b.earned_at)) {
          return earnedRank(b.earned_at) - earnedRank(a.earned_at)
        }
        if (periodRank(a.period) !== periodRank(b.period)) {
          return periodRank(b.period).localeCompare(periodRank(a.period))
        }
        // ⚠️ `?? 0` would be wrong on a value, but this is a tie-break between
        // two rows, not a number anybody reads: a badge with no value sorts
        // after one that has it, and the cell still prints a dash.
        return (b.value ?? -Infinity) - (a.value ?? -Infinity)
      })
      return {
        key,
        items: group,
        hasThresholds: group.some((a) => (a.thresholds?.length ?? 0) > 0),
      }
    })
}

/**
 * Which of the thresholds in force at the time the badge's value had reached.
 *
 * ⚠️ Returns `null` — not an empty list — when there is no value. "We do not
 * know what this badge was worth" and "it reached none of them" are different
 * facts, and six hollow dots would state the second one.
 */
export function reachedThresholds(a: Achievement): { reached: number[]; missed: number[] } | null {
  const thresholds = a.thresholds
  if (!thresholds?.length || a.value == null) return null
  return {
    reached: thresholds.filter((t) => a.value! >= t),
    missed: thresholds.filter((t) => a.value! < t),
  }
}
