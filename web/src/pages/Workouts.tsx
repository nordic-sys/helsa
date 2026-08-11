import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { Card, Empty, ErrorState, Loading } from '../components/ui'
import { useI18n } from '../i18n'
import { useFormat } from '../lib/format'

export default function Workouts() {
  const q = useQuery({ queryKey: ['workouts'], queryFn: () => api.workouts(100) })
  const { t, tx } = useI18n()
  const f = useFormat()

  if (q.isLoading) return <Loading rows={1} />
  if (q.isError) return <ErrorState error={q.error} />

  const items = q.data?.items ?? []

  return (
    <>
      <h1>{t('workouts.title')}</h1>
      <p className="subtle">{t('workouts.subtitle')}</p>

      {items.length === 0 ? (
        <Empty title={t('workouts.empty.title')} hint={t('workouts.empty.hint')} />
      ) : (
        <Card>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('workouts.col.type')}</th>
                  <th>{t('workouts.col.when')}</th>
                  <th>{t('workouts.col.duration')}</th>
                  <th>{t('workouts.col.energy')}</th>
                  <th>{t('workouts.col.distance')}</th>
                  <th>{t('workouts.col.avgHr')}</th>
                  <th>{t('workouts.col.maxHr')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((w) => (
                  <tr key={w.id ?? w.source_uuid}>
                    <td>{f.activityName(w.activity_type)}</td>
                    <td>{f.dateTime(w.started_at)}</td>
                    <td className="num">{f.durationBetween(w.started_at, w.ended_at)}</td>
                    <td className="num">
                      {w.total_energy_kcal != null ? `${f.num(w.total_energy_kcal)} kcal` : '–'}
                    </td>
                    <td className="num">{f.km(w.total_distance_m)}</td>
                    <td className="num" style={{ color: 'var(--helsa-pulse)' }}>
                      {f.num(w.avg_heart_rate)}
                    </td>
                    <td className="num" style={{ color: 'var(--helsa-pulse)' }}>
                      {f.num(w.max_heart_rate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {items.some((w) => w.avg_heart_rate == null) && (
            <p className="subtle" style={{ margin: '12px 0 0' }}>
              {tx('workouts.hrNote', { field: <code>source_uuid</code> })}
            </p>
          )}
        </Card>
      )}
    </>
  )
}
