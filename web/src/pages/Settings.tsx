import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, browserTz, clearToken, getToken, setToken } from '../api/client'
import { Card, ErrorState, Ring } from '../components/ui'
import { relative } from '../lib/format'

export default function SettingsPage() {
  const qc = useQueryClient()
  const [draft, setDraft] = useState('')
  const hasToken = !!getToken()

  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api.devices(), enabled: hasToken })
  const goals = useQuery({ queryKey: ['goals'], queryFn: () => api.goals(), enabled: hasToken })
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.settings(),
    enabled: hasToken,
  })

  function save() {
    if (!draft.trim()) return
    setToken(draft)
    setDraft('')
    qc.invalidateQueries()
  }

  return (
    <>
      <h1>Beállítások</h1>
      <p className="subtle">
        Egyfelhasználós rendszer — nincs bejelentkezés. A hozzáférés két rétegű: hálózati
        (WireGuard) és alkalmazás-szintű (eszköz-token).
      </p>

      <div style={{ marginBottom: 16 }}>
        <Card title="Eszköz-token">
          {hasToken ? (
            <>
              <p style={{ marginTop: 0 }}>
                Be van állítva ezen a gépen. Új gépen egyszer kell megadni.
              </p>
              <button
                className="seg"
                onClick={() => {
                  clearToken()
                  qc.invalidateQueries()
                }}
              >
                Token törlése
              </button>
            </>
          ) : (
            <>
              <p style={{ marginTop: 0, color: 'var(--text-dim)' }}>
                Illeszd be a tokent — a böngésző tárolja, a szerver nem kér jelszót.
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  type="password"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && save()}
                  placeholder="eszköz-token"
                  style={{
                    flex: '1 1 260px',
                    padding: '8px 11px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    background: 'var(--surface-2)',
                    color: 'var(--text)',
                    font: 'inherit',
                  }}
                />
                <button className="seg" onClick={save}>
                  Mentés
                </button>
              </div>
            </>
          )}
        </Card>
      </div>

      {hasToken && (
        <>
          <div style={{ marginBottom: 16 }}>
            <Card title="Eszközök és szinkron-frissesség">
              {devices.isError ? (
                <ErrorState error={devices.error} />
              ) : (devices.data?.length ?? 0) === 0 ? (
                <p style={{ margin: 0, color: 'var(--text-dim)' }}>
                  Még nincs regisztrált eszköz.
                </p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Eszköz</th>
                        <th>Platform</th>
                        <th>Utolsó szinkron</th>
                      </tr>
                    </thead>
                    <tbody>
                      {devices.data!.map((d) => (
                        <tr key={d.id}>
                          <td>{d.name ?? d.model ?? '–'}</td>
                          <td>{d.platform ?? '–'}</td>
                          <td>{relative(d.last_seen_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          <div style={{ marginBottom: 16 }}>
            <Card title="Célok">
              {(goals.data?.length ?? 0) === 0 ? (
                <p style={{ margin: 0, color: 'var(--text-dim)' }}>Még nincs cél-adat.</p>
              ) : (
                <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap' }}>
                  {goals.data!.map((g) => (
                    <Ring
                      key={g.metric}
                      size={84}
                      label={g.metric ?? ''}
                      value={g.target_value}
                      goal={g.target_value}
                      unit={g.unit}
                      color="var(--helsa-fjord)"
                    />
                  ))}
                </div>
              )}
              <p className="subtle" style={{ margin: '10px 0 0' }}>
                A három Apple gyűrű célja a HealthKitből jön (csak olvasható); a lépés-cél
                felhasználó által állított.
              </p>
            </Card>
          </div>

          <Card title="Rendszer">
            <table>
              <tbody>
                <tr>
                  <td>Böngésző időzónája</td>
                  <td className="num">{browserTz()}</td>
                </tr>
                <tr>
                  <td>Szerver időzónája</td>
                  <td className="num">{settings.data?.time_zone ?? '–'}</td>
                </tr>
                <tr>
                  <td>Mértékegység</td>
                  <td className="num">{settings.data?.unit_system ?? '–'}</td>
                </tr>
              </tbody>
            </table>
          </Card>
        </>
      )}
    </>
  )
}
