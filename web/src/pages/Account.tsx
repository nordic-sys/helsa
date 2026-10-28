// My account — every member's own page (docs/36 §5.6).
//
// What it is for: the person's devices and sessions, their own Home Assistant
// switch, what the server's owner can and cannot see, their data out (export)
// and their account gone (delete), and the log of what was done with the
// account. Everything here acts on the CALLER — the routes are `/me…` — so it is
// the same page for an admin and a member.
//
// ⚠️ The "what does the owner see" block is the promise the household rests on
// (§2.5), in the words Bob signed off (§9.4, A16): the interface sentence and the
// database sentence are SEPARATE, so that the log is not read as an audit of the
// database — it is not one.

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type ApiError } from '../api/client'
import type { CodeIssued, TokenInfo } from '../api/types'
import { AccountLog, ConfirmByHandle, TokenList } from '../components/Account'
import { CodeDialog } from '../components/CodeDialog'
import { ExportCard } from '../components/ExportCard'
import { Card, ErrorState, PageHead } from '../components/ui'
import { useI18n } from '../i18n'
import { useSession } from '../session'

export default function Account() {
  const { t } = useI18n()
  const session = useSession()
  const { me } = session
  const qc = useQueryClient()
  const [code, setCode] = useState<CodeIssued | null>(null)
  const [codeError, setCodeError] = useState(false)

  const tokens = useQuery({ queryKey: ['me', 'tokens'], queryFn: () => api.myTokens() })
  const events = useQuery({ queryKey: ['me', 'events'], queryFn: () => api.myEvents() })
  const refresh = () => qc.invalidateQueries({ queryKey: ['me'] })

  const issue = useMutation({
    mutationFn: (purpose: 'device' | 'web') =>
      purpose === 'device' ? api.myDeviceCode() : api.myLoginCode(),
    onSuccess: (c) => {
      setCodeError(false)
      setCode(c)
      refresh()
    },
    onError: () => setCodeError(true),
  })

  const revoke = async (tok: TokenInfo) => {
    await api.revokeMyToken(tok.id)
    await refresh()
  }

  const name = me.display_name ?? me.handle ?? ''

  return (
    <>
      <PageHead
        title={t('account.title')}
        subtitle={[name, me.handle, me.role === 'admin' ? t('role.admin') : t('role.member')]
          .filter(Boolean)
          .join(' · ')}
      />

      <div className="sections">
        <Card title={t('account.devices.title')}>
          {tokens.isError ? (
            <ErrorState error={tokens.error} />
          ) : (
            <TokenList
              tokens={tokens.data}
              onRevoke={revoke}
              onSignOut={() => void session.signOut()}
              empty={t('account.devices.empty')}
            />
          )}
          <div className="btn-row" style={{ marginTop: 14 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={issue.isPending}
              onClick={() => issue.mutate('device')}
            >
              {t('account.devices.connect')}
            </button>
            <button
              type="button"
              className="btn"
              disabled={issue.isPending}
              onClick={() => issue.mutate('web')}
            >
              {t('account.devices.webCode')}
            </button>
          </div>
          {codeError && <p className="form-error">{t('code.failed')}</p>}
        </Card>

        <div className="flow">
          <HomeAssistantCard />
          <Card title={t('account.visibility.title')}>
            {me.role === 'admin' ? (
              <p style={{ margin: 0 }}>{t('account.visibility.admin')}</p>
            ) : (
              <>
                <p style={{ marginTop: 0 }}>{t('account.visibility.ui')}</p>
                <p style={{ marginBottom: 0 }}>{t('account.visibility.db')}</p>
              </>
            )}
          </Card>
        </div>

        <ExportCard />

        <DeleteAccountCard />

        <Card title={t('account.log.title')}>
          {events.isError ? (
            <ErrorState error={events.error} />
          ) : (
            <AccountLog events={events.data} viewerIsOwner />
          )}
        </Card>
      </div>

      {code && <CodeDialog code={code} serverEndpoint={session.me.device_endpoint} onClose={() => setCode(null)} />}
    </>
  )
}

/**
 * The person's own switch (C25): an admin cannot turn it on for them, and it is
 * off for a new member. The second sentence is the reason it is a switch at all —
 * a Home Assistant is read by the whole house.
 */
function HomeAssistantCard() {
  const { t } = useI18n()
  const { me, setMe } = useSession()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const on = !!me.ha_publish
  return (
    <Card title={t('account.ha.title')}>
      <label className="check">
        <input
          type="checkbox"
          checked={on}
          disabled={busy}
          onChange={async (e) => {
            setBusy(true)
            setFailed(false)
            try {
              setMe(await api.patchMe({ ha_publish: e.target.checked }))
            } catch {
              setFailed(true)
            } finally {
              setBusy(false)
            }
          }}
        />
        <span>{t('account.ha.label')}</span>
      </label>
      <p className="subtle" style={{ margin: '8px 0 0 28px' }}>
        {t('account.ha.note')}
      </p>
      {failed && <p className="form-error">{t('account.ha.failed')}</p>}
    </Card>
  )
}

function DeleteAccountCard() {
  const { t } = useI18n()
  const { me, forget } = useSession()
  const [asking, setAsking] = useState(false)
  // ⚠️ Absent = an older server that never said: do not offer what it may refuse.
  const allowed = me.capabilities?.can_delete_self === true
  const handle = me.handle ?? ''
  return (
    <Card title={t('account.delete.title')}>
      {!allowed ? (
        <>
          <button type="button" className="btn btn-danger" disabled aria-describedby="delete-why">
            {t('account.delete.button')}
          </button>
          <p id="delete-why" className="subtle" style={{ margin: '10px 0 0' }}>
            {me.capabilities?.can_delete_self === false
              ? t('account.delete.lastAdmin')
              : t('account.delete.unavailable')}
          </p>
        </>
      ) : asking ? (
        <ConfirmByHandle
          handle={handle}
          action={t('account.delete.confirm')}
          onCancel={() => setAsking(false)}
          onConfirm={async () => {
            try {
              await api.deleteMe(handle)
            } catch (e) {
              if ((e as ApiError).status === 409) throw { detail: t('account.delete.lastAdmin') }
              throw e
            }
            // The account is disabled from this moment, this session with it.
            forget('deleted')
          }}
        >
          <p style={{ margin: 0 }}>{t('account.delete.body')}</p>
        </ConfirmByHandle>
      ) : (
        <>
          <p style={{ marginTop: 0 }}>{t('account.delete.intro')}</p>
          <button type="button" className="btn btn-danger" onClick={() => setAsking(true)}>
            {t('account.delete.button')}
          </button>
        </>
      )}
    </Card>
  )
}
