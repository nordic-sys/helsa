import type { ReactNode } from 'react'
import { ApiError } from '../api/client'
import { useI18n } from '../i18n'
import { useFormat } from '../lib/format'

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="card">
      {title && <h2>{title}</h2>}
      {children}
    </div>
  )
}

export function Stat({
  label,
  value,
  unit,
  color,
}: {
  label: string
  value: ReactNode
  unit?: string
  color?: string
}) {
  return (
    <div className="card stat-card">
      <h2>{label}</h2>
      <div className="stat" style={color ? { color } : undefined}>
        {value}
        {unit ? <small>{unit}</small> : null}
      </div>
    </div>
  )
}

export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="grid" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, i) => (
        <div className="card" key={i}>
          <div className="skeleton" style={{ height: 13, width: '45%', marginBottom: 12 }} />
          <div className="skeleton" />
        </div>
      ))}
    </div>
  )
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="state">
      <strong>{title}</strong>
      {hint}
    </div>
  )
}

/** A warning that is not an error: the data is there, but it needs a caveat to be
 * read correctly. */
export function Note({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="note">
      <strong>{title}</strong>
      {children}
    </div>
  )
}

/** A colour legend — mandatory from two series upwards. */
export function Legend({ items }: { items: { label: string; color: string; value?: string }[] }) {
  return (
    <div className="legend">
      {items.map((it) => (
        <span className="legend-item" key={it.label}>
          <span className="swatch" style={{ background: it.color }} />
          {it.label}
          {it.value ? <strong style={{ color: 'var(--text)' }}>{it.value}</strong> : null}
        </span>
      ))}
    </div>
  )
}

/**
 * The error state. A 401 is handled separately, because it has a concrete course
 * of action.
 *
 * ⚠️ `e.message` and `e.detail` come from the backend's problem+json and are
 * NOT translated here — they are server content, not interface text. Only the
 * fallbacks below are ours.
 */
export function ErrorState({ error }: { error: unknown }) {
  const { t } = useI18n()
  const e = error as ApiError
  if (e?.status === 401 || e?.status === 403) {
    return (
      <div className="state error">
        <strong>{t('error.noToken.title')}</strong>
        {t('error.noToken.body')}
      </div>
    )
  }
  return (
    <div className="state error">
      <strong>{e?.message ?? t('error.generic.title')}</strong>
      {e?.detail ?? t('error.generic.detail')}
    </div>
  )
}

/** The ring for Apple's Move/Exercise/Stand trio. */
export function Ring({
  value,
  goal,
  color,
  label,
  unit,
  size = 104,
}: {
  value?: number
  goal?: number
  color: string
  label: string
  unit?: string
  size?: number
}) {
  const f = useFormat()
  // ⚠️ The `?? 0` belongs HERE and nowhere else. An arc has to have a length, and a
  // missing value draws none — but that is a fact about the drawing, not about the day.
  // Feeding the same `?? 0` to the formatter is what turned "we did not measure this"
  // into "you did nothing", in the text and in the screen-reader label alike.
  const pct = goal && goal > 0 ? Math.min((value ?? 0) / goal, 1) : 0
  const stroke = 11
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <div style={{ textAlign: 'center' }}>
      <svg
        width={size}
        height={size}
        role="img"
        aria-label={`${label}: ${f.num(value)} / ${f.num(goal)} ${unit ?? ''}`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--surface-2)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div style={{ marginTop: 6, fontSize: 13, color: 'var(--text-dim)' }}>{label}</div>
      <div style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
        {f.num(value)}
        <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>
          {' / '}
          {f.num(goal)} {unit}
        </span>
      </div>
    </div>
  )
}
