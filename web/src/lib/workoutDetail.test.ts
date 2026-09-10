// What the detail page's arithmetic must not get wrong.
//
// Every case here is a bug that has already happened on one surface or the
// other, or a rule whose breaking would be silent — which is the same thing a
// day later. The names say what would be shown, not which function is called.

import { describe, expect, it } from 'vitest'
import type { RoutePoint, Sample } from '../api/types'
import {
  MAX_ACCURACY_M,
  clock,
  downsample,
  heartRateAxis,
  heartRateSeries,
  humidityPercent,
  isIndoor,
  lapsFrom,
  paceOf,
  poolLengthM,
  projectRoute,
  routeTrack,
  scaleBar,
  weatherFrom,
} from './workoutDetail'

describe('humidity', () => {
  // ⚠️ The bug this pins printed 3 000% on the phone: `HKUnit.percent()` is
  // documented as 0…1, the watch writes 0…100, and both readers multiplied.
  it('reads a fraction as a fraction and a percentage as a percentage', () => {
    expect(humidityPercent(0.62)).toBeCloseTo(62)
    expect(humidityPercent(62)).toBe(62)
  })

  it('takes 1 to mean 100%, because 1% humidity does not happen outdoors', () => {
    expect(humidityPercent(1)).toBe(100)
  })

  // ⛔ The rule that keeps the already-stored broken rows off the screen. A
  // clamp to 100 would turn a value we know is broken into one we invented.
  it('shows nothing at all above 100, rather than clamping', () => {
    expect(humidityPercent(3000)).toBeUndefined()
    expect(humidityPercent(101)).toBeUndefined()
  })

  it('refuses a negative and a non-number', () => {
    expect(humidityPercent(-1)).toBeUndefined()
    expect(humidityPercent(Number.NaN)).toBeUndefined()
  })

  it('drops the broken humidity but keeps the rest of the block', () => {
    const w = weatherFrom({
      weather: { temperature_c: 21, humidity_pct: 3000, condition: 1 },
    })
    expect(w).toEqual({ temperatureC: 21, humidityPercent: undefined, condition: 'clear' })
  })
})

describe('weather', () => {
  it('is absent when the metadata has none', () => {
    expect(weatherFrom(undefined)).toBeUndefined()
    expect(weatherFrom({ indoor: true })).toBeUndefined()
  })

  // 0 is `HKWeatherConditionNone` — the ABSENCE of a condition, not a condition
  // named "None". Mapping it would put an empty label on every workout that has
  // only a temperature.
  it('treats condition 0 as no condition', () => {
    expect(weatherFrom({ weather: { condition: 0 } })).toBeUndefined()
    expect(weatherFrom({ weather: { condition: 0, temperature_c: 8 } })).toEqual({
      temperatureC: 8,
      humidityPercent: undefined,
      condition: undefined,
    })
  })

  it('names the whole HKWeatherCondition range', () => {
    expect(weatherFrom({ weather: { condition: 3 } })?.condition).toBe('partlyCloudy')
    expect(weatherFrom({ weather: { condition: 27 } })?.condition).toBe('tornado')
    // Out of range: nothing rather than a made-up key the dictionary lacks.
    expect(weatherFrom({ weather: { condition: 99 } })).toBeUndefined()
  })
})

describe('laps', () => {
  const lap = (index: number, extra: Record<string, unknown> = {}) => ({
    index,
    activity: 'running',
    started_at: '2026-08-11T10:00:00Z',
    ended_at: '2026-08-11T10:15:00Z',
    ...extra,
  })

  // ⚠️ HealthKit gives every iOS 16+ workout one `HKWorkoutActivity` identical
  // to the workout. Showing it under "Splits" claims the person segmented the
  // session when they are seeing the system's own shape.
  it('does not call a single segment a split', () => {
    expect(lapsFrom({ laps: [lap(0)] })).toEqual([])
  })

  it('keeps two and puts them in index order', () => {
    const laps = lapsFrom({ laps: [lap(1), lap(0)] })
    expect(laps.map((l) => l.index)).toEqual([0, 1])
  })

  it('leaves a still-running segment without a duration rather than at zero', () => {
    const laps = lapsFrom({ laps: [lap(0, { ended_at: undefined }), lap(1)] })
    expect(laps[0].durationMin).toBeUndefined()
    expect(laps[1].durationMin).toBe(15)
  })

  it('ignores an entry missing what identifies it', () => {
    expect(lapsFrom({ laps: [lap(0), { index: 1 }, lap(2)] }).map((l) => l.index)).toEqual([0, 2])
  })
})

describe('the metadata flags', () => {
  it('tells "indoor" from "we were not told"', () => {
    expect(isIndoor({ indoor: true })).toBe(true)
    expect(isIndoor({ indoor: false })).toBe(false)
    // ⚠️ null, NOT false: from a missing flag we do not infer open sky.
    expect(isIndoor({})).toBeNull()
  })

  it('ignores a zero pool length, which is a filled-in field and not a pool', () => {
    expect(poolLengthM({ lap_length_m: 25 })).toBe(25)
    expect(poolLengthM({ lap_length_m: 0 })).toBeUndefined()
  })
})

describe('pace', () => {
  it('measures each activity the way that activity is talked about', () => {
    expect(paceOf('running', 10000, 50)).toEqual({ kind: 'perKilometer', seconds: 300 })
    expect(paceOf('swimming', 1000, 20)).toEqual({ kind: 'per100Meters', seconds: 120 })
    expect(paceOf('cycling', 30000, 60)).toEqual({ kind: 'speed', kmh: 30 })
    // An unknown type gets km/h: forcing minutes/km onto a rowing session
    // misleads, the neutral speed does not.
    expect(paceOf('rowing', 10000, 30)?.kind).toBe('speed')
  })

  it('has no pace for what covers no distance', () => {
    expect(paceOf('yoga', 0, 45)).toBeUndefined()
    expect(paceOf('strength', 100, 45)).toBeUndefined()
  })

  // ⚠️ Missing data is not zero. "0:00 /km" would claim we measured the session
  // and the person did not move.
  it('answers nothing rather than 0:00 when a side is missing', () => {
    expect(paceOf('running', undefined, 30)).toBeUndefined()
    expect(paceOf('running', 5000, undefined)).toBeUndefined()
    expect(paceOf('running', 5000, 0)).toBeUndefined()
  })

  it('writes the clock the way a runner says it', () => {
    expect(clock(324)).toBe('5:24')
    expect(clock(3750)).toBe('1:02:30')
    expect(clock(59)).toBe('0:59')
  })
})

describe('the route', () => {
  const p = (lat: number, lon: number, extra: Partial<RoutePoint> = {}): RoutePoint => ({
    lat,
    lon,
    ts: '2026-08-11T10:00:00Z',
    ...extra,
  })

  // ⚠️ 50 m is a city block: a fix that bad lands on the next street, and the
  // continuous line draws a there-and-back that looks like a road taken.
  it('leaves out the fixes too inaccurate to draw, and counts them', () => {
    const track = routeTrack([
      p(47.5, 19.05, { accuracy_m: 5 }),
      p(47.6, 19.4, { accuracy_m: MAX_ACCURACY_M + 1 }),
      p(47.51, 19.06, { accuracy_m: 5 }),
    ])
    expect(track.points).toHaveLength(2)
    expect(track.droppedCount).toBe(1)
  })

  // Absence is not evidence of badness — an imported route has no accuracy at all.
  it('keeps a fix that never said how accurate it was', () => {
    expect(routeTrack([p(47.5, 19.05), p(47.51, 19.06)]).droppedCount).toBe(0)
  })

  it('drops a coordinate that is not on Earth', () => {
    expect(routeTrack([p(91, 19), p(47.5, 19.05), p(47.51, 19.06)]).droppedCount).toBe(1)
  })

  // `/workouts/{id}/route` promises time order, but the drawing must not depend
  // on a promise: an out-of-order point puts a spike across the whole frame.
  it('sorts by time, whatever order they arrived in', () => {
    const track = routeTrack([
      p(47.52, 19.07, { ts: '2026-08-11T10:20:00Z' }),
      p(47.5, 19.05, { ts: '2026-08-11T10:00:00Z' }),
    ])
    expect(track.points[0].lat).toBe(47.5)
  })

  it('says a there-and-back is not a loop, and a loop is', () => {
    expect(routeTrack([p(47.5, 19.05), p(47.55, 19.05)]).closedLoop).toBe(false)
    expect(routeTrack([p(47.5, 19.05), p(47.55, 19.05), p(47.5, 19.05)]).closedLoop).toBe(true)
  })

  it('has nothing to draw from a single fix', () => {
    expect(projectRoute(routeTrack([p(47.5, 19.05)]), 900, 380)).toBeUndefined()
    expect(projectRoute(routeTrack([]), 900, 380)).toBeUndefined()
  })

  /**
   * ⚠️ The one that would be invisible in a test and obvious in a picture: a
   * degree of longitude is shorter than a degree of latitude everywhere but the
   * equator, so a square in DEGREES is a wide rectangle in METRES. Without the
   * `cos(lat)` a Budapest loop leans about 32% too wide.
   */
  it('does not stretch the shape: an equal-metre square comes out square', () => {
    const lat = 47.5
    const dLat = 0.01
    const dLon = dLat / Math.cos((lat * Math.PI) / 180)
    const square = routeTrack([
      p(lat, 19.0),
      p(lat + dLat, 19.0),
      p(lat + dLat, 19.0 + dLon),
      p(lat, 19.0 + dLon),
      p(lat, 19.0),
    ])
    const proj = projectRoute(square, 900, 380, 10)!
    const xs = [...proj.d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => Number(m[1]))
    const ys = [...proj.d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => Number(m[2]))
    const width = Math.max(...xs) - Math.min(...xs)
    const height = Math.max(...ys) - Math.min(...ys)
    expect(width / height).toBeCloseTo(1, 1)
  })

  it('fits inside the frame it was given', () => {
    const proj = projectRoute(routeTrack([p(47.5, 19.0), p(47.6, 19.3)]), 900, 380, 10)!
    const nums = [...proj.d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)]
    for (const m of nums) {
      expect(Number(m[1])).toBeGreaterThanOrEqual(9.9)
      expect(Number(m[1])).toBeLessThanOrEqual(890.1)
      expect(Number(m[2])).toBeGreaterThanOrEqual(9.9)
      expect(Number(m[2])).toBeLessThanOrEqual(370.1)
    }
  })

  // North has to be up. Without the flip the route is drawn mirrored, which is
  // a picture of a run somebody never did.
  it('puts north at the top', () => {
    const proj = projectRoute(routeTrack([p(47.5, 19.0), p(47.6, 19.0)]), 900, 380, 10)!
    expect(proj.finish.y).toBeLessThan(proj.start.y)
  })

  it('offers a round scale bar rather than an exact quarter of the frame', () => {
    const bar = scaleBar(4, 900)!
    expect([500, 1000, 2000]).toContain(bar.metres)
    expect(bar.pixels).toBeCloseTo(bar.metres / 4)
  })
})

describe('the heart-rate curve', () => {
  const s = (ts: string, value: number, data_type = 'heartRate'): Sample => ({
    ts,
    value,
    data_type,
  })
  const START = '2026-08-11T10:00:00Z'
  const END = '2026-08-11T11:00:00Z'

  // `/samples` answers newest first. Unsorted, the line runs backwards.
  it('sorts the newest-first response into time order', () => {
    const series = heartRateSeries(
      [s('2026-08-11T10:30:00Z', 150), s('2026-08-11T10:10:00Z', 120)],
      START,
      END,
    )
    expect(series.points.map((p) => p.bpm)).toEqual([120, 150])
  })

  it('keeps a foreign metric out of the curve', () => {
    const series = heartRateSeries(
      [s('2026-08-11T10:10:00Z', 120), s('2026-08-11T10:20:00Z', 9000, 'stepCount')],
      START,
      END,
    )
    expect(series.points).toHaveLength(1)
  })

  it('leaves out what falls outside the session', () => {
    const series = heartRateSeries(
      [s('2026-08-11T09:00:00Z', 60), s('2026-08-11T10:10:00Z', 120)],
      START,
      END,
    )
    expect(series.points).toHaveLength(1)
  })

  /**
   * ⚠️ A SINGLE sample counts as empty. No curve comes out of one point, and an
   * "average / peak / lowest" trio repeating one number three times is the
   * appearance of statistics. On the phone this drew an empty box above three
   * identical figures and looked broken.
   */
  it('calls one lone sample empty, while remembering that it exists', () => {
    const series = heartRateSeries([s('2026-08-11T10:10:00Z', 120)], START, END)
    expect(series.isEmpty).toBe(true)
    expect(series.hasAnySample).toBe(true)
  })

  it('is empty and says nothing arrived when nothing did', () => {
    const series = heartRateSeries([], START, END)
    expect(series.isEmpty).toBe(true)
    expect(series.hasAnySample).toBe(false)
    expect(heartRateAxis(series)).toBeUndefined()
  })

  // ⚠️ An axis from 0 squashes every session into the same flat strip.
  it('stretches the axis onto the data instead of starting at zero', () => {
    const series = heartRateSeries(
      [s('2026-08-11T10:10:00Z', 121), s('2026-08-11T10:20:00Z', 164)],
      START,
      END,
    )
    expect(heartRateAxis(series)).toEqual({ lower: 120, upper: 170 })
  })

  // …but a steady effort must not have its noise magnified into a mountain range.
  it('keeps a minimum span when the effort never varied', () => {
    const series = heartRateSeries(
      [s('2026-08-11T10:10:00Z', 140), s('2026-08-11T10:20:00Z', 141)],
      START,
      END,
    )
    const axis = heartRateAxis(series)!
    expect(axis.upper - axis.lower).toBeGreaterThanOrEqual(30)
  })

  it('does not let the axis go below zero', () => {
    const series = heartRateSeries(
      [s('2026-08-11T10:10:00Z', 4), s('2026-08-11T10:20:00Z', 6)],
      START,
      END,
    )
    expect(heartRateAxis(series)!.lower).toBe(0)
  })

  describe('downsampling', () => {
    const points = Array.from({ length: 1000 }, (_, i) => ({ t: i * 1000, bpm: 100 + (i % 40) }))

    it('leaves a short series alone', () => {
      expect(downsample(points.slice(0, 10), 240)).toHaveLength(10)
    })

    it('averages into buckets rather than throwing samples away', () => {
      const out = downsample(points, 100)
      expect(out).toHaveLength(100)
      // Averaging shaves the peak — which is exactly why the labels come from
      // the raw series, and this test is what pins that they must.
      expect(Math.max(...out.map((p) => p.bpm))).toBeLessThan(
        Math.max(...points.map((p) => p.bpm)),
      )
    })

    it('keeps time moving forward', () => {
      const out = downsample(points, 50)
      for (let i = 1; i < out.length; i += 1) expect(out[i].t).toBeGreaterThan(out[i - 1].t)
    })
  })
})
