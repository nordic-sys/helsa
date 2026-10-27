// The water goal on the web — what the phone's water card measures against.
//
// The goal is a decision made on the phone (`HydrationGoal.swift`), uploaded to
// `/v1/settings` from app 1.0 (7) on. This file turns that block, plus the
// latest body mass, into the goal the page shows, by the phone's own rules:
//
//  * **A goal the user chose wins, always.** It is the only one the phone
//    stores, and so the only one it sends.
//  * **Without one, a suggestion from body mass** — 33 ml per kilogram, rounded
//    to 100 ml, inside the 500–6000 bracket (`HydrationGoalSuggestion`). The
//    phone shows the same number, and the page must label it a suggestion with
//    the same "not medical advice" sentence: a suggestion presented as a
//    decision is how an app ends up holding somebody to a figure a formula
//    picked.
//  * **No body mass, no suggestion.** The phone does not fall back to "about two
//    litres", and neither does this: an invented plausible number cannot be told
//    apart from one computed for the person.
//  * **A block the phone never sent is not "no goal".** It is "this server has
//    not been told" — an older phone or server — and the page says that instead.
//
// ⚠️ The constants are the phone's; a change on one side is carried to the
// other, or the web and the phone hold the same person to two different goals.

import type { HydrationSettings } from '../api/types'

export const ML_PER_KG = 33
export const SUGGESTION_ROUNDING_ML = 100
export const MIN_GOAL_ML = 500
export const MAX_GOAL_ML = 6000

export type WaterGoal =
  /** The phone has not sent its hydration block (older phone or server). */
  | { kind: 'unknown' }
  /** Sent, no goal of their own, and no body mass to suggest one from. */
  | { kind: 'none' }
  | { kind: 'chosen'; ml: number }
  | { kind: 'suggested'; ml: number }

const clamp = (ml: number) => Math.min(Math.max(ml, MIN_GOAL_ML), MAX_GOAL_ML)

/** `HydrationGoalSuggestion.milliliters(forBodyMassKilograms:)`. */
export function suggestedGoalMl(bodyMassKg: number | undefined): number | undefined {
  if (bodyMassKg == null || !(bodyMassKg > 0) || !Number.isFinite(bodyMassKg)) return undefined
  const rounded = Math.round((bodyMassKg * ML_PER_KG) / SUGGESTION_ROUNDING_ML) * SUGGESTION_ROUNDING_ML
  return clamp(rounded)
}

/** `HydrationGoalRules.resolve`, plus the web's own "not told" state. */
export function resolveWaterGoal(
  block: HydrationSettings | undefined,
  bodyMassKg: number | undefined,
): WaterGoal {
  if (block == null) return { kind: 'unknown' }
  if (block.goal_ml != null) return { kind: 'chosen', ml: clamp(block.goal_ml) }
  const suggested = suggestedGoalMl(bodyMassKg)
  return suggested == null ? { kind: 'none' } : { kind: 'suggested', ml: suggested }
}

/**
 * A water amount in millilitres, from the unit the server sent. `undefined` for
 * a unit we do not know — comparing it with a goal in millilitres would be a
 * guess, and a wrong one by a factor of a thousand.
 */
export function toMl(value: number | null | undefined, unit: string | undefined): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined
  switch (unit) {
    case 'mL':
    case 'ml':
      return value
    case 'L':
    case 'l':
      return value * 1000
    case 'fl_oz_us':
      return value * 29.5735295625
    default:
      return undefined
  }
}

/** Body mass in kilograms from `/latest`'s unit; `undefined` when unknown. */
export function toKg(value: number | undefined, unit: string | undefined): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined
  if (unit === 'kg' || unit == null) return value
  if (unit === 'lb') return value * 0.45359237
  if (unit === 'g') return value / 1000
  return undefined
}

/**
 * How a run of days stands against the goal. Only days that carry a
 * measurement count — a day with nothing logged is not a day of drinking
 * nothing, and the phone's week strip leaves such a day empty too.
 */
export function daysAtGoal(dailyMl: (number | undefined)[], goalMl: number): { met: number; measured: number } {
  let met = 0
  let measured = 0
  for (const ml of dailyMl) {
    if (ml == null) continue
    measured += 1
    if (ml >= goalMl) met += 1
  }
  return { met, measured }
}
