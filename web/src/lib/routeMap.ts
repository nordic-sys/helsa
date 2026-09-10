// The map that can go UNDER the drawn route — and the choice that decides whether
// there is one at all.
//
// # The shape, and why it is a setting rather than a feature
//
// Which map to put under a GPS trace is a **privacy trade-off**, and it belongs
// to the person looking at the screen. A tile request says "somebody is looking
// at this square of the world" to whoever serves it, and only the reader knows
// whether that is acceptable — a tile server on their own LAN and a public
// provider on the open internet are the same feature and completely different
// decisions.
//
// So this mirrors how Helsa already treats its own server: **off by default,
// switched on deliberately, and the screen says what each choice means BEFORE it
// is picked**, not after. With the setting off, this page is exactly what it was
// before any of this existed: a drawn line, its marker, its scale bar, and a
// sentence saying why there is no map.
//
// # Three things that hold the privacy line even when a map IS on
//
// 1. **The browser never talks to the tile provider.** Every tile goes through
//    the Helsa server's proxy (`/v1/tiles/…`), so the only host the page contacts
//    is its own origin — in every mode. What the provider learns is then the
//    SERVER's address and the area, not the reader's address. ⚠️ The setting's
//    text says that outright; a sentence implying nothing leaks would be worse
//    than no sentence.
// 2. **A user-entered URL can never enter the page's own request list.** It is
//    carried as a query parameter to our proxy and resolved there. That is also
//    what makes a strict origin rule possible at all: an allowlist cannot contain
//    a value the user types in.
// 3. **No glyphs, no sprites, no symbol layers, and therefore no labels.** This
//    is where self-hosted maps leak: a style copied from anywhere carries
//    `https://fonts.openmaptiles.org/…` in a key nobody reads, and the map then
//    fetches fonts from a third party while looking entirely local.
//    `styleEndpoints()` exists so a test can assert their absence rather than a
//    reviewer having to notice it.
//
//    Dropping labels is not only defensive: the route is the hero here and the
//    map is background, so street names would compete with the line for the same
//    ink. A label-free basemap under an overlay is an ordinary cartographic
//    choice — Positron and Dark Matter both ship one.

import type { StyleSpecification } from 'maplibre-gl'
import type { ProjectedRoute } from './workoutDetail'

/** Where the setting is kept. Beside `helsa.device_token`, and for the same
 * reason: it describes THIS browser on THIS machine, and there is nobody else to
 * share it with in a single-user system. */
const STORE_KEY = 'helsa.map_source'

/** MapLibre's world is 512 px wide at zoom 0. */
const TILE_SIZE = 512

/** Metres round the equator — what the zoom↔resolution conversion is made of. */
const EARTH_CIRCUMFERENCE_M = 40_075_016.686

/**
 * Who is on the other end of the tile URL.
 *
 * ⚠️ `own` and `public` take exactly the same two fields, and that is the point:
 * technically they are one mode. What differs is **who operates the URL**, which
 * is the one thing only the reader knows — so the setting asks, and the screen
 * then says what that answer costs.
 */
export type MapSourceMode = 'off' | 'own' | 'public'

export type TileFormat = 'raster' | 'vector'

export type MapSource = {
  mode: MapSourceMode
  /** A `{z}/{x}/{y}` template. Never fetched by the browser — see the header. */
  url: string
  format: TileFormat
}

export const MAP_SOURCE_OFF: MapSource = { mode: 'off', url: '', format: 'raster' }

/** The proxy on our own server. Under `/v1`, so the reverse proxy already routes
 * it to the API and no deployment has to learn a new path. */
export const TILE_PROXY_PATH = '/v1/tiles'

/** Why a template is not usable — an i18n key, so the screen can say which. */
export type TemplateProblem = 'empty' | 'scheme' | 'placeholders'

/**
 * ⚠️ Checked here as well as on the server, and neither check is redundant. This
 * one exists to TELL SOMEBODY, at the moment they are typing, why the thing they
 * pasted will not work; the server's exists because a browser check protects
 * nothing.
 */
export function templateProblem(url: string): TemplateProblem | undefined {
  const trimmed = url.trim()
  if (trimmed === '') return 'empty'
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return 'scheme'
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'scheme'
  if (!trimmed.includes('{z}') || !trimmed.includes('{x}') || !trimmed.includes('{y}')) {
    return 'placeholders'
  }
  return undefined
}

/** Whether this setting can actually draw anything. */
export function mapSourceUsable(src: MapSource): boolean {
  return src.mode !== 'off' && templateProblem(src.url) === undefined
}

export function readMapSource(): MapSource {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return MAP_SOURCE_OFF
    const parsed = JSON.parse(raw) as Partial<MapSource>
    const mode: MapSourceMode =
      parsed.mode === 'own' || parsed.mode === 'public' ? parsed.mode : 'off'
    const format: TileFormat = parsed.format === 'vector' ? 'vector' : 'raster'
    return { mode, url: typeof parsed.url === 'string' ? parsed.url : '', format }
  } catch {
    // A private window, cleared site data, a browser that refuses storage — all
    // of them mean the same thing here, and it is the safe thing: no map.
    return MAP_SOURCE_OFF
  }
}

export function writeMapSource(src: MapSource) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(src))
  } catch {
    /* see readMapSource: storage that refuses to store costs a preference, not data */
  }
}

/**
 * The URL MapLibre is given for tiles.
 *
 * ⛔ Same-origin, always. The chosen provider's template rides along as an
 * ENCODED query parameter, which does two things at once: the browser cannot be
 * made to contact it, and MapLibre's own `{z}/{x}/{y}` substitution cannot reach
 * inside it — `encodeURIComponent` turns the braces into `%7B…%7D`, so the only
 * placeholders it finds are the three in our path, which are the ones it should
 * be filling in.
 */
export function tileProxyTemplate(src: MapSource): string {
  return `${TILE_PROXY_PATH}/{z}/{x}/{y}?src=${encodeURIComponent(src.url.trim())}`
}

export type RouteCamera = {
  /** `[lon, lat]`, the way MapLibre wants it. */
  center: [number, number]
  /** Fractional, deliberately: the map has to match the drawing, not a tile grid. */
  zoom: number
}

/**
 * The camera that puts MapLibre's pixels exactly where the SVG's are.
 *
 * # Why this is a calculation and not `fitBounds`
 *
 * The route is projected by `projectRoute` — an equidistant projection about the
 * track's mean latitude — and that drawing is the thing being kept. So the map
 * has to be told where to sit, rather than the two being fitted separately to the
 * same box and hoped to agree.
 *
 * Longitude is the axis that makes it exact: it is linear in both projections.
 * The SVG puts `M_PER_DEG · cos(latMid) / metresPerPixel` pixels on a degree of
 * longitude; MapLibre puts `512 · 2^zoom / 360`. Setting those equal gives the
 * zoom, and the centre is the centre of the bounding box, which `projectRoute`
 * places in the middle of its frame by construction.
 *
 * ⚠️ The two projections are not the same, and the residual is worth knowing
 * rather than worrying about: Mercator stretches northwards while the drawing
 * does not, which over the ~2.5 km height of a city run comes to about 0.02% —
 * under a tenth of a pixel at this frame size. Over a 100 km bounding box it
 * would be visible, and a workout is not 100 km wide.
 *
 * `renderedWidthPx` is the CSS width the SVG actually got on screen; the viewBox
 * is scaled to it, so the drawing's metres-per-pixel has to be scaled with it.
 */
export function routeCamera(
  projected: ProjectedRoute,
  viewBoxWidth: number,
  renderedWidthPx: number,
): RouteCamera | undefined {
  if (!(projected.metresPerPixel > 0) || !(renderedWidthPx > 0) || !(viewBoxWidth > 0)) return undefined

  const metresPerCssPixel = (projected.metresPerPixel * viewBoxWidth) / renderedWidthPx
  const pixelsPerDegreeLon =
    ((EARTH_CIRCUMFERENCE_M / 360) * Math.cos((projected.latMid * Math.PI) / 180)) / metresPerCssPixel
  const zoom = Math.log2((pixelsPerDegreeLon * 360) / TILE_SIZE)
  if (!Number.isFinite(zoom)) return undefined

  return {
    center: [projected.center.lon, projected.center.lat],
    zoom: Math.min(Math.max(zoom, 0), 22),
  }
}

// --- The style ---------------------------------------------------------------

/** The two palettes. Muted on purpose: `--helsa-fjord` has to read on top. */
type Palette = {
  background: string
  water: string
  green: string
  built: string
  building: string
  road: string
  roadMajor: string
  boundary: string
  /** How far a RASTER basemap is pushed back. Someone else's cartography arrives
   * at full contrast and was never meant to sit under a 5 px line. */
  rasterOpacity: number
  rasterSaturation: number
  rasterBrightnessMin: number
  rasterBrightnessMax: number
}

const LIGHT: Palette = {
  background: '#eef0f2',
  water: '#d5e2ea',
  green: '#e1e9df',
  built: '#e7e9ec',
  building: '#dcdfe3',
  road: '#fafbfc',
  roadMajor: '#ffffff',
  boundary: '#c9ced5',
  rasterOpacity: 0.55,
  rasterSaturation: -0.75,
  rasterBrightnessMin: 0.25,
  rasterBrightnessMax: 1,
}

const DARK: Palette = {
  background: '#151b21',
  water: '#152530',
  green: '#18241f',
  built: '#1b2229',
  building: '#212931',
  road: '#28313a',
  roadMajor: '#333e48',
  boundary: '#39434c',
  rasterOpacity: 0.42,
  // ⚠️ Inverted min/max, not a typo: it darkens a light basemap instead of
  // dimming it, which is the difference between a muted map and a grey fog.
  rasterSaturation: -0.8,
  rasterBrightnessMin: 0.55,
  rasterBrightnessMax: 0.05,
}

/** Whether to draw the dark palette — the app follows the system, with the
 * `data-theme` escape hatch `tokens.css` already honours. */
export function prefersDark(): boolean {
  if (typeof document === 'undefined') return false
  const forced = document.documentElement.getAttribute('data-theme')
  if (forced === 'dark') return true
  if (forced === 'light') return false
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
}

/** The i18n key of the credit to draw on the map. ⚠️ A KEY, not a string that
 * came with the tiles: an attribution fetched over the network would be one more
 * thing the page asks somebody else for. */
export function attributionKey(format: TileFormat): 'workout.route.attribution.osm' | 'workout.route.attribution.omt' {
  return format === 'vector' ? 'workout.route.attribution.omt' : 'workout.route.attribution.osm'
}

/**
 * The basemap style.
 *
 * ⛔ Every URL in it points at our own proxy, and there is exactly one of them.
 * No `glyphs`, no `sprite`, no symbol layer — see the header for why that is a
 * feature rather than a shortcut.
 *
 * **Raster** is the shape a public provider comes in (OpenStreetMap's own tiles
 * are PNGs), and it needs no schema agreement at all — which is why it is the
 * default. **Vector** is what a self-hosted server usually serves; the layer set
 * below is the OpenMapTiles schema, the one planetiler emits, and it is
 * deliberately short: ground, green, water, built-up, buildings, roads, borders.
 * Enough to recognise "that is the river and that is the park", and nothing that
 * competes with the line.
 */
export function basemapStyle(src: MapSource, dark = prefersDark()): StyleSpecification {
  const c = dark ? DARK : LIGHT
  const tiles = [tileProxyTemplate(src)]

  if (src.format === 'raster') {
    return {
      version: 8,
      sources: {
        helsa: { type: 'raster', tiles, tileSize: 256, attribution: '' },
      },
      layers: [
        { id: 'ground', type: 'background', paint: { 'background-color': c.background } },
        {
          id: 'basemap',
          type: 'raster',
          source: 'helsa',
          paint: {
            'raster-opacity': c.rasterOpacity,
            'raster-saturation': c.rasterSaturation,
            'raster-brightness-min': c.rasterBrightnessMin,
            'raster-brightness-max': c.rasterBrightnessMax,
          },
        },
      ],
    }
  }

  return {
    version: 8,
    sources: {
      helsa: { type: 'vector', tiles, attribution: '' },
    },
    layers: [
      { id: 'ground', type: 'background', paint: { 'background-color': c.background } },
      {
        id: 'green',
        type: 'fill',
        source: 'helsa',
        'source-layer': 'landcover',
        filter: ['in', ['get', 'class'], ['literal', ['wood', 'grass', 'scrub', 'farmland', 'wetland']]],
        paint: { 'fill-color': c.green },
      },
      {
        id: 'park',
        type: 'fill',
        source: 'helsa',
        'source-layer': 'park',
        paint: { 'fill-color': c.green, 'fill-opacity': 0.9 },
      },
      {
        id: 'built',
        type: 'fill',
        source: 'helsa',
        'source-layer': 'landuse',
        filter: ['in', ['get', 'class'], ['literal', ['residential', 'commercial', 'industrial', 'retail']]],
        paint: { 'fill-color': c.built },
      },
      { id: 'water', type: 'fill', source: 'helsa', 'source-layer': 'water', paint: { 'fill-color': c.water } },
      {
        id: 'waterway',
        type: 'line',
        source: 'helsa',
        'source-layer': 'waterway',
        paint: { 'line-color': c.water, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 16, 3] },
      },
      {
        id: 'building',
        type: 'fill',
        source: 'helsa',
        'source-layer': 'building',
        minzoom: 14,
        paint: { 'fill-color': c.building },
      },
      {
        id: 'road-minor',
        type: 'line',
        source: 'helsa',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['minor', 'service', 'track', 'path', 'pedestrian']]],
        minzoom: 12,
        paint: { 'line-color': c.road, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.4, 18, 4] },
      },
      {
        id: 'road-major',
        type: 'line',
        source: 'helsa',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']]],
        paint: {
          'line-color': c.roadMajor,
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 3, 18, 9],
        },
      },
      {
        id: 'boundary',
        type: 'line',
        source: 'helsa',
        'source-layer': 'boundary',
        filter: ['<=', ['get', 'admin_level'], 4],
        paint: { 'line-color': c.boundary, 'line-width': 0.8, 'line-dasharray': [3, 2] },
      },
    ],
  }
}

/**
 * Every endpoint a style would make the browser talk to.
 *
 * ⚠️ **This exists to be asserted on, not to be read.** The leak this feature can
 * suffer is invisible in a screenshot and invisible in a rendered map: a style
 * with a foreign `glyphs` URL looks perfect and quietly fetches fonts from
 * somebody else's server. A test walks this list instead of a reviewer walking
 * the style.
 */
export function styleEndpoints(style: StyleSpecification): string[] {
  const urls: string[] = []
  const push = (u: unknown) => {
    if (typeof u === 'string' && u !== '') urls.push(u)
  }

  push((style as { glyphs?: unknown }).glyphs)
  const sprite = (style as { sprite?: unknown }).sprite
  if (typeof sprite === 'string') push(sprite)
  else if (Array.isArray(sprite)) for (const s of sprite) push((s as { url?: unknown })?.url)

  for (const source of Object.values(style.sources ?? {})) {
    const s = source as { url?: unknown; tiles?: unknown; data?: unknown }
    push(s.url)
    push(s.data)
    if (Array.isArray(s.tiles)) for (const t of s.tiles) push(t)
  }
  return urls
}

/**
 * Whether the browser can draw a WebGL map at all.
 *
 * ⚠️ Also the reason the tests need no GL stub: jsdom has no WebGL, so this is
 * false there, the lazy import never happens, and the page renders exactly what
 * it rendered before the map existed. That is the fallback path being exercised
 * on every test run rather than being hoped about.
 */
export function mapSupported(): boolean {
  if (typeof document === 'undefined') return false
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}
