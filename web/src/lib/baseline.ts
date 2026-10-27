// "Your usual range" on the dashboard: the band behind the trend chart, and the
// words under it.
//
// The arithmetic is NOT here. It happens once, on the server (`GET /v1/baseline`,
// backend `internal/baseline`), which computes it the same way the phone does
// (`HelsaKit/Trends/TrendBaseline.swift`). What this file holds is only how the
// answer is READ: which series' band belongs to the metric on screen, whether
// there is a band at all, and which glyph goes next to which word.
//
// ⚠️ **No verdict, ever.** The five levels describe the person's own last two
// months. More steps than usual is probably welcome; a higher resting heart rate
// than usual probably is not; a heavier body mass is whatever the person is
// working towards. Nothing here may colour, grade or congratulate — the position
// is a fact, whether it is good news is not ours to say.

import type { MetricBaseline, Standing } from '../api/types'
import type { MetricDef } from './metrics'

/**
 * The glyph beside the standing.
 *
 * ⚠️ **Arrows, not colours.** A red "above" would be a verdict, and the rule above
 * says why we do not get to make one. The symbol only repeats the direction the
 * words already carry — so that the standing survives being read at a glance, and
 * so that it does not depend on colour at all, which is the one accessibility trap
 * this whole category walks into. The chart pins the same five directions on iOS
 * with SF Symbols (`TrendStanding.symbolName`); these are their plain-text twins.
 */
export const STANDING_ARROW: Record<Standing, string> = {
  wellBelow: '⤓',
  below: '↘',
  typical: '=',
  above: '↗',
  wellAbove: '⤒',
}

/**
 * The baseline belonging to the metric on screen, trying its aliases too — the
 * same dance `pickSeries` does, and for the same reason: the server knows some
 * types under a short name of its own, and only that name carries a usable answer.
 *
 * Whichever alias has a band wins; if none does, the primary key's entry is
 * returned anyway, because "we looked and there are only 9 days" is an answer and
 * has to reach the screen.
 */
export function pickBaseline(
  def: MetricDef,
  metrics?: Record<string, MetricBaseline>,
): MetricBaseline | undefined {
  if (!metrics) return undefined
  const names = [def.key, ...def.aliases]
  for (const n of names) {
    if (metrics[n]?.mean != null) return metrics[n]
  }
  for (const n of names) {
    if (metrics[n]) return metrics[n]
  }
  return undefined
}

export type Band = { low: number; high: number }

/**
 * The band to draw, or `null`.
 *
 * ⚠️ **`null` is the answer, not a fallback.** Below the server's measured-day
 * minimum there is no band — not a wider one, not a guess drawn from what little
 * there is. A pale rectangle would be read as a reference range no matter how few
 * days it rests on, so the honest thing is to draw nothing and say why.
 */
export function bandOf(baseline?: MetricBaseline): Band | null {
  if (!baseline) return null
  const { low, high, mean } = baseline
  if (mean == null || low == null || high == null) return null
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) return null
  return { low, high }
}

/**
 * Why there is no band, when there is none.
 *
 * ⚠️ The contract leaves the band out for TWO reasons, and they are opposite
 * statements: too few measured days ("we do not know your usual yet") and a
 * reference that never varied ("we know it exactly: it is always this").
 * Calling the second "not enough days" with 60 of 14 on screen is plainly false.
 *
 *  - `notEnough` — fewer measured days than the server's minimum.
 *  - `noVariation` — enough days, and every one carried the same value (the
 *    server sends the mean, and an `sd` of 0 or no `low`/`high`).
 *  - `unknown` — enough days and no band, for a reason the answer does not give.
 */
export type NoBandReason = 'notEnough' | 'noVariation' | 'unknown'

export function noBandReason(baseline: MetricBaseline | undefined, minDays: number): NoBandReason {
  const days = baseline?.day_count ?? 0
  if (days < minDays) return 'notEnough'
  if (baseline?.mean != null && (baseline.sd === 0 || baseline.low == null || baseline.low === baseline.high))
    return 'noVariation'
  return 'unknown'
}
