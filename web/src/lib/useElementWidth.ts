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
