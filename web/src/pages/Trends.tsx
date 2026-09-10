import { useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api, browserTz } from '../api/client'
import type { BaselineRange, Range } from '../api/types'
import { MetricPicker } from '../components/MetricPicker'
import { PeriodStepper } from '../components/PeriodStepper'
import { Card, Empty, ErrorState, Loading, Note } from '../components/ui'
import { useI18n } from '../i18n'
import type { UiKey } from '../i18n'
import { STANDING_ARROW, bandOf, pickBaseline } from '../lib/baseline'
import { useFormat, type Formatters } from '../lib/format'
import { metricDef, pickSeries, readSeries } from '../lib/metrics'
import { useAvailability } from '../lib/useAvailability'
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
  const [metric, setMetric] = useState('stepCount')
  const availability = useAvailability()
  const { t, tx, tMetric, locale } = useI18n()
  const f = useFormat()

  // The region's first weekday, asked once — it cannot change while the page is
  // open, and asking it inside the window functions would put an `Intl` lookup
  // in every loop.
  const firstDay = useMemo(() => firstWeekday(), [])

  const def = metricDef(metric)
  const win = useMemo(
    () => windowFor(range, kind, offset, new Date(), firstDay),
    [range, kind, offset, firstDay],
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

  /** One step finer, anchored on the tapped bucket — year → month → week → day. */
  function drillDown(day: Date) {
    const next = finer(range)
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

  /**
   * At most a handful of x labels, chosen from the buckets themselves.
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
    const max = 7
    if (data.length <= max) return undefined
    const step = Math.ceil(data.length / max)
    const chosen: string[] = []
    for (let i = data.length - 1; i >= 0; i -= step) chosen.push(data[i].t)
    return chosen.reverse()
  }, [data])

  const canDrill = finer(drawnRange) !== null
  const drillHint = DRILL_HINT[drawnRange]

  const delta = r.total != null && previous.total != null ? r.total - previous.total : null
  const ratio = delta != null && previous.total ? delta / previous.total : null

  return (
    <>
      <h1>{t('trends.title')}</h1>
      <p className="subtle">{t('trends.subtitle')}</p>

      <div className="controls">
        {RANGES.map((x) => (
          <button
            key={x.key}
            className="seg"
            aria-pressed={range === x.key}
            onClick={() => selectRange(x.key)}
          >
            {t(x.label)}
          </button>
        ))}
      </div>

      {/* Above the error and empty branches on purpose: a window with nothing in
          it is exactly the window you need to be able to step out of. */}
      <PeriodStepper
        window={drawnWin}
        range={drawnRange}
        canStepForward={canStepForward}
        isBrowsing={isBrowsing}
        onBack={() => setOffset((o) => o - 1)}
        onForward={() => setOffset((o) => Math.min(o + 1, 0))}
        onNow={returnToPresent}
      />

      <div style={{ marginBottom: 16 }}>
        <Card title={t('trends.metric')}>
          <MetricPicker value={metric} onChange={setMetric} availability={availability} />
        </Card>
      </div>

      {r.degraded && (
        <Note title={t('trends.degraded.title')}>
          {tx('trends.degraded.body', {
            metric: <code>{drawnDef.key}</code>,
            file: <code>internal/summary/summary.go</code>,
          })}
        </Note>
      )}

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
        <Card title={`${label}${unit ? ` (${unit})` : ''}`}>
          <div
            style={{
              width: '100%',
              height: 320,
              cursor: canDrill ? 'pointer' : 'default',
              // A load is in flight and the chart below is still the previous
              // window's. Fading it says so without blanking the page.
              opacity: q.isFetching ? 0.55 : 1,
              transition: 'opacity 120ms linear',
            }}
          >
            <ResponsiveContainer>
              <ComposedChart
                data={data}
                margin={{ top: 8, right: 12, bottom: 4, left: -8 }}
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
                  // The furthest back layer, so that everything else is read THROUGH
                  // it: the band is a property of the person, not of any particular
                  // day, which is why it has no x extent and spans the whole plot.
                  //
                  // `extendDomain` because the axis has to make room for it — a band
                  // clipped at the top of the chart would say the period sat inside a
                  // range it never reached. Swift Charts does the same on its own, by
                  // letting the rectangle mark take part in the automatic y scale.
                  //
                  // ⚠️ The axis ids are spelled out because recharts' own defaults for
                  // them do not survive this React version, and the domain-extending
                  // pass matches reference elements BY axis id
                  // (`detectReferenceElementsDomain`). Without them the band drew
                  // fine and silently failed to widen the axis — the one failure
                  // shape a green test suite cannot see.
                  <ReferenceArea
                    y1={band.low}
                    y2={band.high}
                    xAxisId={0}
                    yAxisId={0}
                    ifOverflow="extendDomain"
                    stroke="none"
                    fill={drawnDef.color}
                    fillOpacity={0.1}
                    isFront={false}
                  />
                )}
                <XAxis
                  dataKey="t"
                  tick={{ fill: 'var(--text-dim)', fontSize: 12 }}
                  stroke="var(--border)"
                  ticks={xTicks}
                  // `interval={0}` so recharts prints the labels we chose rather
                  // than thinning them a second time.
                  interval={0}
                  tickFormatter={(v: string) => tickLabel(v, drawnRange, f)}
                />
                <YAxis
                  tick={{ fill: 'var(--text-dim)', fontSize: 12 }}
                  stroke="var(--border)"
                  width={yAxisWidth}
                  tickFormatter={(v: number) => f.fmt(v, drawnDef.digits)}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    color: 'var(--text)',
                  }}
                  labelStyle={{ color: 'var(--text-dim)' }}
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
                    connectNulls
                  />
                )}
                {r.effectiveAgg === 'sum' ? (
                  // Discrete per-period totals → bars; a continuous measurement → a line.
                  <Bar
                    dataKey="value"
                    name={label}
                    fill={drawnDef.color}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={34}
                    isAnimationActive={false}
                  />
                ) : (
                  <Line
                    type="monotone"
                    dataKey="value"
                    name={label}
                    stroke={drawnDef.color}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                    isAnimationActive={false}
                    connectNulls
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {r.total != null && (
            <p className="subtle" style={{ margin: '10px 0 0' }}>
              {r.effectiveAgg === 'avg' ? t('trends.periodAverage') : t('trends.periodTotal')}:{' '}
              <strong>{f.fmt(r.total, drawnDef.digits)}</strong> {unit}
              {showBand && ` ${t('trends.bandNote')}`}
            </p>
          )}

          {/* The chart is the only thing that can be tapped to drill, and a
              gesture nothing announces is a gesture nobody finds. */}
          {drillHint && (
            <p className="subtle" style={{ margin: '4px 0 0' }}>
              {t(drillHint)}
            </p>
          )}

          {/* Where this period stands against the person's own usual.
              ⚠️ No colour, and the arrow only repeats the words. The direction is a
              fact; whether it is welcome is not something this screen can know —
              more steps than usual is probably good, a higher resting heart rate
              than usual probably is not, and we have no idea which the reader is
              after. The number of reference days is named on purpose: a band
              resting on 14 days and one resting on 60 are not equally strong
              claims, and the reader is entitled to tell them apart. */}
          {band && usual?.standing && (
            <p style={{ margin: '8px 0 0', display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span aria-hidden="true" className="subtle">
                {STANDING_ARROW[usual.standing]}
              </span>
              <strong>{t(`trends.standing.${usual.standing}`)}</strong>
            </p>
          )}

          {/* What the pale rectangle is, and how many days it rests on. */}
          {band && usual?.day_count != null && (
            <p className="subtle" style={{ margin: '4px 0 0' }}>
              {t('trends.usual.band', { days: usual.day_count })}
            </p>
          )}

          {/* ⚠️ And when there is not enough yet, SAY so. A band that quietly fails
              to appear looks like a band that does not exist for this metric. */}
          {drawn?.usual && !band && drawn.baseline?.min_days != null && (
            <p className="subtle" style={{ margin: '8px 0 0' }}>
              {t('trends.usual.pending', {
                days: usual?.day_count ?? 0,
                min: drawn.baseline.min_days,
              })}
            </p>
          )}
        </Card>
      )}

      {/* The comparison, and — when the period is still running — what it was
          measured against. ⚠️ A missing previous period is not "−100%": it is
          two windows, one of which we know nothing about. */}
      {drawn && r.hasData && (
        <div style={{ marginTop: 16 }}>
          <Card title={t('trends.compare.title')}>
            {delta == null ? (
              <p className="subtle" style={{ margin: 0 }}>
                {t('trends.compare.none')}
              </p>
            ) : (
              <>
                <p style={{ margin: 0, display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <strong style={{ fontSize: 20 }}>
                    {delta === 0
                      ? t('trends.compare.unchanged')
                      : `${signed(delta, drawnDef.digits, f)} ${unit}`.trim()}
                  </strong>
                  {ratio != null && delta !== 0 && (
                    <span className="subtle" style={{ margin: 0 }}>
                      {signedPercent(ratio)}
                    </span>
                  )}
                </p>
                <p className="subtle" style={{ margin: '6px 0 0' }}>
                  {t('trends.compare.previous', {
                    dates: windowDates(drawn.prev, drawn.range, locale),
                    value: `${f.fmt(previous.total, drawnDef.digits)} ${unit}`.trim(),
                  })}
                </p>
              </>
            )}
            {/* ⚠️ The bill a calendar period comes with, paid here rather than
                left to the reader: this month on the 3rd is three days, and its
                total beside last month's whole one would read as a collapse. */}
            {drawnWin.isPartial && (
              <p className="subtle" style={{ margin: '6px 0 0' }}>
                {t('trends.compare.clipped', { days: dayCount(drawnWin) })}
              </p>
            )}
          </Card>
        </div>
      )}
    </>
  )
}
