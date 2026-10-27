// Year by year — the chosen measurements, each calendar year beside the others.
//
// The web's copy of the phone's long view (`HelsaKit/Sources/HelsaKit/Retrospective/`).
// The rules live in `lib/longView.ts`; this file lays them out.
//
// # What changes on the way from the phone
//
// * **No button, no progress bar, no stop.** On the phone a five-year sweep is
//   minutes of battery on a device in somebody's hand, so it is something a
//   person presses and can interrupt (`RetrospectiveViewModel`). On the server it
//   is one query over rows that are already there, so the page simply shows it.
// * **The years stand side by side.** The phone lists them one under another
//   because that is what fits; at 1440 every year is a column, and a metric
//   reads left to right as the line of its own history.
// * **The picker is the web's own.** The phone's choice is mirrored through
//   iCloud between its devices; the web keeps its own in this browser
//   (`lib/longView.ts`, `SELECTION_KEY`). They start from the same
//   recommendation and may drift apart, and that is fine: they are two screens'
//   preferences, not two copies of one fact.

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api, browserTz } from '../api/client'
import { Card, Empty, ErrorState, Loading, Note, PageHead } from '../components/ui'
import { useI18n } from '../i18n'
import { useFormat } from '../lib/format'
import {
  MIN_MEASURED_MONTHS,
  buildRows,
  change,
  columnYears,
  isFullySelected,
  isRecommended,
  keysIn,
  loadSelection,
  longViewWindow,
  measuredYears,
  orderByCatalogue,
  saveSelection,
  selectAll,
  selectedCount,
  spanText,
  toggle,
  toggleGroup,
  wireNames,
  RECOMMENDED,
  type LongViewRow,
  type YearFigure,
} from '../lib/longView'
import { METRIC_GROUPS, metricDef, type MetricGroupKey } from '../lib/metrics'
import { periodValue } from '../lib/periodSummary'
import { useAvailability, type Availability } from '../lib/useAvailability'
import { useToday } from '../lib/useToday'
import '../styles/summary.css'

export default function YearByYear() {
  const tz = browserTz()
  const { t, tMetric } = useI18n()
  const today = useToday()
  const availability = useAvailability()

  const [selection, setSelectionState] = useState<string[]>(loadSelection)
  function setSelection(next: string[]) {
    setSelectionState(next)
    saveSelection(next)
  }

  const win = useMemo(() => longViewWindow(new Date()), [today])

  /**
   * ONE request for every year (see `lib/longView.ts`). The keys travel with
   * the answer, so the rows are built from what was ASKED, never from a
   * selection that has moved on while the answer was in flight.
   */
  const q = useQuery({
    queryKey: ['years', tz, win.from, win.to, selection.join(',')],
    queryFn: async () => {
      const keys = [...selection]
      const data = await api.summary('year', wireNames(keys), tz, win.from, win.to)
      return { keys, data }
    },
    enabled: selection.length > 0,
    placeholderData: keepPreviousData,
  })

  const rows = useMemo(
    () => (q.data ? buildRows(q.data.keys.map(metricDef), q.data.data, new Date()) : []),
    [q.data, today],
  )
  const years = useMemo(() => columnYears(rows, new Date()), [rows, today])
  const span = spanText(measuredYears(rows))
  const withData = rows.filter((r) => r.years.some((y) => y.measuredMonths > 0))
  const without = rows.filter((r) => !r.years.some((y) => y.measuredMonths > 0))
  const thisYear = new Date().getFullYear()

  return (
    <>
      <PageHead title={t('years.title')} subtitle={t('years.subtitle')} />

      <div className="trends-layout">
        <aside className="card picker-panel" aria-label={t('years.picker.title')}>
          <SelectionPicker selection={selection} onChange={setSelection} availability={availability} />
        </aside>

        <div className="sections" style={{ minWidth: 0 }}>
          {selection.length === 0 ? (
            <Empty title={t('years.none.title')} hint={t('years.none.hint')} />
          ) : q.isLoading ? (
            <Loading rows={3} />
          ) : q.isError ? (
            <ErrorState error={q.error} />
          ) : years.length === 0 ? (
            <Empty title={t('years.empty.title')} hint={t('years.empty.hint', { min: MIN_MEASURED_MONTHS })} />
          ) : (
            <>
              {/* ⚠️ The span FOUND, never the span asked for: a watch three years
                  old has two empty years in a five-year question. */}
              <div>
                <p className="years-span" data-testid="years-span">
                  {t('years.span', { span: span ?? '' })}
                </p>
                <p className="subtle" style={{ margin: '4px 0 0' }}>
                  {t('years.partial')}
                </p>
              </div>

              <section className="card" aria-label={t('years.table.aria')}>
                <p className="chart-status" role="status">
                  {q.isFetching ? t('trends.loading') : ''}
                </p>
                <div className="table-wrap">
                  <table className="years-table">
                    <thead>
                      <tr>
                        <th scope="col">{t('years.table.metric')}</th>
                        {years.map((y) => (
                          <th key={y} scope="col" className="num">
                            {y}
                            {y === thisYear && <span className="years-sofar">{t('years.table.soFar')}</span>}
                          </th>
                        ))}
                        <th scope="col" className="num">
                          {t('years.table.change')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {withData.map((r) => (
                        <Row key={r.def.key} row={r} years={years} />
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="subtle" style={{ margin: '10px 0 0' }}>
                  {t('years.table.legend', { min: MIN_MEASURED_MONTHS })}
                </p>
              </section>

              {without.length > 0 && (
                <p className="subtle" style={{ margin: 0 }} data-testid="years-without">
                  {t('years.noDataFor', { list: without.map((r) => tMetric(r.def.key)).join(', ') })}
                </p>
              )}

              {rows.some((r) => r.degraded) && (
                <Note title={t('trends.degraded.title')}>{t('years.degraded')}</Note>
              )}

              <div className="grid grid-2">
                <Card title={t('trends.sources.title')}>
                  <p style={{ margin: 0, fontSize: 14, color: 'var(--text-2)' }}>{t('trends.sources.body')}</p>
                </Card>
                <Card title={t('years.why.title')}>
                  <p style={{ margin: 0, fontSize: 14, color: 'var(--text-2)' }}>{t('years.why.body')}</p>
                  <p style={{ margin: '8px 0 0' }}>
                    <Link className="linkish" to="/period">
                      {t('years.toPeriod')}
                    </Link>
                  </p>
                </Card>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

/** "+12%" / "−4%" — a minus sign, not a hyphen. */
function signedPercent(ratio: number): string {
  const p = Math.round(ratio * 100)
  return p > 0 ? `+${p}%` : p < 0 ? `−${Math.abs(p)}%` : '0%'
}

function Row({ row, years }: { row: LongViewRow; years: number[] }) {
  const { t, tMetric } = useI18n()
  const byYear = new Map(row.years.map((y) => [y.year, y]))
  // The bar under each figure is scaled to the row's own largest year: it is
  // the shape of one metric's history, never a comparison between metrics.
  const max = Math.max(0, ...row.years.map((y) => y.value ?? 0))
  const c = change(row)
  return (
    <tr>
      <th scope="row">
        <span className="years-metric">
          <span className="dot" aria-hidden="true" style={{ background: row.def.color }} />
          {tMetric(row.def.key)}
        </span>
        {/* What the figure IS, said on every row: an average month for a summed
            metric, an average level for an averaged one. */}
        <span className="years-kind">{row.agg === 'sum' ? t('years.kind.sum') : t('years.kind.avg')}</span>
      </th>
      {years.map((y) => (
        <Cell key={y} fig={byYear.get(y)} row={row} max={max} />
      ))}
      <td className="num">
        {c == null ? (
          <span className="subtle">–</span>
        ) : (
          <span title={t('years.change.title', { from: c.from, to: c.to })}>
            {signedPercent(c.ratio)}
            {c.uneven && (
              <span className="years-flag" data-testid="years-uneven">
                {t('years.change.uneven')}
              </span>
            )}
          </span>
        )}
      </td>
    </tr>
  )
}

function Cell({ fig, row, max }: { fig?: YearFigure; row: LongViewRow; max: number }) {
  const { t, tp } = useI18n()
  const f = useFormat()
  if (!fig || fig.measuredMonths === 0) {
    return (
      <td className="num">
        <span className="subtle" aria-label={t('years.cell.none')}>
          –
        </span>
      </td>
    )
  }
  if (fig.value == null) {
    // ⚠️ Below three months the year gets no figure — but it is not hidden:
    // "two months" is a fact about the history worth seeing.
    return (
      <td className="num">
        <span className="subtle">–</span>
        <span className="years-months">{tp('years.cell.tooFew', fig.measuredMonths)}</span>
      </td>
    )
  }
  const v = periodValue(fig.value, row.unit, row.def.digits, f)
  return (
    <td className="num">
      <span className="years-value">
        {v.value}
        {v.unit && <small> {v.unit}</small>}
      </span>
      <span className="years-bar" aria-hidden="true">
        <span style={{ width: `${max > 0 ? Math.max(2, (fig.value / max) * 100) : 0}%`, background: row.def.color }} />
      </span>
      <span className="years-months">
        {tp('years.cell.months', fig.measuredMonths)}
        {fig.isPartial ? ` ${t('years.cell.ofElapsed', { n: fig.elapsedMonths })}` : ''}
      </span>
    </td>
  )
}

/**
 * The web's picker for the long view: several metrics, by group.
 *
 * A row of checkboxes per group behind a disclosure, with the group's own box
 * beside it — the phone's layout (`RetrospectiveView`): the groups start closed
 * so the whole catalogue fits, and the count beside each one says what is
 * chosen inside while it is shut.
 */
function SelectionPicker({
  selection,
  onChange,
  availability,
}: {
  selection: string[]
  onChange: (next: string[]) => void
  availability: Availability
}) {
  const { t, tGroup, tMetric } = useI18n()
  return (
    <div className="years-picker">
      <h2 className="card-title" style={{ margin: '4px 6px 0' }}>
        {t('years.picker.title')}{' '}
        <span className="subtle" style={{ fontWeight: 400 }}>
          {t('years.picker.count', { n: selection.length })}
        </span>
      </h2>
      <div className="years-picker-actions">
        <button
          type="button"
          className="btn"
          aria-pressed={isRecommended(selection)}
          onClick={() => onChange(orderByCatalogue(RECOMMENDED))}
        >
          {t('years.picker.recommended')}
        </button>
        <button type="button" className="btn" onClick={() => onChange(selectAll())}>
          {t('years.picker.all')}
        </button>
        <button type="button" className="btn" onClick={() => onChange([])} disabled={selection.length === 0}>
          {t('years.picker.clear')}
        </button>
      </div>
      <p className="subtle years-picker-note">{t('years.picker.note')}</p>

      {METRIC_GROUPS.map((g) => (
        <GroupRow
          key={g.key}
          group={g.key}
          label={tGroup(g.key)}
          selection={selection}
          onChange={onChange}
          availability={availability}
          tMetric={tMetric}
          takeLabel={t(isFullySelected(selection, g.key) ? 'years.picker.groupClear' : 'years.picker.groupTake', {
            group: tGroup(g.key),
          })}
        />
      ))}
      <p className="subtle years-picker-note">{t('years.picker.stored')}</p>
    </div>
  )
}

function GroupRow({
  group,
  label,
  selection,
  onChange,
  availability,
  tMetric,
  takeLabel,
}: {
  group: MetricGroupKey
  label: string
  selection: string[]
  onChange: (next: string[]) => void
  availability: Availability
  tMetric: (k: string) => string
  takeLabel: string
}) {
  const keys = keysIn(group)
  const count = selectedCount(selection, group)
  const full = isFullySelected(selection, group)
  return (
    <div className="years-group">
      <input
        type="checkbox"
        checked={full}
        // ⚠️ Half-ticked is drawn as such: a box that looks empty while three of
        // its metrics are chosen would invite the click that throws them away.
        ref={(el) => {
          if (el) el.indeterminate = count > 0 && !full
        }}
        onChange={() => onChange(toggleGroup(selection, group))}
        aria-label={takeLabel}
      />
      <details>
        <summary>
          <span>{label}</span>
          <span className="years-group-count">
            {count}/{keys.length}
          </span>
        </summary>
        <ul>
          {keys.map((k) => (
            <li key={k}>
              <label className={availability.known && !availability.has(k) ? 'dim' : undefined}>
                <input
                  type="checkbox"
                  checked={selection.includes(k)}
                  onChange={() => onChange(toggle(selection, k))}
                />
                <span className="picker-dot" style={{ background: metricDef(k).color }} aria-hidden="true" />
                <span>{tMetric(k)}</span>
              </label>
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
