// Formatters.
//
// ⚠️ The output here is USER-FACING product copy, and it is Hungarian — the number
// formatting, the unit labels, the activity and sleep-stage names alike. The
// comments are English, the strings are not; do not "translate" them in passing.
// Switching unit systems (metric/imperial) will hang off /v1/settings (docs/20 B4)
// — for now everything is metric.

const nf0 = new Intl.NumberFormat('hu-HU', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('hu-HU', { maximumFractionDigits: 1 })

export const num = (v?: number | null) => (v == null ? '–' : nf0.format(v))
export const num1 = (v?: number | null) => (v == null ? '–' : nf1.format(v))

// The useful precision differs per metric: on a step count a decimal is noise,
// while for copper (mg) a whole number would swallow everything. The catalog says
// how many decimals are needed (metrics.ts → MetricDef.digits).
const nfCache = new Map<number, Intl.NumberFormat>()
function nf(digits: number): Intl.NumberFormat {
  let f = nfCache.get(digits)
  if (!f) {
    f = new Intl.NumberFormat('hu-HU', { maximumFractionDigits: digits })
    nfCache.set(digits, f)
  }
  return f
}

/** A decimal-aware number. `fmt(1234.56, 1)` → "1 234,6". */
export const fmt = (v?: number | null, digits = 0) => (v == null ? '–' : nf(digits).format(v))

/** A ratio in 0..1 → "63%". */
export const percent = (v?: number | null, digits = 0) =>
  v == null || !Number.isFinite(v) ? '–' : `${nf(digits).format(v * 100)}%`

export function km(meters?: number | null): string {
  if (meters == null) return '–'
  return meters >= 1000 ? `${nf1.format(meters / 1000)} km` : `${nf0.format(meters)} m`
}

/** A duration given or computed in minutes → "1 ó 24 p", "2 óra", "45 p". */
export function duration(minutes?: number | null): string {
  if (minutes == null) return '–'
  const m = Math.round(minutes)
  const h = Math.floor(m / 60)
  const rest = m % 60
  if (h === 0) return `${rest} p`
  // On a whole hour, do not print "0 p".
  return rest === 0 ? `${h} óra` : `${h} ó ${rest} p`
}

/** Turns the backend's SI/HealthKit units into human Hungarian forms. */
export function unitLabel(unit?: string): string {
  if (!unit) return ''
  switch (unit) {
    case 'count':
      return '' // a step count needs no unit
    case 'count/min':
      return '/perc'
    case 'min':
      return 'perc'
    case 'h':
      return 'óra'
    default:
      return unit // kcal, ms, m, km — these can stay as they are
  }
}

export function durationBetween(a?: string, b?: string): string {
  if (!a || !b) return '–'
  return duration((new Date(b).getTime() - new Date(a).getTime()) / 60000)
}

export function date(iso?: string): string {
  if (!iso) return '–'
  return new Date(iso).toLocaleDateString('hu-HU', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function dateTime(iso?: string): string {
  if (!iso) return '–'
  return new Date(iso).toLocaleString('hu-HU', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function time(iso?: string): string {
  if (!iso) return '–'
  return new Date(iso).toLocaleTimeString('hu-HU', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** "3 perce", "tegnap", "5 napja" — for showing how fresh the sync is. */
export function relative(iso?: string): string {
  if (!iso) return 'soha'
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.round(diff / 60000)
  if (min < 1) return 'épp most'
  if (min < 60) return `${min} perce`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} órája`
  const d = Math.round(h / 24)
  return d === 1 ? 'tegnap' : `${d} napja`
}

const ACTIVITY_HU: Record<string, string> = {
  running: 'Futás',
  walking: 'Séta',
  cycling: 'Kerékpár',
  hiking: 'Túra',
  swimming: 'Úszás',
  strengthTraining: 'Erősítés',
  functionalStrengthTraining: 'Funkcionális erősítés',
  traditionalStrengthTraining: 'Súlyzós edzés',
  yoga: 'Jóga',
  rowing: 'Evezés',
  elliptical: 'Elliptikus',
  highIntensityIntervalTraining: 'HIIT',
  other: 'Egyéb',
}
export const activityName = (t?: string) => (t ? (ACTIVITY_HU[t] ?? t) : '–')

const STAGE_HU: Record<string, string> = {
  deep: 'Mély',
  rem: 'REM',
  core: 'Alap',
  light: 'Könnyű',
  awake: 'Ébren',
  inBed: 'Ágyban',
  asleep: 'Alvás',
}
export const stageName = (s?: string) => (s ? (STAGE_HU[s] ?? s) : '–')

/** The drawing order of the stages: from deep sleep to being awake. */
export const STAGE_ORDER = ['deep', 'rem', 'core', 'light', 'asleep', 'awake']

/** Does it count as sleep? (Efficiency and total sleep time are built from these.) */
export const isAsleep = (stage?: string) =>
  !!stage && stage !== 'awake' && stage !== 'inBed'

/**
 * A Recharts-friendly stage palette. `color-mix()` is reliable as an HTML
 * `background`, but not everywhere as an SVG presentation attribute — so in the
 * charts a base colour plus an opacity produces the same gradation.
 */
export const STAGE_CHART: Record<string, { fill: string; opacity: number }> = {
  deep: { fill: 'var(--helsa-nordlys)', opacity: 1 },
  rem: { fill: 'var(--helsa-fjord)', opacity: 1 },
  core: { fill: 'var(--helsa-nordlys)', opacity: 0.55 },
  light: { fill: 'var(--helsa-nordlys)', opacity: 0.35 },
  asleep: { fill: 'var(--helsa-nordlys)', opacity: 0.75 },
  awake: { fill: 'var(--helsa-ember)', opacity: 1 },
}

export const STAGE_COLOR: Record<string, string> = {
  deep: 'var(--helsa-nordlys)',
  rem: 'var(--helsa-fjord)',
  core: 'color-mix(in srgb, var(--helsa-nordlys) 55%, var(--surface))',
  light: 'color-mix(in srgb, var(--helsa-nordlys) 40%, var(--surface))',
  asleep: 'color-mix(in srgb, var(--helsa-nordlys) 75%, var(--surface))',
  awake: 'var(--helsa-ember)',
}

// The metric catalog (name, unit, group, colour, aggregation) lives in
// lib/metrics.ts — that one is not about five metrics but about the whole HealthKit
// quantity list.
