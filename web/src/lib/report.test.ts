// The printable summary's rules — a port, so the tests are a port too.
//
// The `ReportChange` block mirrors `HelsaKit/Tests/HelsaKitTests/
// ReportChangeTests.swift` test for test, under the same names, so a change on
// one side has an obvious partner on the other. The band, the window and the
// row are the phone's `ReportBaseline` / `ReportWindows` / `ReportContent.row`
// rules; the coverage-withheld block is the web's one addition (`lib/compare.ts`)
// and is tested as such.
//
// Every date is built from LOCAL parts, as the lib builds them: the window is
// calendar days on the reader's clock, and a test that used UTC instants would
// pass in Budapest and fail in New York.

import { describe, expect, it } from 'vitest'
import type { SummaryResponse, Workout } from '../api/types'
import { metricDef } from './metrics'
import {
  BASELINE_MIN_DAYS,
  DEFAULT_REPORT_METRICS,
  MAX_CHANGE_LINES,
  MAX_REPORT_WORKOUTS,
  baselineWindow,
  buildRow,
  changeDelta,
  changeLine,
  changeMagnitude,
  changeRatio,
  makeBand,
  parseReportParams,
  percentile,
  previousAverage,
  reportDigits,
  reportUnit,
  reportWindow,
  reportWorkouts,
  signedPercent,
  topChanges,
  type DayPoint,
  type ReportChange,
  type ReportWindow,
} from './report'

const day = (month: number, d: number, year = 2026) => new Date(year, month - 1, d)
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

/** `count` daily points running backwards from `end`. */
function daily(count: number, end: Date, value: number | ((d: Date) => number)): DayPoint[] {
  return Array.from({ length: count }, (_, i) => {
    const d = addDays(end, -(count - 1 - i))
    return { ms: d.getTime(), value: typeof value === 'function' ? value(d) : value, min: null, max: null }
  })
}

/** A `/summary` answer of daily buckets for one averaged metric. */
function avgSummary(key: string, points: { d: Date; v: number; min?: number; max?: number }[]): SummaryResponse {
  return {
    metrics: {
      [key]: {
        agg: 'avg',
        unit: 'count/min',
        buckets: points.map((p) => ({ t: p.d.toISOString(), avg: p.v, min: p.min, max: p.max })),
      },
    },
  }
}

function sumSummary(key: string, points: { d: Date; v: number }[]): SummaryResponse {
  return {
    metrics: { [key]: { agg: 'sum', unit: 'count', buckets: points.map((p) => ({ t: p.d.toISOString(), v: p.v })) } },
  }
}

const window30 = () => reportWindow(30, day(8, 27))

// --- ReportChangeTests.swift ----------------------------------------------------

describe('ReportChange — when there is no comparison to make', () => {
  it('a previous period with too few measured days says nothing', () => {
    // ⚠️ The guard that matters most: six measured mornings would make a confident arrow.
    const win = window30()
    const base = baselineWindow(win)
    const sparse = daily(6, addDays(new Date(win.start), -1), 60)
    expect(previousAverage(sparse, win, base)).toBeNull()
  })

  it('a period outside the baseline window says nothing', () => {
    // A 365-day report has no previous period inside a year's baseline; inventing
    // one from whatever days are there would compare a year with a fortnight.
    const win = reportWindow(365, day(8, 27))
    const base = baselineWindow(win)
    const everything = daily(800, day(8, 27), 60)
    expect(previousAverage(everything, win, base)).toBeNull()
  })

  it('there is no comparison without a baseline', () => {
    const win = window30()
    expect(previousAverage(null, win, baselineWindow(win))).toBeNull()
    expect(previousAverage(daily(90, day(8, 27), 60), win, null)).toBeNull()
  })
})

describe('ReportChange — the window arithmetic', () => {
  it('only the days before the report window count', () => {
    // ⚠️ Days INSIDE the window must not leak into the previous average — the
    // difference would come out smaller than it is.
    const win = window30()
    const points = daily(90, day(8, 27), (d) => (d.getTime() >= win.start ? 100 : 60))
    const found = previousAverage(points, win, baselineWindow(win))
    expect(found).toEqual({ average: 60, days: 30 })
  })

  it('the previous period ends where the window starts and is as long', () => {
    const win = window30()
    // A spike the day before the window counts; one 31 days before does not.
    const points = daily(90, day(8, 27), (d) => {
      const back = Math.round((win.start - d.getTime()) / 86_400_000)
      return back === 1 ? 90 : back === 31 ? 1000 : 60
    })
    const found = previousAverage(points, win, baselineWindow(win))!
    expect(found.days).toBe(30)
    expect(found.average).toBeCloseTo((29 * 60 + 90) / 30)
  })
})

describe('ReportChange — the change itself', () => {
  it('the ratio is signed and the delta matches', () => {
    const c: ReportChange = { current: 62, previous: 58, previousDays: 30 }
    expect(changeDelta(c)).toBe(4)
    expect(changeRatio(c)!).toBeCloseTo(4 / 58, 4)
  })

  it('a previous period of zero has no percentage', () => {
    const c: ReportChange = { current: 5, previous: 0, previousDays: 30 }
    expect(changeRatio(c)).toBeNull()
    expect(changeMagnitude(c)).toBe(0)
  })
})

describe('ReportChange — which lines reach the page', () => {
  const row = (name: string, change: ReportChange | null) => ({ name, change })

  it('a movement too small to matter is left off', () => {
    expect(topChanges([row('Resting heart rate', { current: 58.6, previous: 58.2, previousDays: 30 })])).toEqual([])
  })

  it('the biggest movers come first and the rest are cut', () => {
    const lines = topChanges([
      row('Small', { current: 106, previous: 100, previousDays: 30 }),
      row('Big', { current: 150, previous: 100, previousDays: 30 }),
      row('Middle', { current: 120, previous: 100, previousDays: 30 }),
      row('Fourth', { current: 110, previous: 100, previousDays: 30 }),
    ])
    expect(lines).toHaveLength(MAX_CHANGE_LINES)
    expect(lines.map((l) => l.name)).toEqual(['Big', 'Middle', 'Fourth'])
  })

  it('a row without a change is simply absent', () => {
    expect(topChanges([row('Resting heart rate', null)])).toEqual([])
  })

  it('a fall and a rise are ranked the same', () => {
    // ⚠️ Unsigned on purpose: ranking rises first would be the page deciding.
    const lines = topChanges([
      row('Fell', { current: 50, previous: 100, previousDays: 30 }),
      row('Rose', { current: 110, previous: 100, previousDays: 30 }),
    ])
    expect(lines[0].name).toBe('Fell')
  })

  const templates = { withPercent: '{name}: {from} → {to} ({pct})', withoutPercent: '{name}: {from} → {to}' }
  const num = (v: number) => String(Math.round(v))

  it('both numbers are printed, not just the difference', () => {
    const line = changeLine('Resting heart rate', 'bpm', { current: 62, previous: 58, previousDays: 30 }, num, templates)
    expect(line).toContain('58')
    expect(line).toContain('62')
    expect(line).toContain('bpm')
    expect(line).toBe('Resting heart rate: 58 → 62 bpm (+7%)')
  })

  it('the unit is not repeated on both sides', () => {
    const line = changeLine('Resting heart rate', 'bpm', { current: 62, previous: 58, previousDays: 30 }, num, templates)
    expect(line.split('bpm').length - 1).toBe(1)
  })

  it('a unitless metric prints no unit at all', () => {
    const line = changeLine('BMI', '', { current: 24, previous: 22, previousDays: 30 }, num, templates)
    expect(line).not.toContain('  ')
  })

  it('a previous zero prints the two numbers without a percentage', () => {
    expect(changeLine('Falls', '', { current: 2, previous: 0, previousDays: 30 }, num, templates)).toBe('Falls: 0 → 2')
  })

  it('the percentage is signed with a minus sign, not a hyphen', () => {
    expect(signedPercent(-0.124)).toBe('−12%')
    expect(signedPercent(0.07)).toBe('+7%')
    expect(signedPercent(0.001)).toBe('0%')
  })
})

// --- ReportBaseline.swift --------------------------------------------------------

describe('the usual range', () => {
  it('below the data minimum there is no band at all', () => {
    expect(makeBand(Array.from({ length: BASELINE_MIN_DAYS - 1 }, (_, i) => i))).toBeNull()
    expect(makeBand(Array.from({ length: BASELINE_MIN_DAYS }, (_, i) => i))).not.toBeNull()
  })

  it('is the 10th–90th percentile with R-7 interpolation, and carries its day count', () => {
    // 1…20: rank of p10 = 19 × 0.1 = 1.9 → 2 + 0.9 = 2.9; p90 rank 17.1 → 18.1.
    const band = makeBand(Array.from({ length: 20 }, (_, i) => 20 - i))!
    expect(band.low).toBeCloseTo(2.9)
    expect(band.high).toBeCloseTo(18.1)
    expect(band.median).toBeCloseTo(10.5)
    expect(band.dayCount).toBe(20)
  })

  it('one wild day does not define the band', () => {
    const values = [...Array.from({ length: 29 }, () => 60), 140]
    expect(makeBand(values)!.high).toBe(60)
  })

  it('percentile handles the edges', () => {
    expect(percentile([], 0.5)).toBe(0)
    expect(percentile([7], 0.9)).toBe(7)
    expect(percentile([1, 2, 3], 1)).toBe(3)
    expect(percentile([1, 2, 3], -1)).toBe(1)
  })
})

// --- ReportWindow.swift ----------------------------------------------------------

describe('the window', () => {
  it('ends today, today included, and is as long as asked', () => {
    const win = reportWindow(30, new Date(2026, 7, 27, 15, 30))
    expect(win.to).toBe('2026-08-27')
    expect(win.from).toBe('2026-07-29')
    expect(win.days).toBe(30)
    expect(win.end).toBe(day(8, 28).getTime())
  })

  it('stays on local midnights across a daylight-saving change', () => {
    // Europe moves its clocks on the last Sunday of October; the day count must not drift.
    const win = reportWindow(90, day(11, 15))
    expect(win.from).toBe('2026-08-18')
    expect(new Date(win.start).getHours()).toBe(0)
  })

  it('the baseline is a year ending on the same day, and contains the period', () => {
    const win = reportWindow(90, day(8, 27))
    const base = baselineWindow(win)
    expect(base.days).toBe(365)
    expect(base.to).toBe(win.to)
    expect(base.end).toBe(win.end)
    expect(base.start).toBeLessThan(win.start)
  })

  it('a report as long as the baseline gets itself as the baseline', () => {
    const win = reportWindow(365, day(8, 27))
    expect(baselineWindow(win)).toEqual(win)
  })
})

// --- ReportContent.row -----------------------------------------------------------

describe('one row', () => {
  const rhr = metricDef('restingHeartRate')

  function setup(win: ReportWindow, opts: { periodDays?: number; prevValue?: number; prevEvery?: number } = {}) {
    const base = baselineWindow(win)
    const end = new Date(win.end - 1)
    const periodPoints = daily(opts.periodDays ?? win.days, new Date(end.getFullYear(), end.getMonth(), end.getDate()), 62)
      .map((p) => ({ d: new Date(p.ms), v: p.value, min: p.value - 4, max: p.value + 6 }))
    const before = daily(base.days - win.days, addDays(new Date(win.start), -1), opts.prevValue ?? 58)
      .filter((_, i) => i % (opts.prevEvery ?? 1) === 0)
      .map((p) => ({ d: new Date(p.ms), v: p.value }))
    return {
      base,
      summary: avgSummary('restingHeartRate', periodPoints),
      baseline: avgSummary('restingHeartRate', [...before, ...periodPoints]),
    }
  }

  it('reads the average, the extremes of the individual measurements, the latest and the band', () => {
    const win = window30()
    const { base, summary, baseline } = setup(win)
    const row = buildRow(rhr, summary, baseline, win, base)
    expect(row.average).toBe(62)
    expect(row.extremes).toEqual({ low: 58, high: 68 })
    expect(row.latest?.ms).toBe(day(8, 27).getTime())
    expect(row.measuredDays).toBe(30)
    expect(row.periodDays).toBe(30)
    expect(row.band).not.toBeNull()
    expect(row.band!.dayCount).toBe(365)
    expect(row.change).toEqual({ current: 62, previous: 58, previousDays: 30 })
    expect(row.total).toBeNull()
  })

  it('an unmeasured period is no measurement — never a zero', () => {
    const win = window30()
    const row = buildRow(rhr, { metrics: {} }, null, win, null)
    expect(row.average).toBeNull()
    expect(row.extremes).toBeNull()
    expect(row.latest).toBeNull()
    expect(row.band).toBeNull()
    expect(row.bandSourceDays).toBe(0)
    expect(row.change).toBeNull()
  })

  it('without a baseline the band is read from the period, and there is no change', () => {
    const win = window30()
    const { summary } = setup(win)
    const row = buildRow(rhr, summary, null, win, null)
    expect(row.band?.dayCount).toBe(30)
    expect(row.change).toBeNull()
  })

  it('a thin band source is no band, with the day count kept for the sentence', () => {
    const win = window30()
    const { summary } = setup(win, { periodDays: 9 })
    const row = buildRow(rhr, summary, null, win, null)
    expect(row.band).toBeNull()
    expect(row.bandSourceDays).toBe(9)
  })

  it('a summed metric carries the period total; its extremes are the daily totals', () => {
    const win = window30()
    const pts = daily(30, day(8, 27), 0).map((p, i) => ({ d: new Date(p.ms), v: i % 2 ? 8000 : 10000 }))
    const row = buildRow(metricDef('stepCount'), sumSummary('stepCount', pts), null, win, null)
    expect(row.total).toBe(15 * 8000 + 15 * 10000)
    expect(row.average).toBe(9000)
    expect(row.extremes).toEqual({ low: 8000, high: 10000 })
  })

  it('days outside the window do not reach the period figures', () => {
    const win = window30()
    const pts = daily(60, day(8, 27), (d) => (d.getTime() >= win.start ? 62 : 200)).map((p) => ({ d: new Date(p.ms), v: p.value }))
    const row = buildRow(rhr, avgSummary('restingHeartRate', pts), null, win, null)
    expect(row.average).toBe(62)
    expect(row.measuredDays).toBe(30)
  })

  // --- The web's own rule ---------------------------------------------------------

  it('withholds a change when the two periods were measured on very different shares (lib/compare.ts)', () => {
    // 30 of 30 now against 8 of 30 before: ≥ 7 days, so the phone would print it.
    const win = window30()
    const { base, summary, baseline } = setup(win, { prevEvery: 4, prevValue: 50 })
    const row = buildRow(rhr, summary, baseline, win, base)
    expect(row.change).toBeNull()
    expect(row.withheldChange).toMatchObject({ current: 62, previous: 50, currentDays: 30 })
    expect(row.withheldChange!.previousDays).toBeLessThan(15)
  })

  it('a withheld change too small to print anyway is not named', () => {
    const win = window30()
    const { base, summary, baseline } = setup(win, { prevEvery: 4, prevValue: 61.5 })
    const row = buildRow(rhr, summary, baseline, win, base)
    expect(row.change).toBeNull()
    expect(row.withheldChange).toBeNull()
  })
})

describe('numbers and units on paper', () => {
  it('decimals follow the magnitude, and zero is "0" (TrendFormat.fractionDigits)', () => {
    expect(reportDigits(8432)).toBe(0)
    expect(reportDigits(62.4)).toBe(1)
    expect(reportDigits(1.23)).toBe(2)
    expect(reportDigits(0)).toBe(0)
  })

  it('the same wire unit is heartbeats or breaths depending on the metric (ReportUnit)', () => {
    expect(reportUnit('restingHeartRate', 'count/min')).toEqual({ word: 'bpm' })
    expect(reportUnit('respiratoryRate', 'count/min')).toEqual({ word: 'breaths' })
    expect(reportUnit('bloodPressureSystolic', 'mmHg')).toEqual({ word: 'mmHg' })
    expect(reportUnit('bodyMassIndex', '')).toEqual({ raw: '' })
    expect(reportUnit('dietaryWater', 'mL')).toEqual({ wire: 'mL' })
    expect(reportUnit('timeInDaylight', 'min')).toEqual({ word: 'minutes' })
  })
})

describe('workouts', () => {
  const w = (id: string, start: Date, min: number | null, dist?: number): Workout => ({
    id,
    activity_type: 'running',
    started_at: start.toISOString(),
    ended_at: min == null ? undefined : new Date(start.getTime() + min * 60_000).toISOString(),
    total_distance_m: dist,
  })

  it('counts the window only, oldest first, and keeps the most recent when over the bound', () => {
    const win = reportWindow(90, day(8, 27))
    const items = Array.from({ length: MAX_REPORT_WORKOUTS + 5 }, (_, i) => w(`w${i}`, new Date(2026, 7, 26 - i, 7), 30, 5000))
    items.push(w('old', new Date(2025, 0, 1, 7), 30))
    const r = reportWorkouts(items, win)
    expect(r.sessions).toBe(MAX_REPORT_WORKOUTS + 5)
    expect(r.shown).toHaveLength(MAX_REPORT_WORKOUTS)
    expect(r.shown[r.shown.length - 1].id).toBe('w0')
    expect(startMs(r.shown[0])).toBeLessThan(startMs(r.shown[1]))
  })

  it('an indoor period has no distance rather than 0 km, and an open session adds no time', () => {
    const win = reportWindow(30, day(8, 27))
    const r = reportWorkouts([w('a', new Date(2026, 7, 20, 7), 40), w('b', new Date(2026, 7, 21, 7), null)], win)
    expect(r.distanceM).toBeNull()
    expect(r.durationMin).toBe(40)
    expect(r.durationKnown).toBe(1)
  })

  it('a second recording of the same session is folded and counted', () => {
    const win = reportWindow(30, day(8, 27))
    const start = new Date(2026, 7, 20, 7)
    const r = reportWorkouts([w('a', start, 40, 5000), { ...w('b', start, 40, 5000), source_uuid: 'other' }], win)
    expect(r.sessions).toBe(1)
    expect(r.extraRecordings).toBe(1)
  })
})

describe('the address', () => {
  const known = (k: string) => k !== 'nope'

  it('no parameters is the phone default: 90 days and the default set', () => {
    expect(parseReportParams(new URLSearchParams(''), known)).toEqual({ days: 90, metrics: DEFAULT_REPORT_METRICS })
  })

  it('reads an offered length and a list, dropping unknown and repeated keys', () => {
    expect(parseReportParams(new URLSearchParams('d=30&m=bodyMass,nope,bodyMass,stepCount'), known)).toEqual({
      days: 30,
      metrics: ['bodyMass', 'stepCount'],
    })
  })

  it('a length that is not offered falls back to 90', () => {
    expect(parseReportParams(new URLSearchParams('d=45'), known).days).toBe(90)
  })

  it('an empty list is "nothing chosen", not the default', () => {
    expect(parseReportParams(new URLSearchParams('m='), known).metrics).toEqual([])
  })
})

function startMs(x: Workout): number {
  return Date.parse(x.started_at ?? '')
}
