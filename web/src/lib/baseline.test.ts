import { describe, expect, it } from 'vitest'
import type { MetricBaseline, Standing } from '../api/types'
import { STANDING_ARROW, bandOf, pickBaseline } from './baseline'
import { metricDef } from './metrics'

// What these hold is the SILENCE. The band is the one element on the Trends page
// that makes a claim rather than reporting a measurement, and every case below is
// about the circumstances in which it must not be drawn at all.

describe('bandOf', () => {
  it('draws a band when the server sent one', () => {
    expect(bandOf({ mean: 100, sd: 10, low: 90, high: 110, day_count: 60 })).toEqual({
      low: 90,
      high: 110,
    })
  })

  it('draws nothing when there were not enough measured days', () => {
    // ⚠️ The server withholds mean/low/high below its minimum and sends only the
    // day count. The correct drawing is nothing — NOT a narrower band, and above all
    // not a band around zero, which is what a `?? 0` here would produce.
    expect(bandOf({ day_count: 9 })).toBeNull()
  })

  it('draws nothing without a baseline at all', () => {
    // The ranges with hourly or monthly buckets never ask for one.
    expect(bandOf(undefined)).toBeNull()
  })

  it('draws nothing for a zero-width band', () => {
    // A reference window whose days never varied. Every single day would fall
    // outside a band of no width, and the standing would flip on a rounding error.
    expect(bandOf({ mean: 60, sd: 0, low: 60, high: 60, day_count: 30 })).toBeNull()
  })
})

describe('pickBaseline', () => {
  const def = metricDef('hrv') // its wire alias is heartRateVariabilitySDNN

  it('prefers whichever name actually carries a band', () => {
    const metrics: Record<string, MetricBaseline> = {
      hrv: { day_count: 0 },
      heartRateVariabilitySDNN: { mean: 45, sd: 8, low: 37, high: 53, day_count: 48 },
    }
    expect(pickBaseline(def, metrics)?.day_count).toBe(48)
  })

  it('still returns the bandless entry when no name has one', () => {
    // "We looked, and there are only nine days" is an answer, and it has to reach
    // the screen — a silently missing key would read as "this metric has no band",
    // which is a different statement.
    expect(pickBaseline(def, { hrv: { day_count: 9 } })?.day_count).toBe(9)
  })

  it('returns nothing when the metric was not answered for', () => {
    expect(pickBaseline(def, {})).toBeUndefined()
    expect(pickBaseline(def, undefined)).toBeUndefined()
  })
})

describe('the standing glyphs', () => {
  it('gives every level a direction and no colour', () => {
    const levels: Standing[] = ['wellBelow', 'below', 'typical', 'above', 'wellAbove']
    for (const level of levels) {
      expect(STANDING_ARROW[level]).toBeTruthy()
    }
    // ⚠️ The middle level points nowhere on purpose: "your usual" is not a small
    // rise, and an arrow on it would suggest a direction the number does not have.
    expect(STANDING_ARROW.typical).toBe('=')
    // The two halves must not share a glyph — the arrow is what survives a glance.
    expect(new Set(levels.map((l) => STANDING_ARROW[l])).size).toBe(levels.length)
  })
})
