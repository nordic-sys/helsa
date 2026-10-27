// The export button — `POST /v1/export`, which existed long before anything on
// the web called it.
//
// # Why it lives on Settings
//
// The phone puts its export on a screen of its own, beside "Your own server",
// because it has two halves to offer (`ExportView.swift`: from HealthKit, and
// from the server). The web has only the server half — there is no HealthKit in
// a browser — and one card of it sits naturally beside the token and the
// devices: the same machinery, the same "your data, from your server".
//
// # What it promises, and only that
//
// * **Progress is bytes, not a percentage.** The server streams rows straight
//   from a database cursor and does not know the size either, so there is no
//   Content-Length to divide by. A made-up bar would be a claim about a number
//   nobody has.
// * **A JSON file is checked before it is saved; a CSV cannot be.** Once the
//   server has sent 200 it cannot take it back, so an export that fails half-way
//   arrives as a short 200 (`server/export.go`). JSON ends on `]}` and is
//   checked; a CSV that stops after any row is still a valid CSV, and the card
//   says so rather than implying a check it does not make.
// * **No PDF.** It is in the contract and answers 501 — offering it would be a
//   button that always fails (the phone draws the same line).

import { useEffect, useRef, useState } from 'react'
import { ApiError, api, type ExportRequest } from '../api/client'
import { useI18n } from '../i18n'
import {
  EXPORT_DAY_OPTIONS,
  exportWindow,
  fallbackFilename,
  filenameFrom,
  formatBytes,
  jsonLooksComplete,
  rangeValid,
} from '../lib/exportFile'
import { METRIC_LIST } from '../lib/metrics'
import { useAvailability } from '../lib/useAvailability'
import { Card } from './ui'

type Format = 'csv' | 'json'
type Period = (typeof EXPORT_DAY_OPTIONS)[number] | 'custom'

type Status =
  | { kind: 'idle' }
  | { kind: 'running'; bytes: number; started: number }
  | { kind: 'done'; file: string; bytes: number }
  | { kind: 'cancelled' }
  | { kind: 'truncated' }
  | { kind: 'failed'; message: string }

const inputStyle: React.CSSProperties = {
  padding: '7px 10px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
  font: 'inherit',
}

/** Hands a finished blob to the browser as a download. Separate so a test can
 * replace it — jsdom has no downloads. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoked a moment later: some engines start the download asynchronously and
  // a URL revoked in the same tick downloads nothing.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function ExportCard({ save = saveBlob }: { save?: (blob: Blob, filename: string) => void }) {
  const { t, tp, locale } = useI18n()
  const [format, setFormat] = useState<Format>('csv')
  const [period, setPeriod] = useState<Period>(30)
  const initial = exportWindow(30, new Date())
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [allMetrics, setAllMetrics] = useState(true)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const abort = useRef<AbortController | null>(null)
  const [, tick] = useState(0)

  // A clock for the elapsed seconds while the file is arriving — the only sign
  // of life a long export has before its first bytes.
  const running = status.kind === 'running'
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [running])

  // Leaving the page stops the download rather than finishing it into nowhere.
  useEffect(() => () => abort.current?.abort(), [])

  const badRange = period === 'custom' && !rangeValid(from, to)
  const noMetrics = !allMetrics && picked.size === 0
  const blocked = running || badRange || noMetrics

  async function run() {
    if (blocked) return
    const win = period === 'custom' ? { from, to } : exportWindow(period, new Date())
    const body: ExportRequest = { format, from: win.from, to: win.to }
    if (!allMetrics) {
      // Every wire name a ticked metric can arrive under (`MetricDef.aliases`):
      // the server filters on the stored `data_type`, which may be either.
      body.metrics = METRIC_LIST.filter((d) => picked.has(d.key)).flatMap((d) => [d.key, ...d.aliases])
    }
    const controller = new AbortController()
    abort.current = controller
    setStatus({ kind: 'running', bytes: 0, started: Date.now() })
    try {
      const file = await api.exportFile(body, {
        signal: controller.signal,
        onProgress: (bytes) =>
          setStatus((s) => (s.kind === 'running' ? { ...s, bytes } : s)),
      })
      if (format === 'json' && !(await jsonLooksComplete(file.blob))) {
        setStatus({ kind: 'truncated' })
        return
      }
      const name = filenameFrom(file.disposition) ?? fallbackFilename(format, win.from, win.to)
      save(file.blob, name)
      setStatus({ kind: 'done', file: name, bytes: file.bytes })
    } catch (err) {
      if (controller.signal.aborted) {
        setStatus({ kind: 'cancelled' })
      } else {
        const message =
          err instanceof ApiError
            ? [err.message, err.detail].filter(Boolean).join(' — ')
            : err instanceof Error
              ? err.message
              : String(err)
        setStatus({ kind: 'failed', message })
      }
    } finally {
      abort.current = null
    }
  }

  const periods: { key: Period; label: string }[] = [
    { key: 30, label: tp('settings.export.days', 30) },
    { key: 90, label: tp('settings.export.days', 90) },
    { key: 365, label: t('settings.export.year') },
    { key: 'custom', label: t('settings.export.custom') },
  ]

  return (
    <Card title={t('settings.export.title')}>
      <p style={{ marginTop: 0, fontSize: 'var(--fs-small)', color: 'var(--text-2)' }}>
        {t('settings.export.intro')}
      </p>

      <div className="export-field">
        <span className="export-label" id="export-format">
          {t('settings.export.format')}
        </span>
        <div className="segmented" role="group" aria-labelledby="export-format">
          {(['csv', 'json'] as const).map((k) => (
            <button
              key={k}
              type="button"
              className="seg"
              aria-pressed={format === k}
              onClick={() => setFormat(k)}
              disabled={running}
            >
              {k.toUpperCase()}
            </button>
          ))}
        </div>
        <p className="subtle" style={{ margin: '6px 0 0' }}>
          {format === 'csv' ? t('settings.export.format.csvNote') : t('settings.export.format.jsonNote')}
        </p>
      </div>

      <div className="export-field">
        <span className="export-label" id="export-period">
          {t('settings.export.period')}
        </span>
        <div className="segmented" role="group" aria-labelledby="export-period">
          {periods.map((p) => (
            <button
              key={p.key}
              type="button"
              className="seg"
              aria-pressed={period === p.key}
              onClick={() => setPeriod(p.key)}
              disabled={running}
            >
              {p.label}
            </button>
          ))}
        </div>
        {period === 'custom' ? (
          <>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10 }}>
              <label style={{ display: 'grid', gap: 4, fontSize: 'var(--fs-caption)' }}>
                {t('settings.export.from')}
                <input
                  type="date"
                  value={from}
                  max={to || undefined}
                  onChange={(e) => setFrom(e.target.value)}
                  disabled={running}
                  style={inputStyle}
                />
              </label>
              <label style={{ display: 'grid', gap: 4, fontSize: 'var(--fs-caption)' }}>
                {t('settings.export.to')}
                <input
                  type="date"
                  value={to}
                  min={from || undefined}
                  onChange={(e) => setTo(e.target.value)}
                  disabled={running}
                  style={inputStyle}
                />
              </label>
            </div>
            <p className="subtle" style={{ margin: '6px 0 0' }}>
              {badRange ? t('settings.export.badRange') : t('settings.export.customNote')}
            </p>
          </>
        ) : (
          <p className="subtle" style={{ margin: '6px 0 0' }}>
            {t('settings.export.periodNote')}
          </p>
        )}
      </div>

      <fieldset className="export-field" style={{ border: 0, padding: 0, margin: '0 0 14px' }}>
        <legend className="export-label">{t('settings.export.metrics')}</legend>
        <label className="export-radio">
          <input
            type="radio"
            name="export-metrics"
            checked={allMetrics}
            onChange={() => setAllMetrics(true)}
            disabled={running}
          />
          {t('settings.export.metrics.all')}
        </label>
        <label className="export-radio">
          <input
            type="radio"
            name="export-metrics"
            checked={!allMetrics}
            onChange={() => setAllMetrics(false)}
            disabled={running}
          />
          {t('settings.export.metrics.some')}
          {!allMetrics && picked.size > 0 && (
            <span className="subtle" style={{ margin: 0 }}>
              {' '}
              · {tp('settings.export.metrics.selected', picked.size)}
            </span>
          )}
        </label>
        {!allMetrics && (
          <MetricChecklist
            picked={picked}
            disabled={running}
            onToggle={(key) =>
              setPicked((prev) => {
                const next = new Set(prev)
                if (next.has(key)) next.delete(key)
                else next.add(key)
                return next
              })
            }
          />
        )}
        <p className="subtle" style={{ margin: '6px 0 0' }}>
          {noMetrics ? t('settings.export.metrics.none') : t('settings.export.metrics.note')}
        </p>
      </fieldset>

      <div className="btn-row">
        <button type="button" className="btn btn-primary" onClick={run} disabled={blocked}>
          {t('settings.export.download')}
        </button>
        {running && (
          <button type="button" className="btn" onClick={() => abort.current?.abort()}>
            {t('settings.export.cancel')}
          </button>
        )}
      </div>

      <div role="status" aria-live="polite" style={{ marginTop: 10, fontSize: 'var(--fs-small)' }}>
        {status.kind === 'running' &&
          (status.bytes === 0 ? (
            <p style={{ margin: 0 }}>{t('settings.export.waiting')}</p>
          ) : (
            <>
              <p style={{ margin: 0 }}>
                {t('settings.export.receiving', {
                  size: formatBytes(status.bytes, locale),
                  seconds: Math.max(0, Math.round((Date.now() - status.started) / 1000)),
                })}
              </p>
              <p className="subtle" style={{ margin: '4px 0 0' }}>
                {t('settings.export.noTotal')}
              </p>
            </>
          ))}
        {status.kind === 'done' && (
          <p style={{ margin: 0 }}>
            {t('settings.export.done', { file: status.file, size: formatBytes(status.bytes, locale) })}
          </p>
        )}
        {status.kind === 'cancelled' && <p style={{ margin: 0 }}>{t('settings.export.cancelled')}</p>}
      </div>
      {(status.kind === 'failed' || status.kind === 'truncated') && (
        <p role="alert" style={{ margin: '6px 0 0', fontSize: 'var(--fs-small)', color: 'var(--error-fg)' }}>
          {status.kind === 'failed'
            ? t('settings.export.failed', { error: status.message })
            : t('settings.export.truncated')}
        </p>
      )}

      <p className="subtle" style={{ margin: '12px 0 0' }}>
        {t('settings.export.footer')}
      </p>
    </Card>
  )
}

/**
 * The metrics that have data, as checkboxes. Its own component so the
 * availability probe runs only once somebody asks to choose — "all metrics" is
 * the default and needs no list.
 */
function MetricChecklist({
  picked,
  disabled,
  onToggle,
}: {
  picked: Set<string>
  disabled: boolean
  onToggle: (key: string) => void
}) {
  const { t, tMetric } = useI18n()
  const availability = useAvailability()
  if (!availability.known) {
    return (
      <p className="subtle" style={{ margin: '6px 0 0' }}>
        {t('settings.export.metrics.listing')}
      </p>
    )
  }
  // Only what exists: a hundred-item list of types with no data in them would
  // be a list of ways to export an empty file.
  const present = METRIC_LIST.filter((d) => availability.has(d.key))
  return (
    <div className="export-metrics">
      {present.map((d) => (
        <label key={d.key} className="export-radio">
          <input
            type="checkbox"
            checked={picked.has(d.key)}
            onChange={() => onToggle(d.key)}
            disabled={disabled}
          />
          {tMetric(d.key)}
        </label>
      ))}
    </div>
  )
}
