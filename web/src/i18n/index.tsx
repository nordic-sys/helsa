// The translation layer.
//
// Deliberately hand-rolled rather than i18next & friends: this is one bundle,
// two languages and a few hundred keys, with no lazy-loaded namespaces, no
// gender and no ordinals to model. A typed record plus `Intl` covers all of it
// in a fraction of the weight — and gives compile-time key checking, which the
// runtime-string libraries do not.
//
// What `Intl` handles rather than us: number grouping and decimals, dates,
// relative time and plural category selection (see `lib/format.ts`).

import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { en } from './en'
import { hu } from './hu'
import type { Dict, GroupKey, Lang, PluralKey, UiKey } from './types'

export type { Lang, UiKey } from './types'

const DICTS: Record<Lang, Dict> = { hu, en }

/** The BCP 47 tag handed to `Intl`. */
const LOCALES: Record<Lang, string> = { hu: 'hu-HU', en: 'en-US' }

export const LANGS: Lang[] = ['hu', 'en']

const STORAGE_KEY = 'helsa.lang'

type Params = Record<string, string | number>

/**
 * The starting language: an earlier choice wins, otherwise the browser's
 * preference decides. Anything that is neither Hungarian nor English lands on
 * English — that is the one the repository is public in.
 */
export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'hu' || saved === 'en') return saved
  } catch {
    /* storage can be blocked (private mode); the browser preference still works */
  }
  const prefs = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const pref of prefs) {
    const base = pref?.toLowerCase().split('-')[0]
    if (base === 'hu' || base === 'en') return base
  }
  return 'en'
}

/** `"{n} éjszaka"` + `{ n: 7 }` → `"7 éjszaka"`. */
function interpolate(template: string, params?: Params): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  )
}

/** The same, but the placeholders are React nodes — for a sentence with a
 * `<code>` or a `<strong>` in the middle of it. */
function interpolateNodes(template: string, nodes: Record<string, ReactNode>): ReactNode {
  const parts = template.split(/\{(\w+)\}/g)
  // split() with one capture group alternates: text, name, text, name, …
  return parts.map((part, i) => (
    <Fragment key={i}>{i % 2 === 1 ? (nodes[part] ?? `{${part}}`) : part}</Fragment>
  ))
}

/** `dietaryVitaminB12` → `Dietary vitamin b12` — for types outside the catalog. */
function humanize(key: string): string {
  const s = key.replace(/([A-Z])/g, ' $1').trim()
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

export type I18n = {
  lang: Lang
  setLang: (lang: Lang) => void
  /** The BCP 47 tag for `Intl`. */
  locale: string
  /** A plain UI string, with optional `{placeholder}` substitution. */
  t: (key: UiKey, params?: Params) => string
  /** A count-dependent string; the category comes from `Intl.PluralRules`. */
  tp: (key: PluralKey, n: number, params?: Params) => string
  /** A string whose `{placeholders}` are React nodes. */
  tx: (key: UiKey, nodes: Record<string, ReactNode>) => ReactNode
  /** A metric's display name; unknown wire names fall back to a readable form. */
  tMetric: (key: string) => string
  tGroup: (key: GroupKey) => string
  tActivity: (key?: string) => string
  tStage: (key?: string) => string
  /** A unit token (`count/min`, `min`, …) in the current language; anything
   * unknown — `kcal`, `mg`, `°C` — is printed as it arrived. */
  tUnit: (unit?: string) => string
}

const I18nContext = createContext<I18n | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang)

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* the choice still holds for this session */
    }
  }, [])

  // Screen readers and the browser's own hyphenation both go by this.
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const value = useMemo<I18n>(() => {
    const dict = DICTS[lang]
    const locale = LOCALES[lang]
    const plural = new Intl.PluralRules(locale)
    const lookup = (table: Record<string, string>, key?: string): string | undefined =>
      key == null ? undefined : (table as Record<string, string | undefined>)[key]

    return {
      lang,
      setLang,
      locale,
      t: (key, params) => interpolate(dict.ui[key], params),
      tp: (key, n, params) => {
        const form = `${key}.${plural.select(n)}` as UiKey
        const template = dict.ui[form] ?? dict.ui[`${key}.other` as UiKey]
        return interpolate(template, { n, ...params })
      },
      tx: (key, nodes) => interpolateNodes(dict.ui[key], nodes),
      tMetric: (key) => lookup(dict.metric, key) ?? humanize(key),
      tGroup: (key) => lookup(dict.group, key) ?? key,
      tActivity: (key) => (key ? (lookup(dict.activity, key) ?? key) : '–'),
      tStage: (key) => (key ? (lookup(dict.stage, key) ?? key) : '–'),
      tUnit: (unit) => (unit ? (lookup(dict.unit, unit) ?? unit) : ''),
    }
  }, [lang, setLang])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>')
  return ctx
}
