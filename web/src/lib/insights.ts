// Grouping and ordering for the observations list.
//
// Kept out of the page so it can be tested without a renderer: the ordering is
// the only thing on that screen with a decision in it, and it is exactly the
// kind of thing that silently regresses.
//
// ⚠️ Nothing here reads `title` or `detail`. Those are the server's sentences and
// the page prints them untouched; sorting on their text would quietly make the
// order depend on the language the server happens to speak.

import type { Insight, InsightKind, InsightSeverity } from '../api/types'

/**
 * The bucket an observation is filed under. `other` is not a server value: it
 * catches a `kind` this build does not know yet, so a new rule family shows up
 * as an extra section rather than disappearing.
 */
export type InsightGroupKey = InsightKind | 'other'

/**
 * Anomalies and trends first — those compare recent days against something, so
 * they are the ones that can be new information today. A `correlation` and a
 * `pattern` describe a standing property of a window, and read the same
 * tomorrow.
 */
export const INSIGHT_KINDS: InsightKind[] = ['anomaly', 'trend', 'correlation', 'pattern']

const KNOWN = new Set<string>(INSIGHT_KINDS)

export function groupKey(insight: Insight): InsightGroupKey {
  return insight.kind && KNOWN.has(insight.kind) ? insight.kind : 'other'
}

/** `notice` before `info`; an absent severity sorts last rather than guessing. */
function severityRank(s?: InsightSeverity): number {
  if (s === 'notice') return 0
  if (s === 'info') return 1
  return 2
}

/** Newest first. An unparseable or absent timestamp sorts last, never as epoch 0. */
function generatedRank(iso?: string): number {
  if (!iso) return -Infinity
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? -Infinity : t
}

export type InsightGroup = {
  key: InsightGroupKey
  items: Insight[]
}

/**
 * The observations, filed by kind and ordered within each: the server's own
 * severity first, then the most recently generated. Empty groups are dropped —
 * a section header over nothing says "we found nothing here", which is a
 * different claim from "this rule family had nothing to report".
 */
export function groupInsights(insights: Insight[]): InsightGroup[] {
  const order: InsightGroupKey[] = [...INSIGHT_KINDS, 'other']
  const buckets = new Map<InsightGroupKey, Insight[]>()

  for (const insight of insights) {
    const key = groupKey(insight)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(insight)
    else buckets.set(key, [insight])
  }

  return order
    .filter((key) => (buckets.get(key)?.length ?? 0) > 0)
    .map((key) => ({
      key,
      items: [...buckets.get(key)!].sort(
        (a, b) =>
          severityRank(a.severity) - severityRank(b.severity) ||
          generatedRank(b.generated_at) - generatedRank(a.generated_at),
      ),
    }))
}

/**
 * The number of decimals a computed value is worth printing with.
 *
 * The `values` map is per rule and untyped on the wire: it holds day counts,
 * correlation coefficients and a `direction` of ±1 side by side. A whole number
 * is printed whole — "14,00 measured days" reads like a measurement precise to
 * the hundredth, which it is not.
 */
export function valueDigits(v: number): number {
  return Number.isInteger(v) ? 0 : 2
}
