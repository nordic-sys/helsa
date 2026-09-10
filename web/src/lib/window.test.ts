// The window arithmetic behind the Trends stepper.
//
// Every case pins `now` and the first weekday, so the suite says the same thing
// on a Sunday in Los Angeles as on a Tuesday in Budapest. The rules being
// checked are the app's (`TrendWindowTests`, `TrendCalendarWindowTests`), and
// they are here in their own right: the two implementations have to agree, and
// a green suite on one side proves nothing about the other.

import { describe, expect, it } from 'vitest'
import {
  bucketKey,
  bucketStarts,
  calendarWindow,
  dayCount,
  finer,
  offsetOf,
  previousWindow,
  rollingWindow,
  windowFor,
} from './window'

/** A local-midnight date, so the tests never depend on the machine's offset. */
const on = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h)

// Monday, so the calendar-week cases do not move with the runner's region.
const MON = 1

describe('rolling windows', () => {
  it('ends today and is as long as its name says', () => {
    const w = rollingWindow('week', 0, on(2026, 9, 10))
    expect([w.from, w.to]).toEqual(['2026-09-04', '2026-09-10'])
    expect(w.kind).toBe('rolling')
    expect(w.isPartial).toBe(false)
    expect(dayCount(w)).toBe(7)
  })

  it('steps back by a whole window, with no gap and no overlap', () => {
    const now = on(2026, 9, 10)
    const current = rollingWindow('week', 0, now)
    const before = rollingWindow('week', -1, now)
    expect([before.from, before.to]).toEqual(['2026-08-28', '2026-09-03'])
    // The precondition of the comparison being between two things of the same
    // size: the earlier window's exclusive end IS the later one's start.
    expect(before.end).toBe(current.start)
    expect(dayCount(before)).toBe(dayCount(current))
  })

  it('cuts the year on month boundaries, so every bucket is a whole month', () => {
    const w = rollingWindow('year', 0, on(2026, 9, 10))
    expect([w.from, w.to]).toEqual(['2025-10-01', '2026-09-30'])
  })
})

describe('calendar windows', () => {
  it('names the month, and cuts the running one off at today', () => {
    const w = calendarWindow('month', 0, on(2026, 9, 10), MON)
    expect([w.from, w.to]).toEqual(['2026-09-01', '2026-09-10'])
    expect(w.isPartial).toBe(true)
  })

  it('gives a finished month whole', () => {
    const w = calendarWindow('month', -1, on(2026, 9, 10), MON)
    expect([w.from, w.to]).toEqual(['2026-08-01', '2026-08-31'])
    expect(w.isPartial).toBe(false)
  })

  it('starts the week where the region says it does', () => {
    // 2026-09-10 is a Thursday.
    const monday = calendarWindow('week', 0, on(2026, 9, 10), 1)
    expect(monday.from).toBe('2026-09-07')
    const sunday = calendarWindow('week', 0, on(2026, 9, 10), 0)
    expect(sunday.from).toBe('2026-09-06')
  })

  it('cuts the running year at today too', () => {
    const w = calendarWindow('year', 0, on(2026, 9, 10), MON)
    expect([w.from, w.to]).toEqual(['2026-01-01', '2026-09-10'])
    expect(w.isPartial).toBe(true)
    expect(calendarWindow('year', -1, on(2026, 9, 10), MON).to).toBe('2025-12-31')
  })

  it('carries the exclusive end one day past the last day it covers', () => {
    const w = calendarWindow('month', -1, on(2026, 9, 10), MON)
    // `docs/25` K15: the last bar occupies the span from its own start to here.
    expect(new Date(w.end).getDate()).toBe(1)
    expect(new Date(w.end).getMonth()).toBe(8) // September
  })
})

describe('the window compared against', () => {
  it('leaves a rolling window alone — both halves are the same length already', () => {
    const now = on(2026, 9, 10)
    const current = windowFor('week', 'rolling', 0, now, MON)
    const prev = previousWindow(current, 'week', 0, now, MON)
    expect([prev.from, prev.to]).toEqual(['2026-08-28', '2026-09-03'])
  })

  it('clips the previous month to the same days when this one is still running', () => {
    const now = on(2026, 9, 10)
    const current = windowFor('month', 'calendar', 0, now, MON)
    const prev = previousWindow(current, 'month', 0, now, MON)
    // Ten days against ten, not ten against thirty-one.
    expect([prev.from, prev.to]).toEqual(['2026-08-01', '2026-08-10'])
    expect(dayCount(prev)).toBe(dayCount(current))
  })

  it('never clips past the previous period’s own end', () => {
    // The 30th of March against February: 30 elapsed days, but February has 28.
    const now = on(2026, 3, 30)
    const current = windowFor('month', 'calendar', 0, now, MON)
    const prev = previousWindow(current, 'month', 0, now, MON)
    expect([prev.from, prev.to]).toEqual(['2026-02-01', '2026-02-28'])
    expect(dayCount(prev)).toBeLessThan(dayCount(current))
  })

  it('gives a finished calendar month the whole previous one', () => {
    const now = on(2026, 9, 10)
    const current = windowFor('month', 'calendar', -1, now, MON)
    const prev = previousWindow(current, 'month', -1, now, MON)
    expect([prev.from, prev.to]).toEqual(['2026-07-01', '2026-07-31'])
  })
})

describe('which window a day falls in', () => {
  it('counts calendar periods, not elapsed days', () => {
    const now = on(2026, 9, 10)
    expect(offsetOf('month', 'calendar', on(2026, 6, 30), now, MON)).toBe(-3)
    expect(offsetOf('year', 'calendar', on(2024, 12, 31), now, MON)).toBe(-2)
    expect(offsetOf('week', 'calendar', on(2026, 9, 1), now, MON)).toBe(-1)
    expect(offsetOf('day', 'calendar', on(2026, 9, 8), now, MON)).toBe(-2)
  })

  it('counts whole window-lengths for a rolling one', () => {
    const now = on(2026, 9, 10)
    expect(offsetOf('week', 'rolling', on(2026, 9, 6), now, MON)).toBe(0)
    expect(offsetOf('week', 'rolling', on(2026, 9, 2), now, MON)).toBe(-1)
  })

  it('never answers with a future window', () => {
    const now = on(2026, 9, 10)
    // ⚠️ A day that has not happened has no window to show, and clamping to the
    // present is the honest answer.
    expect(offsetOf('month', 'calendar', on(2026, 12, 1), now, MON)).toBe(0)
    expect(offsetOf('day', 'calendar', on(2026, 9, 10), now, MON)).toBe(0)
  })
})

describe('the drill ladder', () => {
  it('follows the ranges, not the bucket widths', () => {
    // ⚠️ A month's bars are days, but a tap on one opens the WEEK around it.
    expect(finer('year')).toBe('month')
    expect(finer('month')).toBe('week')
    expect(finer('week')).toBe('day')
    expect(finer('day')).toBeNull()
  })

  it('lands on the calendar period holding the tapped day', () => {
    const now = on(2026, 9, 10)
    // Tapping the August bar of the year view.
    const offset = offsetOf('month', 'calendar', on(2026, 8, 15), now, MON)
    const w = windowFor('month', 'calendar', offset, now, MON)
    expect([w.from, w.to]).toEqual(['2026-08-01', '2026-08-31'])
  })
})

describe('buckets', () => {
  it('covers the whole window, including the days nothing was measured', () => {
    const w = calendarWindow('month', -1, on(2026, 9, 10), MON)
    const starts = bucketStarts(w, 'month')
    expect(starts).toHaveLength(31)
    expect(new Date(starts[0]).getDate()).toBe(1)
    expect(new Date(starts[30]).getDate()).toBe(31)
    // Every start is inside the window; none reaches the exclusive end.
    expect(starts.every((ms) => ms >= w.start && ms < w.end)).toBe(true)
  })

  it('stops at today in a running period', () => {
    const w = calendarWindow('month', 0, on(2026, 9, 10), MON)
    expect(bucketStarts(w, 'month')).toHaveLength(10)
  })

  it('gives the year twelve monthly buckets and the day twenty-four hourly ones', () => {
    const now = on(2026, 9, 10)
    expect(bucketStarts(rollingWindow('year', 0, now), 'year')).toHaveLength(12)
    expect(bucketStarts(rollingWindow('day', 0, now), 'day')).toHaveLength(24)
  })

  it('files a server timestamp under the local day it belongs to', () => {
    // The server sends a bucket start as a UTC instant; what matters is which
    // day it is on the reader's own clock.
    const localMidnight = new Date(2026, 7, 1).getTime()
    expect(bucketKey(localMidnight, 'month')).toBe('2026-08-01')
    expect(bucketKey(localMidnight, 'year')).toBe('2026-08')
    expect(bucketKey(new Date(2026, 7, 1, 14).getTime(), 'day')).toBe('2026-08-01T14')
  })
})
