// The rendered width of an element, kept live.
//
// For the chart decisions that depend on room rather than on point count: how
// many date labels fit on the axis, and whether a value fits above each bar. A
// 30-day month at 390 px has ~8 px a bucket; at 1440 px it has ~30.
//
// `0` until measured — and in environments without `ResizeObserver` (jsdom) it
// stays `0`, which callers read as "unknown" and handle with a fallback.

import { useEffect, useState, type RefObject } from 'react'

export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0)
      setWidth((prev) => (prev === w ? prev : w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return width
}

/**
 * Roughly how wide a label of `chars` characters is at 12 px in the system
 * font — ~7 px a character, deliberately generous: an overlap is worse than one
 * label fewer, and Hungarian dates ("szept. 10.") run longer than English ones.
 */
export function labelPx(chars: number): number {
  return chars * 7 + 4
}
