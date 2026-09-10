// What the window between the stepper's arrows is called, and which days it
// actually covers. The web's copy of `TrendFormat.windowName` / `windowDates`.
//
// ⚠️ **The label is dates, never "two weeks ago".** Once you can walk backwards,
// a relative phrase stops answering the question: four taps back on the month
// view is a place, and the reader has to be able to tell which one — and to tell
// it apart from the same chart a week later.

import type { Range } from '../api/types'
import type { TrendWindow } from './window'

/** The last day the window covers, inclusive — its exclusive end minus a day. */
function lastDay(win: TrendWindow): Date {
  const end = new Date(win.end)
  return new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1)
}

/**
 * The name of a **calendar** window: "August 2026", "2026", "Aug 24 – Aug 30",
 * "11 August 2026".
 *
 * A rolling window has no name — it is a stretch nobody would recognise by its
 * dates — so the caller prints the description of what it is instead
 * (`trends.window.week` and friends). That is the honest thing to call it.
 */
export function calendarWindowName(win: TrendWindow, range: Range, locale: string): string {
  const start = new Date(win.start)
  switch (range) {
    case 'day':
      return new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }).format(start)
    case 'week': {
      // A week has no name of its own, so it is named by the days it covers —
      // and the year is left off, because it stands on the line below.
      const f = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' })
      return `${f.format(start)} – ${f.format(lastDay(win))}`
    }
    case 'month':
      return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(start)
    case 'year':
      return new Intl.DateTimeFormat(locale, { year: 'numeric' }).format(start)
  }
}

/**
 * The dates the window actually covers — the quiet line under the name.
 *
 * ⚠️ **It is not decoration under a calendar name.** A running month is cut off
 * at today, so "August 2026" is covering the 1st to the 27th, not the whole
 * thing; and a rolling window's dates are the only thing that says which stretch
 * it is at all. This line is where that gets stated.
 */
export function windowDates(win: TrendWindow, range: Range, locale: string): string {
  const start = new Date(win.start)
  if (range === 'day') {
    return new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(start)
  }
  const f = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
  return `${f.format(start)} – ${f.format(lastDay(win))}`
}
