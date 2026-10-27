// The weekday grid, drawn — the web's `DayValueGridView`
// (`HelsaKit/Sources/HelsaKit/UI/Components/DayValueGrid.swift`).
//
// One component for both places the phone draws it: a month's steps behind a
// medal, and a metric's days on Trends. Two copies would drift, and the
// empty-cell rule and the peak scaling are decisions, not styling (the app moved
// its step grid onto the shared layout for exactly that reason).
//
// ⚠️ **An unmeasured day is an empty cell with a dash, never a zero-height
// bar**, and it says "no data" to a screen reader. Fill AND height carry a
// highlighted day's state, never colour alone (docs/14 §8).
//
// ⚠️ The number under each bar is the EXACT one, shrunk to fit — not "8.4k".
// Reading off what a given day actually was is the thing the grid is for.

import { useI18n } from '../i18n'
import { barFraction, type DayGrid as Grid } from '../lib/dayGrid'

export type DayGridStyle = {
  /** The number printed under the bar. */
  format: (v: number) => string
  /** What a screen reader hears for a measured day. */
  spoken: (v: number) => string
  /** Days that get the solid fill (a step goal met). Absent = nothing to emphasise. */
  isHighlighted?: (v: number) => boolean
  tint: string
  highlightTint?: string
}

export function DayGrid({ grid, style }: { grid: Grid; style: DayGridStyle }) {
  const { t, tp, locale } = useI18n()
  const dayLabel = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })

  return (
    <div>
      <div className="daygrid" role="list" aria-label={t('daygrid.aria')}>
        {grid.weekdayLabels.map((w, i) => (
          <span key={`weekday-${i}`} className="daygrid-head" aria-hidden="true">
            {w}
          </span>
        ))}
        {Array.from({ length: grid.leadingBlanks }, (_, i) => (
          <span key={`blank-${i}`} aria-hidden="true" />
        ))}
        {grid.cells.map((c) => {
          const measured = c.value != null
          const hi = measured && style.isHighlighted ? style.isHighlighted(c.value as number) : false
          const fraction = barFraction(c.value, grid.peak)
          return (
            <div
              key={`day-${c.date.getTime()}`}
              className="daygrid-cell"
              role="listitem"
              aria-label={`${dayLabel.format(c.date)}: ${
                measured ? style.spoken(c.value as number) : t('daygrid.noData')
              }`}
              data-measured={measured || undefined}
              data-highlighted={hi || undefined}
            >
              <span className="daygrid-day" aria-hidden="true">
                {c.dayOfMonth}
              </span>
              <span className="daygrid-track" aria-hidden="true">
                {measured && (
                  <span
                    className="daygrid-bar"
                    style={{
                      // At least 2px, so a measured small value is still visibly
                      // a measurement and not an empty cell.
                      height: `max(${(fraction * 100).toFixed(1)}%, 2px)`,
                      background: hi ? (style.highlightTint ?? 'var(--helsa-move)') : style.tint,
                      opacity: hi ? 1 : 0.55,
                    }}
                  />
                )}
              </span>
              <span className={measured ? 'daygrid-value' : 'daygrid-value daygrid-none'} aria-hidden="true">
                {measured ? style.format(c.value as number) : '—'}
              </span>
            </div>
          )
        })}
      </div>
      {grid.gapCount > 0 && (
        // ⚠️ Named, not left to be inferred from empty cells: four blanks could be
        // lazy days or days the phone stayed home, and we know which.
        <p className="subtle" style={{ margin: '8px 0 0' }}>
          {tp('daygrid.gaps', grid.gapCount)}
        </p>
      )}
    </div>
  )
}
