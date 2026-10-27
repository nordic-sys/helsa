// The health summary — the phone's printable clinical report, from what the
// server holds, printed by the browser.
//
// The web's copy of `ClinicalReportView` + `ClinicalReportPage`
// (`HelsaKit/Sources/HelsaKit/Report/`). The rules are in `lib/report.ts`; this
// file lays them out twice — once as a page, once as a sheet of A4 — and the
// second layout is `styles/report.css`'s `@media print` block.
//
// # Why the browser prints it
//
// `POST /export` has `pdf` in its contract and answers 501: the server does not
// render documents, and teaching it to would mean a headless browser or a PDF
// library on a box whose job is to store samples. Every browser already has a
// print-to-PDF that paginates, embeds fonts and asks about paper — so this page
// IS the PDF export, and the Print button says so.
//
// # What the phone's page has that this one cannot, said on the page
//
// * **The journal** ("Amit feljegyeztem", the marked days) — only when the
//   phone sent it: the journal leaves the phone solely through its opt-in
//   "Journal and events" switch (app 1.0 (7) on, `GET /journal`). Then the
//   section is the phone's `ReportJournal`, coverage line first. Without it the
//   section stays, with one sentence saying why it is empty — a page without it
//   would read as a period in which nothing was noted — and a 404 (an older
//   server) says that instead.
// * **The events** — the heart-rate, loud-environment and walking-steadiness
//   alerts come with the same switch. Falls and unusual blood pressure are put
//   together on the phone (`HealthEventTimeline`) and are never here, and the
//   section says so. The phone's own iPad sentence is the model: "we cannot
//   see" is said, "there were none" only when the server really holds the
//   journal and it has none.
// * **The source marks** ([1], [2]) — the phone asks HealthKit which app wrote
//   each row. The server knows something close (`/coverage` carries the bundle
//   ids per type), but not per window and row the way the key needs it; until it
//   does, the page takes the phone's no-marks path (`ReportSourceIndex == nil`):
//   no marks, no key, and the honesty line that enumerates what self-recorded
//   can mean.
//
// # What the browser gives back
//
// * **No metric cap.** The phone prints at most six measurements because its
//   sheet is a fixed height and an overflow is silent (`ReportMetricSelection.
//   maxMetrics` calls a second page "the proper answer"). The browser paginates,
//   so the cap is gone; what is left is the 40-workout bound, which was never
//   about space.
// * **The honesty block on every sheet** — the phone repeats it because loose
//   sheets get separated. Here it is a table's `<tfoot>`, which Chrome, Safari and
//   Firefox repeat at the foot of every printed page, and the header is its
//   `<thead>`. A `position: fixed` footer repeats too, but it reserves no room
//   and prints over the last rows of each sheet.
//
// # ⛔️ No chart, on purpose
//
// `ClinicalReportPage.swift`: "A sparkline on a page like this invites the eye to
// find a trend, and a trend is an interpretation. Numbers and dates make no
// claim on their own." The page a doctor reads is the last place the web should
// be bolder than the phone. Nor is there colour: on screen the page follows the
// theme, on paper it is black on white with grey rules and nothing else.

import { useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api, browserTz } from '../api/client'
import type { Workout } from '../api/types'
import { Empty, ErrorState, Loading, PageHead } from '../components/ui'
import { useI18n, type UiKey } from '../i18n'
import { useFormat, type Formatters } from '../lib/format'
import { METRICS, METRIC_LIST, metricDef } from '../lib/metrics'
import { periodMeasurement } from '../lib/periodSummary'
import {
  DEFAULT_REPORT_METRICS,
  REPORT_DAYS,
  baselineWindow,
  buildRow,
  changeLine,
  parseReportParams,
  reportDigits,
  reportUnit,
  reportWindow,
  reportWorkouts,
  topChanges,
  type ReportDays,
  type ReportRow,
} from '../lib/report'
import { useAvailability } from '../lib/useAvailability'
import { useToday } from '../lib/useToday'
import { isoDay } from '../lib/window'
import { useWorkoutHistory } from '../lib/workoutHistory'
import { isApiTooOld } from '../lib/ingest'
import {
  SUMMARY_MAX_ENTRIES,
  dayIn,
  eventTitle,
  journalDays,
  journalEvents,
  journalSummary,
  moodName,
  neverReceived,
  symptomName,
  symptomText,
  tagName,
  type JournalDay,
} from '../lib/journal'
import type { JournalResponse } from '../api/types'
import '../styles/report.css'

const isKnown = (key: string) => key in METRICS

export default function Report() {
  const tz = browserTz()
  const { t, tMetric, lang } = useI18n()
  const f = useFormat()
  // ⚠️ A page left open past midnight must move its window on (`useToday`) —
  // a summary printed in the morning from a tab opened yesterday would otherwise
  // end on the wrong day and say so in its header.
  const today = useToday()
  const [params, setParams] = useSearchParams()
  const { days, metrics } = useMemo(() => parseReportParams(params, isKnown), [params])

  const win = useMemo(() => reportWindow(days, new Date()), [days, today])
  const base = useMemo(() => baselineWindow(win), [win])

  function update(next: { days?: ReportDays; metrics?: string[] }) {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        if (next.days != null) p.set('d', String(next.days))
        if (next.metrics != null) p.set('m', next.metrics.join(','))
        return p
      },
      { replace: true },
    )
  }

  // --- The reads ------------------------------------------------------------

  const names = useMemo(
    () => metrics.flatMap((k) => {
      const d = metricDef(k)
      return [d.key, ...d.aliases]
    }),
    [metrics],
  )
  const baselineAsked = base.days > win.days

  /**
   * The period and its baseline travel together, with the windows they belong
   * to — so a slow answer can never be drawn under a newer heading.
   *
   * `range: 'month'` is what makes the buckets DAILY; `from`/`to` only move the
   * window (the phone asks the same way, `ClinicalReportViewModel.build`).
   *
   * ⚠️ The baseline is allowed to fail and the period is not, as on the phone: a
   * page without a usual range is still worth printing, and it says per row why
   * the range is missing. But the honesty block names the days the range came
   * from, so a failed baseline has to change that sentence as well — the page
   * must not claim a 365-day usual computed from 90.
   */
  const q = useQuery({
    enabled: metrics.length > 0,
    queryKey: ['report', tz, win.from, win.to, base.from, names.join(',')],
    queryFn: async () => {
      const [current, baseline] = await Promise.all([
        api.summary('month', names, tz, win.from, win.to),
        baselineAsked
          ? api.summary('month', names, tz, base.from, base.to).then(
              (d) => d,
              () => null,
            )
          : Promise.resolve(null),
      ])
      return { win, base, current, baseline, at: new Date().toISOString() }
    },
    placeholderData: keepPreviousData,
  })

  // The journal of the same window (`GET /journal`). Allowed to fail without
  // taking the page down, as on the phone: the measurements are worth printing
  // without it, and the section says why it is empty.
  const journal = useQuery({
    queryKey: ['journal', tz, win.from, win.to],
    queryFn: () => api.journal(win.from, win.to, tz),
    placeholderData: keepPreviousData,
  })

  // Shares its cache with the Workouts page, and walks back only as far as the
  // window's first day.
  const history = useWorkoutHistory(win.start)
  const availability = useAvailability()

  // --- What is on the sheet -------------------------------------------------

  const rows = useMemo<ReportRow[]>(() => {
    const d = q.data
    if (!d) return []
    return metrics.map((k) => buildRow(metricDef(k), d.current, d.baseline, d.win, d.baseline ? d.base : null))
  }, [q.data, metrics])
  const drawnWin = q.data?.win ?? win
  // The window the usual range ACTUALLY came from (`baselineWindow: baseline ==
  // nil ? window : requestedBaseline` on the phone).
  const usualDays = q.data?.baseline ? q.data.base.days : drawnWin.days
  const baselineFailed = !!q.data && q.data.base.days > q.data.win.days && q.data.baseline == null
  const workouts = useMemo(() => reportWorkouts(history.items, drawnWin), [history.items, drawnWin])

  const num = (v: number) => f.fmt(v, reportDigits(v))
  const unitOf = (row: ReportRow) => unitLabel(row, t, f)

  const changes = topChanges(rows)
  const withheld = rows.filter((r) => r.withheldChange)
  const empties = rows.filter((r) => r.average == null)
  const nothing = rows.length > 0 && empties.length === rows.length && history.complete && workouts.sessions === 0
  // The per-hour source merge only touches summed types (F9), so its note goes
  // on a page that carries one — the same card, word for word, as Trends.
  const anySummed = rows.some((r) => r.total != null || r.def.agg === 'sum')

  const madeAt = q.data ? `${f.date(q.data.at)} ${f.time(q.data.at)}` : ''
  const periodText = t('report.period', { range: `${f.date(drawnWin.from)} – ${f.date(drawnWin.to)}`, n: drawnWin.days })

  // The file name the print dialog offers for "Save as PDF" is the document
  // title. Deliberately impersonal (`ReportContent.fileName`): it travels into a
  // mail client and a hospital's file share. Set only around printing, so the
  // tab keeps the app's own title the rest of the time.
  useEffect(() => {
    let previous = document.title
    const before = () => {
      previous = document.title
      document.title = t('report.fileName', { day: drawnWin.to })
    }
    const after = () => {
      document.title = previous
    }
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)
    return () => {
      window.removeEventListener('beforeprint', before)
      window.removeEventListener('afterprint', after)
    }
  }, [t, drawnWin.to])

  const isDefault =
    metrics.length === DEFAULT_REPORT_METRICS.length && metrics.every((k, i) => k === DEFAULT_REPORT_METRICS[i])

  return (
    <div className="report" lang={lang}>
      <PageHead
        title={t('report.title')}
        subtitle={t('report.subtitle')}
        aside={
          <button
            type="button"
            className="btn btn-primary report-print"
            onClick={() => window.print()}
            disabled={metrics.length === 0 || q.isLoading}
          >
            {t('report.print')}
          </button>
        }
      />

      <div className="report-controls">
        <div className="segmented" role="group" aria-label={t('report.periodAria')}>
          {REPORT_DAYS.map((d) => (
            <button
              key={d}
              type="button"
              className="seg"
              aria-pressed={days === d}
              onClick={() => update({ days: d })}
            >
              {t(`report.days.${d}` as UiKey)}
            </button>
          ))}
        </div>

        <MetricChooser
          selected={metrics}
          onChange={(m) => update({ metrics: m })}
          has={availability.known ? availability.has : null}
          isDefault={isDefault}
        />
        <p className="subtle report-hint">{t('report.printHint')}</p>
      </div>

      {metrics.length === 0 ? (
        <Empty title={t('report.metrics.none')} />
      ) : q.isLoading ? (
        <Loading rows={4} />
      ) : q.isError ? (
        <ErrorState error={q.error} />
      ) : (
        <article className="report-sheet" aria-busy={q.isFetching || undefined} data-testid="report-sheet">
          <table className="report-frame">
            {/* Repeated at the top of every printed sheet: a sheet separated
                from page one still names the report, the period and the hour. */}
            <thead>
              <tr>
                <td>
                  <header className="report-head">
                    <div className="report-head-line">
                      <h2 className="report-title">{t('report.title')}</h2>
                      <span className="report-made">{t('report.made', { when: madeAt })}</span>
                    </div>
                    <p className="report-period" data-testid="report-period">
                      {periodText}
                    </p>
                  </header>
                </td>
              </tr>
            </thead>
            {/* The honesty block, at the foot of every sheet — never shortened,
                never dropped (`ReportContent.provenance`). */}
            <tfoot>
              <tr>
                <td>
                  <footer className="report-foot" data-testid="report-foot">
                    <p>{t('report.prov.made')}</p>
                    <p>{t('report.prov.self')}</p>
                    <p>{t('report.prov.usual', { n: usualDays })}</p>
                    <p>{t('report.prov.noAssessment')}</p>
                    <p>{t('report.prov.gaps')}</p>
                    <p className="report-foot-strong">{t('report.prov.notMedical')}</p>
                  </footer>
                </td>
              </tr>
            </tfoot>
            <tbody>
              <tr>
                <td>
                  {/* What changed — the first thing after the dates, and that
                      placement is the feature (`ReportContent.changeSummary`).
                      Absent when nothing moved enough: an empty heading would
                      be a claim about nothing. */}
                  {(changes.length > 0 || withheld.length > 0) && (
                    <div className="report-changes" data-testid="report-changes">
                      {changes.length > 0 && (
                        <>
                          <p className="report-changes-title">{t('report.changes.title')}</p>
                          <ul>
                            {changes.map((r) => (
                              <li key={r.key}>
                                {changeLine(tMetric(r.key), unitOf(r), r.change, num, {
                                  withPercent: t('report.changes.line'),
                                  withoutPercent: t('report.changes.lineNoPct'),
                                })}
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                      {withheld.length > 0 && (
                        <p className="report-note" data-testid="report-withheld">
                          {t('report.changes.withheld', {
                            list: withheld
                              .map((r) =>
                                t('report.changes.withheldItem', {
                                  name: tMetric(r.key),
                                  now: r.withheldChange!.currentDays,
                                  then: r.withheldChange!.previousDays,
                                  days: r.periodDays,
                                }),
                              )
                              .join('; '),
                          })}
                        </p>
                      )}
                    </div>
                  )}

                  {nothing && <p className="report-note report-nothing">{t('report.nothing')}</p>}

                  <JournalSection
                    data={journal.data}
                    tooOld={journal.isError && isApiTooOld(journal.error)}
                    failed={journal.isError && !isApiTooOld(journal.error)}
                    from={drawnWin.from}
                    to={drawnWin.to}
                    days={drawnWin.days}
                  />

                  <section className="report-section">
                    <h3>{t('report.table.title')}</h3>
                    <div className="table-wrap">
                      <table className="report-table report-metrics">
                        <thead>
                          <tr>
                            <th scope="col">{t('report.col.measurement')}</th>
                            <th scope="col">{t('report.col.average')}</th>
                            <th scope="col">{t('report.col.extremes')}</th>
                            <th scope="col">{t('report.col.usual')}</th>
                            <th scope="col">{t('report.col.days')}</th>
                          </tr>
                        </thead>
                        {rows.map((r) => (
                          <MetricRows key={r.key} row={r} unit={unitOf(r)} num={num} />
                        ))}
                      </table>
                    </div>
                    {empties.length > 0 && (
                      <p className="report-note">
                        {t('report.empty', { list: empties.map((r) => tMetric(r.key)).join(', ') })}
                      </p>
                    )}
                    {baselineFailed && <p className="report-note">{t('report.baselineFailed')}</p>}
                    {anySummed && (
                      <p className="report-note" data-testid="report-sources">
                        <strong>{t('trends.sources.title')}.</strong> {t('trends.sources.body')}
                      </p>
                    )}
                  </section>

                  <EventsSection data={journal.data} from={drawnWin.from} to={drawnWin.to} />

                  <WorkoutsSection
                    workouts={workouts}
                    isLoading={history.isLoading}
                    isError={history.isError}
                    stillLoading={history.stillLoading}
                    capped={history.capped}
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </article>
      )}
    </div>
  )
}

/** The unit beside a value, spelled out for paper (`ReportUnit.label`). */
function unitLabel(row: ReportRow, t: (k: UiKey) => string, f: Formatters): string {
  const u = reportUnit(row.key, row.wireUnit)
  if ('word' in u) return t(`report.unit.${u.word}` as UiKey)
  if ('raw' in u) return u.raw
  return f.unit(u.wire)
}

/**
 * One measurement: the row, and the line under it.
 *
 * ⚠️ Its own `<tbody>`, so `break-inside: avoid` keeps a row and its second line
 * on one sheet — a "latest reading" orphaned at the top of page two belongs to
 * nothing the reader can see.
 */
function MetricRows({ row, unit, num }: { row: ReportRow; unit: string; num: (v: number) => string }) {
  const { t, tMetric } = useI18n()
  const f = useFormat()
  const sub: string[] = []
  if (row.latest) sub.push(t('report.sub.latest', { value: `${num(row.latest.value)} · ${f.date(isoDay(new Date(row.latest.ms)))}` }))
  if (row.band) sub.push(t('report.sub.middle', { value: num(row.band.median) }))
  if (row.total != null) sub.push(t('report.sub.total', { value: periodMeasurement(row.total, row.wireUnit, row.def.digits, f) }))
  if (row.degraded) sub.push(t('report.sub.degraded'))
  return (
    <tbody className="report-metric" data-testid={`report-row-${row.key}`}>
      <tr>
        <th scope="row">
          {tMetric(row.key)}
          {unit && <span className="report-unit"> {unit}</span>}
        </th>
        {/* ⚠️ "no measurement", never a 0 and never a bare dash: a dash on paper
            is a blank the reader fills in, and the natural filling is "normal". */}
        <td className={`num${row.average == null ? ' report-muted' : ''}`}>
          {row.average == null ? t('report.noMeasurement') : num(row.average)}
        </td>
        <td className={`num${row.extremes ? '' : ' report-muted'}`}>
          {row.extremes ? `${num(row.extremes.low)} – ${num(row.extremes.high)}` : '—'}
        </td>
        {/* ⚠️ Never an empty cell: a blank usual range reads as "nothing to
            report", when the truth is that we did not look. */}
        <td className={`num${row.band ? '' : ' report-muted'}`}>
          {row.band
            ? `${num(row.band.low)} – ${num(row.band.high)}`
            : row.bandSourceDays === 0
              ? t('report.usual.none')
              : t('report.usual.little', { n: row.bandSourceDays })}
        </td>
        <td className="num" title={t('report.coverage', { n: row.measuredDays, of: row.periodDays })}>
          {row.measuredDays} / {row.periodDays}
        </td>
      </tr>
      {sub.length > 0 && (
        <tr className="report-subrow">
          <td colSpan={5}>{sub.join('  ·  ')}</td>
        </tr>
      )}
    </tbody>
  )
}

function WorkoutsSection({
  workouts,
  isLoading,
  isError,
  stillLoading,
  capped,
}: {
  workouts: ReturnType<typeof reportWorkouts>
  isLoading: boolean
  isError: boolean
  stillLoading: boolean
  capped: boolean
}) {
  const { t, tp } = useI18n()
  const f = useFormat()
  const w = workouts
  const total = [
    tp('report.workouts.count', w.sessions, { n: f.num(w.sessions) }),
    w.durationKnown > 0 ? t('report.workouts.inTotal', { d: f.duration(w.durationMin) }) : null,
    w.distanceM != null ? f.km(w.distanceM) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    // A long list starts on a sheet of its own; a sentence does not — a forced
    // break before "no workouts" would print a near-empty page.
    <section
      className={`report-section${w.shown.length > 0 ? ' report-section--newpage' : ' report-section--short'}`}
      data-testid="report-workouts"
    >
      <h3>{t('report.workouts.title')}</h3>
      {isLoading ? (
        <Loading rows={1} />
      ) : isError ? (
        // ⚠️ Not loaded is not "no workouts": we could not look.
        <p className="report-note">{t('report.workouts.notLoaded')}</p>
      ) : w.sessions === 0 && !stillLoading && !capped ? (
        <p className="report-note">{t('report.workouts.none')}</p>
      ) : (
        <>
          <p className="report-total">{total}</p>
          {w.shown.length > 0 && (
            <div className="table-wrap">
              <table className="report-table report-workouts">
                <thead>
                  <tr>
                    <th scope="col">{t('report.workouts.col.time')}</th>
                    <th scope="col">{t('report.workouts.col.type')}</th>
                    <th scope="col">{t('report.workouts.col.duration')}</th>
                    <th scope="col">{t('report.workouts.col.distance')}</th>
                    <th scope="col">{t('report.workouts.col.pulse')}</th>
                  </tr>
                </thead>
                <tbody>
                  {w.shown.map((x) => (
                    <WorkoutRow key={x.id ?? x.source_uuid ?? x.started_at} w={x} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {w.sessions > w.shown.length && (
            <p className="report-note">{t('report.workouts.over', { all: w.sessions, shown: w.shown.length })}</p>
          )}
          {w.extraRecordings > 0 && <p className="report-note">{tp('period.workouts.folded', w.extraRecordings)}</p>}
        </>
      )}
      {/* ⚠️ A count from half a history is a LOWER BOUND, and says so. */}
      {stillLoading && <p className="report-note">{t('period.workouts.loading')}</p>}
      {capped && <p className="report-note">{t('period.workouts.capped')}</p>}
    </section>
  )
}

function WorkoutRow({ w }: { w: Workout }) {
  const { t } = useI18n()
  const f = useFormat()
  // The clock time is KEPT (`ReportWorkoutRow.timeText`): on a shared card the
  // hour would leak a routine; here it is the point, and the page has one reader.
  const hasEnd = !!w.ended_at && Date.parse(w.ended_at) > Date.parse(w.started_at ?? '')
  return (
    <tr>
      <td className="num">
        {f.date(w.started_at)} {f.time(w.started_at)}
      </td>
      <td>{f.activityName(w.activity_type)}</td>
      <td className={`num${hasEnd ? '' : ' report-muted'}`}>{hasEnd ? f.durationBetween(w.started_at, w.ended_at) : '—'}</td>
      <td className={`num${w.total_distance_m ? '' : ' report-muted'}`}>
        {w.total_distance_m ? f.km(w.total_distance_m) : '—'}
      </td>
      <td className={`num${w.avg_heart_rate ? '' : ' report-muted'}`}>
        {w.avg_heart_rate ? t('report.workouts.avgHr', { n: Math.round(w.avg_heart_rate) }) : '—'}
      </td>
    </tr>
  )
}

/**
 * Which measurements go on the page: the chosen ones as removable chips, and a
 * plain select to add one — the catalog, with what has data first.
 *
 * ⚠️ A select and not the Trends picker panel: this choice is made once per
 * appointment, beside a button that prints, and a 100-item panel would push the
 * sheet itself below the fold.
 */
function MetricChooser({
  selected,
  onChange,
  has,
  isDefault,
}: {
  selected: string[]
  onChange: (next: string[]) => void
  /** `null` until the availability probe has answered — then nothing is split. */
  has: ((key: string) => boolean) | null
  isDefault: boolean
}) {
  const { t, tMetric } = useI18n()
  const rest = METRIC_LIST.filter((d) => !selected.includes(d.key))
  const withData = has ? rest.filter((d) => has(d.key)) : rest
  const without = has ? rest.filter((d) => !has(d.key)) : []
  const option = (k: string) => (
    <option key={k} value={k}>
      {tMetric(k)}
    </option>
  )

  return (
    <div className="report-metrics-choice">
      <span className="report-label">{t('report.metrics.title')}</span>
      <ul className="report-chips">
        {selected.map((k) => (
          <li key={k}>
            <span>{tMetric(k)}</span>
            <button
              type="button"
              aria-label={t('report.metrics.remove', { metric: tMetric(k) })}
              onClick={() => onChange(selected.filter((x) => x !== k))}
            >
              <span aria-hidden="true">×</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="report-metrics-actions">
        <select
          className="field"
          value=""
          aria-label={t('report.metrics.add')}
          onChange={(e) => e.target.value && onChange([...selected, e.target.value])}
        >
          <option value="">{t('report.metrics.add')}</option>
          {has ? (
            <>
              {withData.length > 0 && <optgroup label={t('report.metrics.withData')}>{withData.map((d) => option(d.key))}</optgroup>}
              {without.length > 0 && <optgroup label={t('report.metrics.noData')}>{without.map((d) => option(d.key))}</optgroup>}
            </>
          ) : (
            rest.map((d) => option(d.key))
          )}
        </select>
        {!isDefault && (
          <button type="button" className="btn" onClick={() => onChange([...DEFAULT_REPORT_METRICS])}>
            {t('report.metrics.reset')}
          </button>
        )}
      </div>
      <p className="subtle report-hint">{t('report.metrics.defaultNote')}</p>
    </div>
  )
}

// --- The journal and the events --------------------------------------------------

/**
 * "What I noted" — the phone's `ReportJournal` block from the server's copy.
 *
 * ⛔️ The coverage line comes first and is never dropped: an unmarked day is not
 * a symptom-free day, and a list of symptoms without it would read to a
 * clinician as "these were the bad days and the rest were fine".
 */
function JournalSection({
  data,
  tooOld,
  failed,
  from,
  to,
  days,
}: {
  data: JournalResponse | undefined
  tooOld: boolean
  failed: boolean
  from: string
  to: string
  days: number
}) {
  const { t, tp, lang } = useI18n()
  const f = useFormat()
  const marked = data ? journalDays(data.entries, data.tz) : []
  const summary = data && !neverReceived(data) ? journalSummary(marked, from, to) : null

  let body
  if (tooOld) body = <p className="report-note">{t('report.journal.tooOld')}</p>
  else if (failed || !data || neverReceived(data)) body = <p className="report-note">{t('report.journal.never')}</p>
  else if (!summary) body = <p className="report-note">{t('report.journal.none', { n: days })}</p>
  else {
    const list = (items: { key: string; days: number }[], nameOf: (k: string) => string) =>
      items
        .slice(0, SUMMARY_MAX_ENTRIES)
        .map((x) => tp('report.journal.item', x.days, { name: nameOf(x.key) }))
        .join(', ')
    const rest = (items: unknown[]) => Math.max(0, items.length - SUMMARY_MAX_ENTRIES)
    const omitted = summary.markedDays - summary.detail.length
    body = (
      <>
        <p className="report-note">{t('journal.coverage', { n: summary.markedDays, of: summary.periodDays })}</p>
        {summary.symptomDays.length > 0 && (
          <p className="report-note">
            {rest(summary.symptomDays) > 0
              ? t('report.journal.symptomsMore', {
                  list: list(summary.symptomDays, (k) => symptomName(k, lang)),
                  n: rest(summary.symptomDays),
                })
              : t('report.journal.symptoms', { list: list(summary.symptomDays, (k) => symptomName(k, lang)) })}
          </p>
        )}
        {summary.tagDays.length > 0 && (
          <p className="report-note">
            {rest(summary.tagDays) > 0
              ? t('report.journal.tagsMore', { list: list(summary.tagDays, (k) => tagName(k, lang)), n: rest(summary.tagDays) })
              : t('report.journal.tags', { list: list(summary.tagDays, (k) => tagName(k, lang)) })}
          </p>
        )}
        {summary.longestSymptomRun && summary.longestSymptomRun.days > 1 && (
          <p className="report-note">
            {t('report.journal.run', { n: summary.longestSymptomRun.days, date: f.date(summary.longestSymptomRun.start) })}
          </p>
        )}
        <div className="table-wrap">
          <table className="report-table report-journal-days">
            <thead>
              <tr>
                <th scope="col">{t('journal.daysList.day')}</th>
                <th scope="col">{t('journal.daysList.symptoms')}</th>
                <th scope="col">{t('journal.daysList.mood')}</th>
              </tr>
            </thead>
            <tbody>
              {summary.detail.map((d) => (
                <tr key={d.day}>
                  <td>{f.date(d.day)}</td>
                  <td>{d.symptoms.map((s) => symptomText(s.key, s.severity, lang)).join(', ')}</td>
                  <td>{moodAndTags(d, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {omitted > 0 && <p className="report-note">{t('report.journal.omitted', { n: omitted })}</p>}
      </>
    )
  }
  return (
    <section className="report-section report-section--short" data-testid="report-journal">
      <h3>{t('report.journal.title')}</h3>
      {body}
    </section>
  )
}

function moodAndTags(d: JournalDay, lang: 'hu' | 'en'): string {
  const parts: string[] = []
  if (d.mood != null) parts.push(moodName(d.mood, lang))
  if (d.tags.length) parts.push(d.tags.map((x) => tagName(x, lang)).join(', '))
  return parts.join(' · ')
}

/** The alerts of the period from the same journal answer; the honest sentence
 * when the server never received one. */
function EventsSection({ data, from, to }: { data: JournalResponse | undefined; from: string; to: string }) {
  const { t, lang } = useI18n()
  const f = useFormat()
  const tz = data?.tz
  const events =
    data && tz && !neverReceived(data)
      ? journalEvents(data.entries).filter((e) => {
          const day = dayIn(e.at, tz)
          return e.dataType != null && day >= from && day <= to
        }).reverse()
      : null
  return (
    <section className="report-section report-section--short" data-testid="report-events">
      <h3>{t('report.events.title')}</h3>
      {events == null ? (
        <p className="report-note">{t('report.events.body')}</p>
      ) : events.length === 0 ? (
        <p className="report-note">{t('report.events.none')}</p>
      ) : (
        <ul className="report-events">
          {events.map((e) => (
            <li key={e.id}>
              {f.dateTime(e.at)} — {eventTitle(e, lang)}
              {e.marked.length > 0 && ` (${e.marked.map((m) => symptomText(m.key, m.severity, lang)).join(', ')})`}
            </li>
          ))}
        </ul>
      )}
      {events != null && <p className="report-note">{t('report.events.note')}</p>}
    </section>
  )
}
