// The weekday grid's layout — mirrors `HelsaKit/Tests/HelsaKitTests/DayValueGridTests.swift`.
//
// Two things decide whether it tells the truth, and both fail silently: which
// ranges may become a grid, and where the first cell lands. A grid built from
// hourly buckets looks exactly like a grid, and a column offset by one makes
// "every Sunday is empty" a statement about Saturdays.

import { describe, expect, it } from 'vitest'
import { barFraction, dayGridApplies, localDay, makeDayGrid, weekdayLabels } from './dayGrid'

const MONDAY = 1
const SUNDAY = 0

/** Consecutive days from `start` (2026-08-24 is a Monday, 08-27 a Thursday). */
function run(start: string, values: (number | null)[]) {
  const s = localDay(start)
  return values.map((value, i) => ({
    date: new Date(s.getFullYear(), s.getMonth(), s.getDate() + i),
    value,
  }))
}

describe('which ranges may become a grid', () => {
  it('accepts only the daily-bucketed ones', () => {
    expect(dayGridApplies('week')).toBe(true)
    expect(dayGridApplies('month')).toBe(true)
    // Hours and months are not weekdays; a grid of them would invite conclusions
    // about cells that are not days at all.
    expect(dayGridApplies('day')).toBe(false)
    expect(dayGridApplies('year')).toBe(false)
  })

  it('makes no grid from an empty run', () => {
    expect(makeDayGrid([], MONDAY, 'en-GB')).toBeNull()
  })
})

describe('where the first cell lands', () => {
  it('needs no blanks for a Monday in a Monday week', () => {
    const g = makeDayGrid(run('2026-08-24', [1]), MONDAY, 'en-GB')!
    expect(g.leadingBlanks).toBe(0)
    expect(g.weekdayLabels).toHaveLength(7)
  })

  it('needs one blank for the same Monday in a Sunday week', () => {
    expect(makeDayGrid(run('2026-08-24', [1]), SUNDAY, 'en-US')!.leadingBlanks).toBe(1)
  })

  it('leaves three blanks before a Thursday in a Monday week', () => {
    expect(makeDayGrid(run('2026-08-27', [1]), MONDAY, 'en-GB')!.leadingBlanks).toBe(3)
  })

  it('heads the columns in the interface language, starting on the first weekday', () => {
    expect(weekdayLabels('en-GB', MONDAY)).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S'])
    expect(weekdayLabels('en-US', SUNDAY)).toEqual(['S', 'M', 'T', 'W', 'T', 'F', 'S'])
    // ⚠️ The trap the app fell into: English initials under a Hungarian chart.
    const hu = weekdayLabels('hu-HU', MONDAY)
    expect(hu[0]).toBe('H')
    expect(hu[6]).toBe('V')
  })
})

describe('gaps are gaps', () => {
  it('keeps an unmeasured day as a cell with no value, not a zero', () => {
    const g = makeDayGrid(run('2026-08-24', [100, null, 300]), MONDAY, 'en-GB')!
    expect(g.cells).toHaveLength(3)
    expect(g.gapCount).toBe(1)
    expect(g.cells[1].value).toBeNull()
  })

  it('calls a stretch with nothing measured empty, with nothing to scale to', () => {
    const g = makeDayGrid(run('2026-08-24', [null, null]), MONDAY, 'en-GB')!
    expect(g.isEmpty).toBe(true)
    expect(g.peak).toBeNull()
  })
})

describe('the scale', () => {
  it("scales the bars to the stretch's own best day", () => {
    const g = makeDayGrid(run('2026-08-24', [100, 900, 400]), MONDAY, 'en-GB')!
    expect(g.peak).toBe(900)
    expect(barFraction(450, g.peak)).toBe(0.5)
    expect(barFraction(null, g.peak)).toBe(0)
  })

  it('numbers a cell by its calendar day, not its position in the window', () => {
    // A rolling window crosses a month boundary; "31" must not stand over the 1st.
    const g = makeDayGrid(run('2026-08-30', [1, 2, 3]), MONDAY, 'en-GB')!
    expect(g.cells.map((c) => c.dayOfMonth)).toEqual([30, 31, 1])
  })
})
