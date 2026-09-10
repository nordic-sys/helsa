import { describe, expect, it } from 'vitest'
import type { Workout } from '../api/types'
import {
  EMPTY_FILTER,
  activityTypesIn,
  byMonth,
  duplicateTally,
  durationMin,
  groupSessions,
  initiallyExpanded,
  isSameSession,
  matches,
} from './workouts'

let seq = 0
function w(partial: Partial<Workout> & { started_at: string }): Workout {
  seq += 1
  return {
    id: partial.id ?? `id-${String(seq).padStart(3, '0')}`,
    activity_type: 'running',
    ...partial,
  }
}

/** A local-time ISO instant, so the month tests do not depend on the runner's
 * offset the way a `Z` literal would. */
function at(y: number, m: number, d: number, h: number, min = 0): string {
  return new Date(y, m - 1, d, h, min).toISOString()
}

describe('isSameSession', () => {
  it('folds two devices that recorded the same run', () => {
    // 0–30 and 2–32 minutes: 28 shared of 32 covered, 0.875.
    const a = w({ started_at: at(2026, 8, 3, 18, 0), ended_at: at(2026, 8, 3, 18, 30) })
    const b = w({ started_at: at(2026, 8, 3, 18, 2), ended_at: at(2026, 8, 3, 18, 32) })
    expect(isSameSession(a, b)).toBe(true)
  })

  it('does NOT fold a short run that happens during a long hike', () => {
    // The trap the union measure exists for: the run is covered entirely by the
    // hike, so "share of the shorter one" would score 1.0 and merge them.
    const hike = w({
      activity_type: 'hiking',
      started_at: at(2026, 8, 3, 9, 0),
      ended_at: at(2026, 8, 3, 12, 0),
    })
    const run = w({
      activity_type: 'hiking',
      started_at: at(2026, 8, 3, 10, 0),
      ended_at: at(2026, 8, 3, 10, 20),
    })
    expect(isSameSession(hike, run)).toBe(false)
  })

  it('never folds two different activities, however well they line up', () => {
    const a = w({ activity_type: 'running', started_at: at(2026, 8, 3, 18, 0), ended_at: at(2026, 8, 3, 18, 30) })
    const b = w({ activity_type: 'cycling', started_at: at(2026, 8, 3, 18, 0), ended_at: at(2026, 8, 3, 18, 30) })
    expect(isSameSession(a, b)).toBe(false)
  })

  it('falls back to the starts when a recording has no end', () => {
    const a = w({ started_at: at(2026, 8, 3, 18, 0) })
    const near = w({ started_at: at(2026, 8, 3, 18, 3), ended_at: at(2026, 8, 3, 18, 30) })
    const far = w({ started_at: at(2026, 8, 3, 18, 9), ended_at: at(2026, 8, 3, 18, 40) })
    expect(isSameSession(a, near)).toBe(true)
    expect(isSameSession(a, far)).toBe(false)
  })
})

describe('groupSessions', () => {
  it('keeps a chain apart instead of merging three sessions into one', () => {
    // A overlaps B, B overlaps C, A and C do not. Compared against the group's
    // primary, C starts a group of its own.
    const a = w({ started_at: at(2026, 8, 3, 18, 0), ended_at: at(2026, 8, 3, 18, 40) })
    const b = w({ started_at: at(2026, 8, 3, 18, 5), ended_at: at(2026, 8, 3, 18, 45) })
    const c = w({ started_at: at(2026, 8, 3, 18, 20), ended_at: at(2026, 8, 3, 19, 0) })
    const groups = groupSessions([a, b, c])
    expect(groups.length).toBe(2)
  })

  it('leads the group with the recording that has more to say', () => {
    const thin = w({
      id: 'thin',
      started_at: at(2026, 8, 3, 18, 0),
      ended_at: at(2026, 8, 3, 18, 30),
    })
    const rich = w({
      id: 'rich',
      started_at: at(2026, 8, 3, 18, 1),
      ended_at: at(2026, 8, 3, 18, 31),
      total_distance_m: 5000,
      total_energy_kcal: 300,
      avg_heart_rate: 140,
      max_heart_rate: 165,
    })
    const [group] = groupSessions([thin, rich])
    expect(group.primary.id).toBe('rich')
    expect(group.others.map((o) => o.id)).toEqual(['thin'])
    expect(group.count).toBe(2)
  })

  it('is order-independent', () => {
    const a = w({ id: 'a', started_at: at(2026, 8, 3, 18, 0), ended_at: at(2026, 8, 3, 18, 30) })
    const b = w({ id: 'b', started_at: at(2026, 8, 3, 18, 2), ended_at: at(2026, 8, 3, 18, 32) })
    expect(groupSessions([a, b])[0].primary.id).toBe(groupSessions([b, a])[0].primary.id)
  })

  it('calls a difference a difference when one side is missing a value', () => {
    const withDistance = w({
      started_at: at(2026, 8, 3, 18, 0),
      ended_at: at(2026, 8, 3, 18, 30),
      total_distance_m: 5000,
    })
    const without = w({ started_at: at(2026, 8, 3, 18, 1), ended_at: at(2026, 8, 3, 18, 31) })
    const [group] = groupSessions([withDistance, without])
    expect(group.identical).toBe(false)
  })

  it('calls two identical recordings identical', () => {
    const one = w({
      started_at: at(2026, 8, 3, 18, 0),
      ended_at: at(2026, 8, 3, 18, 30),
      total_distance_m: 5000,
      total_energy_kcal: 300,
    })
    const two = w({
      started_at: at(2026, 8, 3, 18, 0),
      ended_at: at(2026, 8, 3, 18, 30),
      total_distance_m: 5000,
      total_energy_kcal: 300,
    })
    const [group] = groupSessions([one, two])
    expect(group.count).toBe(2)
    expect(group.identical).toBe(true)
  })

  it('counts a doubled hour once', () => {
    const a = w({ started_at: at(2026, 8, 3, 18, 0), ended_at: at(2026, 8, 3, 19, 0) })
    const b = w({ started_at: at(2026, 8, 3, 18, 1), ended_at: at(2026, 8, 3, 19, 1) })
    const [month] = byMonth(groupSessions([a, b]))
    expect(month.count).toBe(1)
    expect(month.totalMin).toBe(60)
    expect(duplicateTally(groupSessions([a, b]))).toEqual({ sessions: 1, extra: 1 })
  })
})

describe('byMonth', () => {
  it('buckets in the reader’s calendar, not UTC', () => {
    // 00:30 local on the 1st: the person who did it says September.
    const late = w({ started_at: at(2026, 9, 1, 0, 30), ended_at: at(2026, 9, 1, 1, 0) })
    const [month] = byMonth(groupSessions([late]))
    expect(month.id).toBe('2026-09')
  })

  it('orders months newest first and sessions inside them newest first', () => {
    const july = w({ started_at: at(2026, 7, 4, 10), ended_at: at(2026, 7, 4, 11) })
    const augEarly = w({ started_at: at(2026, 8, 4, 10), ended_at: at(2026, 8, 4, 11) })
    const augLate = w({ started_at: at(2026, 8, 20, 10), ended_at: at(2026, 8, 20, 11) })
    const months = byMonth(groupSessions([july, augEarly, augLate]))
    expect(months.map((m) => m.id)).toEqual(['2026-08', '2026-07'])
    expect(months[0].groups.map((g) => g.primary.started_at)).toEqual([
      augLate.started_at,
      augEarly.started_at,
    ])
  })

  it('counts a session with no end in withoutDuration rather than as zero', () => {
    const open = w({ started_at: at(2026, 8, 4, 10) })
    const closed = w({ started_at: at(2026, 8, 5, 10), ended_at: at(2026, 8, 5, 11) })
    const [month] = byMonth(groupSessions([open, closed]))
    expect(month.totalMin).toBe(60)
    expect(month.withoutDuration).toBe(1)
    expect(durationMin(open)).toBeNull()
  })
})

describe('initiallyExpanded', () => {
  it('leaves a short history open entirely', () => {
    const months = byMonth(
      groupSessions(
        Array.from({ length: 6 }, (_, i) =>
          w({ started_at: at(2026, 8, i + 1, 10), ended_at: at(2026, 8, i + 1, 11) }),
        ),
      ),
    )
    expect(initiallyExpanded(months)).toEqual(new Set(months.map((m) => m.id)))
  })

  it('opens only the newest month once the history is long', () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      w({ started_at: at(2026, i < 12 ? 7 : 8, (i % 12) + 1, 10), ended_at: at(2026, i < 12 ? 7 : 8, (i % 12) + 1, 11) }),
    )
    const months = byMonth(groupSessions(many))
    expect(months.length).toBe(2)
    expect(initiallyExpanded(months)).toEqual(new Set([months[0].id]))
  })
})

describe('matches', () => {
  const long = w({
    started_at: at(2026, 8, 3, 18, 0),
    ended_at: at(2026, 8, 3, 19, 0),
    total_distance_m: 10000,
    total_energy_kcal: 600,
    avg_heart_rate: 150,
  })
  const strength = w({
    activity_type: 'strength',
    started_at: at(2026, 8, 4, 18, 0),
    ended_at: at(2026, 8, 4, 18, 40),
  })

  it('lets everything through when nothing is restricted', () => {
    expect(matches(EMPTY_FILTER, long)).toBe(true)
    expect(matches(EMPTY_FILTER, strength)).toBe(true)
  })

  it('does not exclude a workout that cannot answer the filter', () => {
    // The strength session has no distance at all — "at least 10 km" has nothing
    // to fail it with, so it stays. Reading the missing distance as 0 would drop it.
    const f = { ...EMPTY_FILTER, minKm: 10 }
    expect(matches(f, strength)).toBe(true)
    expect(matches({ ...EMPTY_FILTER, minHr: 140 }, strength)).toBe(true)
  })

  it('excludes a workout by a filter it answers and fails', () => {
    expect(matches({ ...EMPTY_FILTER, minKm: 21.1 }, long)).toBe(false)
    expect(matches({ ...EMPTY_FILTER, minMinutes: 90 }, long)).toBe(false)
    expect(matches({ ...EMPTY_FILTER, maxHr: 120 }, long)).toBe(false)
    expect(matches({ ...EMPTY_FILTER, activityTypes: ['cycling'] }, long)).toBe(false)
  })

  it('lets an unknown indoor flag pass both ways', () => {
    const unknown = w({ started_at: at(2026, 8, 3, 18, 0), ended_at: at(2026, 8, 3, 19, 0) })
    const indoors = w({
      started_at: at(2026, 8, 3, 18, 0),
      ended_at: at(2026, 8, 3, 19, 0),
      metadata: { indoor: true },
    })
    expect(matches({ ...EMPTY_FILTER, place: 'indoor' }, unknown)).toBe(true)
    expect(matches({ ...EMPTY_FILTER, place: 'outdoor' }, unknown)).toBe(true)
    expect(matches({ ...EMPTY_FILTER, place: 'outdoor' }, indoors)).toBe(false)
  })
})

describe('activityTypesIn', () => {
  it('offers the types the history actually holds, commonest first', () => {
    const list = [
      w({ activity_type: 'running', started_at: at(2026, 8, 1, 10) }),
      w({ activity_type: 'yoga', started_at: at(2026, 8, 2, 10) }),
      w({ activity_type: 'running', started_at: at(2026, 8, 3, 10) }),
    ]
    expect(activityTypesIn(list)).toEqual(['running', 'yoga'])
  })
})
