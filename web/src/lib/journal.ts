// The phone's journal and events, as the server holds them (`GET /journal`) —
// the web's copy of the phone's journal rules. Pure functions, no React.
//
// # Where the data comes from, and the one thing every screen must say
//
// The phone sends its journal (moods, symptoms, the heart-rate and other
// alerts) ONLY when the user turned on Settings ▸ Your own server ▸ Journal and
// events (app 1.0 (7) on, off by default). So an empty answer has three
// different meanings, and the screens keep them apart:
//
//   * `last_received_at` absent — this server has never received a journal
//     entry: the switch is off, or the phone predates it (`neverReceived`);
//   * a 404 — the server predates the endpoint (`isApiTooOld`);
//   * entries, but none in the window — nothing was noted in that stretch.
//
// And even then: **an unmarked day is not a symptom-free day** (the phone's
// `ReportJournal`). A journal is written when someone remembers to, so every
// count here comes with how many days carry any note at all.
//
// # What is copied from the phone, by name
//
//   * `ContextHistory.days` — one mood per day (the latest), its tags with it,
//     symptoms merged keeping the strongest, a "not present" value is no marking;
//   * `SymptomSeverity.from(categoryValue:kind:)` — the value tables;
//   * `IllnessSymptoms.role` + `IllnessEpisodeRules` — markers open an episode,
//     accompanying symptoms only extend one, one quiet day is bridged;
//   * `ReportJournal.summary` — the coverage line first, the ranked lists, the
//     longest run, the day-by-day record;
//   * `HealthEvent.id` — `kind:epochSeconds`, the key an event marking carries.

import type { Lang } from '../i18n'

import type { JournalEntry, JournalResponse } from '../api/types'

export type { JournalEntry, JournalResponse }

/** The server has never received a journal entry: switch off, or an older phone. */
export function neverReceived(r: JournalResponse | undefined): boolean {
  return !!r && !r.last_received_at
}

type Name = { en: string; hu: string }
const name = (n: Name, lang: Lang) => n[lang]

// --- Symptoms ------------------------------------------------------------------

export type ValueKind = 'severity' | 'presence' | 'appetite'
export type IllnessRole = 'marker' | 'accompanying' | 'unrelated'
export type Severity = 'present' | 'mild' | 'moderate' | 'severe'

type SymptomDef = Name & { key: string; kind: ValueKind; role: IllnessRole }

const s = (key: string, en: string, hu: string, role: IllnessRole, kind: ValueKind = 'severity'): SymptomDef => ({
  key, en, hu, role, kind,
})

/** The phone's `ContextSymptom.displayOrder`, with its names and roles. */
export const SYMPTOMS: SymptomDef[] = [
  s('fatigue', 'Fatigue', 'Fáradtság', 'accompanying'),
  s('fever', 'Fever', 'Láz', 'marker'),
  s('chills', 'Chills', 'Hidegrázás', 'marker'),
  s('nightSweats', 'Night sweats', 'Éjszakai izzadás', 'accompanying'),
  s('hotFlashes', 'Hot flushes', 'Hőhullám', 'unrelated'),
  s('appetiteChanges', 'Appetite change', 'Étvágyváltozás', 'accompanying', 'appetite'),
  s('headache', 'Headache', 'Fejfájás', 'accompanying'),
  s('dizziness', 'Dizziness', 'Szédülés', 'accompanying'),
  s('fainting', 'Fainting', 'Ájulás', 'accompanying'),
  s('memoryLapse', 'Memory lapse', 'Memóriakiesés', 'unrelated'),
  s('moodChanges', 'Mood swings', 'Hangulatingadozás', 'unrelated', 'presence'),
  s('sleepChanges', 'Changed sleep', 'Megváltozott alvás', 'unrelated', 'presence'),
  s('lossOfSmell', 'Loss of smell', 'Szaglásvesztés', 'marker'),
  s('lossOfTaste', 'Loss of taste', 'Ízlelésvesztés', 'marker'),
  s('soreThroat', 'Sore throat', 'Torokfájás', 'marker'),
  s('coughing', 'Cough', 'Köhögés', 'marker'),
  s('runnyNose', 'Runny nose', 'Orrfolyás', 'marker'),
  s('sinusCongestion', 'Blocked nose', 'Orrdugulás', 'marker'),
  s('shortnessOfBreath', 'Shortness of breath', 'Nehézlégzés', 'accompanying'),
  s('wheezing', 'Wheezing', 'Zihálás', 'accompanying'),
  s('chestTightnessOrPain', 'Chest tightness or pain', 'Mellkasi szorítás vagy fájdalom', 'unrelated'),
  s('rapidPoundingOrFlutteringHeartbeat', 'Racing or pounding heartbeat', 'Szapora vagy heves szívverés', 'unrelated'),
  s('skippedHeartbeat', 'Skipped heartbeat', 'Kihagyó szívverés', 'unrelated'),
  s('nausea', 'Nausea', 'Hányinger', 'marker'),
  s('vomiting', 'Vomiting', 'Hányás', 'marker'),
  s('abdominalCramps', 'Abdominal cramps', 'Hasi görcsök', 'accompanying'),
  s('diarrhea', 'Diarrhoea', 'Hasmenés', 'marker'),
  s('constipation', 'Constipation', 'Székrekedés', 'accompanying'),
  s('bloating', 'Bloating', 'Puffadás', 'accompanying'),
  s('heartburn', 'Heartburn', 'Gyomorégés', 'accompanying'),
  s('generalizedBodyAche', 'Muscle and body aches', 'Izom- és testfájdalom', 'accompanying'),
  s('lowerBackPain', 'Lower back pain', 'Derékfájás', 'unrelated'),
  s('pelvicPain', 'Pelvic pain', 'Medencefájdalom', 'unrelated'),
  s('breastPain', 'Breast pain', 'Mellfájdalom', 'unrelated'),
  s('acne', 'Acne', 'Akne', 'unrelated'),
  s('drySkin', 'Dry skin', 'Száraz bőr', 'unrelated'),
  s('hairLoss', 'Hair loss', 'Hajhullás', 'unrelated'),
  s('bladderIncontinence', 'Bladder leakage', 'Vizelettartási nehézség', 'unrelated'),
  s('vaginalDryness', 'Vaginal dryness', 'Hüvelyszárazság', 'unrelated'),
]

const SYMPTOM_BY_KEY = new Map(SYMPTOMS.map((d, i) => [d.key, { ...d, order: i }]))

export function isSymptom(dataType: string): boolean {
  return SYMPTOM_BY_KEY.has(dataType)
}

/** A symptom's name; a type this build does not know is shown as it arrived. */
export function symptomName(key: string, lang: Lang): string {
  const d = SYMPTOM_BY_KEY.get(key)
  return d ? name(d, lang) : key
}

export function symptomKind(key: string): ValueKind {
  return SYMPTOM_BY_KEY.get(key)?.kind ?? 'severity'
}

/**
 * `SymptomSeverity.from(categoryValue:kind:)`. `null` = not a marking: the
 * "not present" value (the Health app can record that a symptom was absent),
 * or a value a later SDK added.
 */
export function severityOf(dataType: string, value: number | undefined): Severity | null {
  if (value == null) return null
  switch (symptomKind(dataType)) {
    case 'presence':
      return value === 0 ? 'present' : null
    case 'appetite':
      return ({ 0: 'present', 1: 'moderate', 2: 'mild', 3: 'severe' } as Record<number, Severity>)[value] ?? null
    default:
      return ({ 0: 'present', 2: 'mild', 3: 'moderate', 4: 'severe' } as Record<number, Severity>)[value] ?? null
  }
}

const SEVERITY_ORDER: Severity[] = ['present', 'mild', 'moderate', 'severe']
const stronger = (a: Severity, b: Severity) => (SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(b) ? a : b)

const SEVERITY_NAMES: Record<ValueKind, Record<Severity, Name>> = {
  severity: {
    present: { en: 'Present', hu: 'Volt' },
    mild: { en: 'Mild', hu: 'Enyhe' },
    moderate: { en: 'Moderate', hu: 'Közepes' },
    severe: { en: 'Severe', hu: 'Erős' },
  },
  presence: {
    present: { en: 'Present', hu: 'Volt' },
    mild: { en: 'Mild', hu: 'Enyhe' },
    moderate: { en: 'Moderate', hu: 'Közepes' },
    severe: { en: 'Severe', hu: 'Erős' },
  },
  // ⚠️ On appetite the four steps are a DIRECTION (the phone's `appetite` scale).
  appetite: {
    present: { en: 'Changed', hu: 'Megváltozott' },
    mild: { en: 'Less', hu: 'Kevesebb' },
    moderate: { en: 'Unchanged', hu: 'Nem változott' },
    severe: { en: 'More', hu: 'Több' },
  },
}

/** "Fever (moderate)" — the grade only where the type has one, as the phone prints it. */
export function symptomText(key: string, severity: Severity, lang: Lang): string {
  const kind = symptomKind(key)
  if (kind === 'presence') return symptomName(key, lang)
  return `${symptomName(key, lang)} (${name(SEVERITY_NAMES[kind][severity], lang).toLowerCase()})`
}

// --- Mood and tags -------------------------------------------------------------

export type MoodLevel = -2 | -1 | 0 | 1 | 2

/** `MoodLevel.nearest(valence:)`: clamp, double, round. */
export function moodLevel(valence: number): MoodLevel {
  const clamped = Math.min(Math.max(valence, -1), 1)
  const step = Math.round(clamped * 2)
  return (Object.is(step, -0) ? 0 : step) as MoodLevel
}

const MOOD_NAMES: Record<MoodLevel, Name> = {
  [-2]: { en: 'Very bad', hu: 'Nagyon rossz' },
  [-1]: { en: 'Bad', hu: 'Rossz' },
  0: { en: 'Neutral', hu: 'Semleges' },
  1: { en: 'Good', hu: 'Jó' },
  2: { en: 'Very good', hu: 'Nagyon jó' },
}

export function moodName(level: MoodLevel, lang: Lang): string {
  return name(MOOD_NAMES[level], lang)
}

/** The phone's curated tags (`ContextTag.displayOrder`), keyed by the
 * HKStateOfMind association name the phone sends. An association outside the
 * set is not displayed — the phone does the same (`ContextHealthKitTypes.tag`). */
const TAGS: (Name & { key: string })[] = [
  { key: 'work', en: 'Work', hu: 'Munka' },
  { key: 'family', en: 'Family', hu: 'Család' },
  { key: 'partner', en: 'Partner', hu: 'Pár' },
  { key: 'friends', en: 'Friends', hu: 'Barátok' },
  { key: 'health', en: 'Health', hu: 'Egészség' },
  { key: 'fitness', en: 'Move', hu: 'Mozgás' },
  { key: 'tasks', en: 'Errands', hu: 'Teendők' },
  { key: 'travel', en: 'Travel', hu: 'Utazás' },
  { key: 'selfCare', en: 'Myself', hu: 'Önmagam' },
  { key: 'hobbies', en: 'Hobby', hu: 'Hobbi' },
  { key: 'education', en: 'Study', hu: 'Tanulás' },
  { key: 'money', en: 'Money', hu: 'Pénz' },
  { key: 'weather', en: 'Weather', hu: 'Időjárás' },
]
const TAG_ORDER = new Map(TAGS.map((t, i) => [t.key, i]))

export function tagName(key: string, lang: Lang): string {
  const t = TAGS.find((x) => x.key === key)
  return t ? name(t, lang) : key
}

// --- Events --------------------------------------------------------------------

type EventDef = Name & { dataType: string; kind: string }

/** The category events of the phone's timeline, plus walking steadiness. The
 * `kind` is `HealthEventKind.rawValue` — what an event marking's key starts with. */
export const EVENTS: EventDef[] = [
  { dataType: 'highHeartRateEvent', kind: 'highHeartRate', en: 'High heart rate', hu: 'Magas pulzus' },
  { dataType: 'lowHeartRateEvent', kind: 'lowHeartRate', en: 'Low heart rate', hu: 'Alacsony pulzus' },
  { dataType: 'irregularHeartRhythmEvent', kind: 'irregularRhythm', en: 'Irregular heart rhythm', hu: 'Szabálytalan szívritmus' },
  { dataType: 'environmentalAudioExposureEvent', kind: 'loudEnvironment', en: 'Loud environment', hu: 'Hangos környezet' },
  { dataType: 'appleWalkingSteadinessEvent', kind: 'walkingSteadiness', en: 'Walking steadiness notification', hu: 'Járásstabilitás-értesítés' },
]
const EVENT_BY_TYPE = new Map(EVENTS.map((e) => [e.dataType, e]))

export function isEvent(dataType: string): boolean {
  return EVENT_BY_TYPE.has(dataType)
}

export function eventName(dataType: string, lang: Lang): string {
  const e = EVENT_BY_TYPE.get(dataType)
  return e ? name(e, lang) : dataType
}

const SELF_REPORTED: Name = { en: 'A marked moment', hu: 'Megjelölt pillanat' }

/** `StabilityNotice.Level` — the wording keeps the claim with Apple. */
const STEADINESS: Record<number, Name> = {
  1: { en: 'The Health app reported a “low” level', hu: 'Az Egészség app „alacsony” szintet jelzett' },
  2: { en: 'The Health app reported a “very low” level', hu: 'Az Egészség app „nagyon alacsony” szintet jelzett' },
  3: { en: 'The Health app reported a “low” level again', hu: 'Az Egészség app ismét „alacsony” szintet jelzett' },
  4: { en: 'The Health app reported a “very low” level again', hu: 'Az Egészség app ismét „nagyon alacsony” szintet jelzett' },
}

/** A walking-steadiness level in words; `null` for a value this build does not know. */
export function steadinessText(value: number | undefined, lang: Lang): string | null {
  const n = value == null ? undefined : STEADINESS[value]
  return n ? name(n, lang) : null
}

// --- Days ----------------------------------------------------------------------

/** The local calendar day of an instant, `YYYY-MM-DD`. */
export function dayIn(iso: string, tz: string): string {
  // `en-CA` formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(iso))
}

/** Whole days between two day keys (`b − a`), DST-proof: pure calendar arithmetic. */
export function dayDistance(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

export function addDay(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

export type JournalDay = {
  day: string
  mood?: MoodLevel
  /** In the phone's display order. */
  tags: string[]
  /** In the phone's display order, strongest severity of the day. */
  symptoms: { key: string; severity: Severity }[]
}

/**
 * `ContextHistory.days`: entries → the marked days, oldest first. One mood per
 * day (the latest — a correction is the last word), the tags of that same
 * sample, symptoms merged keeping the strongest, and a day that carried only
 * "not present" values does not appear.
 */
export function journalDays(entries: JournalEntry[], tz: string): JournalDay[] {
  const byDay = new Map<string, { moodAt?: string; mood?: MoodLevel; tags: string[]; symptoms: Map<string, Severity> }>()
  const get = (day: string) => {
    let d = byDay.get(day)
    if (!d) byDay.set(day, (d = { tags: [], symptoms: new Map() }))
    return d
  }
  for (const e of entries) {
    if (e.data_type === 'stateOfMind' && e.valence != null) {
      const d = get(dayIn(e.started_at, tz))
      if (d.moodAt != null && d.moodAt > e.started_at) continue
      d.moodAt = e.started_at
      d.mood = moodLevel(e.valence)
      d.tags = (e.associations ?? []).filter((a) => TAG_ORDER.has(a))
        .sort((a, b) => TAG_ORDER.get(a)! - TAG_ORDER.get(b)!)
    } else if (isSymptom(e.data_type)) {
      const sev = severityOf(e.data_type, e.value)
      if (!sev) continue
      const d = get(dayIn(e.started_at, tz))
      const prev = d.symptoms.get(e.data_type)
      d.symptoms.set(e.data_type, prev ? stronger(prev, sev) : sev)
    }
  }
  return [...byDay.entries()]
    .filter(([, d]) => d.mood != null || d.symptoms.size > 0)
    .map(([day, d]) => ({
      day,
      mood: d.mood,
      tags: d.tags,
      symptoms: [...d.symptoms.entries()]
        .map(([key, severity]) => ({ key, severity }))
        .sort((a, b) => (SYMPTOM_BY_KEY.get(a.key)?.order ?? 99) - (SYMPTOM_BY_KEY.get(b.key)?.order ?? 99)),
    }))
    .sort((a, b) => (a.day < b.day ? -1 : 1))
}

// --- Events with their markings -----------------------------------------------

export type JournalEvent = {
  /** `kind:epochSeconds` — `HealthEvent.id`, what a marking's `event_key` says. */
  id: string
  /** The event type, or `null` for a moment the user marked by hand. */
  dataType: string | null
  at: string
  audioLevel?: number
  /** Walking steadiness: 1 initial low … 4 repeat very low. */
  value?: number
  /** What was marked at the moment itself. */
  marked: { key: string; severity: Severity }[]
  /** The follow-up answers: 24 / 48 h → what remained (empty = nothing remained). */
  followUps: { hours: number; symptoms: { key: string; severity: Severity }[] }[]
}

export function eventTitle(e: JournalEvent, lang: Lang): string {
  return e.dataType ? eventName(e.dataType, lang) : name(SELF_REPORTED, lang)
}

/**
 * The event timeline, newest first: every event entry, with the symptoms the
 * user marked on it (joined by `event_key`), and the moments marked by hand
 * (`selfReported:` keys, which have no event entry of their own).
 */
export function journalEvents(entries: JournalEntry[]): JournalEvent[] {
  const markings = new Map<string, JournalEntry[]>()
  for (const e of entries) {
    if (!e.event_key || !isSymptom(e.data_type)) continue
    const list = markings.get(e.event_key) ?? []
    list.push(e)
    markings.set(e.event_key, list)
  }
  const events = new Map<string, JournalEvent>()
  for (const e of entries) {
    const def = EVENT_BY_TYPE.get(e.data_type)
    if (!def) continue
    const id = `${def.kind}:${Math.round(Date.parse(e.started_at) / 1000)}`
    events.set(id, {
      id, dataType: e.data_type, at: e.started_at, audioLevel: e.audio_level_dbaspl,
      value: def.kind === 'walkingSteadiness' ? e.value : undefined, marked: [], followUps: [],
    })
  }
  for (const key of markings.keys()) {
    if (!events.has(key) && key.startsWith('selfReported:')) {
      const seconds = Number(key.slice('selfReported:'.length))
      if (Number.isFinite(seconds)) {
        events.set(key, { id: key, dataType: null, at: new Date(seconds * 1000).toISOString(), marked: [], followUps: [] })
      }
    }
  }
  for (const [key, list] of markings) {
    const ev = events.get(key)
    if (!ev) continue
    const stages = new Map<number, { key: string; severity: Severity }[]>()
    for (const m of list) {
      const sev = severityOf(m.data_type, m.value)
      if (m.follow_up_hours) {
        const st = stages.get(m.follow_up_hours) ?? []
        // A "not present" answer is the answer "it is gone" — the stage exists, empty.
        if (sev) st.push({ key: m.data_type, severity: sev })
        stages.set(m.follow_up_hours, st)
      } else if (sev) {
        ev.marked.push({ key: m.data_type, severity: sev })
      }
    }
    ev.followUps = [...stages.entries()].sort((a, b) => a[0] - b[0]).map(([hours, symptoms]) => ({ hours, symptoms }))
  }
  return [...events.values()].sort((a, b) => (a.at < b.at ? 1 : -1))
}

// --- Illness episodes ------------------------------------------------------------

/** `IllnessEpisodeRules.maxGapDays`: one quiet day is bridged, two are not. */
export const MAX_GAP_DAYS = 1

export type IllnessEpisode = {
  start: string
  end: string
  dayCount: number
  /** The days that carried an illness symptom. */
  days: { day: string; symptoms: { key: string; severity: Severity }[] }[]
  ongoing: boolean
}

function roleOf(key: string): IllnessRole {
  return SYMPTOM_BY_KEY.get(key)?.role ?? 'unrelated'
}

/** `IllnessEpisodeRules.episodes`, oldest first. */
export function illnessEpisodes(days: JournalDay[], today: string): IllnessEpisode[] {
  const ill = days
    .map((d) => ({ day: d.day, symptoms: d.symptoms.filter((x) => roleOf(x.key) !== 'unrelated') }))
    .filter((d) => d.symptoms.length > 0)
    .sort((a, b) => (a.day < b.day ? -1 : 1))
  const runs: (typeof ill)[] = []
  let current: typeof ill = []
  for (const d of ill) {
    const prev = current[current.length - 1]
    if (prev && dayDistance(prev.day, d.day) <= MAX_GAP_DAYS + 1) current.push(d)
    else {
      if (current.length) runs.push(current)
      current = [d]
    }
  }
  if (current.length) runs.push(current)
  return runs
    // A run with no marker day is a rough week, not an illness.
    .filter((run) => run.some((d) => d.symptoms.some((x) => roleOf(x.key) === 'marker')))
    .map((run) => {
      const start = run[0].day
      const end = run[run.length - 1].day
      return {
        start, end, days: run,
        dayCount: dayDistance(start, end) + 1,
        ongoing: dayDistance(end, today) <= MAX_GAP_DAYS,
      }
    })
}

/** The episode's symptoms by how many of its days carried them, most first. */
export function episodeSymptoms(ep: IllnessEpisode): { key: string; days: number }[] {
  const counts = new Map<string, number>()
  for (const d of ep.days) for (const s of d.symptoms) counts.set(s.key, (counts.get(s.key) ?? 0) + 1)
  return [...counts.entries()].map(([key, days]) => ({ key, days }))
    .sort((a, b) => b.days - a.days || (SYMPTOM_BY_KEY.get(a.key)?.order ?? 99) - (SYMPTOM_BY_KEY.get(b.key)?.order ?? 99))
}

// --- The report's journal section -----------------------------------------------

export type JournalSummary = {
  markedDays: number
  periodDays: number
  symptomDays: { key: string; days: number }[]
  tagDays: { key: string; days: number }[]
  longestSymptomRun: { days: number; start: string } | null
  detail: JournalDay[]
}

/** `ReportJournalSummary.maxEntries` / `maxMarkedDays`. */
export const SUMMARY_MAX_ENTRIES = 4
export const SUMMARY_MAX_DAYS = 60

/** `ReportJournal.summary`: `null` when nothing was marked in the window. */
export function journalSummary(days: JournalDay[], from: string, to: string): JournalSummary | null {
  const inWindow = days.filter((d) => d.day >= from && d.day <= to)
  if (inWindow.length === 0) return null
  const symptoms = new Map<string, number>()
  const tags = new Map<string, number>()
  for (const d of inWindow) {
    for (const s of d.symptoms) symptoms.set(s.key, (symptoms.get(s.key) ?? 0) + 1)
    for (const t of d.tags) tags.set(t, (tags.get(t) ?? 0) + 1)
  }
  const ranked = (m: Map<string, number>) =>
    [...m.entries()].map(([key, n]) => ({ key, days: n }))
      .sort((a, b) => b.days - a.days || (a.key < b.key ? -1 : 1))
  return {
    markedDays: inWindow.length,
    periodDays: dayDistance(from, to) + 1,
    symptomDays: ranked(symptoms),
    tagDays: ranked(tags),
    longestSymptomRun: longestRun(inWindow.filter((d) => d.symptoms.length > 0).map((d) => d.day)),
    detail: inWindow.slice(0, SUMMARY_MAX_DAYS),
  }
}

/** The longest run of consecutive days; a gap is never bridged (`ReportJournal.longestRun`). */
export function longestRun(days: string[]): { days: number; start: string } | null {
  if (days.length === 0) return null
  let best = { days: 1, start: days[0] }
  let runStart = days[0]
  let len = 1
  for (let i = 1; i < days.length; i++) {
    if (dayDistance(days[i - 1], days[i]) === 1) len += 1
    else {
      runStart = days[i]
      len = 1
    }
    if (len > best.days) best = { days: len, start: runStart }
  }
  return best
}
