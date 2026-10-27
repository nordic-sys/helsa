import { describe, expect, it } from 'vitest'
import { daysAtGoal, resolveWaterGoal, suggestedGoalMl, toKg, toMl } from './hydration'

describe('the water goal follows the phone', () => {
  it('a chosen goal wins, whatever the body mass says', () => {
    expect(resolveWaterGoal({ goal_ml: 2400 }, 90)).toEqual({ kind: 'chosen', ml: 2400 })
  })

  it('without a chosen goal it suggests 33 ml/kg, rounded to 100 ml', () => {
    // 68.4 kg × 33 = 2257 → 2300 (HydrationGoalSuggestion's own example).
    expect(resolveWaterGoal({}, 68.4)).toEqual({ kind: 'suggested', ml: 2300 })
  })

  it('the suggestion stays inside the phone’s 500–6000 bracket', () => {
    expect(suggestedGoalMl(10)).toBe(500)
    expect(suggestedGoalMl(400)).toBe(6000)
  })

  it('no body mass is no suggestion — never a made-up "about two litres"', () => {
    expect(resolveWaterGoal({}, undefined)).toEqual({ kind: 'none' })
    expect(suggestedGoalMl(0)).toBeUndefined()
    expect(suggestedGoalMl(Number.NaN)).toBeUndefined()
  })

  it('a block the phone never sent is "not told", not "no goal"', () => {
    expect(resolveWaterGoal(undefined, 80)).toEqual({ kind: 'unknown' })
  })
})

describe('units', () => {
  it('reads the server’s water unit, and refuses one it does not know', () => {
    expect(toMl(1.5, 'L')).toBe(1500)
    expect(toMl(250, 'mL')).toBe(250)
    expect(toMl(1, 'cup')).toBeUndefined()
    expect(toMl(null, 'mL')).toBeUndefined()
  })

  it('reads body mass in kilograms', () => {
    expect(toKg(80, 'kg')).toBe(80)
    expect(toKg(100, 'lb')).toBeCloseTo(45.36, 2)
    expect(toKg(80, 'stone')).toBeUndefined()
  })
})

describe('days at the goal', () => {
  it('counts only the days that carry a measurement', () => {
    expect(daysAtGoal([2500, undefined, 1000, 2000], 2000)).toEqual({ met: 2, measured: 3 })
  })
})
