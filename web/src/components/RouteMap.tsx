// The basemap behind the drawn route.
//
// ⚠️ **Loaded lazily and on purpose.** MapLibre is bigger than the rest of this
// dashboard put together, and it is wanted on one card of one page — and there,
// only when somebody has switched a map on. A static import would make every
// visitor to Today pay for a map that is off by default.
//
// The consequence worth knowing: `WorkoutDetail` decides whether to render this
// at all (a chosen source + `mapSupported()`), and the decision happens BEFORE
// the import. In jsdom there is no WebGL, so this file is never even fetched by
// the tests — which is why the suite walks the map-less path on every run rather
// than a mock of the map.
//
// ⛔ Everything here is same-origin. The tiles come from the Helsa server's own
// proxy; the chosen provider's address is resolved on the server and never
// reaches the browser's request list. There is no `glyphs`, no `sprite`, no
// telemetry, and `attributionControl: false` — MapLibre's own control is harmless
// but it renders a link out, and the credit the licence asks for is drawn by the
// page from its own strings instead.

import { useEffect, useRef, useState } from 'react'
import { Map as MapLibreMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { getToken } from '../api/client'
import { TILE_PROXY_PATH, basemapStyle, prefersDark, routeCamera, type MapSource } from '../lib/routeMap'
import type { ProjectedRoute } from '../lib/workoutDetail'

type Props = {
  source: MapSource
  projected: ProjectedRoute
  /** The SVG's viewBox width — the drawing's pixels are in these units. */
  viewBoxWidth: number
  /** Told when the map gives up, so the card can go back to the plain drawing
   * instead of leaving a hole where tiles should be. */
  onFailed: () => void
}

export default function RouteMap({ source, projected, viewBoxWidth, onFailed }: Props) {
  const holder = useRef<HTMLDivElement | null>(null)
  const map = useRef<MapLibreMap | null>(null)
  const failed = useRef(onFailed)
  failed.current = onFailed

  // Re-created when the palette flips, because a style swap is the only way to
  // repaint a MapLibre basemap and the app follows the system theme.
  const [dark, setDark] = useState(prefersDark)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setDark(prefersDark())
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const el = holder.current
    if (!el) return

    // ⚠️ The camera depends on how wide the SVG actually got, and at first paint
    // that is whatever the card gives it. So this re-runs on resize: a map whose
    // zoom was computed for a 900 px card and left there drifts off the line the
    // moment the window narrows, and the drift looks like a projection bug rather
    // than a stale number.
    const aim = () => {
      const camera = routeCamera(projected, viewBoxWidth, el.clientWidth)
      if (!camera || !map.current) return
      map.current.jumpTo({ center: camera.center, zoom: camera.zoom })
    }

    const first = routeCamera(projected, viewBoxWidth, el.clientWidth || viewBoxWidth)
    if (!first) {
      failed.current()
      return
    }

    let m: MapLibreMap
    try {
      m = new MapLibreMap({
        container: el,
        style: basemapStyle(source, dark),
        center: first.center,
        zoom: first.zoom,
        // Not a navigation app: the map cannot be panned, zoomed or rotated, and
        // it takes no keyboard focus. It is a backdrop, and a backdrop that moves
        // under a fixed drawing would only ever be wrong.
        interactive: false,
        attributionControl: false,
        // A basemap that fades in behind an already-drawn line reads as a glitch.
        fadeDuration: 0,
        // ⚠️ The tile proxy sits behind the device token like every other `/v1`
        // route, and MapLibre fetches tiles from a worker, where `localStorage`
        // is not reachable. This hook is what carries the header across: it runs
        // on the main thread, per request.
        transformRequest: (url) => {
          if (!url.includes(TILE_PROXY_PATH)) return { url }
          const token = getToken()
          return token ? { url, headers: { Authorization: `Bearer ${token}` } } : { url }
        },
      })
    } catch {
      failed.current()
      return
    }
    map.current = m

    // An unreachable provider, a lost WebGL context, a source that will not parse
    // — all of them end here, and all of them mean the same thing to the reader:
    // no map. Better an honest drawing than a grey rectangle.
    m.on('error', () => failed.current())

    const observer = new ResizeObserver(() => {
      m.resize()
      aim()
    })
    observer.observe(el)

    return () => {
      observer.disconnect()
      map.current = null
      m.remove()
    }
  }, [source, projected, viewBoxWidth, dark])

  return <div ref={holder} className="route-map" aria-hidden="true" />
}
