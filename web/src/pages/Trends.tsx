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
import { fmt } from '../lib/format'
import { metricDef, pickSeries, readSeries } from '../lib/metrics'
import { useAvailability } from '../lib/useAvailability'

const RANGES: { key: Range; label: string }[] = [
  { key: 'day', label: 'Nap' },
  { key: 'week', label: 'Hét' },
  { key: 'month', label: 'Hónap' },
  { key: 'year', label: 'Év' },
]

/** An hour in the daily view, otherwise a date — from the bucket's ISO timestamp. */
function tickLabel(t: string, range: Range): string {
  if (!t) return ''
  if (range === 'day') return t.slice(11, 16)
  if (range === 'year') return t.slice(0, 7)
  return t.slice(5, 10)
}

export default function Trends() {
  const tz = browserTz()
  const [range, setRange] = useState<Range>('week')
  const [metric, setMetric] = useState('stepCount')
  const availability = useAvailability()

  const def = metricDef(metric)
  const q = useQuery({
    queryKey: ['summary', range, def.key, tz],
    queryFn: () => api.summary(range, [def.key, ...def.aliases], tz),
  })

  const r = readSeries(def, pickSeries(def, q.data?.metrics))
  // For averaged metrics the bucket carries min/max too: that is the band of daily
  // variation (docs/11 §2, the range band). For summed ones it makes no sense.
  const showBand =
    r.effectiveAgg === 'avg' && r.points.some((p) => p.min != null && p.max != null)
  const data = r.points.map((p) => ({
    t: p.t,
    value: p.value,
    band: showBand && p.min != null && p.max != null ? [p.min, p.max] : null,
  }))

  return (
    <>
      <h1>Trendek</h1>
      <p className="subtle">Hosszabb távú alakulás, a saját időzónád szerint bucketelve.</p>

      <div className="controls">
        {RANGES.map((x) => (
          <button
            key={x.key}
            className="seg"
            aria-pressed={range === x.key}
            onClick={() => setRange(x.key)}
          >
            {x.label}
          </button>
        ))}
      </div>

      <div style={{ marginBottom: 16 }}>
        <Card title="Metrika">
          <MetricPicker value={metric} onChange={setMetric} availability={availability} />
        </Card>
      </div>

      {r.degraded && (
        <Note title="Ez a típus mintánkénti átlagként érkezik, nem napi összegként">
          A <code>{def.key}</code> összegzendő metrika, de a szerver csak azt az öt
          típust ismeri név szerint, aminek beégetett aggregációja van — a többire
          átlagot, minimumot és maximumot ad vissza, darabszámot nem. Napi összeget
          ebből nem lehet visszaállítani, ezért itt az egy mintára jutó átlag látszik.
          A javítás helye a backend <code>internal/summary/summary.go</code> metricMeta
          táblája.
        </Note>
      )}

      {q.isLoading ? (
        <Loading rows={1} />
      ) : q.isError ? (
        <ErrorState error={q.error} />
      ) : !r.hasData ? (
        <Empty
          title={`Nincs adat ebben az időszakban: ${def.label}`}
          hint={
            availability.has(def.key)
              ? 'Erre a típusra van adat, csak nem ebben az ablakban — válts időtávot.'
              : 'Erre a típusra még nem érkezett minta. A HealthKit nem különbözteti meg a „nincs adat" és a „nincs engedély" esetet — mindkettő üres.'
          }
        />
      ) : (
        <Card title={`${def.label}${r.unit ? ` (${r.unit})` : ''}`}>
          <div style={{ width: '100%', height: 320 }}>
            <ResponsiveContainer>
              <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="t"
                  tick={{ fill: 'var(--text-dim)', fontSize: 12 }}
                  stroke="var(--border)"
                  tickFormatter={(v: string) => tickLabel(v, range)}
                />
                <YAxis
                  tick={{ fill: 'var(--text-dim)', fontSize: 12 }}
                  stroke="var(--border)"
                  width={58}
                  tickFormatter={(v: number) => fmt(v, def.digits)}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    color: 'var(--text)',
                  }}
                  labelStyle={{ color: 'var(--text-dim)' }}
                  labelFormatter={(v: string) => tickLabel(v, range)}
                  formatter={(v: number | number[], name: string) => {
                    if (Array.isArray(v)) {
                      return [`${fmt(v[0], def.digits)} – ${fmt(v[1], def.digits)}`, 'Szélsőértékek']
                    }
                    return [`${fmt(v, def.digits)} ${r.unit}`.trim(), name]
                  }}
                />
                {showBand && (
                  <Area
                    dataKey="band"
                    name="Szélsőértékek"
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
                    name={def.label}
                    fill={def.color}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={34}
                    isAnimationActive={false}
                  />
                ) : (
                  <Line
                    type="monotone"
                    dataKey="value"
                    name={def.label}
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
              {r.effectiveAgg === 'avg' ? 'Átlag' : 'Összesen'} az időszakban:{' '}
              <strong>{fmt(r.total, def.digits)}</strong> {r.unit}
              {showBand && ' · a halvány sáv a bucketen belüli minimum–maximum'}
            </p>
          )}
        </Card>
      )}
    </>
  )
}
