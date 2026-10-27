// Year by year — the rules mirrored from
// `HelsaKit/Tests/HelsaKitTests/RetrospectiveTests.swift`.
//
// The phone's file names three quiet failures. Two of them carry over: a
// choice that resolves to nothing, and a span the data cannot keep. The third —
// a cached answer to a different question — does not exist here, because the
// web keeps no answer: the server recomputes it on every open. What replaces it
// is the one-request split, which the phone never had to get right.

import { beforeEach, describe, expect, it } from 'vitest'
import type { SummaryResponse } from '../api/types'
import { METRIC_LIST, metricDef } from './metrics'
import {
  MAX_YEARS,
  MIN_MEASURED_MONTHS,
  RECOMMENDED,
  SELECTION_KEY,
  buildRows,
  change,
  columnYears,
  elapsedMonths,
  isFullySelected,
  isRecommended,
  keysIn,
  loadSelection,
  longViewWindow,
  measuredYears,
  saveSelection,
  selectAll,
  selectedCount,
  spanText,
  toggle,
  toggleGroup,
  wireNames,
  yearsBack,
} from './longView'

const now = new Date(2026, 7, 27, 12) // 27 August 2026

/** Monthly step buckets: `{ 2025: [1, 2, 3] }` = Jan–Mar 2025, local midnight as UTC. */
function steps(byYear: Record<number, number[]>, value = 250_000): SummaryResponse {
  const buckets = Object.entries(byYear).flatMap(([y, months]) =>
    months.map((m) => ({ t: new Date(Number(y), m - 1, 1).toISOString(), v: value })),
  )
  return { metrics: { stepCount: { agg: 'sum', unit: 'count', buckets } } }
}

function rowOf(resp: SummaryResponse) {
  return buildRows([metricDef('stepCount')], resp, now)
}

describe('the window', () => {
  it('runs backwards from this year, five years at most', () => {
    const years = yearsBack(now)
    expect(years[0]).toBe(2026)
    expect(years).toHaveLength(MAX_YEARS)
    expect(years).toEqual([...years].sort((a, b) => b - a))
  })

  it('is ONE request from January of the oldest year to today', () => {
    expect(longViewWindow(now)).toEqual({ from: '2022-01-01', to: '2026-08-27' })
  })

  it('counts this year only as far as it has gone', () => {
    expect(elapsedMonths(2025, now)).toBe(12)
    expect(elapsedMonths(2026, now)).toBe(8)
  })
})

describe('splitting one response into years', () => {
  it('a year below three measured months carries no figure — two months are not a year', () => {
    const [row] = rowOf(steps({ 2025: [1, 2], 2026: [1, 2, 3] }))
    const y2025 = row.years.find((y) => y.year === 2025)!
    const y2026 = row.years.find((y) => y.year === 2026)!
    expect(MIN_MEASURED_MONTHS).toBe(3)
    expect(y2025.measuredMonths).toBe(2)
    expect(y2025.value).toBeNull()
    expect(y2026.value).toBe(250_000)
    expect(y2026.isPartial).toBe(true)
  })

  it('the figure is the average MONTH over measured months, not the year’s total', () => {
    const resp: SummaryResponse = {
      metrics: {
        stepCount: {
          agg: 'sum',
          unit: 'count',
          buckets: [1, 2, 3, 7].map((m, i) => ({ t: new Date(2025, m - 1, 1).toISOString(), v: (i + 1) * 100 })),
        },
      },
    }
    const [row] = rowOf(resp)
    // (100 + 200 + 300 + 400) / 4 measured months — the 8 unmeasured are not zeros.
    expect(row.years.find((y) => y.year === 2025)!.value).toBe(250)
  })

  it('a January bucket stamped in the previous UTC year still belongs to January', () => {
    // Budapest's 1 January 00:00 is 31 December 23:00 UTC; slicing the string
    // would hand the month to the wrong year. Built locally, read locally.
    const [row] = rowOf(steps({ 2024: [1, 2, 3] }))
    expect(row.years.find((y) => y.year === 2024)!.measuredMonths).toBe(3)
    expect(row.years.find((y) => y.year === 2023)!.measuredMonths).toBe(0)
  })

  it('an averaged metric averages its monthly levels', () => {
    const resp: SummaryResponse = {
      metrics: {
        restingHeartRate: {
          agg: 'avg',
          unit: 'count/min',
          buckets: [1, 2, 3].map((m) => ({ t: new Date(2025, m - 1, 1).toISOString(), avg: 50 + m })),
        },
      },
    }
    const [row] = buildRows([metricDef('restingHeartRate')], resp, now)
    expect(row.agg).toBe('avg')
    expect(row.years.find((y) => y.year === 2025)!.value).toBe(52) // (51 + 52 + 53) / 3
  })
})

describe('the span it may claim', () => {
  it('is the one FOUND, not the one asked for', () => {
    const rows = rowOf(steps({ 2025: [1, 2, 3, 4], 2026: [1, 2, 3] }))
    expect(measuredYears(rows)).toEqual([2025, 2026])
    expect(spanText(measuredYears(rows))).toBe('2025–2026')
  })

  it('a single measured year is named as one year', () => {
    expect(spanText(measuredYears(rowOf(steps({ 2026: [1, 2, 3] }))))).toBe('2026')
  })

  it('an empty long view claims no span at all', () => {
    const rows = rowOf({ metrics: {} })
    expect(measuredYears(rows)).toEqual([])
    expect(spanText([])).toBeNull()
    expect(columnYears(rows, now)).toEqual([])
  })

  it('draws from the first measured year to this year, even when this year is still too short', () => {
    const rows = rowOf(steps({ 2023: [1, 2, 3], 2026: [1] }))
    expect(columnYears(rows, now)).toEqual([2023, 2024, 2025, 2026])
  })
})

describe('the change from the first measured year to the last', () => {
  it('needs two measured years', () => {
    expect(change(rowOf(steps({ 2026: [1, 2, 3] }))[0])).toBeNull()
  })

  it('is a fraction of the first year', () => {
    const resp: SummaryResponse = {
      metrics: {
        stepCount: {
          agg: 'sum',
          unit: 'count',
          buckets: [
            ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => ({ t: new Date(2025, m - 1, 1).toISOString(), v: 8000 })),
            ...[1, 2, 3, 4, 5, 6, 7, 8].map((m) => ({ t: new Date(2026, m - 1, 1).toISOString(), v: 8800 })),
          ],
        },
      },
    }
    const c = change(rowOf(resp)[0])!
    expect(c.ratio).toBeCloseTo(0.1)
    expect(c.from).toBe(2025)
    expect(c.to).toBe(2026)
    expect(c.uneven).toBe(false)
  })

  it('flags years measured on wildly different shares — but still shows an average', () => {
    // 3 of 12 months against 8 of 8: 0.25 against 1.
    const c = change(rowOf(steps({ 2024: [1, 2, 3], 2026: [1, 2, 3, 4, 5, 6, 7, 8] }))[0])!
    expect(c.uneven).toBe(true)
  })
})

describe('the choice', () => {
  beforeEach(() => localStorage.clear())

  it('never touched resolves to the recommendation, not to nothing', () => {
    expect(loadSelection()).toEqual(expect.arrayContaining(RECOMMENDED))
    expect(isRecommended(loadSelection())).toBe(true)
  })

  it('an emptied, corrupt or unknown stored choice resolves to the recommendation too', () => {
    localStorage.setItem(SELECTION_KEY, '[]')
    expect(isRecommended(loadSelection())).toBe(true)
    localStorage.setItem(SELECTION_KEY, '{not json')
    expect(isRecommended(loadSelection())).toBe(true)
    localStorage.setItem(SELECTION_KEY, JSON.stringify(['noSuchMetric']))
    expect(isRecommended(loadSelection())).toBe(true)
  })

  it('round-trips through storage in catalogue order, dropping names it no longer knows', () => {
    saveSelection(['bodyMass', 'stepCount', 'gone'])
    expect(loadSelection()).toEqual(['stepCount', 'bodyMass'])
  })

  it('survives a storage that throws', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')!
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked')
      },
    })
    try {
      expect(() => saveSelection(['stepCount'])).not.toThrow()
      expect(isRecommended(loadSelection())).toBe(true)
    } finally {
      Object.defineProperty(globalThis, 'localStorage', original)
    }
  })

  it('a half-ticked group fills up before it empties', () => {
    const heart = keysIn('heart')
    let sel = toggle([], heart[0])
    expect(isFullySelected(sel, 'heart')).toBe(false)
    sel = toggleGroup(sel, 'heart')
    expect(isFullySelected(sel, 'heart')).toBe(true)
    sel = toggleGroup(sel, 'heart')
    expect(selectedCount(sel, 'heart')).toBe(0)
  })

  it('select all takes the whole catalogue', () => {
    expect(selectAll()).toHaveLength(METRIC_LIST.length)
  })

  it('sleep is not in the recommendation', () => {
    expect(RECOMMENDED.join().toLowerCase()).not.toContain('sleep')
    expect(RECOMMENDED.length).toBeGreaterThanOrEqual(6)
  })

  it('asks for every alias as well', () => {
    expect(wireNames(['activeEnergy', 'stepCount'])).toEqual(['activeEnergy', 'activeEnergyBurned', 'stepCount'])
  })
})
