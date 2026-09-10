import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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
import { Card, Empty, ErrorState, Loading, Note } from '../components/ui'
import { useI18n } from '../i18n'
import type { UiKey } from '../i18n'
import { STANDING_ARROW, bandOf, pickBaseline } from '../lib/baseline'
import { useFormat, type Formatters } from '../lib/format'
import { metricDef, pickSeries, readSeries } from '../lib/metrics'
import { useAvailability } from '../lib/useAvailability'

const RANGES: { key: Range; label: UiKey }[] = [
  { key: 'day', label: 'range.day' },
  { key: 'week', label: 'range.week' },
  { key: 'month', label: 'range.month' },
  { key: 'year', label: 'range.year' },
]

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

export default function Trends() {
  const tz = browserTz()
  const [range, setRange] = useState<Range>('week')
  const [metric, setMetric] = useState('stepCount')
  const availability = useAvailability()
  const { t, tx, tMetric } = useI18n()
  const f = useFormat()

  const def = metricDef(metric)
  const q = useQuery({
    queryKey: ['summary', range, def.key, tz],
    queryFn: () => api.summary(range, [def.key, ...def.aliases], tz),
  })

  // The person's own usual range — a second, 60-day window, so a request of its
  // own. ⚠️ Only the daily-bucketed ranges may have one: the reference is daily,
  // and a daily band under the hourly buckets of `day` or the monthly ones of
  // `year` would be drawn against numbers of an entirely different size.
  const usualRange: BaselineRange | null =
    range === 'week' || range === 'month' ? range : null
  const bq = useQuery({
    queryKey: ['baseline', usualRange, def.key, tz],
    queryFn: () => api.baseline(usualRange as BaselineRange, [def.key, ...def.aliases], tz),
    enabled: usualRange !== null,
  })
  // ⚠️ A failed baseline must not take the curve down with it, so `bq.isError` is
  // never rendered as an error here: the band is context around the measurement,
  // and one band fewer is a far smaller loss than an error banner over a perfectly
  // good chart. The app makes the same call in `TrendsViewModel.loadBaseline`.
  const usual = pickBaseline(def, bq.data?.metrics)
  const band = bandOf(usual)

  const r = readSeries(def, pickSeries(def, q.data?.metrics))
  const label = tMetric(def.key)
  const unit = f.unit(r.unit)
  // For averaged metrics the bucket carries min/max too: that is the band of daily
  // variation (docs/11 §2, the range band). For summed ones it makes no sense.
  const showBand = r.effectiveAgg === 'avg' && r.points.some((p) => p.min != null && p.max != null)
  const data = r.points.map((p) => ({
    t: p.t,
    value: p.value,
    band: showBand && p.min != null && p.max != null ? [p.min, p.max] : null,
  }))

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
            onClick={() => setRange(x.key)}
          >
            {t(x.label)}
          </button>
        ))}
      </div>

      <div style={{ marginBottom: 16 }}>
        <Card title={t('trends.metric')}>
          <MetricPicker value={metric} onChange={setMetric} availability={availability} />
        </Card>
      </div>

      {r.degraded && (
        <Note title={t('trends.degraded.title')}>
          {tx('trends.degraded.body', {
            metric: <code>{def.key}</code>,
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
            availability.has(def.key)
              ? t('trends.empty.hintElsewhere')
              : t('trends.empty.hintNever')
          }
        />
      ) : (
        <Card title={`${label}${unit ? ` (${unit})` : ''}`}>
          <div style={{ width: '100%', height: 320 }}>
            <ResponsiveContainer>
              <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
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
                    fill={def.color}
                    fillOpacity={0.1}
                    isFront={false}
                  />
                )}
                <XAxis
                  dataKey="t"
                  tick={{ fill: 'var(--text-dim)', fontSize: 12 }}
                  stroke="var(--border)"
                  tickFormatter={(v: string) => tickLabel(v, range, f)}
                />
                <YAxis
                  tick={{ fill: 'var(--text-dim)', fontSize: 12 }}
                  stroke="var(--border)"
                  width={58}
                  tickFormatter={(v: number) => f.fmt(v, def.digits)}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    color: 'var(--text)',
                  }}
                  labelStyle={{ color: 'var(--text-dim)' }}
                  labelFormatter={(v: string) => tickLabel(v, range, f)}
                  formatter={(v: number | number[], name: string) => {
                    if (Array.isArray(v)) {
                      return [
                        `${f.fmt(v[0], def.digits)} – ${f.fmt(v[1], def.digits)}`,
                        t('trends.extremes'),
                      ]
                    }
                    return [`${f.fmt(v, def.digits)} ${unit}`.trim(), name]
                  }}
                />
                {showBand && (
                  <Area
                    dataKey="band"
                    name={t('trends.extremes')}
                    stroke="none"
                    fill={def.color}
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
                    fill={def.color}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={34}
                    isAnimationActive={false}
                  />
                ) : (
                  <Line
                    type="monotone"
                    dataKey="value"
                    name={label}
                    stroke={def.color}
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
              <strong>{f.fmt(r.total, def.digits)}</strong> {unit}
              {showBand && ` ${t('trends.bandNote')}`}
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
          {usualRange && !band && bq.data?.min_days != null && (
            <p className="subtle" style={{ margin: '8px 0 0' }}>
              {t('trends.usual.pending', {
                days: usual?.day_count ?? 0,
                min: bq.data.min_days,
              })}
            </p>
          )}
        </Card>
      )}
    </>
  )
}
