// The weight trend line — a port of the phone's
// `HelsaKit/Sources/HelsaKit/Trends/WeightTrend.swift`, thresholds and all.
//
// # Why a trend line at all (the app's reasoning, kept)
//
// Raw body mass is noisy for reasons that have nothing to do with the body:
// salt, water, the hour of the weighing. A kilogram of day-to-day swing is
// ordinary, and none of it is the person. The smoothed line is the part that is,
// and the kg/week rate answers the actual question — "is this going anywhere?".
// The raw measurements stay on the chart underneath: a computation shown alone
// starts to look like a measurement.
//
// # The gap decision — copied, because it is the part that can lie
//
// Weighings are irregular. The smoothing factor is derived from the number of
// days that actually passed between two weighings, `α = 1 − (1 − αdaily)^Δdays`:
// on a daily rhythm that is the Hacker's Diet 10% a day, after a fortnight away
// it is ≈ 0.77, so the returning weighing mostly re-anchors the line instead of
// being averaged into a stale one. Above `MAX_GAP_DAYS` the line breaks and is
// re-seeded; the rate is computed inside ONE unbroken stretch, from trend values.
//
// ⚠️ **Below the data minimum this says NOTHING**, in a sentence. An EWMA seeded
// from its first value is mostly that value for its first few updates; drawing
// it would be a picture of one weighing dressed as knowledge.
//
// # Where the web differs, and why it does not matter
//
// The phone measures the gap in calendar days with `Calendar.dateComponents`;
// here two LOCAL midnights are subtracted and rounded, which is the same number
// on every day of the year including the two DST switches (a 23- or 25-hour day
// still rounds to one). The sentences are not built here — this file returns
// WHICH sentence and its numbers, and the page words it through i18n, because
// the web keeps every user-visible string in `src/i18n/`.

/** The phone's `WeightTrendThresholds`, value for value. Change them there first. */
export const WEIGHT_TREND = {
  /** Hacker's Diet: on a daily rhythm a weighing moves the trend a tenth of the way. */
  dailySmoothing: 0.1,
  /** Fewer weighings than this in one stretch → no line. */
  minSamples: 5,
  /** …and they must span at least this many days. */
  minSpanDays: 14,
  /** A hole wider than this breaks the line and re-seeds the average. */
  maxGapDays: 21,
  /** The rate looks back at most this far from the last weighing. */
  rateWindowDays: 28,
  /** …and needs at least this much span inside that window. */
  minRateSpanDays: 14,
  /** At least this many trend points inside the rate window. */
  minRatePoints: 3,
} as const

/** The catalog keys that get a trend line (`WeightTrend.isApplicable`): body mass
 * and lean body mass only — "kg/week" is the sentence, and it fits nothing else. */
export const WEIGHT_TREND_METRICS = new Set(['bodyMass', 'leanBodyMass'])

export type WeightTrendPoint = {
  /** Local midnight of the weighing's day. */
  date: Date
  measured: number
  trend: number
  /** The unbroken stretch it belongs to; the line is drawn per stretch. */
  segment: number
}

/** Why no line is drawn — the page turns this into the app's sentence. */
export type WeightTrendShortfall =
  | { kind: 'yearly' }
  | { kind: 'fewSamples'; min: number; count: number }
  | { kind: 'shortSpan'; span: number; min: number }

export type WeightTrend = {
  /** Empty = no line; `shortfall` then says why. */
  points: WeightTrendPoint[]
  unit: string
  /** The TREND's change in unit/week, or `null` when it cannot be stated. */
  changePerWeek: number | null
  shortfall: WeightTrendShortfall | null
}

const DAY_MS = 86_400_000

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Whole calendar days from `a` to `b`, both local midnights. */
function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS)
}

/**
 * The trend for a series, or `null` for a metric we do not smooth at all.
 *
 * `daily` says whether the buckets are days. ⚠️ The yearly view sends MONTHLY
 * buckets — each already an average — and a day-decayed EWMA on top of them
 * would have every α above 0.95: the raw monthly value wearing a trend line's
 * clothes. So it gets no line, and says so (the app's rule exactly). The
 * hourly day view is not daily either; the page never asks there, but the same
 * answer would be correct for it.
 */
export function makeWeightTrend(
  samples: { date: Date; value: number }[],
  metric: string,
  unit: string,
  daily: boolean,
): WeightTrend | null {
  if (!WEIGHT_TREND_METRICS.has(metric)) return null
  if (!daily) return { points: [], unit, changePerWeek: null, shortfall: { kind: 'yearly' } }

  const sorted = [...samples].sort((a, b) => a.date.getTime() - b.date.getTime())
  const points = trendPoints(sorted)
  const short = shortfall(points)
  if (short) return { points: [], unit, changePerWeek: null, shortfall: short }
  return { points, unit, changePerWeek: rate(points), shortfall: null }
}

/** The EWMA: decay by elapsed days, re-seeded across a hole wider than `maxGapDays`. */
export function trendPoints(samples: { date: Date; value: number }[]): WeightTrendPoint[] {
  const out: WeightTrendPoint[] = []
  let segment = 0
  let current: number | null = null
  let previous: Date | null = null

  for (const sample of samples) {
    const day = startOfDay(sample.date)
    let value = sample.value
    if (previous && current != null) {
      const elapsed = daysBetween(previous, day)
      if (elapsed > WEIGHT_TREND.maxGapDays) {
        segment += 1 // we know nothing about the hole: start again
      } else {
        // Δ = 0 (two weighings the same day) gives α = 0: no time passed, so the
        // second reading of the morning does not get its own tenth of a step.
        const alpha = 1 - Math.pow(1 - WEIGHT_TREND.dailySmoothing, Math.max(elapsed, 0))
        value = current + alpha * (sample.value - current)
      }
    }
    current = value
    previous = day
    out.push({ date: day, measured: sample.value, trend: value, segment })
  }
  return out
}

/**
 * Why no line — or `null` when there is one.
 *
 * ⚠️ Checked on the LONGEST unbroken stretch, not the series: twenty weighings
 * in pairs a month apart satisfy any series-level count while containing no
 * stretch a line could honestly be drawn through.
 */
export function shortfall(points: WeightTrendPoint[]): WeightTrendShortfall | null {
  const best = longestStretch(points)
  if (best.length < WEIGHT_TREND.minSamples) {
    return { kind: 'fewSamples', min: WEIGHT_TREND.minSamples, count: best.length }
  }
  const span = spanDays(best)
  if (span < WEIGHT_TREND.minSpanDays) {
    return { kind: 'shortSpan', span, min: WEIGHT_TREND.minSpanDays }
  }
  return null
}

/** The unit/week slope of the trend over the last stretch's final `rateWindowDays`. */
export function rate(points: WeightTrendPoint[]): number | null {
  const last = points[points.length - 1]
  if (!last) return null
  const stretch = points.filter((p) => p.segment === last.segment)
  const cutoff = new Date(
    last.date.getFullYear(),
    last.date.getMonth(),
    last.date.getDate() - WEIGHT_TREND.rateWindowDays,
  )
  const window = stretch.filter((p) => p.date.getTime() >= cutoff.getTime())
  const first = window[0]
  if (window.length < WEIGHT_TREND.minRatePoints || !first) return null
  const days = daysBetween(first.date, last.date)
  if (days < WEIGHT_TREND.minRateSpanDays) return null
  return ((last.trend - first.trend) / days) * 7
}

/** The longest run of one segment. Ties go to the EARLIER stretch, as in Swift
 * (`run.count > best.count`, strictly). */
export function longestStretch(points: WeightTrendPoint[]): WeightTrendPoint[] {
  let best: WeightTrendPoint[] = []
  const segments = [...new Set(points.map((p) => p.segment))].sort((a, b) => a - b)
  for (const s of segments) {
    const run = points.filter((p) => p.segment === s)
    if (run.length > best.length) best = run
  }
  return best
}

function spanDays(points: WeightTrendPoint[]): number {
  const first = points[0]
  const last = points[points.length - 1]
  return first && last ? daysBetween(first.date, last.date) : 0
}

/**
 * "−0,20 kg/week" without the "/week": the sign and the number.
 *
 * ⚠️ Always two decimals (the app's `rateText`): a rate that changes its
 * precision as it nears zero is hard to read against itself week after week.
 * A real minus sign, not a hyphen — the hyphen is smaller and gets lost.
 */
export function signedRate(changePerWeek: number, locale: string): string {
  const n = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(changePerWeek))
  const sign = changePerWeek > 0 ? '+' : changePerWeek < 0 ? '−' : ''
  return `${sign}${n}`
}
