import { useQuery } from '@tanstack/react-query'
import { api, browserTz } from '../api/client'
import { Card, Empty, ErrorState, Loading, Ring, Stat } from '../components/ui'
import { fmt, relative } from '../lib/format'
import { metricDef, pickSeries, readSeries } from '../lib/metrics'

const TODAY = ['stepCount', 'activeEnergy', 'heartRate', 'restingHeartRate'].map(metricDef)
const TODAY_WIRE = TODAY.flatMap((d) => [d.key, ...d.aliases])

export default function Dashboard() {
  const tz = browserTz()

  const summary = useQuery({
    queryKey: ['summary', 'day', tz],
    queryFn: () => api.summary('day', TODAY_WIRE, tz),
  })

  const activity = useQuery({
    queryKey: ['activity', 'today', tz],
    queryFn: () => api.activity(undefined, undefined, tz),
  })

  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api.devices() })

  if (summary.isLoading) return <Loading />
  if (summary.isError) return <ErrorState error={summary.error} />

  const metrics = summary.data?.metrics ?? {}
  const rings = activity.data?.at(-1)

  // The most recent device heartbeat: this is what says whether data is still
  // arriving at all.
  const lastSeen = devices.data
    ?.map((d) => d.last_seen_at)
    .filter(Boolean)
    .sort()
    .at(-1)

  const hasAny = Object.values(metrics).some((m) => (m.buckets?.length ?? 0) > 0 || m.total != null)

  return (
    <>
      <h1>Ma</h1>
      <p className="subtle">
        {summary.data?.from ?? ''} · időzóna: {summary.data?.tz ?? tz}
        {lastSeen ? ` · utolsó szinkron: ${relative(lastSeen)}` : ''}
      </p>

      {!hasAny && (
        <div style={{ marginBottom: 18 }}>
          <Empty
            title="Még nincs adat"
            hint="Az iPhone az egyetlen feltöltő — amint szinkronizál, itt megjelenik."
          />
        </div>
      )}

      <div className="grid" style={{ marginBottom: 18 }}>
        {TODAY.map((def) => {
          // For a summed metric, the sum of today's hourly buckets; for an averaged
          // one, their daily average — readSeries handles the difference, not the
          // card.
          const r = readSeries(def, pickSeries(def, metrics))
          return (
            <Stat
              key={def.key}
              label={def.label}
              value={fmt(r.total, def.digits)}
              unit={r.unit}
              color={def.color}
            />
          )
        })}
      </div>

      <Card title="Aktivitás-gyűrűk">
        {activity.isLoading ? (
          <div className="skeleton" style={{ height: 120 }} />
        ) : rings ? (
          <div
            style={{
              display: 'flex',
              gap: 30,
              flexWrap: 'wrap',
              justifyContent: 'center',
              padding: '6px 0',
            }}
          >
            <Ring
              label="Mozgás"
              value={rings.active_energy}
              goal={rings.active_energy_goal}
              unit="kcal"
              color="var(--helsa-ember)"
            />
            <Ring
              label="Edzés"
              value={rings.exercise_minutes}
              goal={rings.exercise_goal}
              unit="p"
              color="var(--helsa-move)"
            />
            <Ring
              label="Állás"
              value={rings.stand_hours}
              goal={rings.stand_goal}
              unit="ó"
              color="var(--helsa-fjord)"
            />
          </div>
        ) : (
          <Empty
            title="Nincs gyűrű-adat"
            hint="A HealthKit napi activity-summaryja még nem érkezett meg."
          />
        )}
      </Card>
    </>
  )
}
