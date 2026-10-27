// A closed month's medal, opened up — the arithmetic behind the web's port of
// `HelsaKit/Sources/HelsaKit/Achievements/MonthMedalDetailView.swift`.
//
// ⚠️ **The medal's own numbers are the truth here, not today's.** The total and
// the milestones come from the badge (`value`, `thresholds`), which carries the
// thresholds in force when it was earned. Only the day-by-day breakdown is
// fetched, because that is the one thing a medal does not store — and when that
// read fails, nothing else on the page is affected.

import type { Achievement, ChallengeDay } from '../api/types'
import { localDay } from './dayGrid'

const MONTH = /^(\d{4})-(\d{2})$/

/** `YYYY-MM` → `[year, month]`, or `null` for anything that is not a month. */
export function parseMonth(period: string | undefined): [number, number] | null {
  const m = period ? MONTH.exec(period) : null
  if (!m) return null
  const month = Number(m[2])
  return month >= 1 && month <= 12 ? [Number(m[1]), month] : null
}

/** 28…31, leap years included — a calendar fact. */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

/**
 * The monthly medal for `month`, if there is one.
 *
 * The phone mints ONE `kind: month` badge per closed month (`complete` or
 * `progress`, `AchievementRules.swift`); a best-month badge is a `record` and
 * is not this. Should two ever arrive for one month, the one carrying
 * thresholds wins, because it is the one whose milestones can be shown.
 */
export function monthMedal(items: Achievement[], month: string): Achievement | null {
  const candidates = items.filter((a) => a.kind === 'month' && a.period === month)
  return candidates.find((a) => (a.thresholds?.length ?? 0) > 0) ?? candidates[0] ?? null
}

/** Whether a row of the medals table opens a month: a monthly badge with a real
 * `YYYY-MM` period. Anything else has no month to open. */
export function opensMonth(a: Achievement): boolean {
  return a.kind === 'month' && parseMonth(a.period) != null
}

/**
 * The daily step target, derived from the MONTHLY goal — `DailyStreakRules.dailyGoal`
 * in `HelsaKit/Sources/HelsaKit/Challenge/DailyStreak.swift`, exactly:
 * the largest milestone over the days of the month, rounded, at least 1.
 *
 * Deliberately not a second setting: the pace that finishes the month IS the
 * daily goal. `null` without milestones — nothing to measure a day against.
 * (Swift's `.rounded()` is half-away-from-zero; for these positive numbers that
 * is what `Math.round` does too.)
 */
export function dailyGoal(thresholds: number[] | undefined, dayCount: number): number | null {
  if (!thresholds?.length || dayCount <= 0) return null
  const goal = Math.max(...thresholds)
  return Math.max(Math.round(goal / dayCount), 1)
}

/**
 * The medal's total spread over the WHOLE month (`AchievementDisplay.monthStepsPerDay`
 * and `MonthlyChallengeProgress.stepsPerDay` for a closed month).
 *
 * ⚠️ The whole month, not the measured days: a medal is only minted for a
 * closed month, and its total is a whole-month total too. `null` without a value
 * — never zero.
 */
export function perDayOverMonth(value: number | undefined, dayCount: number): number | null {
  if (value == null || value < 0 || dayCount <= 0) return null
  return value / dayCount
}

export type MonthDays = {
  days: { date: Date; value: number | null }[]
  measuredCount: number
  /** The average of the days that CARRIED a measurement — a different
   * denominator from `perDayOverMonth`, and the page labels both. */
  measuredAverage: number | null
  best: { date: Date; steps: number } | null
}

/**
 * The challenge's days as grid rows, plus what the app prints above its grid
 * (`MonthStepCalendar.measuredAverage`, `.bestDay`, `.gapCount`).
 *
 * ⚠️ A day with no `steps` stays `null`. A grid drawn from zeros would show a
 * fortnight of "you did nothing" for a fortnight the phone stayed at home.
 * Days of another month (should the server ever send one) are dropped, and
 * days are not invented beyond what the server sent: it leaves out days that
 * have not happened yet, on purpose.
 */
export function monthDays(days: ChallengeDay[], month: string): MonthDays {
  const rows = days
    .filter((d) => d.day.slice(0, 7) === month)
    .map((d) => ({ date: localDay(d.day), value: d.steps ?? null }))
    .sort((a, b) => a.date.getTime() - b.date.getTime())
  const measured = rows.filter((r) => r.value != null) as { date: Date; value: number }[]
  let best: MonthDays['best'] = null
  for (const r of measured) if (!best || r.value > best.steps) best = { date: r.date, steps: r.value }
  return {
    days: rows,
    measuredCount: measured.length,
    measuredAverage: measured.length
      ? measured.reduce((s, r) => s + r.value, 0) / measured.length
      : null,
    best,
  }
}

/** The badge's milestones, each marked reached by the badge's OWN value. */
export function medalMilestones(a: Achievement): { steps: number; reached: boolean }[] | null {
  if (!a.thresholds?.length || a.value == null) return null
  return [...a.thresholds].sort((x, y) => x - y).map((steps) => ({ steps, reached: a.value! >= steps }))
}
