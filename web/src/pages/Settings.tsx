import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, browserTz, clearToken, getToken, setToken } from '../api/client'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { Card, ErrorState, Ring } from '../components/ui'
import { useI18n } from '../i18n'
import { useFormat } from '../lib/format'

export default function SettingsPage() {
  const qc = useQueryClient()
  const [draft, setDraft] = useState('')
  const hasToken = !!getToken()
  const { t, tMetric } = useI18n()
  const f = useFormat()

  const devices = useQuery({
    queryKey: ['devices'],
    queryFn: () => api.devices(),
    enabled: hasToken,
  })
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
      <h1>{t('settings.title')}</h1>
      <p className="subtle">{t('settings.subtitle')}</p>

      <div style={{ marginBottom: 16 }}>
        <Card title={t('settings.language.title')}>
          <LanguageSwitcher />
          <p className="subtle" style={{ margin: '10px 0 0' }}>
            {t('settings.language.note')}
          </p>
        </Card>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Card title={t('settings.token.title')}>
          {hasToken ? (
            <>
              <p style={{ marginTop: 0 }}>{t('settings.token.present')}</p>
              <button
                className="seg"
                onClick={() => {
                  clearToken()
                  qc.invalidateQueries()
                }}
              >
                {t('settings.token.clear')}
              </button>
            </>
          ) : (
            <>
              <p style={{ marginTop: 0, color: 'var(--text-dim)' }}>{t('settings.token.hint')}</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  type="password"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && save()}
                  placeholder={t('settings.token.placeholder')}
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
                  {t('settings.token.save')}
                </button>
              </div>
            </>
          )}
        </Card>
      </div>

      {hasToken && (
        <>
          <div style={{ marginBottom: 16 }}>
            <Card title={t('settings.devices.title')}>
              {devices.isError ? (
                <ErrorState error={devices.error} />
              ) : (devices.data?.length ?? 0) === 0 ? (
                <p style={{ margin: 0, color: 'var(--text-dim)' }}>
                  {t('settings.devices.empty')}
                </p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('settings.devices.col.device')}</th>
                        <th>{t('settings.devices.col.platform')}</th>
                        <th>{t('settings.devices.col.lastSync')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* The device name, model and platform are strings the phone
                          registered — server content, not interface text. */}
                      {devices.data!.map((d) => (
                        <tr key={d.id}>
                          <td>{d.name ?? d.model ?? '–'}</td>
                          <td>{d.platform ?? '–'}</td>
                          <td>{f.relative(d.last_seen_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          <div style={{ marginBottom: 16 }}>
            <Card title={t('settings.goals.title')}>
              {(goals.data?.length ?? 0) === 0 ? (
                <p style={{ margin: 0, color: 'var(--text-dim)' }}>{t('settings.goals.empty')}</p>
              ) : (
                <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap' }}>
                  {goals.data!.map((g) => (
                    <Ring
                      key={g.metric}
                      size={84}
                      label={g.metric ? tMetric(g.metric) : ''}
                      value={g.target_value}
                      goal={g.target_value}
                      unit={f.unit(g.unit)}
                      color="var(--helsa-fjord)"
                    />
                  ))}
                </div>
              )}
              <p className="subtle" style={{ margin: '10px 0 0' }}>
                {t('settings.goals.note')}
              </p>
            </Card>
          </div>

          <Card title={t('settings.system.title')}>
            <table>
              <tbody>
                <tr>
                  <td>{t('settings.system.browserTz')}</td>
                  <td className="num">{browserTz()}</td>
                </tr>
                <tr>
                  <td>{t('settings.system.serverTz')}</td>
                  <td className="num">{settings.data?.time_zone ?? '–'}</td>
                </tr>
                <tr>
                  <td>{t('settings.system.units')}</td>
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
