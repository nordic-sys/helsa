// Training progress — the web's copy of the phone's progress screen
// (`HelsaKit/Sources/HelsaKit/WorkoutProgress/WorkoutProgressView.swift`).
//
// # What the web adds, and why it is the point of the page
//
// **A year of weeks on one row.** The phone folds a year into 13 columns of 4
// weeks because 52 squares do not fit across a phone; read top to bottom, left
// to right, a break of three weeks is three squares in a column and easy to
// misread. At 1440 the web has the width the year needs, so the grid is one
// row, oldest on the left, and a break is a run of dashed squares you can see
// from across the room. Below the width where 52 squares stop being readable
// (~14 px each) it falls back to the phone's 13 × 4. The page also opens on the
// YEAR rather than the phone's three months, for the same reason: on a phone
// the year is a squeeze, here it is the default view that pays for the screen.
//
// # Where each number comes from
//
// - The weeks, the typical week, the longest break, training time and the
//   types: `lib/trainingProgress.ts`, a value-for-value copy of the phone's
//   `WorkoutProgress`, over the same `/workouts` walk the Workouts page makes
//   (`useWorkoutHistory`, so opening this page after the list costs nothing).
//   Recordings are folded by the list's own `groupSessions` first, so a session
//   recorded by a watch and a gym machine counts once here as it does there.
// - Zone 3 and above: `GET /v1/workout-intensity`. The phone walks `/samples`
//   once per workout; for a year of weeks that is hundreds of paged requests,
//   so the server runs the same rules (backend `internal/workouts/intensity.go`)
//   and answers in one. An older server answers 404, and the card says the
//   server needs updating rather than showing an error — the rest of the page
//   does not depend on it.
// - Resting heart rate and HRV: daily buckets from `/summary`, averaged per week
//   here (`weeklyVitals`, the phone's `WorkoutVitalSeries.weekly`).
//
// What the phone has that the web leaves out: effort ratings (they live in
// HealthKit and do not reach the server) and the share card.

import { useMemo, useRef, useState, type CSSProperties } from 'react'
import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api, browserTz } from '../api/client'
import type { WorkoutIntensity } from '../api/types'
import { Alert, Card, ErrorState, Loading, Note, PageHead } from '../components/ui'
import { useI18n } from '../i18n'
import type { UiKey } from '../i18n'
import { useFormat } from '../lib/format'
import { isApiTooOld } from '../lib/ingest'
import { metricDef, pickSeries } from '../lib/metrics'
import {
  CATEGORIES,
  SPANS,
  addWeeks,
  buildProgress,
  canCompare,
  categoryOf,
  isUsable,
  shade,
  unmeasuredSessions,
  weekStartOf,
  weeklyVitals,
  type Category,
  type Span,
  type TrainingProgress,
  type TrainingWeek,
  type VitalPoint,
} from '../lib/trainingProgress'
import { useElementWidth } from '../lib/useElementWidth'
import { useToday } from '../lib/useToday'
import { useWorkoutHistory } from '../lib/workoutHistory'
import { firstWeekday, isoDay } from '../lib/window'

/** The command that updates a server whose API is older than the web — the
 * same one the sync-queue page prints. */
const UPDATE_COMMAND = 'make prod-pull && make prod-up'

/** Below this width per square a one-row year stops being readable, and the
 * grid falls back to the phone's 13 columns × 4 rows. */
export const MIN_CELL_PX = 14
const CELL_GAP_PX = 3

const SPAN_LABEL: Record<Span, UiKey> = {
  4: 'training.span.4',
  12: 'training.span.12',
  52: 'training.span.52',
}

const CATEGORY_LABEL: Record<Category, UiKey> = {
  strength: 'training.cat.strength',
  cardio: 'training.cat.cardio',
  other: 'training.cat.other',
}

/** The phone's `WorkoutProgressContent.color(_:)`: strength in full fjord,
 * cardio in fjord at 45 %, everything else grey. One hue at two strengths plus a
 * neutral, not three hues — the phone's choice, kept so the two bars read alike. */
const CATEGORY_FILL: Record<Category, { fill: string; opacity: number }> = {
  strength: { fill: 'var(--helsa-fjord)', opacity: 1 },
  cardio: { fill: 'var(--helsa-fjord)', opacity: 0.45 },
  other: { fill: 'var(--text-faint)', opacity: 0.45 },
}

const DAY_MS = 86_400_000

const tooltipStyle = {
  contentStyle: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    color: 'var(--text)',
  },
  labelStyle: { color: 'var(--text-dim)' },
}

const axisTick = { fill: 'var(--text-dim)', fontSize: 12 }

export default function Training() {
  const { t, tp } = useI18n()
  const f = useFormat()
  const tz = browserTz()
  const today = useToday()
  // Re-read whenever the date rolls over, so a page left open overnight moves
  // its current week with the calendar (`today` is the dependency on purpose).
  const now = useMemo(() => new Date(), [today])
  const firstDay = useMemo(() => firstWeekday(), [])

  const [span, setSpan] = useState<Span>(52)
  /** Whole spans back; 0 = ends with the current week. ⚠️ Never negative. */
  const [periodsBack, setPeriodsBack] = useState(0)
  const [chartStyle, setChartStyle] = useState<'grid' | 'bars'>('grid')

  const endingWeeksAgo = periodsBack * span
  const thisWeek = weekStartOf(now.getTime(), firstDay)
  const windowStart = addWeeks(thisWeek, -endingWeeksAgo - span + 1)
  const windowEnd = addWeeks(thisWeek, -endingWeeksAgo + 1)
  const lastDay = Math.min(windowEnd - DAY_MS, now.getTime())

  // The walk goes back to the start of the PREVIOUS window: the comparison line
  // needs it, and so does knowing whether there is anything to step back to.
  const history = useWorkoutHistory(addWeeks(windowStart, -span))

  const intensity = useQuery({
    queryKey: ['workout-intensity', windowStart, windowEnd, today],
    queryFn: () => api.workoutIntensity(new Date(windowStart).toISOString(), new Date(windowEnd).toISOString()),
    placeholderData: keepPreviousData,
  })

  const vitalDefs = [metricDef('restingHeartRate'), metricDef('hrv')]
  const vitals = useQuery({
    queryKey: ['training-vitals', windowStart, lastDay, tz],
    // `range: 'month'` selects DAILY buckets; `from`/`to` set the window — the
    // phone's `loadVitals` asks the same way.
    queryFn: () =>
      api.summary(
        'month',
        vitalDefs.flatMap((d) => [d.key, ...d.aliases]),
        tz,
        isoDay(new Date(windowStart)),
        isoDay(new Date(lastDay)),
      ),
    placeholderData: keepPreviousData,
  })

  const intensityMap = useMemo(() => {
    const m = new Map<string, number>()
    // No maximum → no zones → nothing counted, exactly as on the phone.
    if (!intensity.data?.maximum) return m
    for (const w of intensity.data.workouts) if (w.seconds != null) m.set(w.id, w.seconds)
    return m
  }, [intensity.data])

  const progress = useMemo(
    () => buildProgress(history.items, { weekCount: span, endingWeeksAgo, intensity: intensityMap, now, firstDay }),
    [history.items, span, endingWeeksAgo, intensityMap, now, firstDay],
  )
  const previous = useMemo(
    () => buildProgress(history.items, { weekCount: span, endingWeeksAgo: endingWeeksAgo + span, now, firstDay }),
    [history.items, span, endingWeeksAgo, now, firstDay],
  )

  const weekStarts = progress.weeks.map((w) => w.start)
  const rhr = weeklyVitals(pickSeries(vitalDefs[0], vitals.data?.metrics), weekStarts, firstDay)
  const hrv = weeklyVitals(pickSeries(vitalDefs[1], vitals.data?.metrics), weekStarts, firstDay)

  const oldest = history.items.reduce((m, w) => {
    const s = w.started_at ? new Date(w.started_at).getTime() : NaN
    return Number.isNaN(s) ? m : Math.min(m, s)
  }, Infinity)
  const canGoBack = oldest < windowStart

  const iso = (ms: number) => new Date(ms).toISOString()

  return (
    <>
      <PageHead
        title={t('training.title')}
        subtitle={t('training.subtitle')}
        aside={
          <div className="segmented" role="group" aria-label={t('training.spanAria')}>
            {SPANS.map((s) => (
              <button
                key={s}
                type="button"
                className="seg"
                aria-pressed={span === s}
                onClick={() => {
                  setSpan(s)
                  // ⚠️ Back to the present on a span change: "three years back"
                  // from "4 weeks" would be an arbitrary place nobody asked for.
                  setPeriodsBack(0)
                }}
              >
                {t(SPAN_LABEL[s])}
              </button>
            ))}
          </div>
        }
      />

      <div className="stepper">
        <button
          type="button"
          className="step"
          onClick={() => setPeriodsBack((p) => p + 1)}
          disabled={!canGoBack}
          aria-label={t('training.step.back')}
        >
          <Chevron dir="left" />
        </button>
        <div className="stepper-label">
          <strong>
            {periodsBack === 0 ? t('training.window.last', { n: span }) : t('training.window.past', { n: span })}
          </strong>
          <span className="subtle">
            {f.date(iso(windowStart))} – {f.date(iso(lastDay))}
          </span>
          {periodsBack > 0 && (
            <button type="button" className="linkish" onClick={() => setPeriodsBack(0)}>
              {t('training.step.now')}
            </button>
          )}
        </div>
        <button
          type="button"
          className="step"
          onClick={() => setPeriodsBack((p) => Math.max(0, p - 1))}
          disabled={periodsBack === 0}
          aria-label={t('training.step.forward')}
        >
          <Chevron dir="right" />
        </button>
      </div>

      {history.isLoading ? (
        <Loading rows={3} />
      ) : history.isError ? (
        <ErrorState error={history.error} />
      ) : (
        <div className="sections training">
          {/* ⚠️ A count over a half-loaded history is not short, it is wrong —
              so it says so rather than look finished. */}
          {history.capped && <Note title={t('training.history.capped')} />}
          {history.stillLoading && !history.capped && (
            <p className="subtle" role="status" style={{ margin: 0 }}>
              {t('training.history.loading')}
            </p>
          )}

          {progress.isEmpty ? (
            <Card title={t('training.sessions.title')}>
              <p className="card-lead">{t('training.empty')}</p>
            </Card>
          ) : (
            <>
              <WeeksCard
                progress={progress}
                span={span}
                chartStyle={chartStyle}
                onChartStyle={setChartStyle}
              />
              <div className="flow">
                <TimeCard progress={progress} previous={canCompare(previous, history.items) ? previous : null} span={span} />
                <Card title={t('training.rest.title')}>
                  <p className="card-lead training-fact">
                    {progress.longestRest
                      ? tp('training.rest.span', progress.longestRest.weeks, {
                          from: f.monthDay(iso(progress.longestRest.firstWeek)),
                          to: f.monthDay(iso(progress.longestRest.lastWeek + 6 * DAY_MS)),
                        })
                      : t('training.rest.none')}
                  </p>
                  <p className="subtle" style={{ margin: '8px 0 0' }}>
                    {t('training.rest.hint')}
                  </p>
                </Card>
                <TypesCard progress={progress} />
              </div>
              <ZoneCard progress={progress} query={intensity} />
            </>
          )}

          <VitalsCard weeks={progress.weeks} rhr={rhr} hrv={hrv} />

          <p className="subtle" style={{ margin: 0 }}>
            {t('training.source')}
          </p>
        </div>
      )}
    </>
  )
}

// --- The weeks ----------------------------------------------------------------

function WeeksCard({
  progress,
  span,
  chartStyle,
  onChartStyle,
}: {
  progress: TrainingProgress
  span: Span
  chartStyle: 'grid' | 'bars'
  onChartStyle: (s: 'grid' | 'bars') => void
}) {
  const { t } = useI18n()
  const f = useFormat()
  const typical = progress.typicalWeek
  return (
    <Card title={span === 52 ? t('training.weeksTrained.title') : t('training.sessions.title')}>
      <div className="training-head">
        {span === 52 ? (
          <div className="card-headline">
            {t('training.weeksOf', { active: progress.activeWeeks, total: progress.elapsedWeeks })}
          </div>
        ) : progress.sessionsPerWeek != null ? (
          <div>
            <div className="card-headline">
              {f.fmt(progress.sessionsPerWeek, 1)} <small>{t('training.perWeek')}</small>
            </div>
            <p className="training-line">
              {t('training.workoutIn', { active: progress.activeWeeks, total: progress.elapsedWeeks })}
            </p>
          </div>
        ) : (
          <div />
        )}
        <div className="segmented" role="group" aria-label={t('training.chartAria')}>
          {(['grid', 'bars'] as const).map((s) => (
            <button key={s} type="button" className="seg" aria-pressed={chartStyle === s} onClick={() => onChartStyle(s)}>
              {t(s === 'grid' ? 'training.chart.grid' : 'training.chart.bars')}
            </button>
          ))}
        </div>
      </div>

      {chartStyle === 'grid' ? <WeekGrid weeks={progress.weeks} /> : <WeekBars weeks={progress.weeks} />}

      {typical && (
        <p className="training-line">
          {t('training.typical', {
            sessions: f.fmt(typical.sessions, 1),
            time: f.duration(typical.seconds / 60),
            n: typical.weeks,
          })}
        </p>
      )}
      <p className="subtle" style={{ margin: '6px 0 0' }}>
        {t('training.gapRule')}
      </p>
      <WeeksTable weeks={progress.weeks} />
    </Card>
  )
}

/** The words for one week — the square's tooltip and the table's row. */
function useWeekText() {
  const { t, tp } = useI18n()
  const f = useFormat()
  return (w: TrainingWeek) => {
    const date = f.monthDay(new Date(w.start).toISOString())
    const base =
      w.sessions === 0
        ? t('training.cell.rest', { date })
        : tp('training.cell', w.sessions, { date, time: f.duration(w.seconds / 60) })
    return w.isPartial ? `${base} ${t('training.cell.partial')}` : base
  }
}

/**
 * The phone's `WeekGrid`: one square per week, shaded by the number of
 * sessions, a dashed outline for a week without one, a solid outline for the
 * week still running.
 */
export function WeekGrid({ weeks }: { weeks: TrainingWeek[] }) {
  const { t, locale } = useI18n()
  const f = useFormat()
  const text = useWeekText()
  const ref = useRef<HTMLDivElement>(null)
  const width = useElementWidth(ref)
  const n = weeks.length
  // ⚠️ `0` is "not measured yet" (and always in jsdom): draw one row rather
  // than flash the folded layout first.
  const oneRow = n <= 13 || width === 0 || width >= n * MIN_CELL_PX + (n - 1) * CELL_GAP_PX
  const columns = oneRow ? n : Math.ceil(n / 4)

  const month = new Intl.DateTimeFormat(locale, { month: 'short' })
  const labels: { col: number; span: number; text: string }[] = []
  if (oneRow && n > 13) {
    // A month name where a month starts, at least four squares from the last.
    let last = -Infinity
    weeks.forEach((w, i) => {
      const d = new Date(w.start)
      const prev = i > 0 ? new Date(weeks[i - 1].start) : null
      if ((prev == null || prev.getMonth() !== d.getMonth()) && i - last >= 4 && i <= n - 3) {
        labels.push({ col: i, span: Math.min(4, n - i), text: month.format(d) })
        last = i
      }
    })
  } else if (oneRow) {
    // Short spans: the first, middle and last week, as the phone labels them.
    const picks = n <= 1 ? [0] : [...new Set([0, Math.floor((n - 1) / 2), n - 1])]
    for (const i of picks) labels.push({ col: i, span: 1, text: f.monthDay(new Date(weeks[i].start).toISOString()) })
  } else {
    // The folded year: a month name over every third column of four weeks.
    for (let c = 0; c < columns; c += 3) {
      const w = weeks[c * 4]
      if (w) labels.push({ col: c, span: Math.min(3, columns - c), text: month.format(new Date(w.start)) })
    }
  }

  const gridStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
    maxWidth: columns * 44,
  }
  return (
    <div ref={ref} className="week-grid-wrap">
      <div
        className={`week-grid${oneRow ? '' : ' week-grid--folded'}`}
        style={gridStyle}
        role="img"
        aria-label={t('training.grid.aria')}
        data-layout={oneRow ? 'row' : 'folded'}
      >
        {weeks.map((w) => (
          <div
            key={w.start}
            className={`week-cell${w.sessions === 0 ? ' is-rest' : ''}${w.isPartial ? ' is-partial' : ''}`}
            style={w.sessions > 0 ? ({ '--shade': shade(w.sessions) } as CSSProperties) : undefined}
            title={text(w)}
          />
        ))}
      </div>
      <div className="week-grid-axis" style={gridStyle} aria-hidden="true">
        {labels.map((l) => (
          <span key={l.col} style={{ gridColumn: `${l.col + 1} / span ${l.span}` }}>
            {l.text}
          </span>
        ))}
      </div>
      <div className="week-grid-legend" aria-hidden="true">
        <span className="week-cell is-rest legend-cell" />
        {t('training.legend.rest')}
        <span style={{ marginLeft: 10 }}>1</span>
        {[1, 2, 4].map((k) => (
          <span key={k} className="week-cell legend-cell" style={{ '--shade': shade(k) } as CSSProperties} />
        ))}
        {t('training.legend.max')}
      </div>
    </div>
  )
}

/** The phone's stacked weekly bars, by strength / cardio / other. A rest week is
 * a short dash on the axis rather than nothing, so it reads as a week that
 * happened without training, not as missing data. */
function WeekBars({ weeks }: { weeks: TrainingWeek[] }) {
  const { t } = useI18n()
  const f = useFormat()
  const peak = Math.max(1, ...weeks.map((w) => w.sessions))
  const data = weeks.map((w) => ({
    key: new Date(w.start).toISOString(),
    ...w.categorySessions,
    rest: w.sessions === 0 ? peak * 0.03 : 0,
    partial: w.isPartial,
  }))
  return (
    <>
      <div className="chart-sm" role="img" aria-label={t('training.grid.aria')}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -20 }} barCategoryGap="18%">
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="key" tick={axisTick} stroke="var(--border)" tickFormatter={(v: string) => f.monthDay(v)} minTickGap={24} />
            <YAxis tick={axisTick} stroke="var(--border)" allowDecimals={false} width={44} />
            <Tooltip
              {...tooltipStyle}
              labelFormatter={(v: string) => t('training.week', { date: f.date(v) })}
              formatter={(v: number, name: string) => (name === 'rest' ? [t('training.legend.rest'), ''] : [v, name])}
            />
            {CATEGORIES.map((c, i) => (
              <Bar
                key={c}
                dataKey={c}
                name={t(CATEGORY_LABEL[c])}
                stackId="s"
                fill={CATEGORY_FILL[c].fill}
                fillOpacity={CATEGORY_FILL[c].opacity}
                stroke="var(--surface)"
                strokeWidth={1}
                radius={i === CATEGORIES.length - 1 ? [3, 3, 0, 0] : undefined}
                isAnimationActive={false}
              />
            ))}
            <Bar dataKey="rest" stackId="s" fill="var(--text-faint)" isAnimationActive={false} legendType="none" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="legend">
        {CATEGORIES.map((c) => (
          <span className="legend-item" key={c}>
            <span className="swatch" style={{ background: CATEGORY_FILL[c].fill, opacity: CATEGORY_FILL[c].opacity }} />
            {t(CATEGORY_LABEL[c])}
          </span>
        ))}
        <span className="legend-item">
          <span className="week-cell is-rest legend-cell" />
          {t('training.legend.rest')}
        </span>
      </div>
    </>
  )
}

/** The keyboard's and the screen reader's way into the grid: every week as a
 * row, zone minutes included where known. */
function WeeksTable({ weeks }: { weeks: TrainingWeek[] }) {
  const { t } = useI18n()
  const f = useFormat()
  return (
    <details className="chart-table">
      <summary>{t('training.table.summary')}</summary>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">{t('training.table.week')}</th>
              <th scope="col">{t('training.sessions.title')}</th>
              <th scope="col">{t('training.time.title')}</th>
              <th scope="col">{t('training.zone.title')}</th>
            </tr>
          </thead>
          <tbody>
            {[...weeks].reverse().map((w) => (
              <tr key={w.start}>
                <th scope="row">
                  {f.date(new Date(w.start).toISOString())}
                  {w.isPartial ? ` ${t('training.cell.partial')}` : ''}
                </th>
                <td className="num">{w.sessions}</td>
                <td className="num">{w.sessions ? f.duration(w.seconds / 60) : '–'}</td>
                <td className="num">{w.intenseSeconds == null ? '–' : f.duration(w.intenseSeconds / 60)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

// --- Time, types -----------------------------------------------------------------

function TimeCard({
  progress,
  previous,
  span,
}: {
  progress: TrainingProgress
  /** `null` when the history does not reach back far enough to compare. */
  previous: TrainingProgress | null
  span: Span
}) {
  const { t, tp } = useI18n()
  const f = useFormat()
  const typical = progress.typicalWeek
  let comparison: string | null = null
  if (typical && previous?.typicalWeek) {
    const diff = typical.seconds - previous.typicalWeek.seconds
    comparison =
      Math.abs(diff) < 60
        ? t('training.compare.same', { n: span })
        : t('training.compare.diff', { n: span, diff: `${diff > 0 ? '+' : '−'}${f.duration(Math.abs(diff) / 60)}` })
  }
  return (
    <Card title={t('training.time.title')}>
      {typical && (
        <div className="card-headline">
          {f.duration(typical.seconds / 60)} <small>{t('training.inTypical')}</small>
        </div>
      )}
      {comparison && <p className="training-line">{comparison}</p>}
      <p className="training-line">
        {tp('training.total', progress.totalSessions, { time: f.duration(progress.totalSeconds / 60) })}
      </p>
    </Card>
  )
}

function TypesCard({ progress }: { progress: TrainingProgress }) {
  const { t } = useI18n()
  const f = useFormat()
  const longest = progress.activities[0]?.seconds ?? 0
  return (
    <Card title={t('training.types.title')}>
      <ul className="training-types">
        {progress.activities.map((a) => {
          // Through the shared mapping, so this bar and the stacked chart agree.
          const c = CATEGORY_FILL[categoryOf(a.activityType)]
          return (
            <li key={a.activityType}>
              <div className="training-type-row">
                <strong>{f.activityName(a.activityType)}</strong>
                <span>{t('training.types.row', { n: a.sessions, time: f.duration(a.seconds / 60) })}</span>
              </div>
              <div
                className="training-type-bar"
                aria-hidden="true"
                style={{
                  width: longest > 0 ? `max(4px, ${(a.seconds / longest) * 100}%)` : '4px',
                  background: c.fill,
                  opacity: c.opacity,
                }}
              />
            </li>
          )
        })}
      </ul>
      <p className="subtle" style={{ margin: '8px 0 0' }}>
        {t('training.types.hint')}
      </p>
    </Card>
  )
}

// --- Zone 3 and above ------------------------------------------------------------

function ZoneCard({
  progress,
  query,
}: {
  progress: TrainingProgress
  query: UseQueryResult<WorkoutIntensity>
}) {
  const { t, tp } = useI18n()
  const f = useFormat()
  const data = query.data
  let body
  if (query.isLoading) {
    body = (
      <p className="subtle" role="status" style={{ margin: 0 }}>
        {t('training.zone.loading')}
      </p>
    )
  } else if (query.isError && isApiTooOld(query.error)) {
    // ⚠️ A 404 here is version skew, not a broken page: the web image landed
    // before the backend image. Say which, and what to run — the rest of the
    // page does not need this route and keeps working.
    body = (
      <Alert tone="warn" title={t('ingest.apiOld.title')} live={false}>
        <p>{t('ingest.apiOld.body')}</p>
        <code className="block">{UPDATE_COMMAND}</code>
        <p className="alert-tech">{t('ingest.apiOld.tech')}</p>
      </Alert>
    )
  } else if (query.isError) {
    body = <ErrorState error={query.error} />
  } else if (data && !data.maximum) {
    body = <p className="card-lead">{t('training.zone.noMaximum', { n: data.minimum_workouts })}</p>
  } else if (data?.maximum) {
    const m = data.maximum
    const typical = progress.typicalWeek?.intenseSeconds
    const known = progress.weeks.map((w) => w.intenseSeconds).filter((v): v is number => v != null)
    const peak = Math.max(60, ...known) / 60
    const chart = progress.weeks.map((w) => ({
      key: new Date(w.start).toISOString(),
      // `null` breaks the line — a rest week or an unmeasured week is not drawn
      // across (the phone's `intensitySegments`).
      minutes: w.sessions === 0 || w.intenseSeconds == null ? null : w.intenseSeconds / 60,
      rest: w.sessions === 0 ? peak : null,
    }))
    const unmeasured = unmeasuredSessions(progress)
    body = (
      <>
        {typical != null && (
          <div className="card-headline" style={{ color: 'var(--pulse-text)' }}>
            {f.duration(typical / 60)} <small>{t('training.inTypical')}</small>
          </div>
        )}
        <div className="chart-sm" role="img" aria-label={t('training.zone.aria')}>
          <ResponsiveContainer>
            <ComposedChart data={chart} margin={{ top: 8, right: 8, bottom: 4, left: -20 }} barCategoryGap={0}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="key" tick={axisTick} stroke="var(--border)" tickFormatter={(v: string) => f.monthDay(v)} minTickGap={24} />
              <YAxis tick={axisTick} stroke="var(--border)" width={44} tickFormatter={(v: number) => f.fmt(v, 0)} />
              <Tooltip
                {...tooltipStyle}
                labelFormatter={(v: string) => t('training.week', { date: f.date(v) })}
                formatter={(v: number, name: string) =>
                  name === 'rest' ? [t('training.legend.rest'), ''] : [f.duration(v), t('training.zone.title')]
                }
              />
              <Bar dataKey="rest" fill="var(--surface-3)" isAnimationActive={false} />
              <Line
                dataKey="minutes"
                stroke="var(--helsa-pulse)"
                strokeWidth={2}
                // The running week's dot is faded, as on the phone: its minutes
                // are a part-week, not a low week.
                dot={(p: { cx?: number; cy?: number; index?: number; value?: number | null }) =>
                  p.value == null || p.cx == null || p.cy == null ? (
                    <g key={p.index} />
                  ) : (
                    <circle
                      key={p.index}
                      cx={p.cx}
                      cy={p.cy}
                      r={3}
                      fill="var(--helsa-pulse)"
                      fillOpacity={progress.weeks[p.index ?? 0]?.isPartial ? 0.4 : 1}
                      stroke="var(--surface)"
                      strokeWidth={2}
                    />
                  )
                }
                connectNulls={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="subtle" style={{ margin: '8px 0 0' }}>
          {t('training.zone.method', {
            threshold: Math.round(m.zone3_threshold_bpm),
            max: Math.round(m.bpm),
            n: m.workouts,
          })}
        </p>
        <p className="subtle" style={{ margin: '6px 0 0' }}>
          {t('training.zone.window')}
        </p>
        {unmeasured > 0 && (
          <p className="subtle" style={{ margin: '6px 0 0' }}>
            {tp('training.zone.unmeasured', unmeasured)}
          </p>
        )}
      </>
    )
  }
  return <Card title={t('training.zone.title')}>{body}</Card>
}

// --- Resting heart rate and HRV ---------------------------------------------------

function VitalsCard({ weeks, rhr, hrv }: { weeks: TrainingWeek[]; rhr: VitalPoint[]; hrv: VitalPoint[] }) {
  const { t } = useI18n()
  const f = useFormat()
  return (
    <Card title={t('training.vitals.title')}>
      <div className="grid grid-2">
        <VitalColumn label={t('training.vitals.rhr')} unit={t('unit.bpm')} weeks={weeks} points={rhr} color="var(--helsa-pulse)" />
        <VitalColumn label={t('training.vitals.hrv')} unit={f.unit('ms')} weeks={weeks} points={hrv} color="var(--helsa-fjord)" />
      </div>
      <p className="subtle" style={{ margin: '10px 0 0' }}>
        {t('training.vitals.hint')}
      </p>
    </Card>
  )
}

function VitalColumn({
  label,
  unit,
  weeks,
  points,
  color,
}: {
  label: string
  unit: string
  weeks: TrainingWeek[]
  points: VitalPoint[]
  color: string
}) {
  const { t } = useI18n()
  const f = useFormat()
  const byWeek = new Map(points.map((p) => [p.weekStart, p.value]))
  const data = weeks.map((w) => ({ key: new Date(w.start).toISOString(), v: byWeek.get(w.start) ?? null }))
  const usable = isUsable(points)
  return (
    <div className="training-vital">
      <div className="training-vital-head">
        <span>{label}</span>
        {usable && (
          <strong>
            {f.fmt(points.at(-1)!.value, 0)} <small>{unit}</small>
          </strong>
        )}
      </div>
      {usable ? (
        <>
          <div className="training-vital-chart">
            <ResponsiveContainer>
              <LineChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -20 }}>
                <XAxis dataKey="key" hide />
                <YAxis domain={['auto', 'auto']} tick={axisTick} stroke="var(--border)" width={44} tickFormatter={(v: number) => f.fmt(v, 0)} />
                <Tooltip
                  {...tooltipStyle}
                  labelFormatter={(v: string) => t('training.week', { date: f.date(v) })}
                  formatter={(v: number) => [`${f.fmt(v, 0)} ${unit}`, label]}
                />
                {/* Daily measures: a week is missing only when nothing was
                    recorded, and the line crosses it rather than break. */}
                <Line dataKey="v" stroke={color} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="training-line">{t('training.vitals.start', { v: f.fmt(points[0].value, 0) })}</p>
        </>
      ) : (
        <p className="subtle" style={{ margin: 0 }}>
          {t('training.vitals.notEnough')}
        </p>
      )}
    </div>
  )
}

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
