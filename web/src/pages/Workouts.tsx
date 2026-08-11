import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { Card, Empty, ErrorState, Loading } from '../components/ui'
import { activityName, dateTime, durationBetween, km, num } from '../lib/format'

export default function Workouts() {
  const q = useQuery({ queryKey: ['workouts'], queryFn: () => api.workouts(100) })

  if (q.isLoading) return <Loading rows={1} />
  if (q.isError) return <ErrorState error={q.error} />

  const items = q.data?.items ?? []

  return (
    <>
      <h1>Edzések</h1>
      <p className="subtle">A legutóbbi edzések, a legfrissebbel kezdve.</p>

      {items.length === 0 ? (
        <Empty
          title="Még nincs edzés"
          hint="A Watch edzései a párosított iPhone HealthKitjébe kerülnek, onnan töltődnek fel."
        />
      ) : (
        <Card>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Típus</th>
                  <th>Mikor</th>
                  <th>Időtartam</th>
                  <th>Energia</th>
                  <th>Táv</th>
                  <th>Átlag pulzus</th>
                  <th>Max pulzus</th>
                </tr>
              </thead>
              <tbody>
                {items.map((w) => (
                  <tr key={w.id ?? w.source_uuid}>
                    <td>{activityName(w.activity_type)}</td>
                    <td>{dateTime(w.started_at)}</td>
                    <td className="num">{durationBetween(w.started_at, w.ended_at)}</td>
                    <td className="num">
                      {w.total_energy_kcal != null ? `${num(w.total_energy_kcal)} kcal` : '–'}
                    </td>
                    <td className="num">{km(w.total_distance_m)}</td>
                    <td className="num" style={{ color: 'var(--helsa-pulse)' }}>
                      {num(w.avg_heart_rate)}
                    </td>
                    <td className="num" style={{ color: 'var(--helsa-pulse)' }}>
                      {num(w.max_heart_rate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {items.some((w) => w.avg_heart_rate == null) && (
            <p className="subtle" style={{ margin: '12px 0 0' }}>
              Üres pulzus-oszlop: a minták csak a HealthKit <code>source_uuid</code>-ját ismerik, a
              szerver-oldali edzés-azonosítóhoz kötés az ingest workerben történik.
            </p>
          )}
        </Card>
      )}
    </>
  )
}
