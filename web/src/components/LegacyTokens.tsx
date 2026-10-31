// A token from before the household register is still in use (docs/36 §5.3, W4).
//
// Such a token has no row: it is in no device list, and could be revoked one by
// one only by its exact text, which sits in a phone's keychain. So the server
// remembers when one was last accepted, and one call refuses every one of them
// issued until then. The order the text asks for matters — connect the device
// again with a code FIRST — because the device still using the old token stops
// sending the moment it is revoked.

import { useState } from 'react'
import type { ApiError } from '../api/client'
import { useI18n } from '../i18n'
import { useFormat } from '../lib/format'
import { Alert } from './ui'

export function LegacyTokens({
  usedAt,
  name,
  onRevoke,
}: {
  usedAt?: string
  /** The member's name, on an admin's view of somebody else; absent on one's own. */
  name?: string
  onRevoke: () => Promise<void>
}) {
  const { t } = useI18n()
  const f = useFormat()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!usedAt) return null

  const revoke = async () => {
    setBusy(true)
    setError(null)
    try {
      await onRevoke()
      setAsking(false)
    } catch (e) {
      setError((e as ApiError).status === 409 ? t('legacy.selfRefused') : t('legacy.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Alert tone="warn" title={name ? t('legacy.titleFor', { name }) : t('legacy.title')} live={false}>
      <p>{t('legacy.body', { when: f.relative(usedAt) })}</p>
      <p>{name ? t('legacy.howFor', { name }) : t('legacy.how')}</p>
      {asking ? (
        <div className="confirm confirm--danger" role="group" aria-label={t('legacy.revoke')}>
          <p style={{ margin: 0 }}>{t('legacy.ask')}</p>
          <div className="btn-row">
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void revoke()}>
              {t('legacy.confirm')}
            </button>
            <button type="button" className="btn" onClick={() => setAsking(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <div className="btn-row">
          <button type="button" className="btn" onClick={() => setAsking(true)}>
            {t('legacy.revoke')}
          </button>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Alert>
  )
}
