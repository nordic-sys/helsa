// Today's date on the reader's clock, kept live across midnight.
//
// ⚠️ A page left open overnight used to keep asking for yesterday: the windows
// were computed once (`useMemo` with no clock in its dependencies) and the query
// keys carried no date, so "today" at 00:05 was still the day before — with
// nothing on screen saying so. Every date-dependent query puts this string in its
// key and every date-dependent window lists it as a dependency, so the day rolls
// over by itself.
//
// A once-a-minute check rather than one timer to midnight: a laptop that sleeps
// through midnight never fires a long timeout on time, and a minute's lag is
// invisible on a page whose smallest bucket is an hour.

import { useEffect, useState } from 'react'
import { isoDaysAgo } from './format'

/** How often the date is re-read. */
export const TODAY_TICK_MS = 60_000

export function useToday(): string {
  const [today, setToday] = useState(() => isoDaysAgo(0))
  useEffect(() => {
    const id = setInterval(() => {
      const now = isoDaysAgo(0)
      setToday((prev) => (prev === now ? prev : now))
    }, TODAY_TICK_MS)
    return () => clearInterval(id)
  }, [])
  return today
}
