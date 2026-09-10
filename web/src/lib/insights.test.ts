import { describe, expect, it } from 'vitest'
import type { Insight } from '../api/types'
import { groupInsights, groupKey, valueDigits } from './insights'

const at = (iso: string): string => new Date(iso).toISOString()

const insight = (over: Partial<Insight> = {}): Insight => ({
  id: 'steps-weekend:2026-09-10',
  kind: 'pattern',
  metric: 'stepCount',
  title: 'A napi lépésszámod hétvégén több',
  severity: 'info',
  generated_at: at('2026-09-10T16:58:48Z'),
  ...over,
})

describe('observations are filed by the shape of the statement', () => {
  it('keeps the kinds in their own order, not the order they arrived in', () => {
    const groups = groupInsights([
      insight({ id: 'a', kind: 'pattern' }),
      insight({ id: 'b', kind: 'anomaly' }),
      insight({ id: 'c', kind: 'correlation' }),
      insight({ id: 'd', kind: 'trend' }),
    ])
    expect(groups.map((g) => g.key)).toEqual(['anomaly', 'trend', 'correlation', 'pattern'])
  })

  it('drops the groups with nothing in them', () => {
    const groups = groupInsights([insight({ kind: 'trend' })])
    expect(groups).toHaveLength(1)
    expect(groups[0].key).toBe('trend')
  })

  it('an empty list produces no groups at all', () => {
    expect(groupInsights([])).toEqual([])
  })
})

/**
 * ⚠️ A rule family this build has no name for must still reach the screen. The
 * schema says outright that a server can carry a rule the client does not know
 * yet — and a `switch` with no default is how that becomes a statement that was
 * computed, sent, and then silently dropped on the last metre.
 */
describe('an unknown kind is shown, not swallowed', () => {
  it('files a kind this build does not know under `other`', () => {
    const rogue = { ...insight(), kind: 'prophecy' } as unknown as Insight
    expect(groupKey(rogue)).toBe('other')
    expect(groupInsights([rogue])).toHaveLength(1)
  })

  it('files an observation with no kind at all under `other`', () => {
    expect(groupKey(insight({ kind: undefined }))).toBe('other')
  })

  it('puts `other` last, after every kind it does know', () => {
    const rogue = { ...insight(), id: 'x', kind: 'prophecy' } as unknown as Insight
    const groups = groupInsights([rogue, insight({ id: 'y', kind: 'trend' })])
    expect(groups.map((g) => g.key)).toEqual(['trend', 'other'])
  })
})

describe('within a group: the server’s severity first, then the newest', () => {
  it('puts a notice above an info', () => {
    const groups = groupInsights([
      insight({ id: 'info', kind: 'trend', severity: 'info' }),
      insight({ id: 'notice', kind: 'trend', severity: 'notice' }),
    ])
    expect(groups[0].items.map((i) => i.id)).toEqual(['notice', 'info'])
  })

  it('orders equal severities newest first', () => {
    const groups = groupInsights([
      insight({ id: 'old', kind: 'trend', generated_at: at('2026-09-01T00:00:00Z') }),
      insight({ id: 'new', kind: 'trend', generated_at: at('2026-09-10T00:00:00Z') }),
    ])
    expect(groups[0].items.map((i) => i.id)).toEqual(['new', 'old'])
  })

  it('sorts an observation with no timestamp last instead of treating it as 1970', () => {
    const groups = groupInsights([
      insight({ id: 'undated', kind: 'trend', generated_at: undefined }),
      insight({ id: 'dated', kind: 'trend', generated_at: at('1971-01-01T00:00:00Z') }),
    ])
    expect(groups[0].items.map((i) => i.id)).toEqual(['dated', 'undated'])
  })

  it('does not reorder on the text of the sentence, which is the server’s language', () => {
    const groups = groupInsights([
      insight({ id: 'z', kind: 'trend', title: 'Zebra' }),
      insight({ id: 'a', kind: 'trend', title: 'Alma' }),
    ])
    // Same severity, same timestamp: the input order stands.
    expect(groups[0].items.map((i) => i.id)).toEqual(['z', 'a'])
  })
})

describe('a rule’s computed numbers keep their own precision', () => {
  it('prints a count of days whole', () => {
    expect(valueDigits(14)).toBe(0)
  })

  it('prints a correlation coefficient with decimals', () => {
    expect(valueDigits(0.62)).toBe(2)
  })

  it('leaves a ±1 direction as a bare 1', () => {
    expect(valueDigits(-1)).toBe(0)
  })
})
