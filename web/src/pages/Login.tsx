// The sign-in page (docs/36 §5.1; wording §9.4).
//
// ⚠️ **One sentence for every way a code is wrong.** The server answers expired,
// used, mistyped, revoked and "a phone code typed into the browser" with the same
// 401, on purpose (C7): which of them it was is exactly what somebody guessing
// codes would like to learn. The page cannot know either, so it does not pretend
// to — it names all the reasons at once and says what to do (A3). Too many tries
// (429) is a different situation with a different remedy, and is said apart.

import { useState, type FormEvent } from 'react'
import type { ApiError } from '../api/client'
import { api } from '../api/client'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { Alert } from '../components/ui'
import { useI18n } from '../i18n'
import { normalizeCode } from '../lib/household'
import type { SignedOutReason } from '../session'

/** What the operator runs on the server for the very first sign-in (A5). */
export const FIRST_LOGIN_COMMAND = 'make prod-login-code HANDLE=…'

type Failure = 'shape' | 'rejected' | 'limited' | 'unavailable' | { other: ApiError }

export default function Login({
  reason,
  legacyNotice,
  onSignedIn,
  bootError,
}: {
  reason: SignedOutReason
  legacyNotice: boolean
  onSignedIn: () => Promise<void>
  bootError?: unknown
}) {
  const { t } = useI18n()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const normal = normalizeCode(code)
    if (!normal) {
      setFailure('shape')
      return
    }
    setBusy(true)
    setFailure(null)
    try {
      await api.webLogin(normal)
      await onSignedIn()
    } catch (err) {
      const status = (err as ApiError).status
      setFailure(
        status === 401
          ? 'rejected'
          : status === 429
            ? 'limited'
            : status === 503 || status === undefined
              ? 'unavailable'
              : { other: err as ApiError },
      )
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <div className="login-box">
        <div className="brand login-brand">
          <BrandMark />
          <span>Helsa</span>
        </div>

        {reason === 'ended' && <Alert tone="info" title={t('login.ended')} />}
        {reason === 'signedOut' && <Alert tone="info" title={t('login.signedOut')} live={false} />}
        {reason === 'deleted' && (
          <Alert tone="info" title={t('login.deleted.title')}>
            <p>{t('login.deleted.body')}</p>
          </Alert>
        )}
        {legacyNotice && (
          <Alert tone="info" title={t('login.legacy.title')} live={false}>
            <p>{t('login.legacy.body')}</p>
          </Alert>
        )}
        {bootError != null && <Alert tone="warn" title={t('login.unreachable')} />}

        <h1>{t('login.title')}</h1>
        <p className="subtle">{t('login.intro')}</p>

        <form className="login-form" onSubmit={submit} noValidate>
          <label htmlFor="login-code" className="sr-only">
            {t('login.codeLabel')}
          </label>
          <input
            id="login-code"
            className="text-input code-input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="K7QM-4XPA"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={16}
            aria-invalid={failure === 'shape' || failure === 'rejected' || undefined}
            aria-describedby={failure ? 'login-error' : undefined}
            disabled={busy}
            autoFocus
          />
          <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy || undefined}>
            {busy ? t('login.busy') : t('login.submit')}
          </button>
        </form>

        <div id="login-error" aria-live="polite">
          {failure && <p className="form-error">{failureText(failure, t)}</p>}
        </div>

        <p className="subtle login-first">
          {t('login.first')} <code>{FIRST_LOGIN_COMMAND}</code>
        </p>

        <div className="login-foot">
          <LanguageSwitcher />
        </div>
      </div>
    </div>
  )
}

function failureText(f: Failure, t: ReturnType<typeof useI18n>['t']): string {
  if (f === 'shape') return t('login.error.shape')
  if (f === 'rejected') return t('login.error.rejected')
  if (f === 'limited') return t('login.error.limited')
  if (f === 'unavailable') return t('login.error.unavailable')
  // A 403 (this address is not the server's own origin) and the like: the
  // server's own words, which say what is wrong better than a guess here.
  return f.other.detail ?? f.other.message
}

function BrandMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
      <path d="M4 22a12 12 0 0 1 24 0" stroke="var(--helsa-fjord)" strokeWidth="3" strokeLinecap="round" />
      <path
        d="M6 24h5l2-4 3 7 2-5h8"
        stroke="var(--helsa-move)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
