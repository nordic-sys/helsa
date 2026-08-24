import { describe, expect, it } from 'vitest'
import { localDay, newestActivity } from './activity'
import type { ActivitySummary } from '../api/types'

const day = (d: string, energy: number): ActivitySummary => ({ day: d, active_energy: energy })

describe('the rings card knows whether it is looking at today', () => {
  const now = new Date(2026, 7, 24, 21, 40) // 2026-08-24, late evening

  it('says so when the newest summary really is today', () => {
    const result = newestActivity([day('2026-08-23', 300), day('2026-08-24', 410)], now)
    expect(result?.isToday).toBe(true)
    expect(result?.summary.active_energy).toBe(410)
  })

  /**
   * The defect this file exists for: a window's newest entry presented under a heading
   * that says "Today". A true number under a false claim is worse than no number.
   */
  it('says so when the newest summary is NOT today', () => {
    const result = newestActivity([day('2026-08-20', 300), day('2026-08-22', 410)], now)
    expect(result?.isToday).toBe(false)
    expect(result?.summary.day).toBe('2026-08-22')
  })

  it('takes the newest by date, not by array position', () => {
    const result = newestActivity([day('2026-08-24', 410), day('2026-08-20', 300)], now)
    expect(result?.summary.day).toBe('2026-08-24')
  })

  it('an empty window is nothing at all, not an empty day', () => {
    expect(newestActivity([], now)).toBeNull()
    expect(newestActivity(undefined, now)).toBeNull()
  })
})

describe('today is the local day, not the UTC one', () => {
  /**
   * ⚠️ `toISOString().slice(0, 10)` is the reflex here and it is wrong east of Greenwich:
   * at 21:40 in Budapest it is already tomorrow in UTC-terms only for the other direction,
   * but at 01:00 it would report yesterday — so a current summary would look stale every
   * night, in exactly the hours a person checks their rings.
   */
  it('does not roll over at UTC midnight', () => {
    expect(localDay(new Date(2026, 7, 24, 23, 30))).toBe('2026-08-24')
    expect(localDay(new Date(2026, 7, 24, 0, 30))).toBe('2026-08-24')
  })

  it('pads months and days', () => {
    expect(localDay(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})
