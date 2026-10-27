// The virtual journey on the web — a port of the phone's `Journey/` value layer.
//
// The phone uploads only WHICH route and FROM WHICH DAY (`/v1/settings` →
// `journey`, app 1.0 (7) on). The routes themselves are part of the app; the web
// carries a generated copy (`src/data/journey-routes.json`, written by
// `JourneyCatalogExportTests` in helsa-apple — never edited by hand). The
// distance is the server's: `/summary`'s total of the route's distance metrics
// from the start day to today, the same request `JourneyViewModel.load` makes.
//
// What is ported, rule for rule, from `JourneyProgress.swift` and
// `JourneyTrack.swift`:
//
//  * **No measurement is not zero.** `travelledM` undefined means the server has
//    no distance for the window, and nothing counts as reached — not even the
//    start, because we do not know the walk began.
//  * **The percentage divides by the PUBLISHED length**, never by the drawn
//    line's: the two disagree by a few percent, and the signposts, the stage
//    tables and the user's expectations are built on the published one.
//  * **The line is split by FRACTION of its own length**, not by metres walked
//    along it — so the marker and the percentage say the same thing and the
//    finish lands exactly on the end point.
//  * **A route without a track is a sketch**: straight segments between the
//    approximate waypoints, and the page says so.
//
// ⚠️ A change to any of these on one side is carried to the other, or the phone
// and the web draw the same journey in two places.

import type { MetricSeries } from '../api/types'
import type { Lang } from '../i18n/types'

export type LocalText = { en: string; hu: string }

export type JourneyWaypoint = { name: LocalText; lat: number; lon: number; m: number }

export type JourneyRoute = {
  id: string
  region: string
  name: LocalText
  subtitle: LocalText
  /** Where the length comes from — WITH the track's ODbL attribution appended,
   * as the app prints it. Show it wherever the route is shown. */
  source_note: LocalText
  source_url?: string
  distance_metrics: string[]
  total_m: number
  waypoints: JourneyWaypoint[]
  track?: {
    polyline: string
    points: number
    osm_relations: number[]
    fetched_on: string
    attribution: LocalText
  }
}

export type JourneyCatalogue = { note: string; polyline_precision: number; routes: JourneyRoute[] }

/** The precision the catalogue's polylines are encoded at (`JourneyGeometry.polylinePrecision`).
 * The test holds the generated file to it. */
export const POLYLINE_PRECISION = 5

/**
 * The catalogue, loaded on demand. ⚠️ A dynamic import on purpose: 140 KB of
 * routes is wanted on one page, by people who walk a virtual route at all, and a
 * static import would make every visitor to Today pay for it (the same reasoning
 * as the lazily loaded map in `components/RouteMap.tsx`).
 */
export async function loadCatalogue(): Promise<JourneyCatalogue> {
  const mod = await import('../data/journey-routes.json')
  return mod.default as JourneyCatalogue
}

export function routeById(routes: readonly JourneyRoute[], id: string | undefined): JourneyRoute | undefined {
  return id == null ? undefined : routes.find((r) => r.id === id)
}

export const local = (text: LocalText, lang: Lang) => text[lang] ?? text.en

export type LatLon = { lat: number; lon: number }

// --- Geometry (JourneyGeometry) ---------------------------------------------

const EARTH_RADIUS_M = 6_371_008.8

/** Google's encoded-polyline format at the catalogue's precision. */
export function decodePolyline(encoded: string, precision = POLYLINE_PRECISION): LatLon[] {
  const factor = 10 ** precision
  const out: LatLon[] = []
  let lat = 0
  let lon = 0
  let i = 0
  const next = (): number | undefined => {
    let result = 0
    let shift = 0
    for (;;) {
      if (i >= encoded.length) return undefined
      const chunk = encoded.charCodeAt(i++) - 63
      if (chunk < 0) return undefined
      result |= (chunk & 0x1f) << shift
      shift += 5
      if (chunk < 0x20) break
    }
    return result & 1 ? ~(result >> 1) : result >> 1
  }
  for (;;) {
    const dLat = next()
    const dLon = next()
    if (dLat === undefined || dLon === undefined) break
    lat += dLat
    lon += dLon
    out.push({ lat: lat / factor, lon: lon / factor })
  }
  return out
}

/** Great-circle distance in metres (haversine, the phone's radius). */
export function distanceM(a: LatLon, b: LatLon): number {
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const dLat = lat2 - lat1
  const dLon = ((b.lon - a.lon) * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

function cumulativeLengths(line: LatLon[]): number[] {
  const out = new Array<number>(line.length).fill(0)
  for (let i = 1; i < line.length; i += 1) out[i] = out[i - 1] + distanceM(line[i - 1], line[i])
  return out
}

/**
 * Cut the line in two at `fraction` of its own length (`JourneyProgress.split`).
 * The cut point belongs to BOTH halves, so the two drawn lines meet.
 */
export function splitLine(line: LatLon[], fraction: number): { travelled: LatLon[]; remaining: LatLon[] } {
  if (line.length < 2) return { travelled: line, remaining: line }
  const cumulative = cumulativeLengths(line)
  const total = cumulative[cumulative.length - 1]
  if (!(total > 0)) return { travelled: line, remaining: line }
  const target = Math.min(Math.max(fraction, 0), 1) * total
  // `>=` so a fraction of exactly 1 lands on the last point rather than one before it.
  const index = cumulative.findIndex((c) => c >= target)
  if (index < 0) return { travelled: line, remaining: [] }
  if (index === 0) return { travelled: [line[0]], remaining: line }
  const span = cumulative[index] - cumulative[index - 1]
  const t = span > 0 ? (target - cumulative[index - 1]) / span : 0
  const prev = line[index - 1]
  const next = line[index]
  const here = { lat: prev.lat + (next.lat - prev.lat) * t, lon: prev.lon + (next.lon - prev.lon) * t }
  // At the very end the cut point IS the last point; appending it again would
  // hand the drawing a two-point line of one repeated coordinate.
  const tail = t >= 1 ? line.slice(index + 1) : line.slice(index)
  return { travelled: [...line.slice(0, index), here], remaining: [here, ...tail] }
}

// --- Progress (JourneyProgress) ---------------------------------------------

export type JourneyProgress = {
  route: JourneyRoute
  /** Measured since the start day; undefined = no measurement (NOT zero). */
  travelledM: number | undefined
  hasData: boolean
  /** Clamped to the route: someone who walked 1500 km on a 204 km route is at
   * the finish, not at 735%. */
  effectiveM: number
  fraction: number
  remainingM: number
  /** Said separately, because the clamped 100% would hide it. */
  overshootM: number
  complete: boolean
  reached: JourneyWaypoint[]
  next: JourneyWaypoint | undefined
  toNextM: number | undefined
}

export function journeyProgress(route: JourneyRoute, travelledM: number | undefined): JourneyProgress {
  const total = route.total_m
  const hasData = travelledM != null
  const effectiveM = Math.min(Math.max(travelledM ?? 0, 0), total)
  const fraction = total > 0 ? effectiveM / total : 0
  // Exactly at a waypoint counts as reached; without data nothing does.
  const reached = route.waypoints.filter((w) => hasData && effectiveM >= w.m)
  const next = route.waypoints.find((w) => !(hasData && effectiveM >= w.m))
  return {
    route,
    travelledM,
    hasData,
    effectiveM,
    fraction,
    remainingM: Math.max(total - effectiveM, 0),
    overshootM: hasData ? Math.max((travelledM ?? 0) - total, 0) : 0,
    complete: hasData && total > 0 && effectiveM >= total,
    reached,
    next,
    toNextM: next ? Math.max(next.m - effectiveM, 0) : undefined,
  }
}

/**
 * `/summary`'s total in metres (`JourneyViewModel.meters`). The unit the server
 * sent wins; an unknown or missing one falls back to metres, which is what the
 * distance types are in both catalogues. A missing total is undefined — the
 * server's honest "no measurement", never a zero.
 */
export function metresFromSeries(series: MetricSeries | undefined): number | undefined {
  if (series?.total == null) return undefined
  switch (series.unit) {
    case 'km':
      return series.total * 1000
    case 'mi':
      return series.total * 1609.344
    case 'ft':
      return series.total * 0.3048
    default:
      return series.total
  }
}

/** Several metrics add up (a route can count walking AND cycling); if none has a
 * total, the answer stays undefined. */
export function travelledFrom(metrics: Record<string, MetricSeries> | undefined, wanted: string[]): number | undefined {
  let sum: number | undefined
  for (const m of wanted) {
    const part = metresFromSeries(metrics?.[m])
    if (part != null) sum = (sum ?? 0) + part
  }
  return sum
}

// --- The lines to draw (mapLines) -------------------------------------------

export type JourneyLines = {
  whole: LatLon[]
  travelled: LatLon[]
  remaining: LatLon[]
  /** Where the walker is; undefined without data. */
  here: LatLon | undefined
  /** False when the route has no imported track and the line is the sketch. */
  isTrack: boolean
}

/** The sketch's position: linear between the two neighbouring waypoints. */
function sketchHere(p: JourneyProgress): LatLon | undefined {
  const wps = p.route.waypoints
  if (wps.length === 0) return undefined
  if (!p.next) return wps[wps.length - 1]
  const prev = p.reached[p.reached.length - 1]
  if (!prev) return wps[0]
  const span = p.next.m - prev.m
  if (!(span > 0)) return p.next
  const t = (p.effectiveM - prev.m) / span
  return { lat: prev.lat + (p.next.lat - prev.lat) * t, lon: prev.lon + (p.next.lon - prev.lon) * t }
}

export function journeyLines(p: JourneyProgress): JourneyLines {
  const route = p.route
  if (route.track) {
    const whole = decodePolyline(route.track.polyline)
    if (!p.hasData) return { whole, travelled: [], remaining: whole, here: undefined, isTrack: true }
    const split = splitLine(whole, p.fraction)
    return { whole, ...split, here: split.travelled[split.travelled.length - 1], isTrack: true }
  }
  // The sketch (`travelledPolyline` / `remainingPolyline` / `currentCoordinate`).
  const whole = route.waypoints.map(({ lat, lon }) => ({ lat, lon }))
  if (!p.hasData) return { whole, travelled: [], remaining: whole, here: undefined, isTrack: false }
  const here = sketchHere(p)
  const travelled = p.reached.map(({ lat, lon }) => ({ lat, lon }))
  const lastReachedM = p.reached[p.reached.length - 1]?.m ?? 0
  // The current position only goes on the end if we really are PAST the last
  // reached waypoint — otherwise the same point would be in the line twice.
  if (p.next && p.effectiveM > lastReachedM && here) travelled.push(here)
  const remaining: LatLon[] = []
  if (p.next) {
    if (here) remaining.push(here)
    for (const w of route.waypoints) if (w.m >= p.next.m) remaining.push({ lat: w.lat, lon: w.lon })
  }
  return { whole, travelled, remaining, here, isTrack: false }
}

// --- Projection into the card -------------------------------------------------

const M_PER_DEG = 111_320

export type JourneyFrame = {
  /** SVG path of a line in this frame. */
  path: (line: LatLon[]) => string
  point: (p: LatLon) => { x: number; y: number }
  /** What `RouteMap` needs to put a basemap under the same drawing. */
  projected: {
    d: string
    start: { x: number; y: number }
    finish: { x: number; y: number }
    metresPerPixel: number
    latMid: number
    center: { lon: number; lat: number }
  }
}

/**
 * The same equirectangular projection `projectRoute` uses for a workout, built
 * once from the WHOLE line so the travelled and remaining halves land in one
 * frame. Undefined for fewer than two points.
 */
export function projectJourney(whole: LatLon[], width: number, height: number, padding = 14): JourneyFrame | undefined {
  if (whole.length < 2) return undefined
  const latMid = whole.reduce((s, p) => s + p.lat, 0) / whole.length
  const kx = M_PER_DEG * Math.cos((latMid * Math.PI) / 180)
  const xs = whole.map((p) => p.lon * kx)
  const ys = whole.map((p) => -p.lat * M_PER_DEG)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const spanX = maxX - minX
  const spanY = maxY - minY
  const boxW = Math.max(1, width - 2 * padding)
  const boxH = Math.max(1, height - 2 * padding)
  const scale =
    spanX <= 0 && spanY <= 0
      ? 1
      : Math.min(spanX > 0 ? boxW / spanX : Infinity, spanY > 0 ? boxH / spanY : Infinity)
  const offsetX = padding + (boxW - spanX * scale) / 2
  const offsetY = padding + (boxH - spanY * scale) / 2
  const point = (p: LatLon) => ({
    x: offsetX + (p.lon * kx - minX) * scale,
    y: offsetY + (-p.lat * M_PER_DEG - minY) * scale,
  })
  const path = (line: LatLon[]) =>
    line
      .map((p, i) => {
        const { x, y } = point(p)
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
      })
      .join('')
  return {
    path,
    point,
    projected: {
      d: path(whole),
      start: point(whole[0]),
      finish: point(whole[whole.length - 1]),
      metresPerPixel: scale > 0 ? 1 / scale : 0,
      latMid,
      center: { lon: (minX + maxX) / 2 / kx, lat: -(minY + maxY) / 2 / M_PER_DEG },
    },
  }
}
