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
import {
  STAGE_CHART,
  STAGE_COLOR,
  STAGE_ORDER,
  date,
  duration,
  fmt,
  percent,
  stageName,
  time,
} from '../lib/format'
import { metricDef, pickSeries, readSeries } from '../lib/metrics'
import { averages, groupByNight, segmentMinutes, type Night } from '../lib/sleep'

const WINDOWS = [
  { nights: 7, label: '7 éjszaka' },
  { nights: 30, label: '30 éjszaka' },
]

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
  const chart = [...nights]
    .reverse()
    .map((n) => ({
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
      <h1>Alvás</h1>
      <p className="subtle">
        Éjszakánként, szakaszokra bontva. A minőség-mutatók — hatékonyság, felébredések,
        szakasz-arányok — <strong>számított</strong> értékek a szakaszokból; a HealthKitben
        nincs „alvásminőség" mező. Egy éjszaka a folytonos szakaszok sora: három óránál
        hosszabb szünet után új tétel kezdődik, így a szunyókálás külön látszik.
      </p>

      <div className="controls">
        {WINDOWS.map((w) => (
          <button
            key={w.nights}
            className="seg"
            aria-pressed={nightCount === w.nights}
            onClick={() => setNightCount(w.nights)}
          >
            {w.label}
          </button>
        ))}
      </div>

      {nights.length === 0 ? (
        <Empty
          title="Még nincs alvás-adat"
          hint="Az alvás-szakaszokat a Watch rögzíti, és a párosított iPhone tölti fel."
        />
      ) : (
        <>
          <div className="grid" style={{ marginBottom: 18 }}>
            <Stat
              label={`Átlagos alvásidő — ${avg.nights} éjszaka`}
              value={duration(avg.asleepMin)}
              color="var(--helsa-nordlys)"
            />
            <Stat
              label="Alvás-hatékonyság"
              value={percent(avg.efficiency, 0)}
              color="var(--helsa-fjord)"
            />
            <Stat
              label="Felébredések / éjszaka"
              value={fmt(avg.awakenings, 1)}
              color="var(--helsa-ember)"
            />
            <Stat
              label="Mély + REM arány"
              value={percent(avg.deepRemShare, 0)}
              color="var(--helsa-nordlys)"
            />
          </div>

          {chart.length > 1 && (
            <div style={{ marginBottom: 16 }}>
              <Card title="Szakaszok éjszakánként (perc)">
                <div style={{ width: '100%', height: 300 }}>
                  <ResponsiveContainer>
                    <BarChart data={chart} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="startedAt"
                        tick={{ fill: 'var(--text-dim)', fontSize: 12 }}
                        stroke="var(--border)"
                        tickFormatter={(v: string) => v.slice(5, 10)}
                      />
                      <YAxis
                        tick={{ fill: 'var(--text-dim)', fontSize: 12 }}
                        stroke="var(--border)"
                        width={54}
                        tickFormatter={(v: number) => fmt(v, 0)}
                      />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          borderRadius: 10,
                          color: 'var(--text)',
                        }}
                        labelStyle={{ color: 'var(--text-dim)' }}
                        labelFormatter={(v: string) => date(v)}
                        formatter={(v: number, name: string) => [duration(v), name]}
                      />
                      {presentStages.map((s, i) => (
                        <Bar
                          key={s}
                          dataKey={s}
                          name={stageName(s)}
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
                    label: stageName(s),
                    color: STAGE_COLOR[s] ?? 'var(--surface-2)',
                  }))}
                />
              </Card>
            </div>
          )}

          {physioCards.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <Card title="Élettani mutatók az időszakban">
                <div className="grid">
                  {physioCards.map(({ def, r }) => (
                    <Stat
                      key={def.key}
                      label={def.label}
                      value={fmt(r.total, def.digits)}
                      unit={r.unit}
                      color={def.color}
                    />
                  ))}
                </div>
                <p className="subtle" style={{ margin: '12px 0 0' }}>
                  Ezek az egész időszak átlagai, nem kizárólag az alvás-ablakból — a minták
                  alvás-ablakra szűrése a backend <code>insights</code> rétegére vár (docs/23 §5).
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
  const span = night.inBedMin || 1
  const stages = STAGE_ORDER.filter((s) => (night.stages[s] ?? 0) > 0)

  return (
    <div style={{ marginBottom: 16 }}>
      <Card title={`${date(night.key)} — alvás ${duration(night.asleepMin)}`}>
        {/* A proportional bar: how long each stage lasted */}
        <div
          style={{ display: 'flex', height: 26, borderRadius: 7, overflow: 'hidden', marginBottom: 12 }}
          role="img"
          aria-label={`Alvás-szakaszok ${date(night.key)}`}
        >
          {night.segments.map((s, i) => (
            <div
              key={i}
              title={`${stageName(s.stage)} · ${duration(segmentMinutes(s))}`}
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
                <td>Ágyban</td>
                <td className="num">{duration(night.inBedMin)}</td>
                <td>Hatékonyság</td>
                <td className="num">{percent(night.efficiency, 0)}</td>
              </tr>
              <tr>
                <td>Elalvás</td>
                <td className="num">{time(night.onset)}</td>
                <td>Ébredés</td>
                <td className="num">{time(night.wakeUp)}</td>
              </tr>
              <tr>
                <td>Felébredések</td>
                <td className="num">{night.awakenings}</td>
                <td>Mély + REM</td>
                <td className="num">
                  {percent(
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
                <th>Szakasz</th>
                <th>Hossz</th>
                <th>Arány az alvásidőn belül</th>
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
                    {stageName(s)}
                  </td>
                  <td className="num">{duration(night.stages[s])}</td>
                  <td className="num">
                    {s === 'awake' || s === 'inBed'
                      ? '–'
                      : percent(night.asleepMin > 0 ? night.stages[s]! / night.asleepMin : null, 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <details style={{ marginTop: 12 }}>
          <summary className="subtle" style={{ cursor: 'pointer' }}>
            Nyers szakaszok ({night.segments.length})
          </summary>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table>
              <thead>
                <tr>
                  <th>Szakasz</th>
                  <th>Kezdet</th>
                  <th>Vége</th>
                  <th>Hossz</th>
                </tr>
              </thead>
              <tbody>
                {night.segments.map((s, i) => (
                  <tr key={i}>
                    <td>{stageName(s.stage)}</td>
                    <td className="num">{time(s.started_at)}</td>
                    <td className="num">{time(s.ended_at)}</td>
                    <td className="num">{duration(segmentMinutes(s))}</td>
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
