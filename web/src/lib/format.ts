// Formatters.
//
// ⚠️ Everything here is USER-FACING, so all of it is language-dependent — not
// just the words but the numbers too. `1 234,6` and `1,234.6` are the same
// value; `2026. 08. 11.` and `Aug 11, 2026` are the same day. That is why the
// formatting goes through `Intl` rather than through hand-rolled string
// surgery, and why it hangs off a hook: the locale comes from the i18n context.
//
// Switching unit systems (metric/imperial) will hang off /v1/settings (docs/20
// B4) — for now everything is metric.

import { useMemo } from 'react'
import { useI18n } from '../i18n'

/** What we print where there is no value. */
const DASH = '–'

export type Formatters = {
  /** A whole number: `1234.56` → "1 235". */
  num: (v?: number | null) => string
  /** One decimal: `1234.56` → "1 234,6". */
  num1: (v?: number | null) => string
  /** A decimal-aware number. `fmt(1234.56, 1)` → "1 234,6". */
  fmt: (v?: number | null, digits?: number) => string
  /** A ratio in 0..1 → "63%". */
  percent: (v?: number | null, digits?: number) => string
  /** Metres, promoted to km once it is worth it. */
  km: (meters?: number | null) => string
  /** Minutes → "1 ó 24 p", "2 óra", "45 p". */
  duration: (minutes?: number | null) => string
  durationBetween: (a?: string, b?: string) => string
  /** A full date: "2026. aug. 11." / "Aug 11, 2026". */
  date: (iso?: string) => string
  dateTime: (iso?: string) => string
  time: (iso?: string) => string
  /** Chart-axis forms: no year, and only as much precision as a tick can hold. */
  monthDay: (iso?: string) => string
  yearMonth: (iso?: string) => string
  hourMinute: (iso?: string) => string
  /** "3 perccel ezelőtt", "tegnap" — for showing how fresh the sync is. */
  relative: (iso?: string) => string
  /** A unit token in the current language. */
  unit: (unit?: string) => string
  /** A HealthKit workout type. */
  activityName: (type?: string) => string
  /** A sleep stage. */
  stageName: (stage?: string) => string
}

export function useFormat(): Formatters {
  const { locale, t, tUnit, tActivity, tStage } = useI18n()

  return useMemo<Formatters>(() => {
    // The useful precision differs per metric: on a step count a decimal is
    // noise, while for copper (mg) a whole number would swallow everything. The
    // catalog says how many decimals are needed (metrics.ts → MetricDef.digits).
    const numberFormats = new Map<number, Intl.NumberFormat>()
    const nf = (digits: number): Intl.NumberFormat => {
      let f = numberFormats.get(digits)
      if (!f) {
        f = new Intl.NumberFormat(locale, { maximumFractionDigits: digits })
        numberFormats.set(digits, f)
      }
      return f
    }

    const dateFmt = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
    const dateTimeFmt = new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    const timeFmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' })
    const monthDayFmt = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' })
    const yearMonthFmt = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short' })
    // `numeric: 'auto'` is what turns -1 day into "tegnap" / "yesterday" instead
    // of "1 nappal ezelőtt".
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })

    const fmt = (v?: number | null, digits = 0) => (v == null ? DASH : nf(digits).format(v))

    /**
     * Guards every date formatter: an absent or unparseable ISO string prints a
     * dash.
     *
     * ⚠️ A date-only string is parsed as LOCAL midnight, not UTC. `new
     * Date('2026-08-11')` means UTC midnight per spec, which west of Greenwich
     * renders as the 10th — and the dates we get in this form (a night's key, a
     * summary's `from`) are calendar days on the user's own clock.
     */
    const on = (iso: string | undefined, f: Intl.DateTimeFormat): string => {
      if (!iso) return DASH
      const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
      const d = dateOnly
        ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
        : new Date(iso)
      return Number.isNaN(d.getTime()) ? DASH : f.format(d)
    }

    const duration = (minutes?: number | null): string => {
      if (minutes == null) return DASH
      const m = Math.round(minutes)
      const h = Math.floor(m / 60)
      const rest = m % 60
      if (h === 0) return t('duration.m', { m: rest })
      // On a whole hour, do not print "0 p".
      return rest === 0 ? t('duration.h', { h }) : t('duration.hm', { h, m: rest })
    }

    return {
      num: (v) => fmt(v, 0),
      num1: (v) => fmt(v, 1),
      fmt,
      percent: (v, digits = 0) =>
        v == null || !Number.isFinite(v) ? DASH : `${nf(digits).format(v * 100)}%`,
      km: (meters) => {
        if (meters == null) return DASH
        return meters >= 1000
          ? `${nf(1).format(meters / 1000)} km`
          : `${nf(0).format(meters)} m`
      },
      duration,
      durationBetween: (a, b) => {
        if (!a || !b) return DASH
        return duration((new Date(b).getTime() - new Date(a).getTime()) / 60000)
      },
      date: (iso) => on(iso, dateFmt),
      dateTime: (iso) => on(iso, dateTimeFmt),
      time: (iso) => on(iso, timeFmt),
      monthDay: (iso) => on(iso, monthDayFmt),
      yearMonth: (iso) => on(iso, yearMonthFmt),
      hourMinute: (iso) => on(iso, timeFmt),
      relative: (iso) => {
        if (!iso) return t('relative.never')
        const diff = Date.now() - new Date(iso).getTime()
        const min = Math.round(diff / 60000)
        if (min < 1) return t('relative.now')
        if (min < 60) return rtf.format(-min, 'minute')
        const h = Math.round(min / 60)
        if (h < 24) return rtf.format(-h, 'hour')
        return rtf.format(-Math.round(h / 24), 'day')
      },
      unit: tUnit,
      activityName: tActivity,
      stageName: tStage,
    }
  }, [locale, t, tUnit, tActivity, tStage])
}

/** The drawing order of the stages: from deep sleep to being awake. */
export const STAGE_ORDER = ['deep', 'rem', 'core', 'light', 'asleep', 'awake']

/** Does it count as sleep? (Efficiency and total sleep time are built from these.) */
export const isAsleep = (stage?: string) => !!stage && stage !== 'awake' && stage !== 'inBed'

/**
 * A Recharts-friendly stage palette. `color-mix()` is reliable as an HTML
 * `background`, but not everywhere as an SVG presentation attribute — so in the
 * charts a base colour plus an opacity produces the same gradation.
 */
export const STAGE_CHART: Record<string, { fill: string; opacity: number }> = {
  deep: { fill: 'var(--helsa-nordlys)', opacity: 1 },
  rem: { fill: 'var(--helsa-fjord)', opacity: 1 },
  core: { fill: 'var(--helsa-nordlys)', opacity: 0.55 },
  light: { fill: 'var(--helsa-nordlys)', opacity: 0.35 },
  asleep: { fill: 'var(--helsa-nordlys)', opacity: 0.75 },
  awake: { fill: 'var(--helsa-ember)', opacity: 1 },
}

export const STAGE_COLOR: Record<string, string> = {
  deep: 'var(--helsa-nordlys)',
  rem: 'var(--helsa-fjord)',
  core: 'color-mix(in srgb, var(--helsa-nordlys) 55%, var(--surface))',
  light: 'color-mix(in srgb, var(--helsa-nordlys) 40%, var(--surface))',
  asleep: 'color-mix(in srgb, var(--helsa-nordlys) 75%, var(--surface))',
  awake: 'var(--helsa-ember)',
}

// The metric catalog (name, unit, group, colour, aggregation) lives in
// lib/metrics.ts — that one is not about five metrics but about the whole
// HealthKit quantity list. The display NAMES for it live in src/i18n/.
