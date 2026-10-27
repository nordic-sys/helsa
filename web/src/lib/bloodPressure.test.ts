import { describe, expect, it } from 'vitest'
import type { Sample } from '../api/types'
import {
  BP_OUTLIER,
  bpAbsence,
  bpAverage,
  detectUnusual,
  meanArterial,
  pairReadings,
  pulsePressure,
  readingsInWindow,
  type BpReading,
} from './bloodPressure'

// A mirror of the phone's `BloodPressureOutlierTests.swift`, case for case, plus
// the pairing and the card's arithmetic. What these mostly pin is SILENCE: the
// circumstances under which the page must say nothing about a reading.

const now = new Date(2026, 7, 11, 20, 0, 0)

function at(daysAgo: number, hour = 20): Date {
  return new Date(2026, 7, 11 - daysAgo, hour, 0, 0)
}

function reading(systolic: number, diastolic: number, daysAgo = 0, hour = 8): BpReading {
  const d = at(daysAgo, hour)
  return { at: d.toISOString(), ms: d.getTime(), systolic, diastolic }
}

/** `count` readings on the days before `now`, alternating ± `jitter`. */
function steady(systolic: number, diastolic: number, count: number, jitter = 0): BpReading[] {
  return Array.from({ length: count }, (_, i) => {
    const offset = i + 1
    const sign = offset % 2 === 0 ? 1 : -1
    const d = at(offset)
    return { at: d.toISOString(), ms: d.getTime(), systolic: systolic + sign * jitter, diastolic: diastolic + sign * jitter }
  })
}

describe('unusual readings — the phone’s rule', () => {
  it('stays silent below the data minimum', () => {
    expect(detectUnusual([...steady(120, 78, 5, 2), reading(180, 110)], now)).toEqual([])
  })

  it('speaks exactly at the minimum', () => {
    const readings = [...steady(120, 78, BP_OUTLIER.minBaselineReadings, 2), reading(150, 96)]
    expect(readings).toHaveLength(BP_OUTLIER.minBaselineReadings + 1)
    expect(detectUnusual(readings, now)).toHaveLength(1)
  })

  it('produces nothing from constant data', () => {
    expect(detectUnusual([...steady(120, 78, 30), reading(150, 96)], now)).toEqual([])
  })

  it('calls the same reading unusual for one person and not for another', () => {
    const spike = reading(150, 95)
    expect(detectUnusual([...steady(118, 76, 30, 3), spike], now)).toHaveLength(1)
    // For this person 150/95 IS the usual — saying otherwise would be a medical claim.
    expect(detectUnusual([...steady(149, 94, 30, 3), spike], now)).toEqual([])
  })

  it('finds an unusually LOW reading too', () => {
    const found = detectUnusual([...steady(128, 82, 30, 3), reading(96, 62)], now)
    expect(found).toHaveLength(1)
    expect(found[0].deviations.every((d) => !d.isAbove)).toBe(true)
  })

  it('ignores a statistically large but humanly tiny difference', () => {
    // 4/2 mmHg is not news, however many sigmas it is.
    expect(detectUnusual([...steady(120, 78, 30, 1), reading(124, 80)], now)).toEqual([])
  })

  it('checks the absolute floor per axis', () => {
    const found = detectUnusual([...steady(120, 78, 30, 3), reading(140, 79)], now)
    expect(found).toHaveLength(1)
    expect(found[0].deviations.map((d) => d.axis)).toEqual(['systolic'])
  })

  it('does not let a reading help define the usual it is compared with', () => {
    const found = detectUnusual([...steady(118, 76, 15, 3), reading(152, 97, 0)], now)
    expect(found).toHaveLength(1)
    const sys = found[0].deviations.find((d) => d.axis === 'systolic')
    expect(sys).toBeDefined()
    expect(Math.abs((sys?.baseline ?? 0) - 118)).toBeLessThan(1)
  })

  it('does not consider readings older than the window', () => {
    const old = Array.from({ length: 20 }, (_, i) => {
      const d = at(BP_OUTLIER.baselineDays + i + 1)
      return { at: d.toISOString(), ms: d.getTime(), systolic: 118, diastolic: 76 }
    })
    expect(detectUnusual([...old, reading(160, 100)], now)).toEqual([])
  })

  it('ignores readings in the future', () => {
    const future = reading(180, 110, -1)
    expect(detectUnusual([...steady(120, 78, 30, 3), future], now)).toEqual([])
  })

  it('carries the reading’s own timestamp', () => {
    const spike = reading(150, 95, 2, 7)
    const found = detectUnusual([...steady(118, 76, 30, 3), spike], now)
    expect(found[0].reading.ms).toBe(spike.ms)
  })

  it('counts what the rule had to work with, for the silent case', () => {
    expect(readingsInWindow([...steady(120, 78, 5, 2), reading(130, 80, 120)], now)).toBe(5)
  })
})

describe('pairing', () => {
  const s = (ts: string, value: number): Sample => ({ ts, value })

  it('makes no reading out of half a measurement', () => {
    const readings = pairReadings(
      [s('2026-08-11T06:00:00Z', 148), s('2026-08-11T07:00:00Z', 132)],
      [s('2026-08-11T06:00:00Z', 94)],
    )
    expect(readings).toHaveLength(1)
    expect(readings[0]).toMatchObject({ systolic: 148, diastolic: 94 })
  })

  it('pairs on the exact instant — a minute apart is two halves', () => {
    expect(pairReadings([s('2026-08-11T06:00:00Z', 148)], [s('2026-08-11T06:01:00Z', 94)])).toEqual([])
  })

  it('matches the instant, not the spelling of it', () => {
    const readings = pairReadings([s('2026-08-11T06:00:00Z', 148)], [s('2026-08-11T06:00:00.000Z', 94)])
    expect(readings).toHaveLength(1)
  })

  it('returns the readings oldest first, whatever order the server paged them in', () => {
    const readings = pairReadings(
      [s('2026-08-11T06:00:00Z', 130), s('2026-08-01T06:00:00Z', 120)],
      [s('2026-08-01T06:00:00Z', 80), s('2026-08-11T06:00:00Z', 85)],
    )
    expect(readings.map((r) => r.systolic)).toEqual([120, 130])
  })
})

describe('the card’s arithmetic and absences', () => {
  it('names which half is missing rather than showing the other', () => {
    expect(bpAbsence([], false, false)).toBe('bothMissing')
    expect(bpAbsence([], true, false)).toBe('systolicOnly')
    expect(bpAbsence([], false, true)).toBe('diastolicOnly')
    expect(bpAbsence([], true, true)).toBe('noPairedReading')
    expect(bpAbsence([reading(120, 80)], true, true)).toBe('none')
  })

  it('computes pulse pressure and MAP the phone’s way', () => {
    expect(pulsePressure({ systolic: 120, diastolic: 80 })).toBe(40)
    expect(meanArterial({ systolic: 120, diastolic: 81 })).toBe(94)
  })

  it('averages both values, and has no average without a reading', () => {
    expect(bpAverage([reading(120, 80), reading(130, 90, 1)])).toEqual({ systolic: 125, diastolic: 85 })
    expect(bpAverage([])).toBeNull()
  })
})
