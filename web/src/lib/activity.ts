import type { ActivitySummary } from '../api/types'

/**
 * Which activity summary — if any — belongs to today.
 *
 * ⚠️ **Why this is not `data.at(-1)`.** The dashboard asks for a window, not a day, and
 * then showed the newest entry of that window under a heading that says "Today", with no
 * date beside it. On a quiet weekend, or after a sync that has been silently stuck for a
 * while, the newest entry can be days old — and the card presents it as this morning.
 *
 * That is the failure this whole product is most careful about: not a wrong number, but a
 * true number under a false claim. So the caller is told both things — what the newest
 * summary is, and whether it is actually today's.
 */
export type NewestActivity = {
  summary: ActivitySummary
  /** False when the newest summary is older than today; the screen then has to say so. */
  isToday: boolean
}

/** `now` is injected so the behaviour is testable without waiting for midnight. */
export function newestActivity(
  data: ActivitySummary[] | undefined,
  now: Date = new Date(),
): NewestActivity | null {
  if (!data || data.length === 0) return null

  // Sorted by day rather than trusting the array's order: `at(-1)` is only "the newest"
  // if the server happens to return them in order, and nothing in the contract says it
  // does.
  const dated = data.filter((d) => !!d.day)
  const summary = dated.length > 0
    ? [...dated].sort((a, b) => (a.day ?? '').localeCompare(b.day ?? '')).at(-1)!
    : data.at(-1)!

  return { summary, isToday: summary.day === localDay(now) }
}

/**
 * Today in the LOCAL calendar, as `YYYY-MM-DD`.
 *
 * ⚠️ Not `toISOString().slice(0, 10)`: that converts to UTC first, so for anyone east of
 * Greenwich it says "yesterday" for the whole late evening — which would make a correct,
 * current summary look stale every night.
 */
export function localDay(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
