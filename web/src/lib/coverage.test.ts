import { describe, expect, it } from 'vitest'
import type { CoverageType } from '../api/types'
import { cadenceWord, gaps, groupKey, overdueRatio, sections, tally } from './coverage'

const row = (over: Partial<CoverageType>): CoverageType => ({
  data_type: 'stepCount',
  group: 'activity',
  in_catalog: true,
  state: 'never_arrived',
  ...over,
})

describe('the sections', () => {
  it('keeps a group that has nothing in it', () => {
    // This is the single most useful thing on the page: "0 of 13 bring data" is
    // how a person sees that a whole area is dark. Dropping empty groups because
    // they are empty would hide exactly the finding.
    const found = sections([row({ data_type: 'stepCount', group: 'activity', state: 'measured' })])
    expect(found).toHaveLength(10)
    const mobility = found.find((s) => s.group === 'mobility')
    expect(mobility).toBeDefined()
    expect(mobility?.total).toBe(0)
    expect(mobility?.measured).toBe(0)
  })

  it('counts what brings data per group, and only that', () => {
    const found = sections([
      row({ data_type: 'heartRate', group: 'heart', state: 'measured' }),
      row({ data_type: 'hrv', group: 'heart', state: 'outside_window' }),
      row({ data_type: 'vo2Max', group: 'heart', state: 'never_arrived' }),
    ])
    const heart = found.find((s) => s.group === 'heart')
    expect(heart?.total).toBe(3)
    expect(heart?.measured).toBe(1)
  })

  it('follows the catalogue order, so the page reads the same as the app', () => {
    const order = sections([]).map((s) => s.group)
    expect(order[0]).toBe('activity')
    expect(order[order.length - 1]).toBe('other')
  })
})

describe('the group vocabulary', () => {
  // The server speaks the app's names, the web dictionary uses shorter keys.
  // The translation happens once, at the edge — nowhere else.
  it('maps the app’s nutrition group names onto the dictionary keys', () => {
    expect(groupKey('nutritionMacro')).toBe('macro')
    expect(groupKey('nutritionMineral')).toBe('mineral')
    expect(groupKey('nutritionVitamin')).toBe('vitamin')
    expect(groupKey('heart')).toBe('heart')
  })

  it('falls back rather than rendering an empty heading', () => {
    expect(groupKey(undefined)).toBe('other')
  })
})

describe('the headline’s numbers', () => {
  it('counts against the types actually examined, not a hard-coded 120', () => {
    const t = tally({
      types: [
        row({ state: 'measured' }),
        row({ data_type: 'hrv', state: 'measured' }),
        row({ data_type: 'vo2Max', state: 'never_arrived' }),
      ],
    })
    expect(t).toEqual({ total: 3, measured: 2 })
  })

  it('says nothing rather than something wrong when the report has not arrived', () => {
    expect(tally(undefined)).toEqual({ total: 0, measured: 0 })
  })

  it('does not count an outside-window type as measured', () => {
    // It HAS data — just not in the period being examined. Counting it would make
    // the headline claim a completeness the window does not have.
    expect(tally({ types: [row({ state: 'outside_window' })] }).measured).toBe(0)
  })
})

describe('the gap list', () => {
  const daily = row({
    data_type: 'restingHeartRate',
    group: 'heart',
    state: 'measured',
    gap: { silent_days: 5, typical_interval_days: 1 },
  })
  const weekly = row({
    data_type: 'bodyMass',
    group: 'body',
    state: 'measured',
    gap: { silent_days: 22, typical_interval_days: 7 },
  })
  const fine = row({ data_type: 'stepCount', state: 'measured' })

  it('lists only what has a broken rhythm', () => {
    expect(gaps([daily, fine]).map((r) => r.data_type)).toEqual(['restingHeartRate'])
  })

  // ⚠️ Ordered by missed occasions, not by raw days. A daily metric silent for
  // five days is more remarkable than a weekly one silent for twenty-two, even
  // though twenty-two is the bigger number — and the app sorts it the same way.
  it('puts the most overdue first, not the longest silent', () => {
    expect(gaps([weekly, daily]).map((r) => r.data_type)).toEqual(['restingHeartRate', 'bodyMass'])
    expect(overdueRatio(daily)).toBeGreaterThan(overdueRatio(weekly))
  })

  it('does not divide by a cadence that is missing', () => {
    expect(overdueRatio(row({ gap: { silent_days: 5 } }))).toBe(0)
    expect(overdueRatio(row({}))).toBe(0)
  })
})

describe('how a rhythm is said', () => {
  // The thresholds are the app’s (`MetricCadence.description`), so the phone and
  // the web describe the same series with the same word.
  it('uses the app’s thresholds', () => {
    expect(cadenceWord(1)).toEqual({ key: 'daily' })
    expect(cadenceWord(1.4)).toEqual({ key: 'daily' })
    expect(cadenceWord(2)).toEqual({ key: 'everyOtherDay' })
    expect(cadenceWord(3.2)).toEqual({ key: 'everyNDays', n: 3 })
    expect(cadenceWord(7)).toEqual({ key: 'weekly' })
    expect(cadenceWord(14)).toEqual({ key: 'fortnightly' })
    expect(cadenceWord(21)).toEqual({ key: 'everyNDays', n: 21 })
  })

  it('says nothing when there is no cadence to describe', () => {
    expect(cadenceWord(undefined)).toBeNull()
    expect(cadenceWord(0)).toBeNull()
  })
})
