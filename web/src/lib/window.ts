// The time windows of the Trends page — the web's copy of the app's
// `TrendWindows` (HelsaKit/Sources/HelsaKit/Trends/TrendWindow.swift).
//
// Pure functions with no I/O and no React, so they can be tested against a fixed
// `now` instead of against whatever day the suite happens to run on.
//
// # Why the client computes the window at all
//
// `/v1/summary` will happily pick a window itself: asked with `range` alone it
// answers with the stretch ending today. That is exactly one window, and this
// page needs three — the one being looked at, the one before it (for the
// comparison), and the reference window behind the usual range. If the current
// one came from the server and the previous one from here, the two could be cut
// by different rulers — a different day boundary, a different idea of where a
// month starts — and we would be putting two numbers side by side that are not
// comparable. So all of them are computed here and sent as explicit `from`/`to`;
// `range` still travels, because that is what sets the bucket width.
//
// ⚠️ Everything below works in the browser's own local time, and `tz` is sent to
// the server so it buckets in the same one. A window built out of
// `toISOString()` would start and end on the wrong day for half of every evening
// east of Greenwich.

import type { Range } from '../api/types'

/**
 * A rolling stretch ending now, or a named calendar period.
 *
 * They answer different questions, and the page asks both. **Rolling** is what
 * the screen opens on — *the last 7 days* — because it is the honest answer to
 * "how am I doing": it ends now, and both halves of a comparison are the same
 * length. **Calendar** is what drilling in gives you — *August*, *2025* —
 * because a period you can name is one you can compare with something you
 * remember. On a Thursday the rolling week begins on Friday, which is a stretch
 * nobody has a name for, and that is precisely why tapping a month in the year
 * view has to land on the month rather than on "the 30 days ending near it".
 *
 * ⚠️ The kind travels with the window. Stepping backwards must not silently
 * change what kind of thing you are looking at.
 */
export type WindowKind = 'rolling' | 'calendar'

export type TrendWindow = {
  /** The first day, `YYYY-MM-DD` — the `from` query parameter. */
  from: string
  /** The last day, `YYYY-MM-DD`, **inclusive** — the `to` query parameter. The
   * server turns it into an exclusive end itself (`summary.window()`). */
  to: string
  /** The start of the window as an epoch millisecond — local midnight of `from`. */
  start: number
  /**
   * The end of the window, **exclusive**: local midnight of the day after `to`.
   *
   * ⚠️ This is the number the chart's axis needs, and `docs/25` K15 is what
   * happens without it: a chart whose domain ended at the START of the last
   * bucket, so the final bar hung off the edge of the card. A bucket occupies
   * the whole span from its own start to the next one, and the last one has no
   * next one — the window's exclusive end is the only thing that knows where it
   * stops.
   */
  end: number
  /**
   * Whether the period is still running — this week, this month, this year, cut
   * off at today.
   *
   * ⚠️ It exists so that nothing puts a part-period beside a whole one without
   * saying so. "This month" on the 3rd is three days, and its total next to last
   * month's whole one would read as a collapse.
   */
  isPartial: boolean
  kind: WindowKind
}

// --- Local-time date arithmetic ---------------------------------------------

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

/** The 1st of the month `n` months from the month `d` falls in. */
function monthStart(d: Date, n = 0): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1)
}

/** `YYYY-MM-DD` from the LOCAL getters — see the file header. */
export function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Whole days between two local midnights. */
function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

/**
 * Which day the week starts on, as a JavaScript weekday index (0 = Sunday).
 *
 * ⚠️ **Read from the region, not from the interface language**, which is the
 * same line the app draws: `Calendar.current.firstWeekday` follows the device's
 * region, so a Hungarian reader who switches this page to English still gets a
 * week that starts on Monday. Picking it up from the chosen language instead
 * would move every bar by a day the moment somebody changed the label language.
 *
 * `getWeekInfo()` is not in every engine and is not in the TypeScript lib types
 * yet, hence the cast and the fallback. Monday is the fallback because it is
 * what ISO-8601 says and what both languages this page ships in use.
 */
export function firstWeekday(): number {
  try {
    const locale = new Intl.Locale(navigator.language) as Intl.Locale & {
      getWeekInfo?: () => { firstDay?: number }
      weekInfo?: { firstDay?: number }
    }
    const first = locale.getWeekInfo?.().firstDay ?? locale.weekInfo?.firstDay
    // The week-info convention is 1 = Monday … 7 = Sunday; JavaScript's is 0 = Sunday.
    if (typeof first === 'number' && first >= 1 && first <= 7) return first === 7 ? 0 : first
  } catch {
    /* no week info in this engine — the fallback below stands */
  }
  return 1
}

function startOfWeek(d: Date, firstDay: number): Date {
  const day = startOfDay(d)
  const back = (day.getDay() - firstDay + 7) % 7
  return addDays(day, -back)
}

function make(
  first: Date,
  last: Date,
  isPartial: boolean,
  kind: WindowKind,
): TrendWindow {
  return {
    from: isoDay(first),
    to: isoDay(last),
    start: first.getTime(),
    end: addDays(last, 1).getTime(),
    isPartial,
    kind,
  }
}

// --- The windows themselves --------------------------------------------------

/**
 * The `offset`-th window of the given kind: `0` = the one we are in, `-1` = the
 * one before it.
 *
 * ⚠️ `offset` is never positive on this page. The window after this one has not
 * happened, and an empty chart of next week is indistinguishable from a sync
 * that stopped — see `canStepForward` in the app's `TrendsViewModel`.
 */
export function windowFor(
  range: Range,
  kind: WindowKind,
  offset: number,
  now: Date = new Date(),
  firstDay: number = firstWeekday(),
): TrendWindow {
  return kind === 'rolling'
    ? rollingWindow(range, offset, now)
    : calendarWindow(range, offset, now, firstDay)
}

/**
 * A stretch of a fixed length ending today — what the screen opens on, and the
 * mirror of the server's own `summary.window()`.
 *
 * The step equals the length of the window (7 / 30 days, 12 months), so `-1`
 * joins the current one without a gap or an overlap, which is the precondition
 * of the comparison being between two things of the same size.
 */
export function rollingWindow(range: Range, offset: number, now: Date): TrendWindow {
  const today = startOfDay(now)
  let first: Date
  let last: Date

  switch (range) {
    case 'day':
      first = last = addDays(today, offset)
      break
    case 'week':
      last = addDays(today, offset * 7)
      first = addDays(last, -6)
      break
    case 'month':
      last = addDays(today, offset * 30)
      first = addDays(last, -29)
      break
    case 'year': {
      // With monthly buckets the month is the unit: the window starts on the 1st
      // and runs to the LAST day of the closing month, so every bucket covers a
      // whole month.
      const lastMonth = monthStart(today, offset * 12)
      first = monthStart(lastMonth, -11)
      last = addDays(monthStart(lastMonth, 1), -1)
      break
    }
  }
  return make(first, last, false, 'rolling')
}

/**
 * A named calendar period: the week from its own first weekday, the month from
 * the 1st, the year from January.
 *
 * **The current one is cut off at today** — asking for days that have not
 * happened returns empty buckets, and an empty bucket drawn as a gap in the
 * future is a statement about missing data rather than about the future.
 * `isPartial` records that the cut happened.
 */
export function calendarWindow(
  range: Range,
  offset: number,
  now: Date,
  firstDay: number,
): TrendWindow {
  const today = startOfDay(now)
  let first: Date
  let naturalLast: Date

  switch (range) {
    case 'day':
      first = naturalLast = addDays(today, offset)
      break
    case 'week':
      first = addDays(startOfWeek(today, firstDay), offset * 7)
      naturalLast = addDays(first, 6)
      break
    case 'month':
      first = monthStart(today, offset)
      naturalLast = addDays(monthStart(first, 1), -1)
      break
    case 'year':
      first = new Date(today.getFullYear() + offset, 0, 1)
      naturalLast = new Date(today.getFullYear() + offset, 11, 31)
      break
  }

  const isPartial = naturalLast.getTime() > today.getTime()
  const last = isPartial ? today : naturalLast
  return make(first, last, isPartial, 'calendar')
}

/**
 * The window the current one is compared with.
 *
 * # ⚠️ Clipped to the same extent while the current period is still running
 *
 * This is the bill calendar periods come with, and it has to be paid here rather
 * than left to the reader. On the 3rd of the month "this month" is three days;
 * its total beside last month's whole one reads as a collapse, and nothing on
 * screen would explain it. So the previous window is cut to **the same number of
 * days that have elapsed** in the current one — the first three days of last
 * month, not all of it.
 *
 * ⚠️ Clipped further when the previous period is shorter (the 30th of March
 * against February): the clip can never run past the previous period's own end.
 *
 * A rolling window never needs any of this: both halves are the same length by
 * construction, which is exactly what makes the rolling view the right thing to
 * open on.
 */
export function previousWindow(
  current: TrendWindow,
  range: Range,
  offset: number,
  now: Date = new Date(),
  firstDay: number = firstWeekday(),
): TrendWindow {
  const natural = windowFor(range, current.kind, offset - 1, now, firstDay)
  if (current.kind !== 'calendar' || !current.isPartial) return natural

  const elapsed = daysBetween(new Date(current.start), new Date(current.end))
  if (elapsed <= 0) return natural

  const clippedEnd = addDays(new Date(natural.start), elapsed).getTime()
  const end = Math.min(clippedEnd, natural.end)
  const last = addDays(new Date(end), -1)
  return {
    from: natural.from,
    to: isoDay(last),
    start: natural.start,
    end,
    isPartial: false,
    kind: 'calendar',
  }
}

/**
 * Which offset of `range` holds the given day.
 *
 * - Returns `0` or a negative number. ⚠️ **Never positive.** A day in the future
 *   has no window to show, and clamping to the present is the honest answer.
 */
export function offsetOf(
  range: Range,
  kind: WindowKind,
  day: Date,
  now: Date = new Date(),
  firstDay: number = firstWeekday(),
): number {
  const today = startOfDay(now)
  const target = startOfDay(day)
  if (target.getTime() >= today.getTime()) return 0

  if (kind === 'rolling') {
    const days = daysBetween(target, today)
    switch (range) {
      case 'day':
        return back(days)
      case 'week':
        return back(Math.floor(days / 7))
      case 'month':
        return back(Math.floor(days / 30))
      case 'year':
        return back(Math.floor(monthsBetween(target, today) / 12))
    }
  }

  switch (range) {
    case 'day':
      return back(daysBetween(target, today))
    case 'week':
      return back(
        Math.round(daysBetween(startOfWeek(target, firstDay), startOfWeek(today, firstDay)) / 7),
      )
    case 'month':
      return back(monthsBetween(target, today))
    case 'year':
      return back(today.getFullYear() - target.getFullYear())
  }
}

/** `steps` periods ago, as a never-positive offset — and never `-0`, which is a
 * perfectly good number to compute and a confusing one to read in a test
 * failure or a query key. */
function back(steps: number): number {
  return steps > 0 ? -steps : 0
}

function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
}

/**
 * How many days the window covers — the number the clipped comparison has to
 * name out loud ("only the 27 days that have happened").
 *
 * `Math.round` rather than a division, because the hour the clocks change makes
 * one of these spans 23 or 25 hours long.
 */
export function dayCount(win: TrendWindow): number {
  return Math.round((win.end - win.start) / 86_400_000)
}

/**
 * One step finer — where a tap on the chart drills to.
 *
 * ⚠️ **The ladder is the ranges, not the buckets, and that is a deliberate
 * mismatch.** A month's bars are days, so there is nothing on that chart shaped
 * like a week to tap; but "year → month → week → day" is how people say it, and
 * the tapped date is enough to anchor the next step. Following the buckets
 * instead would jump from a month straight to a day and skip the level most
 * people are actually looking for.
 */
export function finer(range: Range): Range | null {
  switch (range) {
    case 'year':
      return 'month'
    case 'month':
      return 'week'
    case 'week':
      return 'day'
    case 'day':
      return null // hours are as far as /summary goes
  }
}

// --- Buckets -----------------------------------------------------------------

/**
 * The width of one bar, as the range chooses it: `day` → hourly, `week`/`month`
 * → daily, `year` → monthly. The same table the server keys its `time_bucket`
 * off, and the reason the chart's bars have to cover exactly this much.
 */
export type BucketUnit = 'hour' | 'day' | 'month'

export function bucketUnit(range: Range): BucketUnit {
  if (range === 'day') return 'hour'
  if (range === 'year') return 'month'
  return 'day'
}

/**
 * Every bucket start in the window, from `start` up to but not including `end`.
 *
 * ⚠️ **This is what makes a gap a gap.** The server sends only the buckets that
 * had a measurement, so entrusting the chart to the points would draw a 30-day
 * window with 3 measured days as a three-day chart — and the missing 27 days are
 * the information itself. The app solves the same problem from the other side,
 * by handing Swift Charts the window as an explicit x domain; here the buckets
 * are generated instead, and the ones with nothing in them carry `null`, never
 * `0`.
 *
 * Built with the local-time constructors rather than by adding milliseconds, so
 * the day the clocks change is still one bucket rather than 23 or 25 hours of
 * drift.
 */
export function bucketStarts(win: TrendWindow, range: Range): number[] {
  const unit = bucketUnit(range)
  const out: number[] = []
  let cursor = new Date(win.start)
  // A window is at most a year of months, 31 days or 24 hours; the guard is
  // against a bad `end`, not against a legitimately long window.
  for (let i = 0; i < 1000 && cursor.getTime() < win.end; i++) {
    out.push(cursor.getTime())
    cursor =
      unit === 'hour'
        ? new Date(
            cursor.getFullYear(),
            cursor.getMonth(),
            cursor.getDate(),
            cursor.getHours() + 1,
          )
        : unit === 'day'
          ? addDays(cursor, 1)
          : monthStart(cursor, 1)
  }
  return out
}

/**
 * The key a moment belongs under, at this bucket width — local, so that a
 * server timestamp (`2026-07-31T22:00:00Z`, which is the 1st of August in
 * Budapest) lands in the bucket the reader would put it in.
 *
 * Matching on the exact millisecond would work today and break the first time a
 * daylight-saving boundary moved a bucket start by an hour.
 */
export function bucketKey(ms: number, range: Range): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  const ym = `${d.getFullYear()}-${p(d.getMonth() + 1)}`
  switch (bucketUnit(range)) {
    case 'month':
      return ym
    case 'day':
      return `${ym}-${p(d.getDate())}`
    case 'hour':
      return `${ym}-${p(d.getDate())}T${p(d.getHours())}`
  }
}
