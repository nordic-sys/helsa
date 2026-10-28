// One member, for an admin (docs/36 §5.4).
//
// The rules this page carries, each from the review (§9):
//
//   * **Disabling is not revoking (A8).** A disabled member's phone and browser
//     are refused, but their tokens stay: re-enabling lets the same phone carry
//     on. Revoking is a separate, per-device act in the table below.
//   * **A disabled member cannot export (A9)** — which is why the disable and the
//     delete confirmations both say so: an admin about to delete somebody who is
//     disabled has to know that the member can no longer save their data first.
//   * **Two buttons, not one with a choice inside (A6):** connecting a phone and
//     a browser sign-in code are different acts with different reach.
//   * **Codes only for a member with nothing live (C2, Bob's decision).** A
//     member who has a working device asks for their own; otherwise an admin
//     could quietly redeem a code and be them. The server answers 409, and the
//     page says what to do instead — before the button is pressed, too.
//   * **Your own row is not managed from here (A19):** role, disabling and
//     deletion are inactive on it, so the last admin cannot lock themselves out
//     by a slip. Codes and revoking stay — those are yours to use.

import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type ApiError } from '../api/client'
import type { CodeIssued, CodePurpose, Member, Role, TokenInfo } from '../api/types'
import { AccountLog, ConfirmByHandle, TokenList } from '../components/Account'
import { CodeDialog } from '../components/CodeDialog'
import { Alert, Card, ErrorState, Loading, PageHead } from '../components/ui'
import { useI18n } from '../i18n'
import { useFormat } from '../lib/format'
import { useSession } from '../session'
import { MEMBERS_KEY, memberName } from './Household'

export default function MemberPage() {
  const { id = '' } = useParams()
  const { t } = useI18n()
  const member = useQuery({ queryKey: ['household', 'member', id], queryFn: () => api.member(id) })

  return (
    <>
      <p className="back-link">
        <Link to="/household">‹ {t('household.title')}</Link>
      </p>
      {member.isLoading ? (
        <Loading rows={2} />
      ) : member.isError ? (
        <ErrorState error={member.error} />
      ) : member.data ? (
        <MemberDetail m={member.data} />
      ) : null}
    </>
  )
}

function MemberDetail({ m }: { m: Member }) {
  const { t } = useI18n()
  const f = useFormat()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { me } = useSession()
  const own = m.id === me.id
  const name = memberName(m)
  const [busy, setBusy] = useState(false)
  const [patchError, setPatchError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'disable' | 'delete' | null>(null)
  const [code, setCode] = useState<CodeIssued | null>(null)
  const [codeError, setCodeError] = useState<string | null>(null)

  const tokens = useQuery({
    queryKey: ['household', 'member', m.id, 'tokens'],
    queryFn: () => api.memberTokens(m.id),
  })
  const events = useQuery({
    queryKey: ['household', 'member', m.id, 'events'],
    queryFn: () => api.memberEvents(m.id),
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['household'] })

  async function patch(body: { role?: Role; disabled?: boolean }) {
    setBusy(true)
    setPatchError(null)
    try {
      const next = await api.patchMember(m.id, body)
      qc.setQueryData(['household', 'member', m.id], next)
      await refresh()
      setConfirm(null)
    } catch (e) {
      setPatchError((e as ApiError).status === 409 ? t('member.lastAdmin') : t('member.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function issue(purpose: CodePurpose) {
    setCodeError(null)
    try {
      setCode(await api.memberCode(m.id, purpose))
      await refresh()
    } catch (e) {
      setCodeError((e as ApiError).status === 409 ? t('member.code.hasDevice', { name }) : t('code.failed'))
    }
  }

  const revoke = async (tok: TokenInfo) => {
    await api.revokeMemberToken(m.id, tok.id)
    await refresh()
  }

  // The server is the one that decides (409); this only says it before the click.
  const hasLive = !own && (m.devices ?? 0) > 0

  return (
    <>
      <PageHead
        title={
          <>
            {name}
            {own && <span className="subtle"> {t('household.you')}</span>}
          </>
        }
        subtitle={t('member.line', { handle: m.handle, date: f.date(m.created_at) })}
        aside={
          <div className="btn-row">
            <label className="sr-only" htmlFor="member-role">
              {t('member.role')}
            </label>
            <select
              id="member-role"
              className="select"
              value={m.role}
              disabled={own || busy}
              onChange={(e) => void patch({ role: e.target.value as Role })}
            >
              <option value="member">{t('role.member')}</option>
              <option value="admin">{t('role.admin')}</option>
            </select>
            {m.disabled ? (
              <button
                type="button"
                className="btn"
                disabled={own || busy}
                onClick={() => void patch({ disabled: false })}
              >
                {t('member.enable')}
              </button>
            ) : (
              <button
                type="button"
                className="btn"
                disabled={own || busy}
                onClick={() => setConfirm('disable')}
              >
                {t('member.disable')}
              </button>
            )}
            <button
              type="button"
              className="btn btn-danger"
              disabled={own || busy}
              onClick={() => setConfirm('delete')}
            >
              {t('member.delete')}
            </button>
          </div>
        }
      />

      <div className="sections">
        {own && (
          <p className="subtle" style={{ margin: 0 }}>
            {t('member.own')}
          </p>
        )}
        {m.disabled && (
          <Alert tone="warn" title={t('member.disabledNow.title', { name })} live={false}>
            <p>{t('member.disabledNow.body', { name })}</p>
          </Alert>
        )}
        {patchError && <p className="form-error">{patchError}</p>}

        {confirm === 'disable' && (
          <div className="confirm confirm--danger" role="group" aria-label={t('member.disable')}>
            <p style={{ margin: 0 }}>{t('member.disableAsk', { name })}</p>
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={() => void patch({ disabled: true })}
              >
                {t('member.disable')}
              </button>
              <button type="button" className="btn" onClick={() => setConfirm(null)}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}

        {confirm === 'delete' && (
          <ConfirmByHandle
            handle={m.handle}
            action={t('member.deleteConfirm', { name })}
            onCancel={() => setConfirm(null)}
            onConfirm={async () => {
              try {
                await api.deleteMember(m.id, m.handle)
              } catch (e) {
                if ((e as ApiError).status === 409) throw { detail: t('member.lastAdmin') }
                throw e
              }
              await qc.invalidateQueries({ queryKey: MEMBERS_KEY })
              navigate('/household')
            }}
          >
            <p style={{ margin: 0 }}>{t('member.deleteBody', { name })}</p>
            {m.disabled && <p style={{ margin: 0 }}>{t('member.deleteDisabled', { name })}</p>}
          </ConfirmByHandle>
        )}

        <Card title={t('member.devices.title')}>
          {tokens.isError ? (
            <ErrorState error={tokens.error} />
          ) : (
            <TokenList tokens={tokens.data} onRevoke={revoke} empty={t('member.devices.empty', { name })} />
          )}
          <div className="btn-row" style={{ marginTop: 14 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={hasLive}
              onClick={() => void issue('device')}
            >
              {t('member.code.device')}
            </button>
            <button type="button" className="btn" disabled={hasLive} onClick={() => void issue('web')}>
              {t('member.code.web')}
            </button>
          </div>
          {(hasLive || codeError) && (
            <p className={codeError ? 'form-error' : 'subtle'} style={{ margin: '10px 0 0' }}>
              {codeError ?? t('member.code.hasDevice', { name })}
            </p>
          )}
        </Card>

        <Card title={t('member.log.title', { name })}>
          {events.isError ? (
            <ErrorState error={events.error} />
          ) : (
            <AccountLog events={events.data} viewerIsOwner={own} />
          )}
        </Card>
      </div>

      {code && <CodeDialog code={code} forName={own ? undefined : name} serverEndpoint={me.device_endpoint} onClose={() => setCode(null)} />}
    </>
  )
}
