// The sentence an observation's numbers make — in the interface language.
//
// The server sends DATA, not sentences: `rule` names the rule, `values` carries
// the numbers it computed, and the client words it (openapi.yaml →
// `Insight.values`). `title` / `detail` are a Hungarian fallback for a rule the
// client does not know — nothing more.
//
// ⚠️ This is a PORT of the iPhone app's composer (HelsaKit `InsightWording` and
// the `wording(_:)` functions beside each rule in InsightRules.swift,
// SleepPatternRules.swift, TrainingRules.swift, BaselineDriftRules.swift,
// SleepDebtRules.swift, SocialJetlagRules.swift), with its catalog's English and
// Hungarian sentences in `i18n/{en,hu}.ts` under `insight.*`. Same sentences,
// same rounding, same number shapes — a phone and a dashboard describing the same
// body in two different ways is exactly what the shared vectors exist to stop.
// Change a sentence here, change it there.
//
// ⚠️ A missing or non-finite value makes the composer give up (`null`) rather
// than print half a sentence with a gap where a number should be: the server's
// own wording is the better answer then. Same discipline as the app's
// `InsightValues`.

import { useMemo } from 'react'
import type { Insight } from '../api/types'
import { useI18n } from '../i18n'
import type { UiKey } from '../i18n'

type Params = Record<string, string | number>
type Translate = (key: UiKey, params?: Params) => string

export type InsightTextContext = { t: Translate; locale: string }

export type Composed = { title: string; detail: string }

/** What a screen prints. `fallback` marks the server's own Hungarian sentence. */
export type InsightText = {
  title?: string
  detail?: string
  fallback: boolean
}

// --- the rules' constants that the sentences name -----------------------------
// Mirrors `InsightThresholds` in the app (and the Go constants). They are named
// in the sentence, not sent, because they are properties of the rule.

const ANOMALY_STREAK_DAYS = 3
const TREND_WINDOW_DAYS = 7
const MIN_ABS_CORRELATION = 0.5
const SLEEP_PATTERN_WINDOW_DAYS = 28
const ACUTE_LOAD_DAYS = 7
const CHRONIC_LOAD_DAYS = 28
const EFFICIENCY_WINDOW_DAYS = 28
const DRIFT_RECENT_DAYS = 28
const DRIFT_OLDER_START_DAYS = 120
const DRIFT_OLDER_END_DAYS = 90
/** Middle of the older window to the middle of the recent one (`driftSpanDays`). */
const DRIFT_SPAN_DAYS = (DRIFT_OLDER_START_DAYS + DRIFT_OLDER_END_DAYS) / 2 - DRIFT_RECENT_DAYS / 2
/** The empty stretch between the two windows (`driftGapDays`). */
const DRIFT_GAP_DAYS = DRIFT_OLDER_END_DAYS - DRIFT_RECENT_DAYS
const SLEEP_DEBT_WINDOW_DAYS = 14
const SLEEP_DEBT_BASELINE_DAYS = 90
const SOCIAL_JETLAG_WINDOW_DAYS = 56

// --- numbers ------------------------------------------------------------------

/** Swift's `.rounded()`: half away from zero (JS `Math.round` sends -2.5 to -2). */
function roundHalfAway(v: number): number {
  return Math.sign(v) * Math.round(Math.abs(v))
}

/** Swift's `Int(x)`: truncation toward zero. */
const trunc = Math.trunc

const nfCache = new Map<string, Intl.NumberFormat>()
function nf(locale: string, places: number, signed = false): Intl.NumberFormat {
  const key = `${locale}|${places}|${signed}`
  let f = nfCache.get(key)
  if (!f) {
    // ⚠️ Half-even, because that is what the app's `FormatStyle` does; with the
    // default half-expand a changePct of 12.5 would read 13% here and 12% on the
    // phone. Cast because the ES2022 lib does not type `roundingMode` yet.
    f = new Intl.NumberFormat(locale, {
      minimumFractionDigits: places,
      maximumFractionDigits: places,
      signDisplay: signed ? 'always' : 'auto',
      ...({ roundingMode: 'halfEven' } as Intl.NumberFormatOptions),
    })
    nfCache.set(key, f)
  }
  return f
}

/** `HelsaFormat.decimal`: fixed places, grouped, in the display locale. */
export function decimal(v: number, locale: string, places = 1): string {
  return nf(locale, places).format(v)
}

/** `HelsaFormat.signedDecimal`: "+0.42" / "+0,42". */
function signedDecimal(v: number, locale: string, places = 2): string {
  return nf(locale, places, true).format(v)
}

/** `HelsaFormat.steps`: a whole, non-negative, grouped count. */
function steps(v: number, locale: string): string {
  return nf(locale, 0).format(Math.round(Math.max(v, 0)))
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

/** Decimal hours → whole hours and rounded minutes; 7.999 h is 8 h flat. */
export function splitHours(v: number): { h: number; m: number } {
  let h = trunc(v)
  let m = roundHalfAway((v - h) * 60)
  if (m === 60) {
    h += 1
    m = 0
  }
  return { h, m }
}

/** Minutes from the key day's midnight as a wall clock; wraps both ways. */
export function clock(minutes: number): string {
  let m = roundHalfAway(minutes) % (24 * 60)
  if (m < 0) m += 24 * 60
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}

/**
 * The unit TOKENS a rule passes around. Never shown: `value` / `delta` decide
 * what each looks like in the reader's language (the app's `InsightUnit`).
 */
type Unit = 'steps' | 'min' | 'h' | 'clock' | 'bpm' | 'ms' | 'kg' | 'breaths' | 'kmh'

const LEVEL_UNIT: Partial<Record<Unit, UiKey>> = {
  bpm: 'insight.unit.bpm',
  ms: 'insight.unit.ms',
  kg: 'insight.unit.kg',
  breaths: 'insight.unit.breaths',
  kmh: 'insight.unit.kmh',
}

/** Hungarian puts the measure of a comparison in the instrumental ("6,0 kg-mal"). */
const DELTA_UNIT: Partial<Record<Unit, UiKey>> = {
  bpm: 'insight.unit.bpm.delta',
  ms: 'insight.unit.ms.delta',
  kg: 'insight.unit.kg.delta',
  breaths: 'insight.unit.breaths.delta',
}

/** A LEVEL ("the average was 7 hr 30 min") — `InsightText.value`. */
function value(v: number, unit: Unit, c: InsightTextContext): string {
  switch (unit) {
    case 'steps':
      return c.t('insight.unit.steps', { n: steps(v, c.locale) })
    case 'min':
      return c.t('insight.unit.min', { n: decimal(v, c.locale, 0) })
    case 'h': {
      const { h, m } = splitHours(v)
      return c.t('insight.unit.hm', { h: String(h), m: pad(m) })
    }
    case 'clock':
      return clock(v)
    default:
      return `${decimal(v, c.locale)} ${c.t(LEVEL_UNIT[unit]!)}`
  }
}

/** A DIFFERENCE ("72 perccel később") — `InsightText.delta`. */
function delta(v: number, unit: Unit, c: InsightTextContext): string {
  switch (unit) {
    case 'min':
      return c.t('insight.unit.min.delta', { n: decimal(v, c.locale, 0) })
    case 'steps':
      return c.t('insight.unit.steps.delta', { n: steps(v, c.locale) })
    case 'h': {
      const { h, m } = splitHours(v)
      if (h === 0) return c.t('insight.unit.min.delta', { n: m })
      // "2 óra 0 perccel hosszabb" is something no one says.
      if (m === 0) return c.t('insight.unit.h.delta', { h })
      return c.t('insight.unit.hm.delta', { h, m })
    }
    default: {
      const key = DELTA_UNIT[unit] ?? LEVEL_UNIT[unit]
      return `${decimal(v, c.locale)} ${key ? c.t(key) : unit}`
    }
  }
}

// --- reading the values ---------------------------------------------------------

/** Thrown inside a wording when a value is missing; caught by `composeInsight`. */
class Missing extends Error {}

function reader(values: Record<string, number>) {
  const num = (key: string): number => {
    const v = values[key]
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Missing(key)
    return v
  }
  // A count travels as a JSON number like everything else; rounded, as `Int`.
  const count = (key: string): number => roundHalfAway(num(key))
  return { num, count }
}

type Values = ReturnType<typeof reader>
type Wording = (v: Values, c: InsightTextContext) => Composed

// --- the rules ------------------------------------------------------------------

function deviation(label: UiKey, caveat: UiKey, unit: Unit, down: boolean): Wording {
  return (v, c) => {
    const recent = v.num('recent')
    const baseline = v.num('baseline')
    const sd = v.num('deviation')
    const baselineDays = v.count('baselineDays')
    return {
      title: c.t('insight.deviation.title', {
        label: c.t(label),
        days: ANOMALY_STREAK_DAYS,
        word: c.t(down ? 'insight.word.below' : 'insight.word.above'),
      }),
      detail: c.t('insight.deviation.detail', {
        days: ANOMALY_STREAK_DAYS,
        recent: value(recent, unit, c),
        baselineDays,
        baseline: value(baseline, unit, c),
        sd: value(sd, unit, c),
        caveat: c.t(caveat),
      }),
    }
  }
}

function trend(label: UiKey, unit: Unit): Wording {
  return (v, c) => {
    const current = v.num('current')
    const previous = v.num('previous')
    const changePct = v.num('changePct')
    const currentDays = v.count('currentDays')
    const previousDays = v.count('previousDays')
    // The direction is the SIGN of changePct, not a separate field.
    const down = changePct < 0
    return {
      title: c.t('insight.trend.title', {
        label: c.t(label),
        pct: decimal(Math.abs(changePct), c.locale, 0),
        word: c.t(down ? 'insight.word.less' : 'insight.word.more'),
      }),
      detail: c.t('insight.trend.detail', {
        days: TREND_WINDOW_DAYS,
        current: value(current, unit, c),
        currentDays,
        previous: value(previous, unit, c),
        previousDays,
        arrow: c.t(down ? 'insight.word.fell' : 'insight.word.rose'),
      }),
    }
  }
}

/** Fisher's z 95% interval; `null` where it cannot be stated (n ≤ 3, |r| ≥ 1). */
export function fisherInterval(r: number, pairs: number): { low: number; high: number } | null {
  if (!(pairs > 3) || !(Math.abs(r) < 1) || !Number.isFinite(r)) return null
  const z = Math.atanh(r)
  const se = 1 / Math.sqrt(pairs - 3)
  if (!Number.isFinite(se)) return null
  const half = 1.96 * se
  return { low: Math.tanh(z - half), high: Math.tanh(z + half) }
}

const correlation: Wording = (v, c) => {
  const r = v.num('r')
  const pairs = v.count('pairs')
  let detail = c.t('insight.correlation.detail', { pairs, r: signedDecimal(r, c.locale) })
  const ci = fisherInterval(r, pairs)
  if (ci) {
    const low = signedDecimal(ci.low, c.locale)
    const high = signedDecimal(ci.high, c.locale)
    // If the interval reaches below the rule's own gate, the direction is better
    // established than the strength — and the sentence says so.
    const wide = Math.min(Math.abs(ci.low), Math.abs(ci.high)) < MIN_ABS_CORRELATION
    detail +=
      ' ' +
      c.t(wide ? 'insight.correlation.intervalWide' : 'insight.correlation.interval', { low, high })
  }
  return {
    title: c.t('insight.correlation.title', {
      relation: c.t(r < 0 ? 'insight.word.shorter' : 'insight.word.longer'),
    }),
    detail,
  }
}

const regularity: Wording = (v, c) => {
  const midpoint = v.num('midpoint')
  const sd = v.num('midpointSd')
  const nights = v.count('nights')
  return {
    title: c.t('insight.regularity.title', { sd: value(sd, 'min', c) }),
    detail: c.t('insight.regularity.detail', {
      days: SLEEP_PATTERN_WINDOW_DAYS,
      nights,
      midpoint: value(midpoint, 'clock', c),
      sd: value(sd, 'min', c),
    }),
  }
}

function weekend(
  label: UiKey,
  unit: Unit,
  deltaUnit: Unit,
  more: UiKey,
  less: UiKey,
  countWord: UiKey,
): Wording {
  return (v, c) => {
    const free = v.num('free')
    const work = v.num('work')
    const d = v.num('delta')
    const freeCount = v.count('freeCount')
    const workCount = v.count('workCount')
    return {
      title: c.t('insight.weekend.title', {
        label: c.t(label),
        delta: delta(Math.abs(d), deltaUnit, c),
        word: c.t(d < 0 ? less : more),
      }),
      detail: c.t('insight.weekend.detail', {
        days: SLEEP_PATTERN_WINDOW_DAYS,
        free: value(free, unit, c),
        freeCount,
        countWord: c.t(countWord),
        work: value(work, unit, c),
        workCount,
      }),
    }
  }
}

const trainingLoad: Wording = (v, c) => {
  const acute = v.num('acute')
  const chronic = v.num('chronicWeekly')
  const ratio = decimal(v.num('ratio'), c.locale)
  const count = v.count('acuteCount')
  return {
    title: c.t('insight.load.title', { ratio }),
    detail: c.t('insight.load.detail', {
      days: ACUTE_LOAD_DAYS,
      count,
      acute: value(acute, 'min', c),
      chronicDays: CHRONIC_LOAD_DAYS,
      chronic: value(chronic, 'min', c),
      ratio,
    }),
  }
}

/** Metres per minute → km/h. */
const kmh = (mPerMin: number): number => (mPerMin * 60) / 1000

function efficiency(label: UiKey): Wording {
  return (v, c) => {
    const recentSpeed = v.num('recentSpeed')
    const previousSpeed = v.num('previousSpeed')
    const recentHr = v.num('recentHr')
    const previousHr = v.num('previousHr')
    const changePct = v.num('changePct')
    const recentCount = v.count('recentCount')
    const previousCount = v.count('previousCount')
    return {
      title: c.t('insight.efficiency.title', {
        label: c.t(label),
        word: c.t(changePct < 0 ? 'insight.word.slower' : 'insight.word.faster'),
      }),
      detail: c.t('insight.efficiency.detail', {
        days: EFFICIENCY_WINDOW_DAYS,
        recentCount,
        recentSpeed: value(kmh(recentSpeed), 'kmh', c),
        recentHr: value(recentHr, 'bpm', c),
        previousSpeed: value(kmh(previousSpeed), 'kmh', c),
        previousHr: value(previousHr, 'bpm', c),
        previousCount,
      }),
    }
  }
}

function drift(label: UiKey, unit: Unit): Wording {
  return (v, c) => {
    const recent = v.num('recent')
    const older = v.num('older')
    const d = v.num('drift')
    const recentDays = v.count('recentDays')
    const olderDays = v.count('olderDays')
    return {
      title: c.t('insight.drift.title', {
        label: c.t(label),
        months: trunc(DRIFT_SPAN_DAYS / 30),
        delta: delta(Math.abs(d), unit, c),
        word: c.t(d < 0 ? 'insight.word.driftedLower' : 'insight.word.driftedHigher'),
      }),
      detail: c.t('insight.drift.detail', {
        days: DRIFT_RECENT_DAYS,
        recent: value(recent, unit, c),
        recentDays,
        from: DRIFT_OLDER_END_DAYS,
        to: DRIFT_OLDER_START_DAYS,
        older: value(older, unit, c),
        olderDays,
        delta: value(Math.abs(d), unit, c),
        gap: trunc(DRIFT_GAP_DAYS / 30),
      }),
    }
  }
}

const sleepDebt: Wording = (v, c) => {
  const debt = v.num('debtHours')
  const usual = v.num('usual')
  const slept = v.num('slept')
  const expected = v.num('expected')
  const nights = v.count('nights')
  const baselineNights = v.count('baselineNights')
  return {
    title: c.t('insight.debt.title', {
      nights: SLEEP_DEBT_WINDOW_DAYS,
      debt: delta(debt, 'h', c),
    }),
    detail: c.t('insight.debt.detail', {
      nights,
      slept: value(slept, 'h', c),
      usual: value(usual, 'h', c),
      expected: value(expected, 'h', c),
      debt: value(debt, 'h', c),
      baselineDays: SLEEP_DEBT_BASELINE_DAYS,
      baselineNights,
    }),
  }
}

const socialJetlag: Wording = (v, c) => {
  const median = v.num('jetlagMinutes')
  const weeks = v.count('weeks')
  const nights = v.count('nights')
  const weekCount = v.count('weekCount')
  const agreeing = v.count('agreeing')
  // One hour of shift, one time zone — rounded, and the sentence says "roughly".
  const zones = roundHalfAway(median / 60)
  return {
    title: c.t('insight.jetlag.title', { shift: delta(median / 60, 'h', c) }),
    detail: c.t('insight.jetlag.detail', {
      days: SOCIAL_JETLAG_WINDOW_DAYS,
      weekCount,
      weeks,
      nights,
      median: value(median, 'min', c),
      agreeing,
      zones,
    }),
  }
}

/**
 * Every rule this build can word, by its identifier stem (the id without the
 * day). `efficiency-trend` and `baseline-drift` are one rule per activity type /
 * metric, exactly as the server names them.
 */
export const WORDINGS: Record<string, Wording> = {
  'resting-hr-elevated': deviation(
    'insight.label.restingHeartRate',
    'insight.caveat.restingHeartRate',
    'bpm',
    false,
  ),
  'hrv-depressed': deviation('insight.label.hrv', 'insight.caveat.hrv', 'ms', true),
  'sleep-short': deviation('insight.label.sleepDuration', 'insight.caveat.sleepDuration', 'h', true),
  'steps-weekly-trend': trend('insight.label.stepCount', 'steps'),
  'sleep-weekly-trend': trend('insight.label.nightSleep', 'h'),
  'steps-sleep-correlation': correlation,
  'sleep-regularity': regularity,
  'sleep-midpoint-weekend': weekend(
    'insight.label.sleepMidpoint',
    'clock',
    'min',
    'insight.word.later',
    'insight.word.earlier',
    'insight.count.nights',
  ),
  'sleep-weekend-duration': weekend(
    'insight.label.sleepLength',
    'h',
    'h',
    'insight.word.longer',
    'insight.word.shorter',
    'insight.count.nights',
  ),
  'steps-weekend': weekend(
    'insight.label.stepCount',
    'steps',
    'steps',
    'insight.word.more',
    'insight.word.less',
    'insight.count.days',
  ),
  'training-load-jump': trainingLoad,
  'efficiency-trend-running': efficiency('insight.activity.running'),
  'efficiency-trend-cycling': efficiency('insight.activity.cycling'),
  'efficiency-trend-walking': efficiency('insight.activity.walking'),
  'efficiency-trend-swimming': efficiency('insight.activity.swimming'),
  'baseline-drift-restingHeartRate': drift('insight.label.restingHeartRate', 'bpm'),
  'baseline-drift-hrv': drift('insight.label.hrv', 'ms'),
  'baseline-drift-respiratoryRate': drift('insight.label.respiratoryRate', 'breaths'),
  'baseline-drift-bodyMass': drift('insight.label.bodyMass', 'kg'),
  'baseline-drift-sleepDuration': drift('insight.label.sleepDuration', 'h'),
  'sleep-debt': sleepDebt,
  'social-jetlag': socialJetlag,
}

/**
 * The composed title and detail, or `null` when this build does not know the
 * rule or the values do not carry what its sentence needs. `null` is a real
 * answer: the server's own sentence is the fallback for exactly that case.
 */
export function composeInsight(
  rule: string | undefined,
  values: Record<string, number> | undefined,
  c: InsightTextContext,
): Composed | null {
  if (!rule || !values || !Object.prototype.hasOwnProperty.call(WORDINGS, rule)) return null
  try {
    return WORDINGS[rule](reader(values), c)
  } catch (e) {
    if (e instanceof Missing) return null
    throw e
  }
}

/**
 * The rule stem of an id (`baseline-drift-bodyMass:2026-08-11` →
 * `baseline-drift-bodyMass`), for a server that predates the `rule` field. Splits
 * on the LAST colon: the stem itself has hyphens, the day is at the end.
 */
export function ruleFromId(id?: string): string | undefined {
  if (!id) return undefined
  const colon = id.lastIndexOf(':')
  if (colon <= 0) return undefined
  return id.slice(0, colon)
}

/** What to print for one observation: ours where we can, the server's otherwise. */
export function insightText(insight: Insight, c: InsightTextContext): InsightText {
  const composed = composeInsight(insight.rule ?? ruleFromId(insight.id), insight.values, c)
  if (composed) return { ...composed, fallback: false }
  return {
    title: insight.title?.trim() || undefined,
    detail: insight.detail?.trim() || undefined,
    fallback: true,
  }
}

/** `insightText`, bound to the interface language. */
export function useInsightText(): (insight: Insight) => InsightText {
  const { t, locale } = useI18n()
  return useMemo(() => {
    const c: InsightTextContext = { t, locale }
    return (insight: Insight) => insightText(insight, c)
  }, [t, locale])
}
