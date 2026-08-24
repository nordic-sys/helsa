import { useQuery } from '@tanstack/react-query'
import { newestActivity } from '../lib/activity'
import { api, browserTz } from '../api/client'
import { Card, Empty, ErrorState, Loading, Ring, Stat } from '../components/ui'
import { useI18n } from '../i18n'
import { useFormat } from '../lib/format'
import { metricDef, pickSeries, readSeries } from '../lib/metrics'

const TODAY = ['stepCount', 'activeEnergy', 'heartRate', 'restingHeartRate'].map(metricDef)
const TODAY_WIRE = TODAY.flatMap((d) => [d.key, ...d.aliases])

export default function Dashboard() {
  const tz = browserTz()
  const { t, tMetric } = useI18n()
  const f = useFormat()

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
  // ⚠️ NOT `at(-1)`: the query asks for a window, and its newest entry is not necessarily
  // today's. Presenting a three-day-old summary under a heading that says "Today" is a
  // true number under a false claim — see `newestActivity`.
  const newest = newestActivity(activity.data)
  const rings = newest?.summary

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
      <h1>{t('dashboard.title')}</h1>
      <p className="subtle">
        {f.date(summary.data?.from)} · {t('dashboard.tz', { tz: summary.data?.tz ?? tz })}
        {lastSeen ? ` · ${t('dashboard.lastSync', { when: f.relative(lastSeen) })}` : ''}
      </p>

      {!hasAny && (
        <div style={{ marginBottom: 18 }}>
          <Empty title={t('dashboard.empty.title')} hint={t('dashboard.empty.hint')} />
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
              label={tMetric(def.key)}
              value={f.fmt(r.total, def.digits)}
              unit={f.unit(r.unit)}
              color={def.color}
            />
          )
        })}
      </div>

      <Card title={t('dashboard.rings.title')}>
        {/* When the newest summary is older than today, the card says which day it is
            for instead of quietly implying this morning. */}
        {newest && !newest.isToday && newest.summary.day ? (
          <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 8 }}>
            {f.date(newest.summary.day)}
          </div>
        ) : null}
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
              label={t('dashboard.rings.move')}
              value={rings.active_energy}
              goal={rings.active_energy_goal}
              unit="kcal"
              color="var(--helsa-ember)"
            />
            <Ring
              label={t('dashboard.rings.exercise')}
              value={rings.exercise_minutes}
              goal={rings.exercise_goal}
              unit={t('unit.minShort')}
              color="var(--helsa-move)"
            />
            <Ring
              label={t('dashboard.rings.stand')}
              value={rings.stand_hours}
              goal={rings.stand_goal}
              unit={t('unit.hourShort')}
              color="var(--helsa-fjord)"
            />
          </div>
        ) : (
          <Empty
            title={t('dashboard.rings.empty.title')}
            hint={t('dashboard.rings.empty.hint')}
          />
        )}
      </Card>
    </>
  )
}
