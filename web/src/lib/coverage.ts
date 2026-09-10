// The reading layer of the completeness report — **pure functions**, so the
// claims the page makes can be pinned by tests without a browser.
//
// ⚠️ The one rule everything here obeys: **a missing measurement is not a zero.**
// The server already refuses to conflate them (it leaves `measured_days` out
// rather than sending 0), and the job of this file is not to undo that on the
// last metre with a `?? 0`. That is exactly how the rings lost the distinction
// once already — see `components/ui.test.tsx`.

import type { CoverageGroup, CoverageResponse, CoverageType } from '../api/types'
import type { GroupKey } from '../i18n/types'

/**
 * The server speaks the APP's group vocabulary (`nutritionMacro`), the web
 * dictionary uses shorter keys (`macro`). Neither is wrong and neither is worth a
 * migration, so the translation happens here, once, at the edge — rather than
 * three components each doing their own `.replace('nutrition', '')`.
 */
const GROUP_KEY: Record<CoverageGroup, GroupKey> = {
  activity: 'activity',
  heart: 'heart',
  respiratory: 'respiratory',
  body: 'body',
  nutritionMacro: 'macro',
  nutritionMineral: 'mineral',
  nutritionVitamin: 'vitamin',
  mobility: 'mobility',
  environment: 'environment',
  other: 'other',
}

/** The groups in the catalogue's order — the same order the app shows them in. */
export const COVERAGE_GROUPS: CoverageGroup[] = [
  'activity',
  'heart',
  'respiratory',
  'body',
  'nutritionMacro',
  'nutritionMineral',
  'nutritionVitamin',
  'mobility',
  'environment',
  'other',
]

export function groupKey(group?: CoverageGroup): GroupKey {
  return group ? (GROUP_KEY[group] ?? 'other') : 'other'
}

export type CoverageSection = {
  group: CoverageGroup
  rows: CoverageType[]
  /** How many of the group's types brought data. */
  measured: number
  /** How many types the group has at all. */
  total: number
}

/**
 * The rows split into sections, in catalogue order, keeping each group's own
 * order.
 *
 * Empty groups are kept. A section reading "0 of 13 bring data" is the single
 * most useful thing on the page — it is how a person sees that a whole area
 * (mobility, say) is dark — and dropping it because it has nothing in it would
 * hide precisely the finding.
 */
export function sections(types: CoverageType[]): CoverageSection[] {
  const byGroup = new Map<CoverageGroup, CoverageType[]>()
  for (const g of COVERAGE_GROUPS) byGroup.set(g, [])
  for (const row of types) {
    const g = row.group ?? 'other'
    const bucket = byGroup.get(g)
    if (bucket) bucket.push(row)
    else byGroup.set(g, [row])
  }
  return COVERAGE_GROUPS.map((group) => {
    const rows = byGroup.get(group) ?? []
    return {
      group,
      rows,
      measured: rows.filter((r) => r.state === 'measured').length,
      total: rows.length,
    }
  })
}

/**
 * The headline's two numbers.
 *
 * ⚠️ It counts against the types actually EXAMINED, not against a hard-coded 120:
 * if the server's catalogue grows or shrinks, "120 of which…" would be a claim
 * about types nobody looked at. The app's headline is careful about the same
 * thing for the same reason.
 */
export function tally(resp?: CoverageResponse): { total: number; measured: number } {
  const types = resp?.types ?? []
  return {
    total: types.length,
    measured: types.filter((r) => r.state === 'measured').length,
  }
}

/** The metrics whose rhythm has broken, the most overdue first. */
export function gaps(types: CoverageType[]): CoverageType[] {
  return types
    .filter((r) => r.gap != null)
    .sort((a, b) => overdueRatio(b) - overdueRatio(a))
}

/**
 * How many typical intervals have gone by without data.
 *
 * ⚠️ This — not the raw day count — is the order. A daily metric silent for five
 * days is more remarkable than a weekly one silent for twenty-two, even though
 * twenty-two is the bigger number. The app sorts its list the same way, and if
 * the two ever disagree the same data tells two stories.
 */
export function overdueRatio(row: CoverageType): number {
  const silent = row.gap?.silent_days
  const typical = row.gap?.typical_interval_days
  if (silent == null || typical == null || typical <= 0) return 0
  return silent / typical
}

/**
 * How the rhythm is said. The thresholds are the app's
 * (`MetricCadence.description`), so that the phone and the web describe the same
 * series with the same word.
 *
 * The result is a key plus a count, not a sentence: the wording lives in the
 * dictionaries, and the caller puts it into "until now it arrived roughly …".
 */
export type CadenceWord = { key: 'daily' | 'everyOtherDay' | 'weekly' | 'fortnightly'; n?: never }
  | { key: 'everyNDays'; n: number }

export function cadenceWord(typicalIntervalDays?: number): CadenceWord | null {
  const days = typicalIntervalDays
  if (days == null || days <= 0) return null
  if (days < 1.5) return { key: 'daily' }
  if (days < 2.5) return { key: 'everyOtherDay' }
  if (days < 5.5) return { key: 'everyNDays', n: Math.round(days) }
  if (days < 8.5) return { key: 'weekly' }
  if (days < 16) return { key: 'fortnightly' }
  return { key: 'everyNDays', n: Math.round(days) }
}
