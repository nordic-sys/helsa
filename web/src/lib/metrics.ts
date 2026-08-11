// The metric catalog — the full list of HealthKit quantity types (docs/23 §3).
//
// The backend's `data_type` is an open string, so any type can be stored and
// queried. This catalog describes the PRESENTATION: unit, group, colour, decimal
// places and — most importantly — the **nature of the aggregation**.
//
// ⚠️ Summed vs averaged: this is not cosmetics but correctness. Steps and calories
// consumed have to be ADDED UP; heart rate and body weight have to be AVERAGED. A
// daily "average step sample" is exactly as meaningless a number as a "daily total
// heart rate".
//
// The key is the wire name: the HealthKit identifier without its prefix, in
// lowerCamelCase (`HKQuantityTypeIdentifierDietaryEnergyConsumed` →
// `dietaryEnergyConsumed`). Where the backend knows a different short name
// (`activeEnergy`, `hrv`), THAT is the key — because those are the only ones it
// returns a correct `agg`/`unit`/`total` for — and the HealthKit name becomes an
// alias. On query we ask for both, and whichever has data wins.
//
// ⚠️ The DISPLAY NAMES are not here: they live in `src/i18n/`, one set per
// language, and `MetricKey` is derived from that dictionary — so a metric added
// here without a translation is a compile error, not a blank label.

import type { MetricSeries } from '../api/types'
import type { GroupKey, MetricKey } from '../i18n/types'

export type MetricGroupKey = GroupKey

/** `sum`: cumulative, to be added up over the period. `avg`: an instantaneous
 * measurement, to be averaged. */
export type MetricAgg = 'sum' | 'avg'

export type MetricDef = {
  key: string
  /**
   * The unit to display, as a CANONICAL token — the same vocabulary the server
   * speaks (`min`, `count/min`), not a pre-translated word. `i18n.tUnit()` turns
   * it into something readable; anything it does not recognise (`kcal`, `mg`,
   * `°C`) reads the same in either language and passes through. An empty string
   * means it need not be printed.
   */
  unit: string
  group: MetricGroupKey
  agg: MetricAgg
  digits: number
  color: string
  /** Further wire names this same metric may arrive under. */
  aliases: string[]
}

export const METRIC_GROUPS: { key: MetricGroupKey; color: string }[] = [
  { key: 'activity', color: 'var(--helsa-move)' },
  { key: 'heart', color: 'var(--helsa-pulse)' },
  { key: 'respiratory', color: 'var(--helsa-fjord)' },
  { key: 'body', color: 'var(--helsa-nordlys)' },
  { key: 'macro', color: 'var(--helsa-ember)' },
  { key: 'mineral', color: 'var(--helsa-fjord)' },
  { key: 'vitamin', color: 'var(--helsa-move)' },
  { key: 'mobility', color: 'var(--helsa-nordlys)' },
  { key: 'environment', color: 'var(--helsa-fjord)' },
  { key: 'other', color: 'var(--helsa-pulse)' },
]

const GROUP_COLOR = new Map(METRIC_GROUPS.map((g) => [g.key, g.color]))

/** [wire name, unit, aggregation, decimal places, overrides?] */
type Row = [MetricKey, string, MetricAgg, number, { color?: string; aliases?: string[] }?]

// --- 3.1 Activity and movement -----------------------------------------------
const ACTIVITY: Row[] = [
  ['stepCount', '', 'sum', 0, { color: 'var(--helsa-move)' }],
  ['distanceWalkingRunning', 'm', 'sum', 0],
  ['distanceCycling', 'm', 'sum', 0],
  ['distanceSwimming', 'm', 'sum', 0],
  ['distanceWheelchair', 'm', 'sum', 0],
  ['distanceDownhillSnowSports', 'm', 'sum', 0],
  ['pushCount', '', 'sum', 0],
  ['swimmingStrokeCount', '', 'sum', 0],
  ['flightsClimbed', '', 'sum', 0],
  [
    'activeEnergy',
    'kcal',
    'sum',
    0,
    { color: 'var(--helsa-ember)', aliases: ['activeEnergyBurned'] },
  ],
  ['basalEnergyBurned', 'kcal', 'sum', 0],
  ['appleExerciseTime', 'min', 'sum', 0],
  ['appleMoveTime', 'min', 'sum', 0],
  ['appleStandTime', 'min', 'sum', 0],
  ['nikeFuel', '', 'sum', 0],
  ['physicalEffort', 'kcal/hr/kg', 'avg', 1],
]

// --- 3.2 Heart and circulation -----------------------------------------------
const HEART: Row[] = [
  ['heartRate', 'count/min', 'avg', 0, { color: 'var(--helsa-pulse)' }],
  ['restingHeartRate', 'count/min', 'avg', 0, { color: 'var(--helsa-pulse)' }],
  ['walkingHeartRateAverage', 'count/min', 'avg', 0],
  ['hrv', 'ms', 'avg', 0, { color: 'var(--helsa-fjord)', aliases: ['heartRateVariabilitySDNN'] }],
  ['heartRateRecoveryOneMinute', 'count/min', 'avg', 0],
  ['atrialFibrillationBurden', '%', 'avg', 1],
  ['bloodPressureSystolic', 'mmHg', 'avg', 0],
  ['bloodPressureDiastolic', 'mmHg', 'avg', 0],
  ['peripheralPerfusionIndex', '%', 'avg', 1],
  ['vo2Max', 'ml/kg/min', 'avg', 1],
]

// --- 3.3 Respiration and blood oxygen ----------------------------------------
const RESPIRATORY: Row[] = [
  ['respiratoryRate', 'count/min', 'avg', 0],
  ['oxygenSaturation', '%', 'avg', 1],
  ['forcedVitalCapacity', 'L', 'avg', 2],
  ['forcedExpiratoryVolume1', 'L', 'avg', 2],
  ['peakExpiratoryFlowRate', 'L/min', 'avg', 0],
  ['inhalerUsage', '', 'sum', 0],
]

// --- 3.4 Body composition ----------------------------------------------------
const BODY: Row[] = [
  ['bodyMass', 'kg', 'avg', 1],
  ['bodyMassIndex', '', 'avg', 1],
  ['bodyFatPercentage', '%', 'avg', 1],
  ['leanBodyMass', 'kg', 'avg', 1],
  ['height', 'm', 'avg', 2],
  ['waistCircumference', 'm', 'avg', 2],
  ['appleSleepingWristTemperature', '°C', 'avg', 2],
  ['bodyTemperature', '°C', 'avg', 1],
  ['basalBodyTemperature', '°C', 'avg', 2],
]

// --- 3.5 Nutrition — macros --------------------------------------------------
const MACRO: Row[] = [
  ['dietaryEnergyConsumed', 'kcal', 'sum', 0, { color: 'var(--helsa-ember)' }],
  ['dietaryProtein', 'g', 'sum', 1, { color: 'var(--helsa-fjord)' }],
  ['dietaryCarbohydrates', 'g', 'sum', 1, { color: 'var(--helsa-ember)' }],
  ['dietaryFatTotal', 'g', 'sum', 1, { color: 'var(--helsa-nordlys)' }],
  ['dietaryFiber', 'g', 'sum', 1],
  ['dietarySugar', 'g', 'sum', 1],
  ['dietaryFatSaturated', 'g', 'sum', 1],
  ['dietaryFatMonounsaturated', 'g', 'sum', 1],
  ['dietaryFatPolyunsaturated', 'g', 'sum', 1],
  ['dietaryCholesterol', 'mg', 'sum', 0],
  ['dietaryWater', 'mL', 'sum', 0],
  ['dietaryCaffeine', 'mg', 'sum', 0],
]

// --- 3.6 Nutrition — minerals ------------------------------------------------
const MINERAL: Row[] = [
  ['dietaryCalcium', 'mg', 'sum', 0],
  ['dietaryIron', 'mg', 'sum', 1],
  ['dietaryMagnesium', 'mg', 'sum', 0],
  ['dietaryPhosphorus', 'mg', 'sum', 0],
  ['dietaryPotassium', 'mg', 'sum', 0],
  ['dietarySodium', 'mg', 'sum', 0],
  ['dietaryZinc', 'mg', 'sum', 1],
  ['dietaryChloride', 'mg', 'sum', 0],
  ['dietaryChromium', 'µg', 'sum', 1],
  ['dietaryCopper', 'mg', 'sum', 2],
  ['dietaryIodine', 'µg', 'sum', 1],
  ['dietaryManganese', 'mg', 'sum', 2],
  ['dietaryMolybdenum', 'µg', 'sum', 1],
  ['dietarySelenium', 'µg', 'sum', 1],
]

// --- 3.7 Nutrition — vitamins ------------------------------------------------
const VITAMIN: Row[] = [
  ['dietaryVitaminA', 'µg', 'sum', 1],
  ['dietaryVitaminB6', 'mg', 'sum', 2],
  ['dietaryVitaminB12', 'µg', 'sum', 1],
  ['dietaryVitaminC', 'mg', 'sum', 1],
  ['dietaryVitaminD', 'µg', 'sum', 1],
  ['dietaryVitaminE', 'mg', 'sum', 1],
  ['dietaryVitaminK', 'µg', 'sum', 1],
  ['dietaryThiamin', 'mg', 'sum', 2],
  ['dietaryRiboflavin', 'mg', 'sum', 2],
  ['dietaryNiacin', 'mg', 'sum', 1],
  ['dietaryFolate', 'µg', 'sum', 1],
  ['dietaryBiotin', 'µg', 'sum', 1],
  ['dietaryPantothenicAcid', 'mg', 'sum', 2],
]

// --- 3.8 Mobility and gait ---------------------------------------------------
const MOBILITY: Row[] = [
  ['walkingSpeed', 'm/s', 'avg', 2],
  ['walkingStepLength', 'm', 'avg', 2],
  ['walkingAsymmetryPercentage', '%', 'avg', 1],
  ['walkingDoubleSupportPercentage', '%', 'avg', 1],
  ['sixMinuteWalkTestDistance', 'm', 'avg', 0],
  ['stairAscentSpeed', 'm/s', 'avg', 2],
  ['stairDescentSpeed', 'm/s', 'avg', 2],
  ['appleWalkingSteadiness', '%', 'avg', 1],
  ['runningSpeed', 'm/s', 'avg', 2],
  ['runningPower', 'W', 'avg', 0],
  ['runningStrideLength', 'm', 'avg', 2],
  ['runningVerticalOscillation', 'cm', 'avg', 1],
  ['runningGroundContactTime', 'ms', 'avg', 0],
]

// --- 3.9 Environment and hearing ---------------------------------------------
const ENVIRONMENT: Row[] = [
  ['environmentalAudioExposure', 'dB', 'avg', 0],
  ['headphoneAudioExposure', 'dB', 'avg', 0],
  ['environmentalSoundReduction', 'dB', 'avg', 0],
  ['timeInDaylight', 'min', 'sum', 0],
  ['uvExposure', '', 'avg', 1],
]

// --- 3.10 Other --------------------------------------------------------------
const OTHER: Row[] = [
  ['bloodGlucose', 'mg/dL', 'avg', 0],
  ['bloodAlcoholContent', '%', 'avg', 3],
  ['insulinDelivery', 'IU', 'sum', 1],
  ['numberOfTimesFallen', '', 'sum', 0],
  ['electrodermalActivity', 'S', 'avg', 2],
  ['waterTemperature', '°C', 'avg', 1],
  ['underwaterDepth', 'm', 'avg', 1],
]

const SOURCE: [MetricGroupKey, Row[]][] = [
  ['activity', ACTIVITY],
  ['heart', HEART],
  ['respiratory', RESPIRATORY],
  ['body', BODY],
  ['macro', MACRO],
  ['mineral', MINERAL],
  ['vitamin', VITAMIN],
  ['mobility', MOBILITY],
  ['environment', ENVIRONMENT],
  ['other', OTHER],
]

/** The catalog in order — the groups follow the order of docs/23 §3. */
export const METRIC_LIST: MetricDef[] = SOURCE.flatMap(([group, rows]) =>
  rows.map(([key, unit, agg, digits, extra]) => ({
    key,
    unit,
    group,
    agg,
    digits,
    color: extra?.color ?? GROUP_COLOR.get(group) ?? 'var(--helsa-fjord)',
    aliases: extra?.aliases ?? [],
  })),
)

/** Key (and alias) → definition. */
export const METRICS: Record<string, MetricDef> = Object.fromEntries(
  METRIC_LIST.flatMap((d) => [d.key, ...d.aliases].map((k) => [k, d] as const)),
)

/** Every wire name worth asking the server for (keys + aliases). */
export const ALL_WIRE_NAMES: string[] = METRIC_LIST.flatMap((d) => [d.key, ...d.aliases])

export const metricsOfGroup = (g: MetricGroupKey) => METRIC_LIST.filter((d) => d.group === g)

/**
 * Give an unknown wire name a usable definition too: the catalog is a snapshot of
 * docs/23, whereas HealthKit grows with every iOS release. Better that it shows up
 * raw than that it disappears — `i18n.tMetric()` humanises the name for it.
 */
export function metricDef(key: string): MetricDef {
  const known = METRICS[key]
  if (known) return known
  return {
    key,
    unit: '',
    group: 'other',
    agg: 'avg',
    digits: 1,
    color: 'var(--text-dim)',
    aliases: [],
  }
}

// --- Reading a series --------------------------------------------------------

export type Point = { t: string; value: number | null; min: number | null; max: number | null }

export type ReadSeries = {
  points: Point[]
  /**
   * The unit to display. **What the server sent wins**, if anything: that chain
   * originates in the iOS catalog, which is verified against the real SDK. The
   * catalog's own `unit` only comes into play when there is no data, i.e. when
   * there is nothing to ask the server about. Without this rule the truth about
   * units would live in three places — and they did drift apart: `dietaryWater`
   * was in L here and in mL in the SDK.
   *
   * Still a canonical token, not a display string: run it through `tUnit()`.
   */
  unit: string
  /** What the RECEIVED data actually carries — not necessarily what the catalog
   * intended. */
  effectiveAgg: MetricAgg
  /** The sum (sum) or the average (avg) over the period — computed client-side. */
  total: number | null
  hasData: boolean
  /**
   * For a metric the catalog says should be summed, the server returned only an
   * average. In that case the daily TOTAL cannot be reconstructed (the bucket
   * carries no count), and the UI MUST say so, otherwise we show a false number.
   */
  degraded: boolean
}

/**
 * Reads the point series belonging to the given metric out of a `MetricSeries`.
 *
 * The server's `agg` field is the primary source, but it only carries a value for
 * the handful of metrics the server knows by name (`internal/summary/summary.go`
 * metricMeta) — for every other type an empty `agg`, buckets without `v` and
 * `total: 0` come back. So we infer from the actual bucket contents, and the
 * catalog is only the last-resort fallback.
 */
export function readSeries(def: MetricDef, series?: MetricSeries): ReadSeries {
  const buckets = series?.buckets ?? []
  const hasV = buckets.some((b) => b.v != null)
  const hasAvg = buckets.some((b) => b.avg != null)
  const effectiveAgg: MetricAgg = hasV ? 'sum' : hasAvg ? 'avg' : (series?.agg ?? def.agg)

  const points: Point[] = buckets.map((b) => ({
    t: b.t ?? '',
    value: (effectiveAgg === 'sum' ? b.v : b.avg) ?? null,
    min: b.min ?? null,
    max: b.max ?? null,
  }))

  const values = points.map((p) => p.value).filter((v): v is number => v != null)
  const total =
    values.length === 0
      ? null
      : effectiveAgg === 'sum'
        ? values.reduce((s, v) => s + v, 0)
        : values.reduce((s, v) => s + v, 0) / values.length

  return {
    points,
    unit: series?.unit || def.unit,
    effectiveAgg,
    total,
    hasData: values.length > 0,
    degraded: def.agg === 'sum' && effectiveAgg === 'avg',
  }
}

/**
 * One metric's series out of the summary response, trying the aliases too.
 * It returns whichever has any data at all; if none does, the first one.
 */
export function pickSeries(
  def: MetricDef,
  metrics?: Record<string, MetricSeries>,
): MetricSeries | undefined {
  if (!metrics) return undefined
  const names = [def.key, ...def.aliases]
  for (const n of names) {
    const s = metrics[n]
    if (s?.buckets?.some((b) => b.v != null || b.avg != null)) return s
  }
  for (const n of names) {
    if (metrics[n]) return metrics[n]
  }
  return undefined
}
