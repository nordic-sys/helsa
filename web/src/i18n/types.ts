// The types the dictionaries and the catalog are checked against.
//
// Kept apart from `index.tsx` so that `lib/metrics.ts` can import `MetricKey`
// without dragging React in — and so there is no import cycle between the
// catalog and the translation layer.

import type { hu } from './hu'

export type Lang = 'hu' | 'en'

/** The shape every dictionary has to fill in. */
export type Dict = typeof hu

/** Every plain UI string key — `t('sleep.title')` accepts exactly these. */
export type UiKey = keyof Dict['ui']

/**
 * The base of a plural pair: `sleep.window` for the `sleep.window.one` /
 * `sleep.window.other` couple. Derived, so adding a pair to the dictionary is
 * enough to make `tp()` accept it.
 */
type StripOther<K> = K extends `${infer B}.other` ? B : never
export type PluralKey = StripOther<UiKey>

export type MetricKey = keyof Dict['metric']
export type GroupKey = keyof Dict['group']
