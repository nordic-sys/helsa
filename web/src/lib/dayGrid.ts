// A stretch of days laid out for a weekday grid — the phone's
// `HelsaKit/Sources/HelsaKit/UI/Components/DayValueGrid.swift` (`DayValueGrid`),
// which the step grid of a month (`MonthStepGrid.swift`) and the Trends screen's
// "Day by day" card both draw through.
//
// # Why a weekday grid at all
//
// A chart shows the shape of a stretch and withholds the numbers; a list gives
// the numbers and buries the shape. The grid gives both, and adds the one thing
// neither has: **the weekday**. "Every Sunday is empty" is a fact only this
// layout can show.
//
// What is general lives here once — the leading blanks, the weekday headings,
// the peak a bar is scaled to. What a number MEANS (a step goal, a unit) is the
// caller's, exactly as the app splits `DayValueGrid` from `DayValueGridStyle`.
//
// ⚠️ **A day with no measurement is `null`, never zero**, and it is drawn as an
// empty cell. A bar of zero height sits where a bar of 200 steps would, and the
// two claims are not remotely the same.

import type { Range } from '../api/types'

export type DayCell = {
  /** Local midnight of the day. */
  date: Date
  /** `null` = nobody measured this day. */
  value: number | null
  dayOfMonth: number
}

export type DayGrid = {
  cells: DayCell[]
  /** Empty slots before the first day so it lands under its own weekday. */
  leadingBlanks: number
  /** Narrow weekday names, starting on `firstDay`. */
  weekdayLabels: string[]
  /** The stretch's own largest measured value — what the bars are scaled to. */
  peak: number | null
  /** Days with no measurement. */
  gapCount: number
  /** No day carried a value at all. */
  isEmpty: boolean
}

/**
 * Only where a bucket IS a day: Trends' week and month. The day view's buckets
 * are hours and the year's are months, and a "weekday grid" of either would
 * invite weekday conclusions about cells that are not weekdays at all (the
 * app's `DayValueGrid.make` returns `nil` for them, for that reason).
 */
export function dayGridApplies(range: Range): boolean {
  return range === 'week' || range === 'month'
}

/**
 * The very short weekday names, rotated to start on `firstDay` (0 = Sunday).
 *
 * From `Intl` in the INTERFACE language — "H K Sz Cs P Sz V" in Hungarian —
 * while the first weekday comes from the region (`window.firstWeekday`), the
 * same split the Trends axis already makes. The app learnt the hard way that a
 * bare calendar answers in English with Sunday first (`TrendsView.swift`,
 * `calendarFor`); here the locale is always passed explicitly.
 */
export function weekdayLabels(locale: string, firstDay: number): string[] {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: 'narrow' })
  // 2023-01-01 was a Sunday: day i of that week has `getDay() === i`.
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2023, 0, 1 + ((firstDay + i) % 7))))
}

/**
 * The grid from a run of consecutive days, missing days included as `null`.
 *
 * ⚠️ The blanks come from `firstDay`, never from a constant: a Hungarian week
 * starts on Monday and an American one on Sunday, and a fixed offset shifts the
 * whole grid by a column for one of them.
 *
 * Returns `null` for an empty run — there is no first day to place.
 */
export function makeDayGrid(
  days: { date: Date; value: number | null }[],
  firstDay: number,
  locale: string,
): DayGrid | null {
  const first = days[0]
  if (!first) return null
  const cells: DayCell[] = days.map((d) => ({
    date: d.date,
    value: d.value,
    dayOfMonth: d.date.getDate(),
  }))
  const measured = cells.filter((c) => c.value != null).map((c) => c.value as number)
  return {
    cells,
    leadingBlanks: (first.date.getDay() - firstDay + 7) % 7,
    weekdayLabels: weekdayLabels(locale, firstDay),
    // ⚠️ The stretch's OWN peak, not a fixed maximum: a month whose best day was
    // 4 000 steps and one whose best was 20 000 are each read on their own terms.
    peak: measured.length ? Math.max(...measured) : null,
    gapCount: cells.length - measured.length,
    isEmpty: measured.length === 0,
  }
}

/** A bar's height as a share of the peak, 0…1. Zero for an empty cell — which is
 * then not drawn at all, rather than drawn at zero. */
export function barFraction(value: number | null, peak: number | null): number {
  if (value == null || peak == null || peak <= 0) return 0
  return Math.min(Math.max(value / peak, 0), 1)
}

/** `YYYY-MM-DD` (a calendar day) → local midnight. */
export function localDay(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}
