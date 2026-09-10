// Back, forward, and which window is on screen — the web's copy of
// `TrendsContent.periodStepper`.
//
// ⚠️ **Forward stops at the present.** The window after this one has not
// happened, and an empty chart of next week is indistinguishable from a sync
// that stopped. The arrow is disabled rather than hidden, so that the edge of
// the data is something you can feel rather than something you discover.
//
// ⚠️ **The label is dates, never "two weeks ago".** Four taps back on the month
// view is a place, and the reader has to be able to tell which one — and to tell
// it apart from the same chart a week later.

import type { Range } from '../api/types'
import { useI18n } from '../i18n'
import type { UiKey } from '../i18n'
import type { TrendWindow } from '../lib/window'
import { calendarWindowName, windowDates } from '../lib/windowLabel'

const ROLLING_NAME: Record<Range, UiKey> = {
  day: 'trends.window.day',
  week: 'trends.window.week',
  month: 'trends.window.month',
  year: 'trends.window.year',
}

export function PeriodStepper({
  window: win,
  range,
  canStepForward,
  isBrowsing,
  onBack,
  onForward,
  onNow,
}: {
  window: TrendWindow
  range: Range
  canStepForward: boolean
  isBrowsing: boolean
  onBack: () => void
  onForward: () => void
  onNow: () => void
}) {
  const { t, locale } = useI18n()
  const name =
    win.kind === 'calendar' ? calendarWindowName(win, range, locale) : t(ROLLING_NAME[range])

  return (
    <div className="stepper">
      <button type="button" className="step" onClick={onBack} aria-label={t('trends.step.back')}>
        <Chevron dir="left" />
      </button>

      <div className="stepper-label">
        <strong>{name}</strong>
        {/* ⚠️ Not decoration under the name. A running month is cut off at
            today, so "August 2026" is covering the 1st to the 27th; and a
            rolling window's dates are the only thing that says which stretch it
            is at all. */}
        <span className="subtle">{windowDates(win, range, locale)}</span>
        {isBrowsing && (
          <button type="button" className="linkish" onClick={onNow}>
            {t('trends.step.now')}
          </button>
        )}
      </div>

      <button
        type="button"
        className="step"
        onClick={onForward}
        disabled={!canStepForward}
        aria-label={t('trends.step.forward')}
      >
        <Chevron dir="right" />
      </button>
    </div>
  )
}

/** Drawn rather than typed: "‹" and "›" are punctuation to a screen reader, and
 * the arrows already carry their names on the buttons. */
function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d={dir === 'left' ? 'M10 3 L5 8 L10 13' : 'M6 3 L11 8 L6 13'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
