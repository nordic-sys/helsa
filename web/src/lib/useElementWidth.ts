// The rendered width of an element, kept live.
//
// For the chart decisions that depend on room rather than on point count: how
// many date labels fit on the axis, and whether a value fits above each bar. A
// 30-day month at 390 px has ~8 px a bucket; at 1440 px it has ~30.
//
// `0` until measured — and in environments without `ResizeObserver` (jsdom) it
// stays `0`, which callers read as "unknown" and handle with a fallback.
//
// ⚠️ A CALLBACK ref, not a `RefObject`. The Trends chart's container is only
// mounted once the first load finishes; with a `RefObject` the effect ran once
// on mount, found `ref.current === null` (the skeleton was on screen), and never
// looked again — so the width stayed `0`, the label thinning fell back to its
// seven-label ceiling, and at 390 px the dates were printed on top of each
// other. Holding the element in state re-runs the observer whenever the element
// appears, changes or goes away.

import { useCallback, useEffect, useState } from 'react'

export function useElementWidth<T extends HTMLElement = HTMLDivElement>(): [
  (el: T | null) => void,
  number,
] {
  const [el, setEl] = useState<T | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0)
      setWidth((prev) => (prev === w ? prev : w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  const ref = useCallback((node: T | null) => setEl(node), [])
  return [ref, width]
}

/**
 * Roughly how wide a label of `chars` characters is at 12 px in the system
 * font — ~7 px a character, deliberately generous: an overlap is worse than one
 * label fewer, and Hungarian dates ("szept. 10.") run longer than English ones.
 */
export function labelPx(chars: number): number {
  return chars * 7 + 4
}

/**
 * The fallback for the x-axis DATE labels when they cannot be measured (jsdom):
 * ~6 px a character. The value labels above the bars stay on `labelPx` — they
 * are bold digits, and wider.
 */
export function tickLabelPx(chars: number): number {
  return chars * 6 + 4
}

let ctx: CanvasRenderingContext2D | null | undefined

/**
 * The rendered width of an axis label at 12 px in the page's font, measured
 * with a canvas — plus the same 4 px slack as the estimates.
 *
 * ⚠️ Measured rather than estimated because the estimate was either too tight
 * for one language or too loose for the other: at 7 px a character the
 * Hungarian month and year axes kept only two labels at 390 px, where "okt. 12."
 * is really 41 px and "2026. febr." about 57. Without a canvas (jsdom) it falls
 * back to `tickLabelPx`.
 */
export function axisLabelPx(text: string): number {
  if (ctx === undefined) {
    ctx = null
    try {
      const jsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)
      if (!jsdom && typeof document !== 'undefined') ctx = document.createElement('canvas').getContext('2d')
    } catch {
      ctx = null
    }
  }
  if (!ctx) return tickLabelPx(text.length)
  ctx.font = `12px ${getComputedStyle(document.body).fontFamily || 'sans-serif'}`
  return Math.ceil(ctx.measureText(text).width) + 4
}
