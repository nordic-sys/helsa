// The one-time code, shown once (docs/36 §5.5).
//
// Two kinds, and they are deliberately NOT drawn alike:
//
//   * **a connection code (phone)** carries a QR of
//     `helsa://enrol?e=<server>&c=<code>` — the phone scans it and has both the
//     address and the code without typing — AND the code and the address as
//     text, for the phone that types them by hand (A2);
//   * **a sign-in code (browser)** has NO QR (A3). It is typed on the sign-in
//     page of a browser, and a QR on screen would only invite somebody to scan
//     it with a phone, where it is refused with the one 401 that explains nothing.
//
// The code is never stored by the page: closing the dialog forgets it, and the
// server holds only its hash.

import { useEffect, useRef, useState } from 'react'
import type { CodeIssued } from '../api/types'
import { useI18n } from '../i18n'
import { deviceEndpoint, enrolUrl, mmss, secondsLeft } from '../lib/household'
import { QrCode } from './QrCode'

export function CodeDialog({
  code,
  forName,
  serverEndpoint,
  onClose,
}: {
  code: CodeIssued
  /** Whose code it is, when an admin issued it for somebody else. */
  forName?: string
  /** The phone's address as the server knows it (GET /v1/me device_endpoint). */
  serverEndpoint?: string
  onClose: () => void
}) {
  const { t, locale } = useI18n()
  const closeRef = useRef<HTMLButtonElement>(null)
  const now = useNow(1000)
  const left = secondsLeft(code.expires_at, now)
  const device = code.purpose === 'device'
  const endpoint = deviceEndpoint(window.location, import.meta.env.VITE_HELSA_DEVICE_ENDPOINT, serverEndpoint)
  const until = new Date(code.expires_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  const title = device
    ? forName
      ? t('code.device.titleFor', { name: forName })
      : t('code.device.title')
    : forName
      ? t('code.web.titleFor', { name: forName })
      : t('code.web.title')

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="code-dialog-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
        }}
      >
        <div className="modal-head">
          <h2 id="code-dialog-title">{title}</h2>
          <button ref={closeRef} type="button" className="btn" onClick={onClose}>
            {t('code.close')}
          </button>
        </div>

        <div className={device ? 'code-body code-body--qr' : 'code-body'}>
          {device && left > 0 && <QrCode value={enrolUrl(endpoint, code.code)} label={t('code.qrLabel')} />}
          <div className="code-text">
            <div className="code-value" data-testid="code-value">
              {code.code}
            </div>
            <p className="subtle" aria-live="polite" style={{ margin: 0 }}>
              {left > 0 ? t('code.expires', { time: until, left: mmss(left) }) : t('code.expired')}
            </p>
            <Copyable
              label={device ? t('code.device.address') : t('code.web.address')}
              value={device ? endpoint : window.location.origin}
            />
          </div>
        </div>

        {device ? (
          <>
            <p>{t('code.device.howTo')}</p>
            <p className="subtle">{forName ? t('code.device.certAdmin') : t('code.device.cert')}</p>
          </>
        ) : (
          <p>{t('code.web.howTo')}</p>
        )}
        <p className="subtle" style={{ marginBottom: 0 }}>
          {t('code.once')}
        </p>
      </div>
    </div>
  )
}

/** A value to copy: selectable text, and a button where the clipboard works. */
function Copyable({ label, value }: { label: string; value: string }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  return (
    <div className="copyable">
      <span className="copyable-label">{label}</span>
      <code className="copyable-value">{value}</code>
      {navigator.clipboard && (
        <button
          type="button"
          className="btn btn-small"
          onClick={() => {
            navigator.clipboard.writeText(value).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }}
        >
          {copied ? t('code.copied') : t('code.copy')}
        </button>
      )}
    </div>
  )
}

/** `Date.now()`, re-read every `ms` — for a countdown. */
export function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}
