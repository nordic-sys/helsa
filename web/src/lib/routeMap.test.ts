// The tests that stand in for a reviewer's eyes.
//
// Two of the things this file checks are invisible in a screenshot, which is the
// whole reason they are here:
//
// * **A leak.** A style with `glyphs: 'https://fonts.openmaptiles.org/...'`
//   renders a perfect map and quietly fetches fonts from somebody else's server.
//   Nothing about the picture says so.
// * **A misalignment of a fraction of a pixel.** Which nobody sees until the
//   frame is a different width, and then it looks like a projection bug.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  MAP_SOURCE_OFF,
  TILE_PROXY_PATH,
  attributionKey,
  basemapStyle,
  mapSourceUsable,
  readMapSource,
  routeCamera,
  styleEndpoints,
  templateProblem,
  tileProxyTemplate,
  writeMapSource,
  type MapSource,
} from './routeMap'
import { projectRoute, routeTrack } from './workoutDetail'

const OSM: MapSource = {
  mode: 'public',
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  format: 'raster',
}
const MINE: MapSource = { mode: 'own', url: 'http://tiles:3000/hungary/{z}/{x}/{y}', format: 'vector' }

const p = (lat: number, lon: number) => ({ lat, lon, ts: '2026-09-10T10:00:00Z' })

describe('off is the default, and off means off', () => {
  beforeEach(() => localStorage.clear())

  it('starts with no map for anyone who never opens the setting', () => {
    expect(readMapSource()).toEqual(MAP_SOURCE_OFF)
    expect(mapSourceUsable(readMapSource())).toBe(false)
  })

  it('remembers a choice, and treats a corrupted one as off', () => {
    writeMapSource(OSM)
    expect(readMapSource()).toEqual(OSM)

    // ⚠️ Every unreadable state has to fall to OFF rather than to a default
    // provider: the safe direction here is "sends nothing", and a half-parsed
    // setting must never be resolved into a request.
    localStorage.setItem('helsa.map_source', '{not json')
    expect(readMapSource()).toEqual(MAP_SOURCE_OFF)
    localStorage.setItem('helsa.map_source', '{"mode":"whatever","url":"https://x/{z}/{x}/{y}"}')
    expect(readMapSource().mode).toBe('off')
  })
})

describe('the browser only ever asks its own origin', () => {
  it('sends every tile through our proxy, never to the provider', () => {
    for (const src of [OSM, MINE]) {
      const template = tileProxyTemplate(src)
      expect(template.startsWith(`${TILE_PROXY_PATH}/{z}/{x}/{y}?src=`)).toBe(true)
      // Relative — so it cannot name a host at all.
      expect(template).not.toMatch(/^[a-z]+:/i)
      // ⚠️ The provider's own address rides along ENCODED. Unencoded braces in
      // the query would be substituted by MapLibre as if they were ours, which
      // would quietly corrupt the upstream URL.
      expect(template).not.toContain(src.url)
      expect(decodeURIComponent(template.split('src=')[1])).toBe(src.url)
      expect(template.split('src=')[1]).not.toMatch(/[{}]/)
    }
  })

  it('names no endpoint outside our own path, in either format', () => {
    for (const src of [OSM, MINE]) {
      const endpoints = styleEndpoints(basemapStyle(src, false))
      expect(endpoints.length).toBe(1)
      for (const url of endpoints) {
        expect(url.startsWith(`${TILE_PROXY_PATH}/`)).toBe(true)
        expect(url).not.toMatch(/^(https?:)?\/\//)
      }
    }
  })

  it('carries no glyphs and no sprite, so no font or icon can be fetched from anywhere', () => {
    // ⚠️ THE trap. Every MapLibre style found on the internet has these two keys
    // pointing at fonts.openmaptiles.org and demotiles.maplibre.org, they are
    // easy to copy in with the rest of a style, and a map with labels looks
    // BETTER than one without — so the mistake is rewarded on screen.
    for (const src of [OSM, MINE]) {
      const style = basemapStyle(src, true)
      expect((style as Record<string, unknown>).glyphs).toBeUndefined()
      expect((style as Record<string, unknown>).sprite).toBeUndefined()
      for (const layer of style.layers) {
        // A symbol layer is the only kind that needs a glyph or a sprite; if one
        // ever appears the two keys have to come back, and this fails first.
        expect(layer.type).not.toBe('symbol')
      }
    }
  })

  it('credits whoever the tiles came from, from our own strings', () => {
    expect(attributionKey('raster')).toBe('workout.route.attribution.osm')
    expect(attributionKey('vector')).toBe('workout.route.attribution.omt')
  })
})

describe('an address the reader typed', () => {
  it('says what is wrong with it rather than failing silently later', () => {
    expect(templateProblem('')).toBe('empty')
    expect(templateProblem('   ')).toBe('empty')
    expect(templateProblem('tiles.example/{z}/{x}/{y}')).toBe('scheme')
    expect(templateProblem('file:///tiles/{z}/{x}/{y}')).toBe('scheme')
    expect(templateProblem('https://tiles.example/a.png')).toBe('placeholders')
    expect(templateProblem('https://tiles.example/{z}/{x}.png')).toBe('placeholders')
    expect(templateProblem(OSM.url)).toBeUndefined()
    expect(templateProblem(MINE.url)).toBeUndefined()
  })

  it('is not usable until it is complete, whatever the mode says', () => {
    expect(mapSourceUsable({ mode: 'own', url: '', format: 'vector' })).toBe(false)
    expect(mapSourceUsable({ mode: 'public', url: 'nonsense', format: 'raster' })).toBe(false)
    expect(mapSourceUsable(OSM)).toBe(true)
    expect(mapSourceUsable({ ...OSM, mode: 'off' })).toBe(false)
  })
})

describe('the map sits exactly where the drawing does', () => {
  // An INDEPENDENT Web Mercator implementation. The point of the test is that
  // `routeCamera` and this disagree by less than a pixel — if the camera were
  // derived from the same lines it would only be testing itself.
  const screenOf = (
    lon: number,
    lat: number,
    camera: { center: [number, number]; zoom: number },
    widthPx: number,
    heightPx: number,
  ) => {
    const world = 512 * 2 ** camera.zoom
    const mx = (l: number) => ((l + 180) / 360) * world
    const my = (l: number) =>
      ((180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (l * Math.PI) / 360))) / 360) * world
    return {
      x: mx(lon) - mx(camera.center[0]) + widthPx / 2,
      y: my(lat) - my(camera.center[1]) + heightPx / 2,
    }
  }

  const VIEWBOX_W = 900
  const VIEWBOX_H = 380

  it.each([
    ['a Budapest loop at full width', 900],
    ['the same card on a phone', 358],
    ['an awkward in-between width', 613],
  ])('puts every fix within a pixel of its drawn position — %s', (_name, renderedWidth) => {
    const points = [
      p(47.4955, 19.0525),
      p(47.5082, 19.0565),
      p(47.5206, 19.0872),
      p(47.5101, 19.0713),
      p(47.4998, 19.0601),
    ]
    const projected = projectRoute(routeTrack(points), VIEWBOX_W, VIEWBOX_H)!
    const camera = routeCamera(projected, VIEWBOX_W, renderedWidth)!

    const k = renderedWidth / VIEWBOX_W
    const renderedHeight = VIEWBOX_H * k
    const drawn = projected.d
      .slice(1)
      .split(/[ML]/)
      .map((pair) => pair.trim().split(' ').map(Number))

    for (let i = 0; i < points.length; i += 1) {
      const onMap = screenOf(points[i].lon, points[i].lat, camera, renderedWidth, renderedHeight)
      expect(onMap.x).toBeCloseTo(drawn[i][0] * k, 0)
      expect(onMap.y).toBeCloseTo(drawn[i][1] * k, 0)
    }
  })

  it('asks for a higher zoom the smaller the route is', () => {
    const big = projectRoute(routeTrack([p(47.4, 19.0), p(47.6, 19.3)]), VIEWBOX_W, VIEWBOX_H)!
    const small = projectRoute(routeTrack([p(47.5, 19.05), p(47.502, 19.053)]), VIEWBOX_W, VIEWBOX_H)!
    expect(routeCamera(small, VIEWBOX_W, 900)!.zoom).toBeGreaterThan(
      routeCamera(big, VIEWBOX_W, 900)!.zoom,
    )
  })

  it('has no camera for a frame with no width, rather than an infinite zoom', () => {
    // A card that has not been laid out yet reports 0, and `Math.log2(Infinity)`
    // is a map that never draws and never says why.
    const projected = projectRoute(routeTrack([p(47.5, 19.05), p(47.51, 19.06)]), VIEWBOX_W, VIEWBOX_H)!
    expect(routeCamera(projected, VIEWBOX_W, 0)).toBeUndefined()
  })
})
