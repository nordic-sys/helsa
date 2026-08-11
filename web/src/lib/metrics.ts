// The metric catalog — the full list of HealthKit quantity types (docs/23 §3).
//
// The backend's `data_type` is an open string, so any type can be stored and
// queried. This catalog describes the PRESENTATION: display name, unit, group,
// colour, decimal places and — most importantly — the **nature of the
// aggregation**.
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

import type { MetricSeries } from '../api/types'

export type MetricGroupKey =
  | 'activity'
  | 'heart'
  | 'respiratory'
  | 'body'
  | 'macro'
  | 'mineral'
  | 'vitamin'
  | 'mobility'
  | 'environment'
  | 'other'

/** `sum`: cumulative, to be added up over the period. `avg`: an instantaneous
 * measurement, to be averaged. */
export type MetricAgg = 'sum' | 'avg'

export type MetricDef = {
  key: string
  label: string
  /** The unit to display. An empty string means it need not be printed. */
  unit: string
  group: MetricGroupKey
  agg: MetricAgg
  digits: number
  color: string
  /** Further wire names this same metric may arrive under. */
  aliases: string[]
}

export const METRIC_GROUPS: { key: MetricGroupKey; label: string; color: string }[] = [
  { key: 'activity', label: 'Aktivitás', color: 'var(--helsa-move)' },
  { key: 'heart', label: 'Szív', color: 'var(--helsa-pulse)' },
  { key: 'respiratory', label: 'Légzés', color: 'var(--helsa-fjord)' },
  { key: 'body', label: 'Testösszetétel', color: 'var(--helsa-nordlys)' },
  { key: 'macro', label: 'Táplálkozás — makrók', color: 'var(--helsa-ember)' },
  { key: 'mineral', label: 'Táplálkozás — ásványi', color: 'var(--helsa-fjord)' },
  { key: 'vitamin', label: 'Táplálkozás — vitaminok', color: 'var(--helsa-move)' },
  { key: 'mobility', label: 'Mobilitás', color: 'var(--helsa-nordlys)' },
  { key: 'environment', label: 'Környezet', color: 'var(--helsa-fjord)' },
  { key: 'other', label: 'Egyéb', color: 'var(--helsa-pulse)' },
]

const GROUP_COLOR = new Map(METRIC_GROUPS.map((g) => [g.key, g.color]))

export function groupLabel(g: MetricGroupKey): string {
  return METRIC_GROUPS.find((x) => x.key === g)?.label ?? g
}

/** [wire name, display name, unit, aggregation, decimal places, overrides?] */
type Row = [
  string,
  string,
  string,
  MetricAgg,
  number,
  { color?: string; aliases?: string[] }?,
]

// --- 3.1 Activity and movement -----------------------------------------------
const ACTIVITY: Row[] = [
  ['stepCount', 'Lépés', '', 'sum', 0, { color: 'var(--helsa-move)' }],
  ['distanceWalkingRunning', 'Gyaloglás/futás táv', 'm', 'sum', 0],
  ['distanceCycling', 'Kerékpáros táv', 'm', 'sum', 0],
  ['distanceSwimming', 'Úszott táv', 'm', 'sum', 0],
  ['distanceWheelchair', 'Kerekesszékes táv', 'm', 'sum', 0],
  ['distanceDownhillSnowSports', 'Lesiklott táv', 'm', 'sum', 0],
  ['pushCount', 'Tolások', '', 'sum', 0],
  ['swimmingStrokeCount', 'Úszótempók', '', 'sum', 0],
  ['flightsClimbed', 'Megmászott emelet', '', 'sum', 0],
  [
    'activeEnergy',
    'Aktív energia',
    'kcal',
    'sum',
    0,
    { color: 'var(--helsa-ember)', aliases: ['activeEnergyBurned'] },
  ],
  ['basalEnergyBurned', 'Alapanyagcsere-energia', 'kcal', 'sum', 0],
  ['appleExerciseTime', 'Edzésidő', 'perc', 'sum', 0],
  ['appleMoveTime', 'Mozgásidő', 'perc', 'sum', 0],
  ['appleStandTime', 'Állásidő', 'perc', 'sum', 0],
  ['nikeFuel', 'Nike Fuel', '', 'sum', 0],
  ['physicalEffort', 'Fizikai megterhelés', 'kcal/ó/kg', 'avg', 1],
]

// --- 3.2 Heart and circulation -----------------------------------------------
const HEART: Row[] = [
  ['heartRate', 'Pulzus', '/perc', 'avg', 0, { color: 'var(--helsa-pulse)' }],
  ['restingHeartRate', 'Nyugalmi pulzus', '/perc', 'avg', 0, { color: 'var(--helsa-pulse)' }],
  ['walkingHeartRateAverage', 'Séta közbeni pulzus', '/perc', 'avg', 0],
  [
    'hrv',
    'HRV (SDNN)',
    'ms',
    'avg',
    0,
    { color: 'var(--helsa-fjord)', aliases: ['heartRateVariabilitySDNN'] },
  ],
  ['heartRateRecoveryOneMinute', 'Pulzus-visszaállás (1 perc)', '/perc', 'avg', 0],
  ['atrialFibrillationBurden', 'Pitvarfibrilláció-arány', '%', 'avg', 1],
  ['bloodPressureSystolic', 'Vérnyomás — szisztolés', 'mmHg', 'avg', 0],
  ['bloodPressureDiastolic', 'Vérnyomás — diasztolés', 'mmHg', 'avg', 0],
  ['peripheralPerfusionIndex', 'Perifériás perfúziós index', '%', 'avg', 1],
  ['vo2Max', 'VO₂max', 'ml/kg/perc', 'avg', 1],
]

// --- 3.3 Respiration and blood oxygen ----------------------------------------
const RESPIRATORY: Row[] = [
  ['respiratoryRate', 'Légzésszám', '/perc', 'avg', 0],
  ['oxygenSaturation', 'Véroxigén (SpO₂)', '%', 'avg', 1],
  ['forcedVitalCapacity', 'Erőltetett vitálkapacitás', 'L', 'avg', 2],
  ['forcedExpiratoryVolume1', 'FEV1', 'L', 'avg', 2],
  ['peakExpiratoryFlowRate', 'Kilégzési csúcsáramlás', 'L/perc', 'avg', 0],
  ['inhalerUsage', 'Inhalátor-használat', '', 'sum', 0],
]

// --- 3.4 Body composition ----------------------------------------------------
const BODY: Row[] = [
  ['bodyMass', 'Testsúly', 'kg', 'avg', 1],
  ['bodyMassIndex', 'BMI', '', 'avg', 1],
  ['bodyFatPercentage', 'Testzsír', '%', 'avg', 1],
  ['leanBodyMass', 'Zsírmentes testtömeg', 'kg', 'avg', 1],
  ['height', 'Testmagasság', 'm', 'avg', 2],
  ['waistCircumference', 'Derékbőség', 'm', 'avg', 2],
  ['appleSleepingWristTemperature', 'Alvási csuklóhőmérséklet', '°C', 'avg', 2],
  ['bodyTemperature', 'Testhőmérséklet', '°C', 'avg', 1],
  ['basalBodyTemperature', 'Bazális testhőmérséklet', '°C', 'avg', 2],
]

// --- 3.5 Nutrition — macros --------------------------------------------------
const MACRO: Row[] = [
  ['dietaryEnergyConsumed', 'Bevitt energia', 'kcal', 'sum', 0, { color: 'var(--helsa-ember)' }],
  ['dietaryProtein', 'Fehérje', 'g', 'sum', 1, { color: 'var(--helsa-fjord)' }],
  ['dietaryCarbohydrates', 'Szénhidrát', 'g', 'sum', 1, { color: 'var(--helsa-ember)' }],
  ['dietaryFatTotal', 'Zsír (összes)', 'g', 'sum', 1, { color: 'var(--helsa-nordlys)' }],
  ['dietaryFiber', 'Rost', 'g', 'sum', 1],
  ['dietarySugar', 'Cukor', 'g', 'sum', 1],
  ['dietaryFatSaturated', 'Telített zsír', 'g', 'sum', 1],
  ['dietaryFatMonounsaturated', 'Egyszeresen telítetlen zsír', 'g', 'sum', 1],
  ['dietaryFatPolyunsaturated', 'Többszörösen telítetlen zsír', 'g', 'sum', 1],
  ['dietaryCholesterol', 'Koleszterin', 'mg', 'sum', 0],
  ['dietaryWater', 'Víz', 'mL', 'sum', 0],
  ['dietaryCaffeine', 'Koffein', 'mg', 'sum', 0],
]

// --- 3.6 Nutrition — minerals ------------------------------------------------
const MINERAL: Row[] = [
  ['dietaryCalcium', 'Kalcium', 'mg', 'sum', 0],
  ['dietaryIron', 'Vas', 'mg', 'sum', 1],
  ['dietaryMagnesium', 'Magnézium', 'mg', 'sum', 0],
  ['dietaryPhosphorus', 'Foszfor', 'mg', 'sum', 0],
  ['dietaryPotassium', 'Kálium', 'mg', 'sum', 0],
  ['dietarySodium', 'Nátrium', 'mg', 'sum', 0],
  ['dietaryZinc', 'Cink', 'mg', 'sum', 1],
  ['dietaryChloride', 'Klorid', 'mg', 'sum', 0],
  ['dietaryChromium', 'Króm', 'µg', 'sum', 1],
  ['dietaryCopper', 'Réz', 'mg', 'sum', 2],
  ['dietaryIodine', 'Jód', 'µg', 'sum', 1],
  ['dietaryManganese', 'Mangán', 'mg', 'sum', 2],
  ['dietaryMolybdenum', 'Molibdén', 'µg', 'sum', 1],
  ['dietarySelenium', 'Szelén', 'µg', 'sum', 1],
]

// --- 3.7 Nutrition — vitamins ------------------------------------------------
const VITAMIN: Row[] = [
  ['dietaryVitaminA', 'A-vitamin', 'µg', 'sum', 1],
  ['dietaryVitaminB6', 'B6-vitamin', 'mg', 'sum', 2],
  ['dietaryVitaminB12', 'B12-vitamin', 'µg', 'sum', 1],
  ['dietaryVitaminC', 'C-vitamin', 'mg', 'sum', 1],
  ['dietaryVitaminD', 'D-vitamin', 'µg', 'sum', 1],
  ['dietaryVitaminE', 'E-vitamin', 'mg', 'sum', 1],
  ['dietaryVitaminK', 'K-vitamin', 'µg', 'sum', 1],
  ['dietaryThiamin', 'Tiamin (B1)', 'mg', 'sum', 2],
  ['dietaryRiboflavin', 'Riboflavin (B2)', 'mg', 'sum', 2],
  ['dietaryNiacin', 'Niacin (B3)', 'mg', 'sum', 1],
  ['dietaryFolate', 'Folát (B9)', 'µg', 'sum', 1],
  ['dietaryBiotin', 'Biotin (B7)', 'µg', 'sum', 1],
  ['dietaryPantothenicAcid', 'Pantoténsav (B5)', 'mg', 'sum', 2],
]

// --- 3.8 Mobility and gait ---------------------------------------------------
const MOBILITY: Row[] = [
  ['walkingSpeed', 'Gyaloglási sebesség', 'm/s', 'avg', 2],
  ['walkingStepLength', 'Lépéshossz', 'm', 'avg', 2],
  ['walkingAsymmetryPercentage', 'Járás-aszimmetria', '%', 'avg', 1],
  ['walkingDoubleSupportPercentage', 'Kettős támaszfázis', '%', 'avg', 1],
  ['sixMinuteWalkTestDistance', '6 perces séta-teszt', 'm', 'avg', 0],
  ['stairAscentSpeed', 'Lépcsőn fel — sebesség', 'm/s', 'avg', 2],
  ['stairDescentSpeed', 'Lépcsőn le — sebesség', 'm/s', 'avg', 2],
  ['appleWalkingSteadiness', 'Járásstabilitás', '%', 'avg', 1],
  ['runningSpeed', 'Futósebesség', 'm/s', 'avg', 2],
  ['runningPower', 'Futóteljesítmény', 'W', 'avg', 0],
  ['runningStrideLength', 'Futó lépéshossz', 'm', 'avg', 2],
  ['runningVerticalOscillation', 'Függőleges kilengés', 'cm', 'avg', 1],
  ['runningGroundContactTime', 'Talajérintési idő', 'ms', 'avg', 0],
]

// --- 3.9 Environment and hearing ---------------------------------------------
const ENVIRONMENT: Row[] = [
  ['environmentalAudioExposure', 'Környezeti hangterhelés', 'dB', 'avg', 0],
  ['headphoneAudioExposure', 'Fejhallgató-hangterhelés', 'dB', 'avg', 0],
  ['environmentalSoundReduction', 'Zajcsökkentés', 'dB', 'avg', 0],
  ['timeInDaylight', 'Napfényben töltött idő', 'perc', 'sum', 0],
  ['uvExposure', 'UV-terhelés', '', 'avg', 1],
]

// --- 3.10 Other --------------------------------------------------------------
const OTHER: Row[] = [
  ['bloodGlucose', 'Vércukor', 'mg/dL', 'avg', 0],
  ['bloodAlcoholContent', 'Véralkohol', '%', 'avg', 3],
  ['insulinDelivery', 'Inzulin-bevitel', 'IU', 'sum', 1],
  ['numberOfTimesFallen', 'Elesések', '', 'sum', 0],
  ['electrodermalActivity', 'Bőrvezetés', 'S', 'avg', 2],
  ['waterTemperature', 'Vízhőmérséklet', '°C', 'avg', 1],
  ['underwaterDepth', 'Merülési mélység', 'm', 'avg', 1],
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
  rows.map(([key, label, unit, agg, digits, extra]) => ({
    key,
    label,
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
 * raw than that it disappears.
 */
export function metricDef(key: string): MetricDef {
  const known = METRICS[key]
  if (known) return known
  return {
    key,
    label: humanize(key),
    unit: '',
    group: 'other',
    agg: 'avg',
    digits: 1,
    color: 'var(--text-dim)',
    aliases: [],
  }
}

/** `dietaryVitaminB12` → `Dietary vitamin b12` — for unknown types only. */
function humanize(key: string): string {
  const s = key.replace(/([A-Z])/g, ' $1').trim()
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
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
