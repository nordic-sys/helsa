// One session, opened — the web's copy of the phone's `WorkoutMetadata`,
// `WorkoutWeather`, `WorkoutLap`, `WorkoutPace`, `WorkoutRouteTrack` and
// `WorkoutHeartRateSeries`.
//
// # Why a copy again
//
// The same reason as `lib/workouts.ts`: the `metadata` object is a contract
// **between the clients**, written by the phone and stored untouched by the
// server (`WorkoutMetadata.swift`). If the web guessed at the key names or the
// units, the two screens would disagree about the same jsonb — and the
// disagreement would be silent, because nothing on either side validates it.
//
// Everything here is a pure function over data. No React, no formatting: the
// wording and the locale belong to the page, and the arithmetic belongs here,
// where a test can reach it. Every rule below broke something on the phone
// first; the comments say what.

import type { RoutePoint, Sample, Workout } from '../api/types'

// --- The metadata object -----------------------------------------------------
//
// ⚠️ The keys are **snake_case on the wire**, and that is measured rather than
// assumed. The phone's `APIClient` rewrites `CodingKeys` into snake_case but
// leaves free dictionary keys untouched, so what the phone writes into
// `metadata` is what arrives here, character for character.

const WEATHER_KEY = 'weather'
const LAPS_KEY = 'laps'
const INDOOR_KEY = 'indoor'
const LAP_LENGTH_KEY = 'lap_length_m'

function obj(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/** A finite number, or `undefined`. ⚠️ Never a fallback zero — every caller here
 * is asking about a measurement, and 0 is a measurement. */
function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

// --- Weather -----------------------------------------------------------------

/** The 27 `HKWeatherCondition` values, by their raw wire integer.
 *
 * ⚠️ 0 (`HKWeatherConditionNone`) is deliberately absent. That is not a weather
 * condition called "None", it is the absence of one — mapping it would put an
 * empty condition on every workout that has a temperature and nothing else. */
export const WEATHER_CONDITIONS: Record<number, string> = {
  1: 'clear',
  2: 'fair',
  3: 'partlyCloudy',
  4: 'mostlyCloudy',
  5: 'cloudy',
  6: 'foggy',
  7: 'haze',
  8: 'windy',
  9: 'blustery',
  10: 'smoky',
  11: 'dust',
  12: 'snow',
  13: 'hail',
  14: 'sleet',
  15: 'freezingDrizzle',
  16: 'freezingRain',
  17: 'mixedRainAndHail',
  18: 'mixedRainAndSnow',
  19: 'mixedRainAndSleet',
  20: 'mixedSnowAndSleet',
  21: 'drizzle',
  22: 'scatteredShowers',
  23: 'showers',
  24: 'thunderstorms',
  25: 'tropicalStorm',
  26: 'hurricane',
  27: 'tornado',
}

export type Weather = {
  temperatureC?: number
  /** 0…100. */
  humidityPercent?: number
  /** A key of `WEATHER_CONDITIONS`, not a sentence — the page words it. */
  condition?: string
}

/**
 * A humidity off the wire, onto the house 0…100 scale.
 *
 * ⚠️ **The scale cannot be trusted, so it is inferred — and the inference has to
 * match the phone's exactly.** `HKUnit.percent()` is documented as 0…1 and the
 * watch writes 0…100; the phone believed the documentation, multiplied by 100,
 * and printed **3 000%**. It now reads the scale off the value: at or below 1 is
 * a fraction, because an outdoor relative humidity of 1% does not occur on Earth
 * while 100% is fog and rain.
 *
 * ⛔ **Above 100 the answer is `undefined`, not a clamp to 100.** Rows carrying
 * the old bug's output are already stored on people's servers, and this is the
 * only thing that keeps them off the screen. Clamping would turn a value we know
 * to be broken into a measurement we invented — which `ADR-0007` forbids more
 * plainly than any of the rest of it.
 */
export function humidityPercent(raw: number): number | undefined {
  if (!Number.isFinite(raw) || raw < 0) return undefined
  const percent = raw <= 1 ? raw * 100 : raw
  return percent <= 100 ? percent : undefined
}

/** The weather out of `metadata`; `undefined` when not one field is readable —
 * which is the case for most workouts, because HealthKit only fills this in for
 * an outdoor session recorded with an Apple Watch. */
export function weatherFrom(metadata?: Record<string, unknown>): Weather | undefined {
  const raw = obj(metadata?.[WEATHER_KEY])
  if (!raw) return undefined
  const humidity = num(raw.humidity_pct)
  const condition = num(raw.condition)
  const out: Weather = {
    temperatureC: num(raw.temperature_c),
    humidityPercent: humidity == null ? undefined : humidityPercent(humidity),
    condition: condition == null ? undefined : WEATHER_CONDITIONS[Math.round(condition)],
  }
  const empty =
    out.temperatureC == null && out.humidityPercent == null && out.condition == null
  return empty ? undefined : out
}

// --- Laps --------------------------------------------------------------------

export type Lap = {
  index: number
  activityType: string
  startedAt: string
  endedAt?: string
  distanceM?: number
  energyKcal?: number
  avgHeartRate?: number
  maxHeartRate?: number
  /** Minutes, or `undefined` while the segment is still running. */
  durationMin?: number
}

/**
 * The laps out of `metadata`, sorted by index.
 *
 * ⚠️ **A single lap is not a lap.** HealthKit hands every iOS 16+ workout at
 * least one `HKWorkoutActivity` identical to the workout itself; drawing that
 * under a "Splits" heading would claim the person segmented the session when
 * they are only seeing the system's internal shape. Laps start at two.
 */
export function lapsFrom(metadata?: Record<string, unknown>): Lap[] {
  const arr = metadata?.[LAPS_KEY]
  if (!Array.isArray(arr)) return []
  const laps: Lap[] = []
  for (const entry of arr) {
    const o = obj(entry)
    if (!o) continue
    const index = num(o.index)
    const activityType = typeof o.activity === 'string' ? o.activity : undefined
    const startedAt = typeof o.started_at === 'string' ? o.started_at : undefined
    if (index == null || !activityType || !startedAt) continue
    const endedAt = typeof o.ended_at === 'string' ? o.ended_at : undefined
    laps.push({
      index,
      activityType,
      startedAt,
      endedAt,
      distanceM: num(o.distance_m),
      energyKcal: num(o.energy_kcal),
      avgHeartRate: num(o.avg_heart_rate),
      maxHeartRate: num(o.max_heart_rate),
      durationMin: minutesBetween(startedAt, endedAt),
    })
  }
  return laps.length >= 2 ? laps.sort((a, b) => a.index - b.index) : []
}

/** Pool length in metres (`HKMetadataKeyLapLength`), for swimming. */
export function poolLengthM(metadata?: Record<string, unknown>): number | undefined {
  const v = num(metadata?.[LAP_LENGTH_KEY])
  return v != null && v > 0 ? v : undefined
}

/** Indoor, outdoor, or **unknown**.
 *
 * ⚠️ `null` is a third answer, not a synonym for outdoor: a missing flag means
 * the recording app never wrote one, and inferring open sky from silence is how
 * a treadmill session ends up captioned "Outdoor". The list's `isIndoor` reads
 * the same key the same way (`lib/workouts.ts`). */
export function isIndoor(metadata?: Record<string, unknown>): boolean | null {
  const raw = metadata?.[INDOOR_KEY]
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'number') return raw !== 0
  if (typeof raw === 'string') return raw === 'true' || raw === '1'
  return null
}

/** Minutes between two instants; `undefined` when either is missing or unparseable.
 *
 * ⚠️ `undefined`, never 0. A segment with no end did not last no time. */
export function minutesBetween(from?: string, to?: string): number | undefined {
  if (!from || !to) return undefined
  const a = new Date(from).getTime()
  const b = new Date(to).getTime()
  if (Number.isNaN(a) || Number.isNaN(b)) return undefined
  const min = (b - a) / 60000
  return min > 0 ? min : undefined
}

// --- Pace --------------------------------------------------------------------

/** What the correct measure IS for an activity — it differs, and picking the
 * wrong one is a silent error rather than a visible one. */
export type PaceStyle = 'perKilometer' | 'per100Meters' | 'speed' | 'unavailable'

export function paceStyle(activityType?: string): PaceStyle {
  switch (activityType) {
    case 'running':
    case 'walking':
    case 'hiking':
      return 'perKilometer'
    // A per-kilometre pace makes no sense for a 1200 m swim.
    case 'swimming':
      return 'per100Meters'
    // These cover no distance at all, so there is nothing to divide.
    case 'yoga':
    case 'strength':
    case 'hiit':
      return 'unavailable'
    // Cycling and everything unknown: speed. For the unknown this is the SAFE
    // choice — forcing minutes/km onto a rowing session misleads, km/h does not.
    default:
      return 'speed'
  }
}

export type Pace =
  /** A clock reading — "5:24" — over a fixed distance. */
  | { kind: 'perKilometer' | 'per100Meters'; seconds: number }
  /** Kilometres per hour, as a number the page formats in its own locale. */
  | { kind: 'speed'; kmh: number }

/**
 * The pace or speed of a session.
 *
 * ⚠️ **Missing data is not zero.** With no distance or no duration the answer is
 * `undefined`, never "0:00 /km" — that reading would claim we measured the
 * session and the person did not move.
 */
export function paceOf(
  activityType?: string,
  distanceM?: number | null,
  durationMin?: number | null,
): Pace | undefined {
  if (distanceM == null || distanceM <= 0) return undefined
  if (durationMin == null || durationMin <= 0) return undefined
  const seconds = durationMin * 60
  switch (paceStyle(activityType)) {
    case 'unavailable':
      return undefined
    case 'perKilometer':
      return { kind: 'perKilometer', seconds: seconds / (distanceM / 1000) }
    case 'per100Meters':
      return { kind: 'per100Meters', seconds: seconds / (distanceM / 100) }
    case 'speed':
      return { kind: 'speed', kmh: distanceM / 1000 / (durationMin / 60) }
  }
}

/** Seconds → "5:24" / "1:02:30". The hour only appears when there is one. */
export function clock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

// --- The route ---------------------------------------------------------------

/**
 * Above this horizontal error a point is not drawn.
 *
 * ⚠️ **50 metres is a city block.** A fix that bad lands on the next street, and
 * because the line is continuous it draws a there-and-back loop that looks like
 * a road actually taken. GPS gives readings like that in the first seconds of a
 * workout and between tall buildings — without the filter every urban run has a
 * spike at its start.
 */
export const MAX_ACCURACY_M = 50

/** Within this, the start and the finish are the same place. */
export const LOOP_TOLERANCE_M = 80

/** Metres per degree of latitude. Good to a few tenths of a percent anywhere,
 * which is far below what a drawn route can show. */
const M_PER_DEG = 111_320

export type RouteTrack = {
  /** The drawable fixes, in increasing time order. */
  points: RoutePoint[]
  /** How many were dropped as too inaccurate. ⚠️ Not cosmetics: if half a
   * workout disappears the page has to say so rather than quietly draw a
   * shorter line. */
  droppedCount: number
  /** Whether it ends where it began — the start and finish markers would sit on
   * top of each other, and one marker saying "Start / Finish" is the honest
   * drawing of that. */
  closedLoop: boolean
  /** The length of the drawn line in metres. ⚠️ NOT the session's distance:
   * this is what the surviving fixes add up to, and the workout's own
   * `total_distance_m` is the measurement. Used for the scale bar only. */
  drawnLengthM: number
}

function plausible(p: RoutePoint): boolean {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return false
  if (Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) return false
  // ⚠️ A MISSING accuracy is a keeping case. Absence is not evidence of
  // badness, and an imported route has no `accuracy_m` at all.
  if (p.accuracy_m == null) return true
  return p.accuracy_m >= 0 && p.accuracy_m <= MAX_ACCURACY_M
}

/** Planar distance in metres. Over the span of one workout the curvature of the
 * Earth is far below the noise of GPS. */
export function metresBetween(a: RoutePoint, b: RoutePoint): number {
  const dLat = (b.lat - a.lat) * M_PER_DEG
  const dLon = (b.lon - a.lon) * M_PER_DEG * Math.cos((a.lat * Math.PI) / 180)
  return Math.sqrt(dLat * dLat + dLon * dLon)
}

export function routeTrack(raw: RoutePoint[] | undefined, maxAccuracyM = MAX_ACCURACY_M): RouteTrack {
  const all = raw ?? []
  const kept = all
    .filter((p) => plausible(p) && (p.accuracy_m == null || p.accuracy_m <= maxAccuracyM))
    .sort((a, b) => new Date(a.ts ?? 0).getTime() - new Date(b.ts ?? 0).getTime())

  let drawnLengthM = 0
  for (let i = 1; i < kept.length; i += 1) drawnLengthM += metresBetween(kept[i - 1], kept[i])

  const first = kept[0]
  const last = kept[kept.length - 1]
  const closedLoop =
    kept.length > 1 && first != null && last != null && metresBetween(first, last) <= LOOP_TOLERANCE_M

  return { points: kept, droppedCount: all.length - kept.length, closedLoop, drawnLengthM }
}

export type ProjectedRoute = {
  /** An SVG path, ready for a `<path d>`. */
  d: string
  start: { x: number; y: number }
  finish: { x: number; y: number }
  /** Metres per drawn pixel — what the scale bar is made of. */
  metresPerPixel: number
  /** The mean latitude the projection was built about — the `cos` in `kx`.
   * Exported because a map underneath has to be told the SAME number: it is what
   * turns this drawing's pixels into a zoom level (`lib/routeMap.ts`). */
  latMid: number
  /** The geographic point that lands in the MIDDLE of the frame. The drawn
   * bounding box is centred in the box by construction, so this is the centre of
   * the bounds — and it is where a map underneath has to put its camera. */
  center: { lon: number; lat: number }
}

/**
 * The route projected into a box, drawn by us.
 *
 * ⛔ **The streets are not fetched from a third party.** Asking a tile host for
 * the roads somebody ran on tells the tile host where they were, and the phone's
 * App Privacy answer rests on the same rule. Since 2026-09 there CAN be a map
 * under this drawing, and the way that was made to keep the rule is that the
 * tiles are built on Bob's machine and served by Bob's server — see
 * `lib/routeMap.ts`. Where no such region is installed, this drawing stands on
 * its own exactly as before.
 *
 * ⚠️ Whatever goes underneath, THIS is the projection. The map is aligned to the
 * drawing, never the other way round: the dropped-fix accounting, the scale bar
 * and the aspect ratio below are the measurement, and a basemap is decoration
 * that has to fit it.
 *
 * ⚠️ **The aspect ratio is preserved.** Stretching the bounding box to fill the
 * frame would bend every route: an out-and-back along one street would come out
 * as a wide oval, and nothing on screen would say the drawing had been squashed.
 * A degree of longitude is also shorter than a degree of latitude everywhere but
 * the equator, so the x axis carries a `cos(lat)` — without it a Budapest loop
 * leans about 32% too wide.
 */
export function projectRoute(
  track: RouteTrack,
  width: number,
  height: number,
  padding = 10,
): ProjectedRoute | undefined {
  const pts = track.points
  if (pts.length < 2) return undefined

  const latMid = pts.reduce((sum, p) => sum + p.lat, 0) / pts.length
  const kx = M_PER_DEG * Math.cos((latMid * Math.PI) / 180)
  const xs = pts.map((p) => p.lon * kx)
  // Negated: latitude grows northwards and SVG's y grows downwards, so the
  // flip happens here rather than being forgotten in the drawing.
  const ys = pts.map((p) => -p.lat * M_PER_DEG)

  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const spanX = maxX - minX
  const spanY = maxY - minY

  const boxW = Math.max(1, width - 2 * padding)
  const boxH = Math.max(1, height - 2 * padding)
  // A route that never moved in one direction (a straight line) has a zero span
  // on that axis; the other axis then sets the scale on its own.
  const scale =
    spanX <= 0 && spanY <= 0
      ? 1
      : Math.min(spanX > 0 ? boxW / spanX : Infinity, spanY > 0 ? boxH / spanY : Infinity)

  const offsetX = padding + (boxW - spanX * scale) / 2
  const offsetY = padding + (boxH - spanY * scale) / 2
  const at = (i: number) => ({
    x: offsetX + (xs[i] - minX) * scale,
    y: offsetY + (ys[i] - minY) * scale,
  })

  let d = ''
  for (let i = 0; i < pts.length; i += 1) {
    const { x, y } = at(i)
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
  }

  return {
    d,
    start: at(0),
    finish: at(pts.length - 1),
    metresPerPixel: scale > 0 ? 1 / scale : 0,
    latMid,
    // Read back out of the projected extremes rather than recomputed from the
    // points: this is the point that lands in the middle of the FRAME, and it has
    // to come from the same three lines that put it there.
    center: { lon: (minX + maxX) / 2 / kx, lat: -(minY + maxY) / 2 / M_PER_DEG },
  }
}

/** The 1-2-5 step nearest to a quarter of the frame — a scale bar wants a round
 * number, and a route with no streets under it needs one to have a size at all. */
export function scaleBar(metresPerPixel: number, width: number): { metres: number; pixels: number } | undefined {
  if (!(metresPerPixel > 0) || !(width > 0)) return undefined
  const target = (width / 4) * metresPerPixel
  const magnitude = 10 ** Math.floor(Math.log10(target))
  const steps = [1, 2, 5, 10].map((s) => s * magnitude)
  const metres = steps.reduce((best, s) => (Math.abs(s - target) < Math.abs(best - target) ? s : best))
  return { metres, pixels: metres / metresPerPixel }
}

// --- The heart-rate curve ----------------------------------------------------

export type HeartRatePoint = { t: number; bpm: number }

export type HeartRateSeries = {
  /** Sorted, in the session's window. */
  points: HeartRatePoint[]
  /** ⚠️ True for **one** sample as well. No curve can be drawn from one point,
   * and an "average / peak / lowest" trio repeating the same number three times
   * is the appearance of statistics rather than statistics. On the phone this
   * looked like a broken chart, and it is a real case: a stray sample can fall
   * inside the window of a session that carries no measurement. */
  isEmpty: boolean
  /** Whether anything at all arrived — for telling "nothing" from "one point". */
  hasAnySample: boolean
  min?: number
  max?: number
  average?: number
}

/**
 * The heart-rate samples of a session, filtered to its window.
 *
 * ⚠️ `/samples` returns **newest first**, so the sort is mandatory: unsorted,
 * the line runs backwards across the chart. The `data_type` check is here too,
 * so a botched query cannot smuggle a foreign metric into the curve.
 */
export function heartRateSeries(
  samples: Sample[] | undefined,
  startIso?: string,
  endIso?: string,
  dataType = 'heartRate',
): HeartRateSeries {
  const start = startIso ? new Date(startIso).getTime() : NaN
  const end = endIso ? new Date(endIso).getTime() : NaN
  const points: HeartRatePoint[] = []
  for (const s of samples ?? []) {
    if (s.data_type !== dataType) continue
    if (s.value == null || !(s.value > 0) || !s.ts) continue
    const t = new Date(s.ts).getTime()
    if (Number.isNaN(t)) continue
    if (!Number.isNaN(start) && t < start) continue
    if (!Number.isNaN(end) && t > end) continue
    points.push({ t, bpm: s.value })
  }
  points.sort((a, b) => a.t - b.t)

  const bpms = points.map((p) => p.bpm)
  return {
    points,
    isEmpty: points.length < 2,
    hasAnySample: points.length > 0,
    min: bpms.length ? Math.min(...bpms) : undefined,
    max: bpms.length ? Math.max(...bpms) : undefined,
    average: bpms.length ? bpms.reduce((a, b) => a + b, 0) / bpms.length : undefined,
  }
}

/** The smallest span the vertical axis is allowed to have. */
export const MIN_HR_SPAN = 30

/**
 * The bounds of the heart-rate axis. Two decisions, both deliberate:
 *
 * 1. **It does not start at zero.** A curve between 120 and 165 drawn from 0 is
 *    a flat strip, and every session then looks the same. The axis is stretched
 *    onto the data.
 * 2. **There is a minimum span.** Somebody who held 140 the whole way would get
 *    a ±0 axis that magnifies measurement noise into a mountain range — 30 bpm
 *    keeps the sense of proportion and removes the division by zero.
 */
export function heartRateAxis(series: HeartRateSeries): { lower: number; upper: number } | undefined {
  if (series.min == null || series.max == null) return undefined
  let lower = Math.floor(series.min / 10) * 10
  let upper = Math.ceil(series.max / 10) * 10
  const missing = MIN_HR_SPAN - (upper - lower)
  if (missing > 0) {
    const half = Math.ceil(missing / 2 / 10) * 10
    lower -= half
    upper += half
  }
  if (lower < 0) {
    upper += -lower
    lower = 0
  }
  return { lower, upper }
}

/**
 * At most `buckets` points, by **averaging** within each bucket.
 *
 * An hour off the watch is ~720 samples at five-second intervals and a long ride
 * is several thousand; a chart a few hundred pixels wide cannot show them.
 * Averaging rather than picking every nth sample, because averaging does not
 * drop peaks at random — the shape survives.
 *
 * ⚠️ The min/max labels must still come from the RAW series. Averaging cuts the
 * real peak off, and a label that says less than what happened is worse than no
 * label.
 */
export function downsample(points: HeartRatePoint[], buckets: number): HeartRatePoint[] {
  if (buckets <= 0 || points.length <= buckets) return points
  const size = points.length / buckets
  const out: HeartRatePoint[] = []
  for (let i = 0; i < buckets; i += 1) {
    const lo = Math.floor(i * size)
    const hi = Math.min(Math.floor((i + 1) * size), points.length)
    if (lo >= hi) continue
    const slice = points.slice(lo, hi)
    out.push({
      t: slice.reduce((sum, p) => sum + p.t, 0) / slice.length,
      bpm: slice.reduce((sum, p) => sum + p.bpm, 0) / slice.length,
    })
  }
  return out
}

// --- What the header says ----------------------------------------------------

/** The session's own length in minutes, or `undefined` when it has no end. */
export function workoutMinutes(w?: Workout): number | undefined {
  return minutesBetween(w?.started_at, w?.ended_at)
}
