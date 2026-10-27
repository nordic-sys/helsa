// The closed month behind a medal: which badge, which daily target, which
// averages. The rules are the phone's (`MonthMedalDetailView.swift`,
// `MonthStepCalendar.swift`, `DailyStreak.swift`).

import { describe, expect, it } from 'vitest'
import type { Achievement } from '../api/types'
import {
  dailyGoal,
  daysInMonth,
  medalMilestones,
  monthDays,
  monthMedal,
  opensMonth,
  parseMonth,
  perDayOverMonth,
} from './monthMedal'

const medal = (over: Partial<Achievement>): Achievement => ({
  kind: 'month',
  code: 'complete',
  period: '2026-08',
  value: 120_000,
  thresholds: [20_000, 35_000, 70_000, 100_000],
  ...over,
})

describe('which rows open a month', () => {
  it('opens a monthly medal with a real month, and nothing else', () => {
    expect(opensMonth(medal({}))).toBe(true)
    expect(opensMonth(medal({ kind: 'record', code: 'best-month' }))).toBe(false)
    expect(opensMonth(medal({ kind: 'year', period: '2026' }))).toBe(false)
    expect(opensMonth(medal({ period: undefined }))).toBe(false)
    expect(parseMonth('2026-13')).toBeNull()
  })

  it('finds the monthly medal of a month, preferring the one that kept its thresholds', () => {
    const items = [
      medal({ kind: 'record', code: 'best-month', thresholds: undefined }),
      medal({ code: 'progress', thresholds: undefined }),
      medal({ id: 'keep' }),
    ]
    expect(monthMedal(items, '2026-08')?.id).toBe('keep')
    expect(monthMedal(items, '2026-07')).toBeNull()
  })
})

describe('the daily target (DailyStreakRules.dailyGoal)', () => {
  it('is the largest milestone over the days of the month, rounded, at least 1', () => {
    expect(dailyGoal([20_000, 100_000], 31)).toBe(3226) // 3225.8
    expect(dailyGoal([100_000, 20_000], 28)).toBe(3571) // order does not matter
    expect(dailyGoal([10], 31)).toBe(1) // never zero
  })

  it('does not exist without milestones', () => {
    expect(dailyGoal([], 31)).toBeNull()
    expect(dailyGoal(undefined, 31)).toBeNull()
  })

  it('knows leap years', () => {
    expect(daysInMonth(2028, 2)).toBe(29)
    expect(daysInMonth(2026, 2)).toBe(28)
  })
})

describe('the two averages', () => {
  it('spreads the medal total over the WHOLE month', () => {
    expect(perDayOverMonth(31_000, 31)).toBe(1000)
    // No value is not zero.
    expect(perDayOverMonth(undefined, 31)).toBeNull()
  })

  it('averages only the measured days for the grid, and keeps gaps as gaps', () => {
    const d = monthDays(
      [
        { day: '2026-08-01', steps: 1000 },
        { day: '2026-08-02' },
        { day: '2026-08-03', steps: 3000 },
        { day: '2026-07-31', steps: 99_999 }, // another month: ignored
      ],
      '2026-08',
    )
    expect(d.days.map((x) => x.value)).toEqual([1000, null, 3000])
    expect(d.measuredCount).toBe(2)
    expect(d.measuredAverage).toBe(2000)
    expect(d.best?.steps).toBe(3000)
    expect(d.best?.date.getDate()).toBe(3)
  })

  it('has no average and no best day for a month with nothing measured', () => {
    const d = monthDays([{ day: '2026-08-01' }], '2026-08')
    expect(d.measuredAverage).toBeNull()
    expect(d.best).toBeNull()
  })
})

describe("the medal's own milestones", () => {
  it('marks them reached by the value the medal was earned with', () => {
    expect(medalMilestones(medal({ value: 50_000 }))).toEqual([
      { steps: 20_000, reached: true },
      { steps: 35_000, reached: true },
      { steps: 70_000, reached: false },
      { steps: 100_000, reached: false },
    ])
  })

  it('claims nothing without a snapshot or without a value', () => {
    expect(medalMilestones(medal({ thresholds: undefined }))).toBeNull()
    expect(medalMilestones(medal({ value: undefined }))).toBeNull()
  })
})
