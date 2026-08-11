import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api, browserTz } from '../api/client'
import type { Range } from '../api/types'
import { MetricPicker } from '../components/MetricPicker'
import { Card, Empty, ErrorState, Loading, Note } from '../components/ui'
import { useI18n } from '../i18n'
import type { UiKey } from '../i18n'
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
        </Card>
      )}
    </>
  )
}
