import { describe, expect, it } from 'vitest'
import type { LatestValue } from '../api/types'
import { hu } from '../i18n/hu'
import { en } from '../i18n/en'
import { BLOOD_PRESSURE_KEYS } from './bloodPressure'
import { GAIT_KEYS } from './gait'
import {
  BESPOKE,
  CURATED_FOR_TEST,
  NUTRITION_GROUPS,
  PAGE_WIRE_NAMES,
  SECTIONS,
  cardGroups,
  daysOld,
  headlineFromLatest,
  headlineFromSeries,
  isolatedKeys,
  outsideSpan,
  pickLatest,
  sparkPoints,
  spanStart,
  yDomain,
} from './measurements'
import { METRIC_LIST, metricDef, readSeries } from './metrics'
import { isoDay } from './window'

describe('the sections come from the catalog', () => {
  // The phone's `HealthSectionTests`: a type added to the catalog lands on a
  // card the same day, without anybody filing it anywhere.
  it('puts every non-nutrition metric on exactly one card, or on a bespoke card', () => {
    for (const def of METRIC_LIST) {
      if (NUTRITION_GROUPS.has(def.group)) continue
      const onCards = SECTIONS.flatMap((g) => cardGroups(g)).flatMap((g) => g.metrics).filter((d) => d.key === def.key)
      if (BESPOKE.has(def.key)) expect(onCards).toHaveLength(0)
      else expect(onCards, def.key).toHaveLength(1)
    }
  })

  it('lets only blood pressure and the five gait series skip the grid', () => {
    expect([...BESPOKE].sort()).toEqual([...BLOOD_PRESSURE_KEYS, ...GAIT_KEYS].sort())
  })

  it('keeps every curated list inside its own catalog group', () => {
    for (const [group, specs] of Object.entries(CURATED_FOR_TEST)) {
      for (const spec of specs ?? []) {
        for (const key of spec.metrics) expect(metricDef(key).group, `${key} under ${group}`).toBe(group)
      }
    }
  })

  it('leaves nutrition to its own page, and asks the server about nothing there', () => {
    for (const g of NUTRITION_GROUPS) expect(SECTIONS).not.toContain(g)
    expect(PAGE_WIRE_NAMES).not.toContain('dietaryProtein')
    expect(PAGE_WIRE_NAMES).toContain('activeEnergyBurned')
    expect(PAGE_WIRE_NAMES.length).toBeLessThanOrEqual(200) // /latest's cap
  })

  it('gives a section without curated groups no sub-heading of its own', () => {
    const heart = cardGroups('heart')
    expect(heart).toHaveLength(1)
    expect(heart[0].title).toBeNull()
  })
})

describe('the headline', () => {
  const lv = (over: Partial<LatestValue>): LatestValue => ({ agg: 'avg', ts: '2026-10-27T06:15:00Z', day: '2026-10-27', ...over })

  it('shows an averaged type’s latest reading at its own instant', () => {
    expect(headlineFromLatest(lv({ value: 82.4 }), '2026-10-27')).toEqual({
      kind: 'sample',
      value: 82.4,
      at: '2026-10-27T06:15:00Z',
      day: '2026-10-27',
    })
  })

  it('calls a summed type’s day partial while it is today', () => {
    expect(headlineFromLatest(lv({ agg: 'sum', day_total: 6412 }), '2026-10-27')).toMatchObject({ kind: 'dayTotal', partial: true })
    expect(headlineFromLatest(lv({ agg: 'sum', day_total: 6412, day: '2026-10-25' }), '2026-10-27')).toMatchObject({
      kind: 'dayTotal',
      partial: false,
    })
  })

  it('never puts a zero where the server could not total a day', () => {
    expect(headlineFromLatest(lv({ agg: 'sum' }), '2026-10-27').kind).toBe('noFigure')
  })

  it('has no headline for a type that never arrived', () => {
    expect(headlineFromLatest(undefined, '2026-10-27')).toEqual({ kind: 'none' })
  })

  it('picks the newest of a metric’s wire names', () => {
    const def = metricDef('activeEnergy')
    const picked = pickLatest(def, {
      activeEnergy: lv({ agg: 'sum', ts: '2026-01-01T10:00:00Z', day_total: 1 }),
      activeEnergyBurned: lv({ agg: 'sum', ts: '2026-10-27T10:00:00Z', day_total: 2 }),
    })
    expect(picked?.day_total).toBe(2)
  })

  it('falls back to the last MEASURED day on an older server, not to a trailing gap', () => {
    const def = metricDef('restingHeartRate')
    const read = readSeries(def, {
      agg: 'avg',
      buckets: [
        { t: new Date(2026, 9, 24).toISOString(), avg: 55 },
        { t: new Date(2026, 9, 25).toISOString(), avg: 57 },
      ],
    })
    expect(headlineFromSeries(read, '2026-10-27')).toMatchObject({ kind: 'bucket', value: 57, day: '2026-10-25', agg: 'avg' })
    expect(headlineFromSeries(readSeries(def, undefined), '2026-10-27')).toEqual({ kind: 'none' })
  })

  it('flags a latest value older than the span on screen', () => {
    const h = headlineFromLatest(lv({ value: 80, day: '2026-09-01' }), '2026-10-27')
    expect(outsideSpan(h, 'week', '2026-10-27')).toBe(true)
    expect(outsideSpan(h, 'year', '2026-10-27')).toBe(false)
    expect(outsideSpan({ kind: 'none' }, 'week', '2026-10-27')).toBe(false)
  })

  it('counts age in calendar days', () => {
    expect(daysOld('2026-10-27', '2026-10-27')).toBe(0)
    expect(daysOld('2026-10-24', '2026-10-27')).toBe(3)
    expect(daysOld('2026-10-24', '2026-10-26')).toBe(2) // across the clock change
  })
})

describe('the sparkline', () => {
  const today = '2026-10-27'
  const def = metricDef('restingHeartRate')
  const read = readSeries(def, {
    agg: 'avg',
    buckets: [
      { t: new Date(2026, 8, 20).toISOString(), avg: 60 },
      { t: new Date(2026, 9, 20).toISOString(), avg: 58 },
      { t: new Date(2026, 9, 26).toISOString(), avg: 56 },
      { t: new Date(2026, 9, 27).toISOString(), avg: 55 },
    ],
  })

  it('draws every day of the span, with null — never 0 — for the unmeasured ones', () => {
    const pts = sparkPoints(read, 'month', today)
    expect(pts).toHaveLength(30)
    expect(pts[0].key).toBe(spanStart('month', today))
    expect(pts.at(-1)).toEqual({ key: today, value: 55 })
    expect(pts.filter((p) => p.value != null)).toHaveLength(3) // Sep 20 is outside 30 days
    expect(pts.some((p) => p.value === 0)).toBe(false)
  })

  it('makes the week the last seven days of the same series', () => {
    const pts = sparkPoints(read, 'week', today)
    expect(pts.map((p) => p.key)).toEqual(['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27'])
  })

  it('draws twelve months on the year span', () => {
    const year = readSeries(def, { agg: 'avg', buckets: [{ t: new Date(2026, 3, 1).toISOString(), avg: 61 }] })
    const pts = sparkPoints(year, 'year', today)
    expect(pts).toHaveLength(12)
    expect(pts[0].key).toBe('2025-11')
    expect(pts.find((p) => p.key === '2026-04')?.value).toBe(61)
  })

  it('dots the points that have no measured neighbour', () => {
    const pts = sparkPoints(read, 'month', today)
    expect([...isolatedKeys(pts)]).toEqual([isoDay(new Date(2026, 9, 20))])
  })

  it('keeps the band inside the domain, and starts summed bars at zero', () => {
    const pts = [
      { key: 'a', value: 55 },
      { key: 'b', value: 57 },
    ]
    const [lo, hi] = yDomain(pts, { low: 50, high: 60 }, 'avg') ?? [0, 0]
    expect(lo).toBeLessThan(50)
    expect(hi).toBeGreaterThan(60)
    expect(yDomain(pts, null, 'sum')?.[0]).toBe(0)
    expect(yDomain([{ key: 'a', value: null }], null, 'avg')).toBeNull()
  })
})

describe('the wording', () => {
  // The phone's `differencesTakeTheInstrumentalCaseAndPercentagePoints`: a
  // Hungarian comparison takes the instrumental case, and a percentage moves in
  // points. Merging these with the level units would make every comparison
  // ungrammatical in one language and look fine in the other.
  it('puts the case ending on Hungarian differences only', () => {
    expect(hu.ui['meas.gait.delta.speed']).toBe(' m/s-mal')
    expect(hu.ui['meas.gait.delta.length']).toBe(' méterrel')
    expect(hu.ui['meas.gait.delta.points']).toBe(' százalékponttal')
    expect(en.ui['meas.gait.delta.points']).toBe(' percentage points')
  })

  it('never grades the person', () => {
    const forbidden = ['romlott', 'rosszabb', 'kockázatos', 'veszély', 'javult', 'worse', 'deteriorat', 'danger', 'improved', 'hypertension', 'magas vérnyomás']
    for (const dict of [hu.ui, en.ui]) {
      for (const [k, v] of Object.entries(dict)) {
        if (!k.startsWith('meas.')) continue
        for (const word of forbidden) expect(v.toLowerCase(), k).not.toContain(word)
      }
    }
  })
})
