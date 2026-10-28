import { describe, expect, it } from 'vitest'
import type { Insight } from '../api/types'
import { en } from '../i18n/en'
import { hu } from '../i18n/hu'
import type { Dict, UiKey } from '../i18n/types'
import {
  WORDINGS,
  clock,
  composeInsight,
  fisherInterval,
  insightText,
  ruleFromId,
  splitHours,
  type InsightTextContext,
} from './insightText'

// --- a translator without React, the same interpolation as i18n/index.tsx ----

function ctx(dict: Dict, locale: string): InsightTextContext {
  return {
    locale,
    t: (key: UiKey, params?: Record<string, string | number>) =>
      dict.ui[key].replace(/\{(\w+)\}/g, (whole, name: string) =>
        params && name in params ? String(params[name]) : whole,
      ),
  }
}
const EN = ctx(en, 'en-US')
const HU = ctx(hu, 'hu-HU')
const NBSP = ' '

// --- the shared vectors (backend/internal/insights/testdata/vectors) ----------
//
// The numbers the Go and Swift engines agree on. What fires there must word here
// — a value set that cannot carry its own sentence would read perfectly on the
// machine that computed it and fall back to Hungarian everywhere else.

type Vector = {
  name: string
  expect: { id: string; values: Record<string, number> }[]
}
const vectorFiles = import.meta.glob(
  '../../../backend/internal/insights/testdata/vectors/*.json',
  { eager: true, import: 'default' },
) as Record<string, Vector>
const fired = Object.values(vectorFiles).flatMap((v) =>
  v.expect.map((e) => ({ vector: v.name, rule: ruleFromId(e.id)!, values: e.values })),
)

// --- the backend's own rule list, read from its source --------------------------

const goSources = import.meta.glob(
  [
    '../../../backend/internal/insights/rules.go',
    '../../../backend/internal/insights/training.go',
    '../../../backend/internal/insights/baseline_drift.go',
  ],
  { eager: true, query: '?raw', import: 'default' },
) as Record<string, string>
const go = (name: string): string => {
  const hit = Object.entries(goSources).find(([path]) => path.endsWith(`/${name}`))
  if (!hit) throw new Error(`backend source ${name} not found`)
  return hit[1]
}
const quoted = (block: string): string[] => [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1])
const between = (src: string, start: string): string => {
  const from = src.indexOf(start)
  if (from < 0) throw new Error(`"${start}" not found`)
  return src.slice(from, src.indexOf('\n}', from))
}

/** Every rule id stem the server can emit, expanded per activity type / metric. */
function backendRules(): string[] {
  const stems = quoted(between(go('rules.go'), 'var ruleIDPrefixes'))
  const activities = [
    ...between(go('training.go'), 'var efficiencyRules').matchAll(/activityType:\s*"([^"]+)"/g),
  ].map((m) => m[1])
  const metrics = [
    ...between(go('baseline_drift.go'), 'var baselineDriftRules').matchAll(/metric:\s*"([^"]+)"/g),
  ].map((m) => m[1])
  return stems
    .flatMap((stem) =>
      stem === 'efficiency-trend'
        ? activities.map((a) => `${stem}-${a}`)
        : stem === 'baseline-drift'
          ? metrics.map((m) => `${stem}-${m}`)
          : [stem],
    )
    .sort()
}

/**
 * Pinned on purpose, as well as read: the parse above could quietly return less
 * (a renamed variable), and this list is what that would be measured against.
 */
const PINNED = [
  'baseline-drift-bodyMass',
  'baseline-drift-hrv',
  'baseline-drift-respiratoryRate',
  'baseline-drift-restingHeartRate',
  'baseline-drift-sleepDuration',
  'efficiency-trend-cycling',
  'efficiency-trend-running',
  'efficiency-trend-swimming',
  'efficiency-trend-walking',
  'hrv-depressed',
  'resting-hr-elevated',
  'sleep-debt',
  'sleep-midpoint-weekend',
  'sleep-regularity',
  'sleep-short',
  'sleep-weekend-duration',
  'sleep-weekly-trend',
  'social-jetlag',
  'steps-sleep-correlation',
  'steps-weekend',
  'steps-weekly-trend',
  'training-load-jump',
]

// Realistic values for every rule, in the key sets the vectors pin
// (site/src/content/docs/api/insight-vectors.md). Where a vector fires the rule,
// its own numbers are used below as well.
const REALISTIC: Record<string, Record<string, number>> = {
  'resting-hr-elevated': { recent: 63, baseline: 55.5, deviation: 2.1, baselineDays: 27 },
  'hrv-depressed': { recent: 38.4, baseline: 52, deviation: 6.3, baselineDays: 28 },
  'sleep-short': { recent: 5.6, baseline: 7.3, deviation: 0.5, baselineDays: 26 },
  'steps-weekly-trend': { current: 7420, previous: 9311, changePct: -20.3, currentDays: 7, previousDays: 6 },
  'sleep-weekly-trend': { current: 7.9, previous: 7.1, changePct: 11.3, currentDays: 6, previousDays: 7 },
  'steps-sleep-correlation': { r: -0.62, pairs: 41 },
  'sleep-regularity': { midpoint: 1610, midpointSd: 72.4, nights: 24 },
  'sleep-midpoint-weekend': { free: 1700, work: 1630, delta: 70, freeCount: 7, workCount: 18 },
  'sleep-weekend-duration': { free: 8.2, work: 6.9, delta: 1.3, freeCount: 8, workCount: 19 },
  'steps-weekend': { free: 13250, work: 8900, delta: 4350, freeCount: 8, workCount: 20 },
  'training-load-jump': { acute: 315, chronicWeekly: 180, ratio: 1.75, acuteCount: 5 },
  'efficiency-trend-running': {
    recentSpeed: 190, previousSpeed: 176, recentHr: 151, previousHr: 150,
    changePct: 8, recentCount: 6, previousCount: 5,
  },
  'efficiency-trend-cycling': {
    recentSpeed: 410, previousSpeed: 440, recentHr: 132, previousHr: 134,
    changePct: -6.8, recentCount: 4, previousCount: 4,
  },
  'efficiency-trend-walking': {
    recentSpeed: 92, previousSpeed: 84, recentHr: 104, previousHr: 102,
    changePct: 9.5, recentCount: 9, previousCount: 7,
  },
  'efficiency-trend-swimming': {
    recentSpeed: 38, previousSpeed: 35, recentHr: 128, previousHr: 127,
    changePct: 8.6, recentCount: 4, previousCount: 4,
  },
  'baseline-drift-restingHeartRate': { recent: 61, older: 55, drift: 6, t: 11.2, recentDays: 28, olderDays: 30 },
  'baseline-drift-hrv': { recent: 41.2, older: 49.8, drift: -8.6, t: -4.1, recentDays: 27, olderDays: 29 },
  'baseline-drift-respiratoryRate': { recent: 15.9, older: 14.6, drift: 1.3, t: 3.2, recentDays: 25, olderDays: 28 },
  'baseline-drift-bodyMass': { recent: 78, older: 82, drift: -4, t: 15, recentDays: 8, olderDays: 8 },
  'baseline-drift-sleepDuration': { recent: 6.4, older: 7.25, drift: -0.85, t: -3.4, recentDays: 26, olderDays: 30 },
  'sleep-debt': { debtHours: 7.5, usual: 7.4, nights: 13, slept: 88.7, expected: 96.2, baselineNights: 81 },
  'social-jetlag': { jetlagMinutes: 104, weeks: 7, nights: 49, weekCount: 8, agreeing: 6 },
}

function wellFormed(text: { title: string; detail: string }) {
  for (const s of [text.title, text.detail]) {
    expect(s.trim().length).toBeGreaterThan(10)
    expect(s).not.toMatch(/\{\w+\}|undefined|NaN|Infinity/)
  }
}

describe('the backend and the composer know the same rules', () => {
  it('reads the backend rule list as the pinned one', () => {
    expect(backendRules()).toEqual(PINNED)
  })

  it('has wording for exactly the rules the backend emits — a new rule without a sentence fails here', () => {
    expect(Object.keys(WORDINGS).sort()).toEqual(backendRules())
  })

  it('has realistic test values for every rule it knows', () => {
    expect(Object.keys(REALISTIC).sort()).toEqual(Object.keys(WORDINGS).sort())
  })
})

describe('every rule composes in both languages', () => {
  for (const rule of PINNED) {
    it(rule, () => {
      const e = composeInsight(rule, REALISTIC[rule], EN)
      const h = composeInsight(rule, REALISTIC[rule], HU)
      expect(e).not.toBeNull()
      expect(h).not.toBeNull()
      wellFormed(e!)
      wellFormed(h!)
      // Not the same sentence twice: a key that fell through to the other
      // dictionary would make the two languages equal.
      expect(h!.title).not.toBe(e!.title)
      expect(h!.detail).not.toBe(e!.detail)
    })
  }

  it('words every insight a shared vector fires, from its values alone', () => {
    expect(fired.length).toBeGreaterThan(10)
    for (const f of fired) {
      for (const c of [EN, HU]) {
        const text = composeInsight(f.rule, f.values, c)
        expect(text, `${f.vector} → ${f.rule}`).not.toBeNull()
        wellFormed(text!)
      }
    }
  })
})

describe('the sentences, word for word (ported from the app catalog)', () => {
  const vec = (rule: string) => fired.find((f) => f.rule === rule)!.values

  it('resting-hr-elevated', () => {
    expect(composeInsight('resting-hr-elevated', vec('resting-hr-elevated'), EN)).toEqual({
      title: 'Your resting heart rate has been above the usual for 3 days',
      detail:
        'The last 3 days average 63.0 bpm, and the earlier 28 days average 55.0 bpm (standard deviation 1.0 bpm). This is not a diagnosis — resting heart rate moves with sleep, alcohol, stress and illness too.',
    })
    expect(composeInsight('resting-hr-elevated', vec('resting-hr-elevated'), HU)).toEqual({
      title: 'A nyugalmi pulzusod 3 napja a szokásos fölött',
      detail:
        'Az elmúlt 3 nap átlaga 63,0 szívverés/perc, a korábbi 28 nap átlaga 55,0 szívverés/perc (szórás 1,0 szívverés/perc). Ez nem diagnózis — a nyugalmi pulzust az alvás, az alkohol, a stressz és a betegség is elmozdítja.',
    })
  })

  it('steps-weekend: grouping follows the locale, the difference takes the instrumental', () => {
    const e = composeInsight('steps-weekend', vec('steps-weekend'), EN)!
    const h = composeInsight('steps-weekend', vec('steps-weekend'), HU)!
    expect(e.title).toBe('Your daily step count is 5,000 steps less at the weekend than on a weekday')
    expect(h.title).toBe('A napi lépésszámod hétvégén 5000 lépéssel kevesebb, mint hétköznap')
    expect(h.detail).toContain(`a hétköznapi 11${NBSP}000 lépés (20 mért napból)`)
  })

  it('sleep-midpoint-weekend: levels are clock readings, the difference minutes', () => {
    const e = composeInsight('sleep-midpoint-weekend', vec('sleep-midpoint-weekend'), EN)!
    const h = composeInsight('sleep-midpoint-weekend', vec('sleep-midpoint-weekend'), HU)!
    expect(e.title).toBe('The middle of your sleep is 120 min later at the weekend than on a weekday')
    expect(h.title).toBe('Az alvásod közepe hétvégén 120 perccel később van, mint hétköznap')
    expect(e.detail).toContain('the weekend average is 05:00 (8 of the measured nights)')
  })

  it('sleep-debt and social-jetlag speak hours and minutes', () => {
    expect(composeInsight('sleep-debt', vec('sleep-debt'), EN)!.title).toBe(
      'Your last 14 nights fell 6 hr short of your usual in total',
    )
    expect(composeInsight('sleep-debt', vec('sleep-debt'), HU)!.title).toBe(
      'Az elmúlt 14 éjszaka alatt 6 órával alvás hiányzik a szokásoshoz képest',
    )
    const j = composeInsight('social-jetlag', vec('social-jetlag'), HU)!
    expect(j.title).toBe('Szociális jetlag: a hétvégi alvásközeped 1 óra 55 perccel későbbre csúszik')
    expect(j.detail).toContain('Ez nagyjából 2 időzónányi eltolódás')
  })

  it('trend: the direction is the sign of changePct', () => {
    expect(composeInsight('sleep-weekly-trend', vec('sleep-weekly-trend'), EN)!.title).toBe(
      "Your night's sleep is 14% less than the previous week",
    )
    expect(composeInsight('steps-weekly-trend', vec('steps-weekly-trend'), HU)!.title).toBe(
      'A napi lépésszámod 125%-kal több, mint az előző héten',
    )
  })

  it('training-load-jump rounds half to even, like the app', () => {
    // 127.5 → 128 either way; 12.5 → 12 only under half-even (half-up says 13)
    const d = composeInsight('training-load-jump', vec('training-load-jump'), EN)!.detail
    expect(d).toContain('weekly average of the preceding 28 days is 128 min — a ratio of 1.9')
    expect(
      composeInsight('steps-weekly-trend', { ...vec('steps-weekly-trend'), changePct: 12.5 }, EN)!.title,
    ).toContain('is 12% more')
  })

  it('efficiency and baseline drift name their activity / metric', () => {
    expect(composeInsight('efficiency-trend-running', vec('efficiency-trend-running'), HU)!.title).toBe(
      'Futásnál ugyanakkora pulzus mellett gyorsabb vagy, mint egy hónapja',
    )
    expect(composeInsight('efficiency-trend-running', vec('efficiency-trend-running'), EN)!.detail).toContain(
      'the average speed was 12.0 km/h at an average heart rate of 150.0 bpm',
    )
    expect(composeInsight('baseline-drift-bodyMass', vec('baseline-drift-bodyMass'), HU)!.title).toBe(
      'A testtömeged alapvonala nagyjából 3 hónap alatt 4,0 kg-mal lejjebb csúszott',
    )
    expect(
      composeInsight('baseline-drift-sleepDuration', REALISTIC['baseline-drift-sleepDuration'], EN)!.title,
    ).toBe('Your sleep duration baseline has drifted lower by 51 min over roughly 3 months')
  })

  it('correlation states its uncertainty, and says nothing about it at r = 1', () => {
    const perfect = composeInsight('steps-sleep-correlation', vec('steps-sleep-correlation'), EN)!
    expect(perfect.detail).toContain('a correlation of +1.00 over 28 days')
    expect(perfect.detail).not.toContain('true strength')

    const real = composeInsight('steps-sleep-correlation', { r: -0.62, pairs: 41 }, EN)!
    expect(real.title).toBe('Busier days are followed by shorter sleep')
    expect(real.detail).toMatch(/true strength could be anywhere between -0\.78 and -0\.39/)

    const tight = composeInsight('steps-sleep-correlation', { r: 0.8, pairs: 60 }, HU)!
    expect(tight.detail).toMatch(/a valódi erősség \+0,69 és \+0,88 között van\.$/)
  })
})

describe('falling back to the server sentence', () => {
  const server: Insight = {
    id: 'brand-new-rule:2026-10-28',
    rule: 'brand-new-rule',
    values: { x: 1 },
    title: 'Egy új szabály mondata',
    detail: 'A szerver magyarul fogalmazott.',
  }

  it('an unknown rule keeps the server wording, marked as fallback', () => {
    expect(insightText(server, EN)).toEqual({
      title: 'Egy új szabály mondata',
      detail: 'A szerver magyarul fogalmazott.',
      fallback: true,
    })
  })

  it('a known rule with a missing or non-finite value falls back too, not half a sentence', () => {
    const { recent: _drop, ...partial } = REALISTIC['resting-hr-elevated']
    void _drop
    expect(composeInsight('resting-hr-elevated', partial, EN)).toBeNull()
    expect(
      composeInsight('resting-hr-elevated', { ...REALISTIC['resting-hr-elevated'], recent: NaN }, EN),
    ).toBeNull()
    expect(insightText({ ...server, rule: 'resting-hr-elevated', values: partial }, EN).fallback).toBe(true)
  })

  it('no values at all (an old server) falls back', () => {
    expect(insightText({ ...server, rule: 'sleep-debt', values: undefined }, EN).fallback).toBe(true)
  })

  it('a known rule is worded in the interface language and is not a fallback', () => {
    const text = insightText(
      { id: 'sleep-debt:2026-10-28', rule: 'sleep-debt', values: REALISTIC['sleep-debt'], title: 'X' },
      EN,
    )
    expect(text.fallback).toBe(false)
    expect(text.title).toBe('Your last 14 nights fell 7 hr 30 min short of your usual in total')
  })

  it('without a `rule` field the stem is recovered from the id', () => {
    expect(ruleFromId('baseline-drift-bodyMass:2026-08-11')).toBe('baseline-drift-bodyMass')
    expect(ruleFromId('no-day')).toBeUndefined()
    const text = insightText(
      { id: 'steps-weekend:2026-08-11', values: REALISTIC['steps-weekend'] },
      HU,
    )
    expect(text.fallback).toBe(false)
  })

  it('a prototype key is not a rule', () => {
    expect(composeInsight('toString', {}, EN)).toBeNull()
  })
})

describe('the number shapes', () => {
  it('splits hours like the app: 7.999 h is 8 h flat', () => {
    expect(splitHours(7.999)).toEqual({ h: 8, m: 0 })
    expect(splitHours(6.4)).toEqual({ h: 6, m: 24 })
  })

  it('wraps a clock reading both ways', () => {
    expect(clock(1590)).toBe('02:30')
    expect(clock(-30)).toBe('23:30')
  })

  it('has no interval where it cannot state one', () => {
    expect(fisherInterval(1, 28)).toBeNull()
    expect(fisherInterval(0.6, 3)).toBeNull()
  })
})
