import { describe, expect, it } from 'vitest'
import type { Achievement } from '../api/types'
import { groupAchievements, groupKey, reachedThresholds } from './achievements'

const BATCH = '2026-09-10T16:45:27Z'

const badge = (over: Partial<Achievement> = {}): Achievement => ({
  id: 'month:complete:2026-07',
  kind: 'month',
  code: 'complete',
  period: '2026-07',
  value: 452505,
  unit: 'count',
  earned_at: BATCH,
  ...over,
})

describe('medals are filed by family', () => {
  it('puts the rarest first and the monthly list last', () => {
    const groups = groupAchievements([
      badge({ id: '1', kind: 'month' }),
      badge({ id: '2', kind: 'milestone', period: undefined }),
      badge({ id: '3', kind: 'streak' }),
      badge({ id: '4', kind: 'record' }),
      badge({ id: '5', kind: 'year', period: '2025' }),
    ])
    expect(groups.map((g) => g.key)).toEqual(['milestone', 'record', 'streak', 'year', 'month'])
  })

  it('files a family this build does not know under `other` rather than dropping it', () => {
    const rogue = { ...badge(), kind: 'decade' } as unknown as Achievement
    expect(groupKey(rogue)).toBe('other')
    expect(groupAchievements([rogue]).map((g) => g.key)).toEqual(['other'])
  })

  it('flags the groups that carry a threshold snapshot', () => {
    const groups = groupAchievements([
      badge({ id: 'm', kind: 'month', thresholds: [20000, 35000] }),
      badge({ id: 's', kind: 'streak', unit: 'month', value: 3 }),
    ])
    expect(groups.find((g) => g.key === 'month')!.hasThresholds).toBe(true)
    expect(groups.find((g) => g.key === 'streak')!.hasThresholds).toBe(false)
  })
})

/**
 * ⚠️ The live server hands back 36 of its 42 medals stamped with the SAME second
 * — a reinstalled phone uploads years of history in one batch, and `earned_at`
 * records when the server first saw them, not when they were lived. Ordered by
 * that alone the monthly table comes out in whatever order the database returns.
 */
describe('medals earned in the same second still have an order', () => {
  it('breaks the tie on the period, newest first', () => {
    const groups = groupAchievements([
      badge({ id: 'a', period: '2025-08' }),
      badge({ id: 'b', period: '2026-07' }),
      badge({ id: 'c', period: '2025-09' }),
    ])
    expect(groups[0].items.map((a) => a.period)).toEqual(['2026-07', '2025-09', '2025-08'])
  })

  it('breaks a further tie on the value, for a family with no period', () => {
    const groups = groupAchievements([
      badge({ id: 'a', kind: 'milestone', period: undefined, value: 2500000 }),
      badge({ id: 'b', kind: 'milestone', period: undefined, value: 10000000 }),
    ])
    expect(groups[0].items.map((a) => a.value)).toEqual([10000000, 2500000])
  })

  it('still puts a genuinely newer medal above the batch', () => {
    const groups = groupAchievements([
      badge({ id: 'batch', period: '2026-07' }),
      badge({ id: 'later', period: '2020-01', earned_at: '2026-09-11T00:00:00Z' }),
    ])
    expect(groups[0].items.map((a) => a.id)).toEqual(['later', 'batch'])
  })
})

/**
 * ⚠️ The rule the whole product is built on, in the one place on this page where
 * it could be broken: a medal that arrived without its figure is a medal whose
 * value we do not know. Rendering six hollow thresholds would say it reached
 * none of them — a claim about data nobody has.
 */
describe('a medal with no value reaches no verdict about its thresholds', () => {
  it('returns nothing to draw when the value is missing', () => {
    expect(reachedThresholds(badge({ value: undefined, thresholds: [20000, 35000] }))).toBeNull()
  })

  it('returns nothing to draw when there are no thresholds', () => {
    expect(reachedThresholds(badge({ thresholds: undefined }))).toBeNull()
  })

  it('splits the thresholds the value actually cleared', () => {
    const split = reachedThresholds(badge({ value: 70000, thresholds: [20000, 70000, 100000] }))
    expect(split).toEqual({ reached: [20000, 70000], missed: [100000] })
  })

  it('counts a threshold met exactly as reached', () => {
    expect(reachedThresholds(badge({ value: 20000, thresholds: [20000] }))!.reached).toEqual([
      20000,
    ])
  })

  it('a measured zero is a real figure and clears nothing — which is not the same as unknown', () => {
    const split = reachedThresholds(badge({ value: 0, thresholds: [20000] }))
    expect(split).not.toBeNull()
    expect(split!.reached).toEqual([])
  })
})
