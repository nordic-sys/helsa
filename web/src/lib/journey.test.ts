import { describe, expect, it } from 'vitest'
import catalogue from '../data/journey-routes.json'
import {
  POLYLINE_PRECISION,
  decodePolyline,
  distanceM,
  journeyLines,
  journeyProgress,
  projectJourney,
  routeById,
  splitLine,
  travelledFrom,
  type JourneyCatalogue,
  type JourneyRoute,
} from './journey'

const cat = catalogue as JourneyCatalogue
const balaton = routeById(cat.routes, 'balatoni-bringakorut')!
const rpddk = routeById(cat.routes, 'rpddk')!

describe('the generated catalogue', () => {
  it('is the app’s, and says so', () => {
    expect(cat.note).toMatch(/GENERATED/)
    expect(cat.polyline_precision).toBe(POLYLINE_PRECISION)
    expect(cat.routes.length).toBeGreaterThanOrEqual(35)
    expect(new Set(cat.routes.map((r) => r.id)).size).toBe(cat.routes.length)
  })

  it('every route’s length is its last waypoint, as in the app', () => {
    for (const r of cat.routes) expect(r.total_m).toBe(r.waypoints[r.waypoints.length - 1].m)
  })

  // ODbL: wherever the track is shown, the credit has to be — and the page shows
  // `source_note`. So the attribution is checked to be inside it, in both languages.
  it('a route with a track carries its OpenStreetMap credit inside the source note', () => {
    const tracked = cat.routes.filter((r) => r.track)
    expect(tracked.length).toBeGreaterThan(0)
    for (const r of tracked) {
      expect(r.source_note.en).toContain(r.track!.attribution.en)
      expect(r.source_note.hu).toContain(r.track!.attribution.hu)
      expect(r.track!.attribution.en).toMatch(/OpenStreetMap contributors \(ODbL\)/)
    }
  })

  it('the cycling route counts cycling, not walking', () => {
    expect(balaton.distance_metrics).toEqual(['distanceCycling'])
  })
})

describe('progress (JourneyProgress)', () => {
  it('no measurement is not zero: nothing is reached, not even the start', () => {
    const p = journeyProgress(rpddk, undefined)
    expect(p.hasData).toBe(false)
    expect(p.reached).toEqual([])
    expect(p.next).toBe(rpddk.waypoints[0])
    expect(p.complete).toBe(false)
  })

  it('exactly at a waypoint counts as reached', () => {
    const at = rpddk.waypoints[1].m
    const p = journeyProgress(rpddk, at)
    expect(p.reached).toHaveLength(2)
    expect(p.next).toBe(rpddk.waypoints[2])
  })

  it('past the finish is clamped to it, and the overshoot is said separately', () => {
    const p = journeyProgress(balaton, balaton.total_m * 1.5)
    expect(p.fraction).toBe(1)
    expect(p.complete).toBe(true)
    expect(p.overshootM).toBeCloseTo(balaton.total_m * 0.5)
    expect(p.next).toBeUndefined()
  })

  it('adds up several metrics, and stays undefined when none has a total', () => {
    expect(
      travelledFrom(
        { distanceWalkingRunning: { total: 2, unit: 'km' }, distanceCycling: { total: 500, unit: 'm' } },
        ['distanceWalkingRunning', 'distanceCycling'],
      ),
    ).toBe(2500)
    expect(travelledFrom({ distanceCycling: {} }, ['distanceCycling'])).toBeUndefined()
    expect(travelledFrom(undefined, ['distanceCycling'])).toBeUndefined()
  })
})

describe('the drawn line', () => {
  it('decodes the track the app imported', () => {
    const line = decodePolyline(balaton.track!.polyline)
    expect(line.length).toBe(balaton.track!.points)
    // Near Balatonfüred, the start.
    expect(distanceM(line[0], { lat: 46.958, lon: 17.888 })).toBeLessThan(5_000)
  })

  it('splits by FRACTION of the drawing, and the halves meet at the marker', () => {
    const line = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 },
      { lat: 0, lon: 2 },
    ]
    const half = splitLine(line, 0.5)
    expect(half.travelled[half.travelled.length - 1]).toEqual(half.remaining[0])
    expect(half.travelled[half.travelled.length - 1].lon).toBeCloseTo(1)
    // At the finish the marker IS the end point, and nothing is left.
    const done = splitLine(line, 1)
    expect(done.travelled[done.travelled.length - 1]).toEqual(line[2])
    expect(done.remaining).toEqual([line[2]])
  })

  it('a tracked route draws the track; without data the whole route is "ahead"', () => {
    const none = journeyLines(journeyProgress(balaton, undefined))
    expect(none.isTrack).toBe(true)
    expect(none.travelled).toEqual([])
    expect(none.here).toBeUndefined()
    expect(none.remaining.length).toBe(balaton.track!.points)
  })

  it('a route without a track is the waypoint sketch', () => {
    const halfway = journeyLines(journeyProgress(rpddk, rpddk.total_m / 2))
    expect(halfway.isTrack).toBe(false)
    expect(halfway.here).toBeDefined()
    expect(halfway.travelled[halfway.travelled.length - 1]).toEqual(halfway.remaining[0])
  })

  it('projects the halves into one frame', () => {
    const lines = journeyLines(journeyProgress(rpddk, 100_000))
    const frame = projectJourney(lines.whole, 600, 300)!
    expect(frame.path(lines.travelled)).toMatch(/^M/)
    const { x, y } = frame.point(lines.whole[0])
    expect(x).toBeGreaterThanOrEqual(0)
    expect(y).toBeGreaterThanOrEqual(0)
    expect(projectJourney([lines.whole[0]], 600, 300)).toBeUndefined()
  })

  it('an unknown id is not a route', () => {
    expect(routeById(cat.routes as JourneyRoute[], 'a-route-from-the-future')).toBeUndefined()
  })
})
