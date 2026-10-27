// Whether two periods were measured enough alike to be compared.
//
// ⚠️ A comparison of two totals is only a comparison of behaviour when both
// periods were MEASURED on a similar share of their buckets. One measured day
// against seven reads as an 86% collapse, and it is nothing but a phone that did
// not sync. The calendar truncation (`trends.compare.clipped`) is a different
// problem and is handled elsewhere: this is about missing measurements inside
// equally long windows.

/** Measured buckets out of the window's buckets. */
export type Coverage = { measured: number; total: number }

/**
 * Below this ratio between the two periods' measured shares, a SUMMED
 * comparison is withheld: half the coverage already halves a total by itself.
 */
export const COVERAGE_RATIO_MIN = 0.5

function share(c: Coverage): number {
  return c.total > 0 ? c.measured / c.total : 0
}

/**
 * - `comparable` — similar coverage: the delta may be shown as it is.
 * - `uneven` — the coverage differs by more than `COVERAGE_RATIO_MIN`: a summed
 *   delta is withheld, an averaged one is shown with the coverage beside it
 *   (an average over fewer days is noisier, not biased by the count).
 */
export function coverageVerdict(current: Coverage, previous: Coverage): 'comparable' | 'uneven' {
  const a = share(current)
  const b = share(previous)
  const hi = Math.max(a, b)
  if (hi === 0) return 'comparable'
  return Math.min(a, b) / hi >= COVERAGE_RATIO_MIN ? 'comparable' : 'uneven'
}
