import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api, browserTz } from '../api/client'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { MapSourceCard } from '../components/MapSourceCard'
import { Card, ErrorState, Ring } from '../components/ui'
import { useI18n } from '../i18n'
import { useFormat } from '../lib/format'

export default function SettingsPage() {
  const { t, tx, tMetric } = useI18n()
  const f = useFormat()

  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api.devices() })
  const goals = useQuery({ queryKey: ['goals'], queryFn: () => api.goals() })
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.settings() })

  return (
    <>
      <h1>{t('settings.title')}</h1>
      <p className="subtle">{t('settings.subtitle')}</p>

      {/* ⚠️ Every card on this page is a switch, a short table or a sentence —
          not one of them is wider than about 400px of actual content, and they
          used to be a single stacked column with a third of a desktop window
          empty beside them. `.flow` is the whole fix: they share a row as soon as
          two fit, and fall back to the stack when they do not. */}
      <div className="flow">
        <Card title={t('settings.language.title')}>
          <LanguageSwitcher />
          <p className="subtle" style={{ margin: '10px 0 0' }}>
            {t('settings.language.note')}
          </p>
        </Card>

        {/* The map source sits high on the page on purpose: it is the only
            setting here that decides whether something leaves this machine, and a
            choice like that should not be below a table of devices. */}
        <MapSourceCard />

        <Card title={t('settings.devices.title')}>
          {devices.isError ? (
            <ErrorState error={devices.error} />
          ) : (devices.data?.length ?? 0) === 0 ? (
            <p style={{ margin: 0, color: 'var(--text-dim)' }}>{t('settings.devices.empty')}</p>
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

        {/* The export moved to My account (docs/36 §5.6, "Adataim"): it is
                the person's own data out, next to deleting the account. */}
        <Card title={t('settings.export.title')}>
          <p style={{ margin: 0 }}>
            {tx('settings.export.moved', { link: <Link to="/account">{t('nav.account')}</Link> })}
          </p>
        </Card>

        <Card title={t('settings.system.title')}>
          <div className="table-wrap">
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
          </div>
        </Card>
      </div>
    </>
  )
}
