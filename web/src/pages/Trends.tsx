import { useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api, browserTz } from '../api/client'
import type { BaselineRange, Range } from '../api/types'
import { MetricPicker } from '../components/MetricPicker'
import { PeriodStepper } from '../components/PeriodStepper'
import { Card, Empty, ErrorState, Loading, Note, PageHead } from '../components/ui'
import { useI18n } from '../i18n'
import type { UiKey } from '../i18n'
import { STANDING_ARROW, bandOf, noBandReason, pickBaseline } from '../lib/baseline'
import { coverageVerdict } from '../lib/compare'
import { useFormat, type Formatters } from '../lib/format'
import { METRIC_LIST, metricDef, pickSeries, readSeries } from '../lib/metrics'
import { useAvailability } from '../lib/useAvailability'
import { useToday } from '../lib/useToday'
import { labelPx, useElementWidth } from '../lib/useElementWidth'
import {
  bucketKey,
  bucketStarts,
  dayCount,
  finer,
  firstWeekday,
  offsetOf,
  previousWindow,
  windowFor,
  type WindowKind,
} from '../lib/window'
import { windowDates } from '../lib/windowLabel'

const RANGES: { key: Range; label: UiKey }[] = [
  { key: 'day', label: 'range.day' },
  { key: 'week', label: 'range.week' },
  { key: 'month', label: 'range.month' },
  { key: 'year', label: 'range.year' },
]

/** What a tap opens, said in the words of the level it lands on. */
const DRILL_HINT: Record<Range, UiKey | null> = {
  year: 'trends.drill.toMonth',
  month: 'trends.drill.toWeek',
  week: 'trends.drill.toDay',
  day: null,
}

/**
 * An hour in the daily view, a month in the yearly one, otherwise a date — from
 * the bucket's ISO timestamp, formatted for the current locale rather than
 * sliced out of the string.
 */
function tickLabel(t: string, range: Range, f: Formatters): string {
  if (!t) return ''
  if (range === 'day') return f.hourMinute(t)
  if (range === 'year') return f.yearMonth(t)
  return f.monthDay(t)
}

/**
 * Which bucket a click on the chart landed in, as an epoch millisecond.
 *
 * The parameter is `unknown` on purpose: recharts' click state type lives behind
 * a deep internal import path, and a structural read of the two fields we need
 * is both narrower and more stable than pinning that path.
 */
function tappedBucket(state: unknown): number | null {
  const payload = (state as { activePayload?: { payload?: { ms?: unknown } }[] } | null)
    ?.activePayload
  const ms = payload?.[0]?.payload?.ms
  return typeof ms === 'number' ? ms : null
}

/** "+1 204" / "−318" — a minus sign, not a hyphen: the hyphen is smaller and
 * gets lost next to the number. The app's `TrendFormat.signedNumber`. */
function signed(value: number, digits: number, f: Formatters): string {
  if (value === 0) return '0'
  return `${value > 0 ? '+' : '−'}${f.fmt(Math.abs(value), digits)}`
}

function signedPercent(ratio: number): string {
  const percent = Math.round(ratio * 100)
  if (percent > 0) return `+${percent}%`
  if (percent < 0) return `−${Math.abs(percent)}%`
  return '0%'
}

export default function Trends() {
  const tz = browserTz()
  const [range, setRange] = useState<Range>('week')
  /**
   * Which window of `range` is on screen. `0` = the one we are in, `-1` = the
   * one before it. ⚠️ **Never positive** — see `stepForward`.
   */
  const [offset, setOffset] = useState(0)
  /**
   * ⚠️ **The screen opens rolling and only becomes calendar by drilling in.**
   * "The last 7 days" is the honest answer to *how am I doing* — it ends now,
   * and both halves of the comparison are the same length. "August" is the
   * honest answer to *what happened then*. Opening on a calendar week would mean
   * that on a Monday the page shows one day; opening on a rolling one and never
   * offering the other means a tap on September lands on "the 30 days ending
   * near September".
   */
  const [kind, setKind] = useState<WindowKind>('rolling')
  // The metric can arrive in the URL — the Today page's tiles open Trends on
  // their own metric — and the choice is written back, so a chart is a link.
  // An unknown name falls back to steps rather than drawing a blank chart.
  const [params, setParams] = useSearchParams()
  const fromUrl = params.get('metric')
  const [metric, setMetricState] = useState(
    fromUrl && METRIC_LIST.some((d) => d.key === fromUrl) ? fromUrl : 'stepCount',
  )
  function setMetric(key: string) {
    setMetricState(key)
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('metric', key)
        return next
      },
      { replace: true },
    )
  }
  const availability = useAvailability()
  const { t, tx, tMetric, locale } = useI18n()
  const f = useFormat()

  // The region's first weekday, asked once — it cannot change while the page is
  // open, and asking it inside the window functions would put an `Intl` lookup
  // in every loop.
  const firstDay = useMemo(() => firstWeekday(), [])

  const def = metricDef(metric)
  // ⚠️ The clock is a dependency: without it a page left open past midnight kept
  // drawing the window that ended yesterday (see `useToday`).
  const today = useToday()
  const win = useMemo(
    () => windowFor(range, kind, offset, new Date(), firstDay),
    [range, kind, offset, firstDay, today],
  )

  /**
   * Everything the screen needs about one window, fetched together.
   *
   * The three calls go in parallel and land in one object, which is what makes
   * the K14 fix possible below: the range and the window the data belongs to
   * travel WITH it, instead of being read off state that has already moved on.
   *
   * ⚠️ Only the current window's failure is an error. The comparison and the
   * usual range are context around the curve, and neither is worth an empty
   * screen — so both are caught here and come back as `null`.
   */
  const q = useQuery({
    queryKey: ['trends', def.key, tz, range, win.from, win.to],
    queryFn: async () => {
      const names = [def.key, ...def.aliases]
      const prev = previousWindow(win, range, offset, new Date(), firstDay)
      // ⚠️ Only the daily-bucketed ranges may have a usual range: the reference
      // is daily, and a daily band under the hourly buckets of `day` or the
      // monthly ones of `year` would be drawn against numbers of an entirely
      // different size.
      const usual: BaselineRange | null = range === 'week' || range === 'month' ? range : null
      const [data, previous, baseline] = await Promise.all([
        api.summary(range, names, tz, win.from, win.to),
        api.summary(range, names, tz, prev.from, prev.to).then(
          (d) => d,
          () => null,
        ),
        usual
          ? api.baseline(usual, names, tz, win.from, win.to).then(
              (d) => d,
              () => null,
            )
          : Promise.resolve(null),
      ])
      return { metric: def.key, range, win, prev, usual, data, previous, baseline }
    },
    placeholderData: keepPreviousData,
  })

  // --- Control -------------------------------------------------------------

  function selectRange(next: Range) {
    if (next === range) return
    setRange(next)
    // ⚠️ Switching the width returns to the present, and to the rolling view the
    // page opened on. An offset means "three windows back", and three weeks back
    // is not three months back; and a calendar period the reader never asked to
    // be in is just as disorienting.
    setOffset(0)
    setKind('rolling')
  }

  /**
   * ⚠️ Forward stops at the present. The window after this one has not happened,
   * and an empty chart of next week is indistinguishable from a sync that
   * stopped.
   */
  const canStepForward = offset < 0
  const isBrowsing = offset !== 0 || kind !== 'rolling'

  function returnToPresent() {
    setOffset(0)
    setKind('rolling')
  }

  /**
   * One step finer, anchored on the tapped bucket — year → month → week → day.
   *
   * ⚠️ From the range ON SCREEN, not the selected one. With `keepPreviousData`
   * the chart can still be last selection's while the next one loads: tapping a
   * day of the visible week after choosing Year used to drill from Year — to a
   * month. And while a replacement is loading, drilling is off altogether
   * (`canDrill`), so the tap cannot land in a chart that is about to change.
   */
  function drillDown(day: Date) {
    const next = finer(drawnRange)
    if (!next) return
    // Drilling always lands on a CALENDAR period: the point of tapping September
    // is to get September, not the thirty days that happen to end near it.
    setOffset(offsetOf(next, 'calendar', day, new Date(), firstDay))
    setKind('calendar')
    setRange(next)
  }

  // --- What is actually on screen -------------------------------------------

  // ⚠️ **The drawn range is not the selected one, and the difference is a bug
  // that reached a real phone** (`docs/25` K14). The selection changes the
  // instant the reader taps; the data arrives afterwards. Draw the range and the
  // window the loaded series belongs to, and the mismatched frame cannot happen.
  const drawn = q.data
  const drawnRange = drawn?.range ?? range
  const drawnDef = drawn ? metricDef(drawn.metric) : def
  const drawnWin = drawn?.win ?? win

  // Memoised because the rows below key off `r.points`: `readSeries` builds a
  // fresh array every call, and an identity that changes every render would make
  // every memo underneath it a no-op.
  const r = useMemo(
    () => readSeries(drawnDef, pickSeries(drawnDef, drawn?.data.metrics)),
    [drawnDef, drawn],
  )
  const previous = readSeries(drawnDef, pickSeries(drawnDef, drawn?.previous?.metrics ?? undefined))
  const usual = pickBaseline(drawnDef, drawn?.baseline?.metrics)
  const band = bandOf(usual)

  const label = tMetric(drawnDef.key)
  const unit = f.unit(r.unit)
  // For averaged metrics the bucket carries min/max too: that is the band of daily
  // variation (docs/11 §2, the range band). For summed ones it makes no sense.
  const showBand = r.effectiveAgg === 'avg' && r.points.some((p) => p.min != null && p.max != null)

  /**
   * One row per bucket of the window — including the ones nothing was measured
   * in.
   *
   * ⚠️ The server sends only the buckets that had data, so drawing its points
   * directly would turn a 30-day window with 3 measured days into a three-day
   * chart, and the 27 missing days are the information itself. The bucket list
   * comes from the window, whose end is EXCLUSIVE (`docs/25` K15): a domain that
   * stopped at the start of the last bucket left the final bar hanging off the
   * edge.
   *
   * The empty ones carry `null`, never `0` — a missing measurement is not a day
   * of sitting still.
   */
  const data = useMemo(() => {
    const byBucket = new Map(
      r.points.map((p) => {
        const ms = new Date(p.t).getTime()
        return [Number.isNaN(ms) ? '' : bucketKey(ms, drawnRange), p]
      }),
    )
    return bucketStarts(drawnWin, drawnRange).map((ms) => {
      const p = byBucket.get(bucketKey(ms, drawnRange))
      return {
        t: new Date(ms).toISOString(),
        ms,
        value: p?.value ?? null,
        band: showBand && p?.min != null && p?.max != null ? [p.min, p.max] : null,
      }
    })
    // Keyed on the loaded response rather than on `r.points`: `readSeries` builds
    // a fresh array every render, so its identity would defeat the memo entirely.
  }, [r.points, drawnRange, drawnWin, showBand])

  /**
   * How much room the y axis needs, from the longest label it will have to
   * print.
   *
   * ⚠️ Found by screenshot, not by reasoning: the fixed 58 points fitted
   * "60,000" and quietly cut "1,000,000" down to "00,000" on the year view — a
   * clipped number does not look clipped, it looks like a smaller number. The
   * year view is newly easy to reach now that the chart can be drilled into and
   * stepped through, which is how it came up.
   */
  const yAxisWidth = useMemo(() => {
    const widest = Math.max(0, ...data.map((d) => d.value ?? 0), band?.high ?? 0)
    return Math.max(58, 22 + 7.6 * f.fmt(widest, drawnDef.digits).length)
  }, [data, band, drawnDef.digits, f])

  // The chart's real width, for the label decisions below. `0` = not measured.
  const chartRef = useRef<HTMLDivElement>(null)
  const chartWidth = useElementWidth(chartRef)
  /** The plot area: the chart minus the y axis and the margins. `null` = unknown. */
  const plotWidth = chartWidth > 0 ? Math.max(0, chartWidth - yAxisWidth - 4) : null

  /**
   * At most as many x labels as FIT, chosen from the buckets themselves.
   *
   * ⚠️ From the measured plot width and the longest label, not from the point
   * count: seven weekly labels at 390 px left ~34 px each for "Sep 10" — and the
   * Hungarian "szept. 10." is longer still. Without a measurement (jsdom) the
   * old ceiling of seven stands.
   *
   * ⚠️ **Counted from the END.** Recharts' own thinning keeps the first tick and
   * every nth after it, which on a 30-day month drops the last one — and "how far
   * does this window reach" is the single most useful label on the axis,
   * especially now that the window is something you can walk backwards through.
   * The app selects its ticks the same way and for the same reason
   * (`TrendFormat.tickDates`).
   *
   * `undefined` when they all fit: then every bucket gets its own label.
   */
  const xTicks = useMemo(() => {
    const widest = Math.max(1, ...data.map((d) => tickLabel(d.t, drawnRange, f).length))
    const max =
      plotWidth == null ? 7 : Math.max(2, Math.min(7, Math.floor(plotWidth / (labelPx(widest) + 12))))
    if (data.length <= max) return undefined
    const step = Math.ceil(data.length / max)
    const chosen: string[] = []
    for (let i = data.length - 1; i >= 0; i -= step) chosen.push(data[i].t)
    return chosen.reverse()
  }, [data, drawnRange, f, plotWidth])

  // Off while the chart on screen is a placeholder for a window still loading.
  const replacing = q.isPlaceholderData
  const canDrill = finer(drawnRange) !== null && !replacing

  // Measured buckets with no measured neighbour: the broken line cannot show
  // them, so they are drawn as dots (see the `<Line>`).
  const isolated = useMemo(() => isolatedIndices(data.map((d) => d.value)), [data])
  const drillHint = DRILL_HINT[drawnRange]

  const delta = r.total != null && previous.total != null ? r.total - previous.total : null
  const ratio = delta != null && previous.total ? delta / previous.total : null

  /**
   * How much of each period was MEASURED — shown under the comparison, and the
   * reason a summed delta can be withheld (see `lib/compare`). Buckets, in the
   * range's own unit: hours of a day, days of a week or month, months of a year.
   */
  const prevBuckets = drawn ? bucketStarts(drawn.prev, drawnRange).length : 0
  const prevMeasured = previous.points.filter((p) => p.value != null).length
  const curCoverage = { measured: data.filter((d) => d.value != null).length, total: data.length }
  const prevCoverage = { measured: prevMeasured, total: prevBuckets }
  const uneven = coverageVerdict(curCoverage, prevCoverage) === 'uneven'
  const withheld = uneven && r.effectiveAgg === 'sum'

  /**
   * The second headline figure beside the total.
   *
   * For a summed metric over daily buckets (week, month) it is the average of
   * the days that CARRIED a measurement — named as such, because dividing by the
   * window's length would count an unsynced day as a day of sitting still. Over
   * monthly buckets (year) it is per month, and over hourly ones (day) there is
   * no second figure: the total is the day.
   */
  const measured = data.filter((d) => d.value != null).length
  const perBucket =
    r.effectiveAgg === 'sum' && r.total != null && measured > 0 && drawnRange !== 'day'
      ? r.total / measured
      : null

  // Values printed on the bars only when there is room for them to be read: the
  // widest value has to fit in one bucket's width (measured), or — unmeasured —
  // the old rule of at most 14 bars.
  const widestValue = Math.max(1, ...data.map((d) => (d.value == null ? 0 : f.fmt(d.value, drawnDef.digits).length)))
  const labelBars =
    r.effectiveAgg === 'sum' &&
    (plotWidth == null ? data.length <= 14 : plotWidth / Math.max(1, data.length) >= labelPx(widestValue) + 2)

  return (
    <>
      <PageHead
        title={t('trends.title')}
        subtitle={t('trends.subtitle')}
        aside={
          <div className="segmented" role="group" aria-label={t('trends.periodAria')}>
            {RANGES.map((x) => (
              <button
                key={x.key}
                type="button"
                className="seg"
                aria-pressed={range === x.key}
                onClick={() => selectRange(x.key)}
              >
                {t(x.label)}
              </button>
            ))}
          </div>
        }
      />

      <div className="trends-layout">
        <aside className="card picker-panel" aria-label={t('trends.metric')}>
          <MetricPicker value={metric} onChange={setMetric} availability={availability} />
        </aside>

        <div className="sections" style={{ minWidth: 0 }}>
          {r.degraded && (
            <Note title={t('trends.degraded.title')}>
              {tx('trends.degraded.body', {
                metric: <code>{drawnDef.key}</code>,
                file: <code>internal/summary/summary.go</code>,
              })}
            </Note>
          )}

          <section className="card" aria-label={`${label}${unit ? ` (${unit})` : ''}`}>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                marginBottom: 16,
              }}
            >
              {/* Above the error and empty branches on purpose: a window with
                  nothing in it is exactly the window you need to step out of. */}
              <PeriodStepper
                window={drawnWin}
                range={drawnRange}
                canStepForward={canStepForward}
                isBrowsing={isBrowsing}
                onBack={() => setOffset((o) => o - 1)}
                onForward={() => setOffset((o) => Math.min(o + 1, 0))}
                onNow={returnToPresent}
              />
              {r.hasData && r.total != null && (
                <div style={{ display: 'flex', gap: 28, textAlign: 'right', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span className="stat-note">
                      {r.effectiveAgg === 'avg' ? t('trends.periodAverage') : t('trends.total')}
                    </span>
                    <span className="figure" style={{ justifyContent: 'flex-end' }}>
                      {f.fmt(r.total, drawnDef.digits)}
                      {unit && <small style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-dim)' }}>{unit}</small>}
                    </span>
                  </div>
                  {perBucket != null && (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span className="stat-note">
                        {drawnRange === 'year'
                          ? t('trends.perMonth', { n: measured })
                          : t('trends.perDay', { n: measured })}
                      </span>
                      <span className="figure" style={{ justifyContent: 'flex-end' }}>
                        {f.fmt(perBucket, drawnDef.digits)}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {q.isLoading ? (
              <Loading rows={1} />
            ) : q.isError ? (
              <ErrorState error={q.error} />
            ) : !r.hasData ? (
              <Empty
                title={t('trends.empty.title', { metric: label })}
                hint={
                  availability.has(drawnDef.key)
                    ? t('trends.empty.hintElsewhere')
                    : t('trends.empty.hintNever')
                }
              />
            ) : (
              <>
                <h2 className="card-title" style={{ marginBottom: 8 }}>
                  {label}
                  {unit ? ` (${unit})` : ''}
                </h2>
                {/* Wide by nature, and tall in proportion: `.chart`'s height
                    follows the window. */}
                {/* A load is in flight and the chart is still the previous
                    window's. ⚠️ Said by a separate indicator, NOT by fading
                    the chart: at 0.55 opacity its axis labels fell to ~2.2:1. */}
                <p className="chart-status" role="status">
                  {q.isFetching ? t('trends.loading') : ''}
                </p>
                <div
                  className="chart"
                  ref={chartRef}
                  aria-busy={q.isFetching || undefined}
                  style={{ cursor: canDrill ? 'pointer' : 'default' }}
                >
                  <ResponsiveContainer>
                    <ComposedChart
                      // The keyboard can walk the buckets (arrow keys move the
                      // tooltip); the table under the chart is the full,
                      // operable version of the same numbers.
                      accessibilityLayer
                      title={`${label}${unit ? ` (${unit})` : ''}`}
                      desc={t('trends.chartDesc', { period: windowDates(drawnWin, drawnRange, locale) })}
                      data={data}
                      margin={{ top: labelBars ? 22 : 8, right: 12, bottom: 4, left: -8 }}
                      onClick={
                        canDrill
                          ? (state: unknown) => {
                              const ms = tappedBucket(state)
                              if (ms != null) drillDown(new Date(ms))
                            }
                          : undefined
                      }
                    >
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                      {band && (
                        // The furthest back layer: the band is a property of the
                        // person, not of any day, so it spans the whole plot.
                        // `extendDomain` so a band is never clipped at the top.
                        // ⚠️ The axis ids are spelled out because recharts'
                        // defaults do not survive this React version, and the
                        // domain pass matches reference elements BY axis id.
                        <ReferenceArea
                          y1={band.low}
                          y2={band.high}
                          xAxisId={0}
                          yAxisId={0}
                          ifOverflow="extendDomain"
                          stroke="none"
                          fill={drawnDef.color}
                          fillOpacity={0.12}
                          isFront={false}
                        />
                      )}
                      {band && usual?.mean != null && (
                        // The middle of the band. ⚠️ The server sends a MEAN, not
                        // a median, and the legend says "your average" for that
                        // reason — a line labelled "median" would be a claim
                        // about a number we do not have.
                        <ReferenceLine
                          y={usual.mean}
                          xAxisId={0}
                          yAxisId={0}
                          stroke={drawnDef.color}
                          strokeDasharray="6 4"
                          strokeWidth={2}
                          strokeOpacity={0.7}
                          ifOverflow="extendDomain"
                        />
                      )}
                      <XAxis
                        dataKey="t"
                        tick={{ fill: 'var(--text-faint)', fontSize: 12 }}
                        stroke="var(--border)"
                        ticks={xTicks}
                        // `interval={0}` so recharts prints the labels we chose
                        // rather than thinning them a second time.
                        interval={0}
                        tickFormatter={(v: string) => tickLabel(v, drawnRange, f)}
                      />
                      <YAxis
                        tick={{ fill: 'var(--text-faint)', fontSize: 12 }}
                        stroke="var(--border)"
                        width={yAxisWidth}
                        tickFormatter={(v: number) => f.fmt(v, drawnDef.digits)}
                      />
                      <Tooltip
                        cursor={{ fill: 'var(--surface-2)' }}
                        contentStyle={{
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          borderRadius: 10,
                          color: 'var(--text)',
                        }}
                        labelStyle={{ color: 'var(--text-dim)' }}
                        // ⚠️ Recharts colours each item in its series colour by
                        // default — the chart fill, 2.7:1 on white for move and
                        // ember. The text is text; the fill is not.
                        itemStyle={{ color: 'var(--text)' }}
                        labelFormatter={(v: string) => tickLabel(v, drawnRange, f)}
                        formatter={(v: number | number[], name: string) => {
                          if (Array.isArray(v)) {
                            return [
                              `${f.fmt(v[0], drawnDef.digits)} – ${f.fmt(v[1], drawnDef.digits)}`,
                              t('trends.extremes'),
                            ]
                          }
                          return [`${f.fmt(v, drawnDef.digits)} ${unit}`.trim(), name]
                        }}
                      />
                      {showBand && (
                        <Area
                          dataKey="band"
                          name={t('trends.extremes')}
                          stroke="none"
                          fill={drawnDef.color}
                          fillOpacity={0.13}
                          isAnimationActive={false}
                        />
                      )}
                      {r.effectiveAgg === 'sum' ? (
                        // Discrete per-period totals → bars.
                        <Bar
                          dataKey="value"
                          name={label}
                          fill={drawnDef.color}
                          radius={[8, 8, 3, 3]}
                          maxBarSize={64}
                          isAnimationActive={false}
                        >
                          {labelBars && (
                            <LabelList
                              dataKey="value"
                              position="top"
                              fill="var(--text-2)"
                              fontSize={12}
                              fontWeight={600}
                              // A bucket with nothing in it gets no label — not "0".
                              formatter={(v: number | null) =>
                                v == null ? '' : f.fmt(v, drawnDef.digits)
                              }
                            />
                          )}
                        </Bar>
                      ) : (
                        // A continuous measurement → a line.
                        <Line
                          type="monotone"
                          dataKey="value"
                          name={label}
                          stroke={drawnDef.color}
                          strokeWidth={2}
                          // ⚠️ No `connectNulls`: a missing day breaks the line
                          // instead of being bridged by a slope nobody measured.
                          // A measured bucket with no measured neighbour would
                          // then be a line of zero length — invisible — so it
                          // gets a dot of its own.
                          dot={(props: { index?: number; cx?: number; cy?: number }) =>
                            props.index != null && isolated.has(props.index) && props.cx != null && props.cy != null ? (
                              <circle
                                key={`iso-${props.index}`}
                                cx={props.cx}
                                cy={props.cy}
                                r={3.5}
                                fill={drawnDef.color}
                                data-testid="isolated-point"
                              />
                            ) : (
                              <g key={`no-${props.index}`} />
                            )
                          }
                          activeDot={{ r: 4 }}
                          isAnimationActive={false}
                        />
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                {/* Where this period stands against the person's own usual, and
                    what the pale band and the dashed line are.
                    ⚠️ No colour on the standing, and the arrow only repeats the
                    words: the direction is a fact, whether it is welcome is not
                    something this screen can know. */}
                <div className="legend" style={{ alignItems: 'center' }}>
                  {band && usual?.standing && (
                    <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 17 }}>
                      <span aria-hidden="true" className="subtle" style={{ margin: 0, fontSize: 17 }}>
                        {STANDING_ARROW[usual.standing]}
                      </span>
                      <strong>{t(`trends.standing.${usual.standing}`)}</strong>
                    </span>
                  )}
                  {/* How many days the band rests on: 14 and 60 are not equally
                      strong claims. */}
                  {band && usual?.day_count != null && (
                    <span className="legend-item" style={{ fontSize: 14 }}>
                      {t('trends.usual.band', { days: usual.day_count })}
                    </span>
                  )}
                  {band && (
                    <span className="legend-item">
                      <span
                        className="swatch"
                        aria-hidden="true"
                        style={{ width: 16, background: drawnDef.color, opacity: 0.25 }}
                      />
                      {t('trends.legend.usualRange')}
                    </span>
                  )}
                  {band && usual?.mean != null && (
                    <span className="legend-item">
                      <span className="swatch-line" aria-hidden="true" style={{ color: drawnDef.color }} />
                      {t('trends.legend.average')}
                    </span>
                  )}
                  {showBand && (
                    <span className="legend-item">{t('trends.bandNote').replace(/^·\s*/, '')}</span>
                  )}
                </div>

                {/* ⚠️ When there is not enough yet, SAY so. A band that quietly
                    fails to appear looks like a band that does not exist. */}
                {drawn?.usual && !band && drawn.baseline?.min_days != null && (
                  <p className="subtle" style={{ margin: '8px 0 0' }} data-testid="usual-none">
                    {(() => {
                      const why = noBandReason(usual, drawn.baseline.min_days)
                      const days = usual?.day_count ?? 0
                      return why === 'notEnough'
                        ? t('trends.usual.pending', { days, min: drawn.baseline.min_days })
                        : why === 'noVariation'
                          ? t('trends.usual.flat', {
                              days,
                              value: `${f.fmt(usual?.mean, drawnDef.digits)} ${unit}`.trim(),
                            })
                          : t('trends.usual.unavailable', { days })
                    })()}
                  </p>
                )}

                {/* The chart is the only thing that can be clicked to drill,
                    and a gesture nothing announces is a gesture nobody finds. */}
                {drillHint && (
                  <p className="subtle" style={{ margin: '8px 0 0' }}>
                    {t(drillHint)} {t('trends.table.hint')}
                  </p>
                )}

                <ChartTable
                  rows={data}
                  range={drawnRange}
                  digits={drawnDef.digits}
                  unit={unit}
                  showBand={showBand}
                  canDrill={canDrill}
                  onOpen={(ms) => drillDown(new Date(ms))}
                />
              </>
            )}
          </section>

          {drawn && r.hasData && (
            <div className="grid grid-2">
              {/* The comparison. ⚠️ A missing previous period is not "−100%":
                  it is two windows, one of which we know nothing about. */}
              <Card title={t('trends.compare.title')}>
                {delta == null ? (
                  <p className="subtle" style={{ margin: 0 }}>
                    {t('trends.compare.none')}
                  </p>
                ) : withheld ? (
                  // ⚠️ One measured day beside seven reads as a collapse, and
                  // it is only a phone that did not sync: no delta at all.
                  <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--text-2)' }} data-testid="compare-withheld">
                    {t('trends.compare.uneven', {
                      dates: windowDates(drawn.prev, drawn.range, locale),
                      value: `${f.fmt(previous.total, drawnDef.digits)} ${unit}`.trim(),
                    })}
                  </p>
                ) : (
                  <>
                    <p className="figure" style={{ margin: '0 0 6px' }}>
                      {delta !== 0 && <DeltaArrow up={delta > 0} />}
                      {delta === 0
                        ? t('trends.compare.unchanged')
                        : `${signed(delta, drawnDef.digits, f)} ${unit}`.trim()}
                    </p>
                    <p style={{ margin: 0, fontSize: 14, color: 'var(--text-2)' }}>
                      {ratio != null && delta !== 0 && `${signedPercent(ratio)} · `}
                      {t('trends.compare.previous', {
                        dates: windowDates(drawn.prev, drawn.range, locale),
                        value: `${f.fmt(previous.total, drawnDef.digits)} ${unit}`.trim(),
                      })}
                    </p>
                  </>
                )}
                {delta != null && (
                  <p className="subtle" style={{ margin: '6px 0 0' }} data-testid="compare-coverage">
                    {t(`trends.compare.coverage.${drawnRange}` as UiKey, {
                      a: curCoverage.measured,
                      total: curCoverage.total,
                      b: prevCoverage.measured,
                      prevTotal: prevCoverage.total,
                    })}
                    {uneven && !withheld && ` ${t('trends.compare.unevenAvg')}`}
                  </p>
                )}
                {/* ⚠️ The bill a calendar period comes with: this month on the
                    3rd is three days, beside last month's whole one. */}
                {drawnWin.isPartial && (
                  <p className="subtle" style={{ margin: '6px 0 0' }}>
                    {t('trends.compare.clipped', { days: dayCount(drawnWin) })}
                  </p>
                )}
              </Card>

              {/* Where the summed numbers come from. ⚠️ Generic on purpose: the
                  summary carries no per-source breakdown, so this names no
                  device and no app — only the rule the server applies. Averaged
                  metrics are not merged, so they get no such card. */}
              {r.effectiveAgg === 'sum' && (
                <Card title={t('trends.sources.title')}>
                  <p style={{ margin: 0, fontSize: 14, color: 'var(--text-2)' }}>
                    {t('trends.sources.body')}
                  </p>
                </Card>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

/**
 * The chart's numbers as a table — every bucket, measured or not — and, where
 * the chart can be drilled, each period a button that opens it.
 *
 * ⚠️ This is the keyboard's way into the chart: a click on an SVG bar is
 * mouse-only, and Recharts' accessibility layer moves a tooltip but cannot
 * drill. Behind a disclosure so it costs sighted readers nothing.
 */
function ChartTable({
  rows,
  range,
  digits,
  unit,
  showBand,
  canDrill,
  onOpen,
}: {
  rows: { t: string; ms: number; value: number | null; band: number[] | null }[]
  range: Range
  digits: number
  unit: string
  showBand: boolean
  canDrill: boolean
  onOpen: (ms: number) => void
}) {
  const { t } = useI18n()
  const f = useFormat()
  const period = (iso: string) =>
    range === 'day' ? f.hourMinute(iso) : range === 'year' ? f.yearMonth(iso) : f.date(iso)
  return (
    <details className="chart-table">
      <summary>{t('trends.table.summary')}</summary>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">{t('trends.table.period')}</th>
              <th scope="col">{unit ? `${t('trends.table.value')} (${unit})` : t('trends.table.value')}</th>
              {showBand && <th scope="col">{t('trends.extremes')}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.ms}>
                <th scope="row">
                  {canDrill ? (
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => onOpen(row.ms)}
                      aria-label={t('trends.table.open', { period: period(row.t) })}
                    >
                      {period(row.t)}
                    </button>
                  ) : (
                    period(row.t)
                  )}
                </th>
                <td className="num">
                  {row.value == null ? (
                    <span className="subtle">{t('trends.table.notMeasured')}</span>
                  ) : (
                    f.fmt(row.value, digits)
                  )}
                </td>
                {showBand && (
                  <td className="num">
                    {row.band ? `${f.fmt(row.band[0], digits)} – ${f.fmt(row.band[1], digits)}` : '–'}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

/** Indices of non-null values whose neighbours are both null (or absent). */
export function isolatedIndices(values: (number | null)[]): Set<number> {
  const out = new Set<number>()
  values.forEach((v, i) => {
    if (v != null && values[i - 1] == null && values[i + 1] == null) out.add(i)
  })
  return out
}

/** The direction of a change, drawn; the sign in the number says it too. */
function DeltaArrow({ up }: { up: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={up ? 'M7 17L17 7M9 7h8v8' : 'M7 7l10 10M17 9v8H9'} />
    </svg>
  )
}
