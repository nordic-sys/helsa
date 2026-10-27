// Whether a media query matches, kept live.
//
// For the one layout decision CSS cannot make on its own: whether a workout row
// is a BUTTON that selects it into the panel beside the list, or a LINK to the
// session's own page. That is a difference in what the element is, not in how it
// looks, so it has to be decided in the markup.
//
// ⚠️ Without `matchMedia` (jsdom, some embedded webviews) this answers `false`:
// the narrow layout, which works everywhere, rather than a panel that might have
// no room.

import { useEffect, useState } from 'react'

function matches(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false
}

export function useMediaQuery(query: string): boolean {
  const [value, setValue] = useState(() => matches(query))
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const onChange = () => setValue(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return value
}
