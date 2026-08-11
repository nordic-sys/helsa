import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api, browserTz } from '../api/client'
import { Card, Empty, ErrorState, Legend, Loading, Stat } from '../components/ui'
import { useI18n } from '../i18n'
import { STAGE_CHART, STAGE_COLOR, STAGE_ORDER, useFormat } from '../lib/format'
import { metricDef, pickSeries, readSeries } from '../lib/metrics'
import { averages, groupByNight, segmentMinutes, type Night } from '../lib/sleep'

const WINDOWS = [7, 30]

/** The physiological metrics measured during the sleep window (docs/23 §5). */
const PHYSIO = [
  'restingHeartRate',
  'hrv',
  'respiratoryRate',
  'appleSleepingWristTemperature',
  'oxygenSaturation',
].map(metricDef)

/** The ISO date N days ago, in local time. */
function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function Sleep() {
  const tz = browserTz()
  const [nightCount, setNightCount] = useState(7)
  const { t, tp, tx, tMetric } = useI18n()
  const f = useFormat()

  const from = isoDaysAgo(nightCount - 1)
  const to = isoDaysAgo(0)

  const q = useQuery({
    queryKey: ['sleep', nightCount, tz],
    queryFn: () => api.sleep(from, to, tz),
  })

  const physio = useQuery({
    queryKey: ['sleep-physio', nightCount, tz],
    queryFn: () =>
      api.summary(
        nightCount > 7 ? 'month' : 'week',
        PHYSIO.flatMap((d) => [d.key, ...d.aliases]),
        tz,
      ),
  })

  if (q.isLoading) return <Loading rows={2} />
  if (q.isError) return <ErrorState error={q.error} />

  const nights = groupByNight(q.data ?? [])
  const avg = averages(nights)

  // Only the stages that actually occur make it onto the chart.
  const presentStages = STAGE_ORDER.filter((s) => nights.some((n) => (n.stages[s] ?? 0) > 0))
  const chart = [...nights].reverse().map((n) => ({
    startedAt: n.startedAt,
    key: n.key,
    ...Object.fromEntries(presentStages.map((s) => [s, n.stages[s] ?? 0])),
  }))

  const physioCards = PHYSIO.map((def) => ({
    def,
    r: readSeries(def, pickSeries(def, physio.data?.metrics)),
  })).filter((x) => x.r.hasData)

  return (
    <>
      <h1>{t('sleep.title')}</h1>
      <p className="subtle">
        {tx('sleep.subtitle', { derived: <strong>{t('sleep.subtitle.derived')}</strong> })}
      </p>

      <div className="controls">
        {WINDOWS.map((n) => (
          <button
            key={n}
            className="seg"
            aria-pressed={nightCount === n}
            onClick={() => setNightCount(n)}
          >
            {tp('sleep.window', n)}
          </button>
        ))}
      </div>

      {nights.length === 0 ? (
        <Empty title={t('sleep.empty.title')} hint={t('sleep.empty.hint')} />
      ) : (
        <>
          <div className="grid" style={{ marginBottom: 18 }}>
            <Stat
              label={tp('sleep.avgSleep', avg.nights)}
              value={f.duration(avg.asleepMin)}
              color="var(--helsa-nordlys)"
            />
            <Stat
              label={t('sleep.efficiency')}
              value={f.percent(avg.efficiency, 0)}
              color="var(--helsa-fjord)"
            />
            <Stat
              label={t('sleep.awakeningsPerNight')}
              value={f.fmt(avg.awakenings, 1)}
              color="var(--helsa-ember)"
            />
            <Stat
              label={t('sleep.deepRemShare')}
              value={f.percent(avg.deepRemShare, 0)}
              color="var(--helsa-nordlys)"
            />
          </div>

          {chart.length > 1 && (
            <div style={{ marginBottom: 16 }}>
              <Card title={t('sleep.stagesChart')}>
                <div style={{ width: '100%', height: 300 }}>
                  <ResponsiveContainer>
                    <BarChart data={chart} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="startedAt"
                        tick={{ fill: 'var(--text-dim)', fontSize: 12 }}
                        stroke="var(--border)"
                        tickFormatter={(v: string) => f.monthDay(v)}
                      />
                      <YAxis
                        tick={{ fill: 'var(--text-dim)', fontSize: 12 }}
                        stroke="var(--border)"
                        width={54}
                        tickFormatter={(v: number) => f.fmt(v, 0)}
                      />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          borderRadius: 10,
                          color: 'var(--text)',
                        }}
                        labelStyle={{ color: 'var(--text-dim)' }}
                        labelFormatter={(v: string) => f.date(v)}
                        formatter={(v: number, name: string) => [f.duration(v), name]}
                      />
                      {presentStages.map((s, i) => (
                        <Bar
                          key={s}
                          dataKey={s}
                          name={f.stageName(s)}
                          stackId="stage"
                          fill={STAGE_CHART[s]?.fill ?? 'var(--surface-2)'}
                          fillOpacity={STAGE_CHART[s]?.opacity ?? 1}
                          stroke="var(--surface)"
                          strokeWidth={1.5}
                          maxBarSize={38}
                          radius={i === presentStages.length - 1 ? [4, 4, 0, 0] : undefined}
                          isAnimationActive={false}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <Legend
                  items={presentStages.map((s) => ({
                    label: f.stageName(s),
                    color: STAGE_COLOR[s] ?? 'var(--surface-2)',
                  }))}
                />
              </Card>
            </div>
          )}

          {physioCards.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <Card title={t('sleep.physio.title')}>
                <div className="grid">
                  {physioCards.map(({ def, r }) => (
                    <Stat
                      key={def.key}
                      label={tMetric(def.key)}
                      value={f.fmt(r.total, def.digits)}
                      unit={f.unit(r.unit)}
                      color={def.color}
                    />
                  ))}
                </div>
                <p className="subtle" style={{ margin: '12px 0 0' }}>
                  {tx('sleep.physio.note', { insights: <code>insights</code> })}
                </p>
              </Card>
            </div>
          )}

          {nights.map((n) => (
            <NightCard key={n.startedAt} night={n} />
          ))}
        </>
      )}
    </>
  )
}

function NightCard({ night }: { night: Night }) {
  const { t, tp } = useI18n()
  const f = useFormat()
  const span = night.inBedMin || 1
  const stages = STAGE_ORDER.filter((s) => (night.stages[s] ?? 0) > 0)
  const day = f.date(night.key)

  return (
    <div style={{ marginBottom: 16 }}>
      <Card title={t('sleep.night.title', { date: day, duration: f.duration(night.asleepMin) })}>
        {/* A proportional bar: how long each stage lasted */}
        <div
          style={{
            display: 'flex',
            height: 26,
            borderRadius: 7,
            overflow: 'hidden',
            marginBottom: 12,
          }}
          role="img"
          aria-label={t('sleep.night.aria', { date: day })}
        >
          {night.segments.map((s, i) => (
            <div
              key={i}
              title={`${f.stageName(s.stage)} · ${f.duration(segmentMinutes(s))}`}
              style={{
                width: `${(segmentMinutes(s) / span) * 100}%`,
                background: STAGE_COLOR[s.stage ?? ''] ?? 'var(--surface-2)',
              }}
            />
          ))}
        </div>

        <div className="table-wrap" style={{ marginBottom: 12 }}>
          <table>
            <tbody>
              <tr>
                <td>{t('sleep.inBed')}</td>
                <td className="num">{f.duration(night.inBedMin)}</td>
                <td>{t('sleep.efficiencyShort')}</td>
                <td className="num">{f.percent(night.efficiency, 0)}</td>
              </tr>
              <tr>
                <td>{t('sleep.onset')}</td>
                <td className="num">{f.time(night.onset)}</td>
                <td>{t('sleep.wakeUp')}</td>
                <td className="num">{f.time(night.wakeUp)}</td>
              </tr>
              <tr>
                <td>{t('sleep.awakenings')}</td>
                <td className="num">{f.num(night.awakenings)}</td>
                <td>{t('sleep.deepRem')}</td>
                <td className="num">
                  {f.percent(
                    night.asleepMin > 0
                      ? ((night.stages.deep ?? 0) + (night.stages.rem ?? 0)) / night.asleepMin
                      : null,
                    0,
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('sleep.col.stage')}</th>
                <th>{t('sleep.col.length')}</th>
                <th>{t('sleep.col.shareOfSleep')}</th>
              </tr>
            </thead>
            <tbody>
              {stages.map((s) => (
                <tr key={s}>
                  <td>
                    <span
                      className="picker-dot"
                      style={{ background: STAGE_COLOR[s] ?? 'var(--surface-2)' }}
                    />{' '}
                    {f.stageName(s)}
                  </td>
                  <td className="num">{f.duration(night.stages[s])}</td>
                  <td className="num">
                    {s === 'awake' || s === 'inBed'
                      ? '–'
                      : f.percent(
                          night.asleepMin > 0 ? night.stages[s]! / night.asleepMin : null,
                          0,
                        )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <details style={{ marginTop: 12 }}>
          <summary className="subtle" style={{ cursor: 'pointer' }}>
            {tp('sleep.raw', night.segments.length)}
          </summary>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table>
              <thead>
                <tr>
                  <th>{t('sleep.col.stage')}</th>
                  <th>{t('sleep.col.start')}</th>
                  <th>{t('sleep.col.end')}</th>
                  <th>{t('sleep.col.length')}</th>
                </tr>
              </thead>
              <tbody>
                {night.segments.map((s, i) => (
                  <tr key={i}>
                    <td>{f.stageName(s.stage)}</td>
                    <td className="num">{f.time(s.started_at)}</td>
                    <td className="num">{f.time(s.ended_at)}</td>
                    <td className="num">{f.duration(segmentMinutes(s))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Card>
    </div>
  )
}
