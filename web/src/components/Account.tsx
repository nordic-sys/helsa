// The pieces My account (pages/Account.tsx) and an admin's member page
// (pages/Member.tsx) share: the device list, the account log and the
// type-the-handle confirmation. One drawing for both, because the member page
// promises "the same list the member sees" (openapi.yaml), and two components
// would drift apart one wording at a time.

import { useRef, useState, type ReactNode } from 'react'
import type { AccountEvent, TokenInfo } from '../api/types'
import { useI18n } from '../i18n'
import { useFormat } from '../lib/format'
import { liveTokens, logLine } from '../lib/household'
import { Empty } from './ui'

// --- Devices and sessions -----------------------------------------------------

export function TokenList({
  tokens,
  onRevoke,
  onSignOut,
  empty,
}: {
  tokens: TokenInfo[] | undefined
  onRevoke: (t: TokenInfo) => Promise<void>
  /** Given on My account only: this browser's own row signs out instead. */
  onSignOut?: () => void
  empty: string
}) {
  const { t } = useI18n()
  const f = useFormat()
  const live = liveTokens(tokens)
  if (live.length === 0)
    return (
      <p className="subtle" style={{ margin: 0 }}>
        {empty}
      </p>
    )
  return (
    <div className="table-wrap table-wrap--anchor">
      <table>
        <thead>
          <tr>
            <th>{t('tokens.col.label')}</th>
            <th>{t('tokens.col.kind')}</th>
            <th>{t('tokens.col.created')}</th>
            <th>{t('tokens.col.lastUsed')}</th>
            <th>
              <span className="sr-only">{t('tokens.col.action')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {live.map((tok) => (
            <tr key={tok.id}>
              {/* The label is what the phone or the browser was called when it
                  joined — the member's words, not interface text. */}
              <td>
                {tok.label}
                {tok.current && <span className="chip">{t('tokens.thisOne')}</span>}
              </td>
              <td>{tok.kind === 'web' ? t('tokens.kind.web') : t('tokens.kind.device')}</td>
              <td>{f.date(tok.created_at)}</td>
              <td>
                {tok.current
                  ? t('tokens.now')
                  : tok.last_used_at
                    ? f.relative(tok.last_used_at)
                    : t('tokens.never')}
              </td>
              <td className="num">
                {tok.current && tok.kind === 'web' && onSignOut ? (
                  <button type="button" className="btn btn-small" onClick={onSignOut}>
                    {t('menu.signOut')}
                  </button>
                ) : (
                  <RevokeButton token={tok} onRevoke={onRevoke} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Revoking a phone stops it uploading — one question first, in place. */
function RevokeButton({ token, onRevoke }: { token: TokenInfo; onRevoke: (t: TokenInfo) => Promise<void> }) {
  const { t } = useI18n()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  if (!asking) {
    return (
      <button type="button" className="btn btn-small" onClick={() => setAsking(true)}>
        {t('tokens.revoke')}
      </button>
    )
  }
  return (
    <span className="inline-confirm" role="group" aria-label={t('tokens.revokeAria', { label: token.label })}>
      <span>{token.kind === 'web' ? t('tokens.revokeAsk.web') : t('tokens.revokeAsk.device')}</span>
      <button
        type="button"
        className="btn btn-small btn-danger"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setFailed(false)
          try {
            await onRevoke(token)
          } catch {
            setFailed(true)
            setBusy(false)
          }
        }}
      >
        {t('tokens.revokeYes')}
      </button>
      <button type="button" className="btn btn-small" onClick={() => setAsking(false)} disabled={busy}>
        {t('common.cancel')}
      </button>
      {failed && <span className="form-error">{t('tokens.revokeFailed')}</span>}
    </span>
  )
}

// --- The account log ----------------------------------------------------------

export function AccountLog({
  events,
  viewerIsOwner,
}: {
  events: AccountEvent[] | undefined
  viewerIsOwner: boolean
}) {
  const { t } = useI18n()
  const f = useFormat()
  const role = (r: string) => (r === 'admin' ? t('role.admin') : r === 'member' ? t('role.member') : r)
  if (!events?.length) return <Empty title={t('log.empty')} />
  return (
    <ol className="account-log">
      {events.map((ev, i) => {
        const line = logLine(ev, viewerIsOwner, t('log.operator'), role)
        return (
          <li key={`${ev.at}-${i}`}>
            <time dateTime={ev.at}>{f.dateTime(ev.at)}</time>
            <span>
              {'key' in line
                ? t(line.key, line.params)
                : t('log.unknown', { actor: line.actor ?? t('log.operator'), kind: line.raw })}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

// --- Type the handle to confirm -----------------------------------------------

/**
 * A deletion asks for the account's handle (A10) — typed, not clicked, because
 * a deletion cannot be taken back and the handle is the one word nobody types by
 * accident. The server checks it too (`DeleteConfirm`).
 */
export function ConfirmByHandle({
  handle,
  children,
  action,
  onConfirm,
  onCancel,
}: {
  handle: string
  children: ReactNode
  action: string
  onConfirm: () => Promise<void>
  onCancel: () => void
}) {
  const { t } = useI18n()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const matches = typed.trim().toLowerCase() === handle.toLowerCase()
  return (
    <div className="confirm confirm--danger" role="group" aria-label={action}>
      {children}
      <label className="form-field">
        <span>{t('delete.typeHandle', { handle })}</span>
        <input
          ref={input}
          className="text-input"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />
      </label>
      <div className="btn-row">
        <button
          type="button"
          className="btn btn-danger"
          disabled={!matches || busy}
          onClick={async () => {
            setBusy(true)
            setError(null)
            try {
              await onConfirm()
            } catch (e) {
              setError((e as { detail?: string; message?: string }).detail ?? t('delete.failed'))
              setBusy(false)
            }
          }}
        >
          {action}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
    </div>
  )
}
