// The phone's journal rules, copied (`lib/journal.ts`). Each case names the
// phone rule it pins down — a drift between the two would show the same journal
// differently on the web and on the phone, with nothing reporting it.

import { describe, expect, it } from 'vitest'
import type { JournalEntry } from '../api/types'
import {
  dayIn,
  illnessEpisodes,
  journalDays,
  journalEvents,
  journalSummary,
  longestRun,
  moodLevel,
  neverReceived,
  severityOf,
  symptomText,
} from './journal'

const TZ = 'Europe/Budapest'
let seq = 0
function e(data_type: string, at: string, extra: Partial<JournalEntry> = {}): JournalEntry {
  seq += 1
  return { source_uuid: `u${seq}`, data_type, started_at: at, ended_at: at, ...extra }
}
const sym = (type: string, day: string, value = 0, extra: Partial<JournalEntry> = {}) =>
  e(type, `${day}T10:00:00Z`, { value, ...extra })
const mood = (at: string, valence: number, associations: string[] = []) =>
  e('stateOfMind', at, { valence, associations, mood_kind: 'daily_mood' })

describe('values (SymptomSeverity.from(categoryValue:kind:))', () => {
  it('reads severity, presence and appetite on their own scales', () => {
    expect(severityOf('fever', 0)).toBe('present')
    expect(severityOf('fever', 1)).toBeNull() // "not present" is no marking
    expect(severityOf('fever', 4)).toBe('severe')
    expect(severityOf('sleepChanges', 0)).toBe('present')
    expect(severityOf('sleepChanges', 1)).toBeNull()
    expect(severityOf('appetiteChanges', 1)).toBe('moderate') // no change IS a statement
    expect(severityOf('appetiteChanges', 2)).toBe('mild') // decreased
    expect(severityOf('fever', 9)).toBeNull() // a value a later SDK adds
  })

  it('prints a grade only where the type has one, and appetite as a direction', () => {
    expect(symptomText('fever', 'moderate', 'en')).toBe('Fever (moderate)')
    expect(symptomText('sleepChanges', 'present', 'en')).toBe('Changed sleep')
    expect(symptomText('appetiteChanges', 'mild', 'hu')).toBe('Étvágyváltozás (kevesebb)')
  })

  it('rounds a valence to the nearest of five steps (MoodLevel.nearest)', () => {
    expect(moodLevel(-1)).toBe(-2)
    expect(moodLevel(-0.2)).toBe(0)
    expect(moodLevel(0.3)).toBe(1)
    expect(moodLevel(5)).toBe(2) // clamped, not dropped
  })
})

describe('days (ContextHistory.days)', () => {
  it('keeps the latest mood with its own tags, and the strongest symptom', () => {
    const days = journalDays(
      [
        mood('2026-10-20T07:00:00Z', 0.5, ['work']),
        mood('2026-10-20T19:00:00Z', -0.5, ['family']),
        sym('headache', '2026-10-20', 2),
        sym('headache', '2026-10-20', 4),
      ],
      TZ,
    )
    expect(days).toEqual([
      { day: '2026-10-20', mood: -1, tags: ['family'], symptoms: [{ key: 'headache', severity: 'severe' }] },
    ])
  })

  it('a day with only "not present" values does not appear', () => {
    expect(journalDays([sym('fever', '2026-10-20', 1)], TZ)).toEqual([])
  })

  it('cuts days in the journal time zone, not UTC', () => {
    // 23:30 UTC on the 20th is already the 21st in Budapest.
    expect(dayIn('2026-10-20T23:30:00Z', TZ)).toBe('2026-10-21')
    expect(journalDays([e('fever', '2026-10-20T23:30:00Z', { value: 0 })], TZ)[0].day).toBe('2026-10-21')
  })

  it('shows only the curated tags, as the phone does', () => {
    expect(journalDays([mood('2026-10-20T07:00:00Z', 0, ['spirituality', 'work'])], TZ)[0].tags).toEqual(['work'])
  })
})

describe('illness episodes (IllnessEpisodeRules)', () => {
  const days = (entries: JournalEntry[]) => journalDays(entries, TZ)

  it('needs a marker day: three days of fatigue are a rough week, not an illness', () => {
    const d = days([sym('fatigue', '2026-10-01'), sym('fatigue', '2026-10-02'), sym('fatigue', '2026-10-03')])
    expect(illnessEpisodes(d, '2026-10-27')).toEqual([])
  })

  it('bridges one quiet day, not two, and starts on the first symptom day', () => {
    const d = days([
      sym('fatigue', '2026-10-01'),
      sym('fever', '2026-10-02'),
      sym('coughing', '2026-10-04'), // one quiet day: bridged
      sym('soreThroat', '2026-10-07'), // two quiet days: a new run
    ])
    const eps = illnessEpisodes(d, '2026-10-27')
    expect(eps.map((x) => [x.start, x.end, x.dayCount])).toEqual([
      ['2026-10-01', '2026-10-04', 4],
      ['2026-10-07', '2026-10-07', 1],
    ])
  })

  it('an unrelated symptom neither opens nor extends one', () => {
    const d = days([sym('fever', '2026-10-01'), sym('lowerBackPain', '2026-10-02'), sym('lowerBackPain', '2026-10-03')])
    expect(illnessEpisodes(d, '2026-10-27')[0].end).toBe('2026-10-01')
  })

  it('is ongoing while a symptom tomorrow could still join it', () => {
    const d = days([sym('fever', '2026-10-26')])
    expect(illnessEpisodes(d, '2026-10-27')[0].ongoing).toBe(true)
    expect(illnessEpisodes(d, '2026-10-29')[0].ongoing).toBe(false)
  })
})

describe('events (HealthEvent.id and the markings)', () => {
  it('joins the symptoms marked on an event by its key, and the follow-ups by their stage', () => {
    const at = '2026-10-22T10:00:00Z'
    const key = `highHeartRate:${Date.parse(at) / 1000}`
    const events = journalEvents([
      e('highHeartRateEvent', at, { value: 0 }),
      sym('dizziness', '2026-10-22', 3, { event_key: key }),
      sym('dizziness', '2026-10-23', 2, { event_key: key, follow_up_hours: 24 }),
      sym('dizziness', '2026-10-24', 1, { event_key: key, follow_up_hours: 48 }), // "it is gone"
    ])
    expect(events).toHaveLength(1)
    expect(events[0].marked).toEqual([{ key: 'dizziness', severity: 'moderate' }])
    expect(events[0].followUps).toEqual([
      { hours: 24, symptoms: [{ key: 'dizziness', severity: 'mild' }] },
      { hours: 48, symptoms: [] },
    ])
  })

  it('a moment marked by hand becomes an event of its own', () => {
    const events = journalEvents([sym('headache', '2026-10-22', 0, { event_key: 'selfReported:1792663200' })])
    expect(events).toHaveLength(1)
    expect(events[0].dataType).toBeNull()
    expect(events[0].marked).toEqual([{ key: 'headache', severity: 'present' }])
  })
})

describe('the report block (ReportJournal)', () => {
  it('counts the marked days of the window against all of its days', () => {
    const d = journalDays([sym('fever', '2026-10-20'), sym('fever', '2026-10-21'), sym('fever', '2026-09-01')], TZ)
    const s = journalSummary(d, '2026-10-01', '2026-10-27')!
    expect(s.markedDays).toBe(2)
    expect(s.periodDays).toBe(27)
    expect(s.symptomDays).toEqual([{ key: 'fever', days: 2 }])
    expect(s.longestSymptomRun).toEqual({ days: 2, start: '2026-10-20' })
  })

  it('an empty window is null — no heading over "0 days"', () => {
    expect(journalSummary([], '2026-10-01', '2026-10-27')).toBeNull()
  })

  it('never bridges a gap in the longest run', () => {
    expect(longestRun(['2026-10-01', '2026-10-03', '2026-10-04'])).toEqual({ days: 2, start: '2026-10-03' })
  })
})

describe('never received', () => {
  it('is what an absent last_received_at says', () => {
    expect(neverReceived({ tz: TZ, from: 'a', to: 'b', entries: [], total: 0 })).toBe(true)
    expect(neverReceived({ tz: TZ, from: 'a', to: 'b', entries: [], total: 0, last_received_at: null })).toBe(true)
    expect(neverReceived({ tz: TZ, from: 'a', to: 'b', entries: [], total: 2, last_received_at: '2026-10-27T06:00:00Z' })).toBe(false)
  })
})
