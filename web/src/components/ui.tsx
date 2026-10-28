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

/**
 * The text-safe twin of a brand colour.
 *
 * The brand colours are chart fills: `--helsa-move` on a white card is 2.6:1 and
 * not a colour a number can be read in. Callers keep passing the brand token they
 * have always passed (the metric catalogue speaks it), and the number is drawn in
 * the darkened variant from `tokens.css` instead. Anything else passes through.
 */
export function textColor(color?: string): string | undefined {
  const m = color?.match(/^var\(--helsa-(fjord|move|ember|pulse|nordlys)\)$/)
  return m ? `var(--${m[1]}-text)` : color
}

export function Stat({
  label,
  value,
  unit,
  color,
  dot,
  note,
  missing,
  big,
}: {
  label: string
  value: ReactNode
  unit?: string
  /** The figure's colour — a brand token is mapped to its text-safe twin. */
  color?: string
  /** A dot before the label in the metric's colour; the figure stays text-coloured. */
  dot?: string
  /** One line under the figure. */
  note?: ReactNode
  /** Nothing was measured: the dash is drawn dim and the unit is left off. */
  missing?: boolean
  big?: boolean
}) {
  return (
    <div className={`card stat-card${big ? ' stat-big' : ''}`}>
      <h2>
        {dot && <span className="dot" aria-hidden="true" style={{ background: dot }} />}
        {label}
      </h2>
      <div
        className={`stat${missing ? ' is-missing' : ''}`}
        style={color && !missing ? { color: textColor(color) } : undefined}
      >
        {value}
        {unit && !missing ? <small>{unit}</small> : null}
      </div>
      {note != null && <p className="stat-note">{note}</p>}
    </div>
  )
}

/** A page's title row: the heading and its line, and an optional control or
 * status on the right. */
export function PageHead({
  title,
  subtitle,
  aside,
}: {
  title: ReactNode
  subtitle?: ReactNode
  aside?: ReactNode
}) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle != null && <p className="subtle">{subtitle}</p>}
      </div>
      {aside}
    </header>
  )
}

export type AlertTone = 'error' | 'warn' | 'info' | 'unknown'

/** A page-level warning: an icon, a title and its explanation. The tone is the
 * severity, and the title always says it in words as well. */
export function Alert({
  tone,
  title,
  children,
  live = true,
}: {
  tone: AlertTone
  title: ReactNode
  children?: ReactNode
  /** `role="alert"` — off for a standing condition that should not interrupt. */
  live?: boolean
}) {
  return (
    <section className={`alert alert--${tone}`} role={live ? 'alert' : undefined}>
      {tone !== 'unknown' && <AlertIcon tone={tone} />}
      <div className="alert-body">
        <h2 className="alert-title">{title}</h2>
        {children}
      </div>
    </section>
  )
}

function AlertIcon({ tone }: { tone: Exclude<AlertTone, 'unknown'> }) {
  const common = {
    width: 26,
    height: 26,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
  }
  if (tone === 'error')
    return (
      <svg {...common}>
        <path d="M12 3l9 16H3z" />
        <path d="M12 10v4M12 17h.01" />
      </svg>
    )
  if (tone === 'warn')
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M8 12h8" />
      </svg>
    )
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
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
 * The error state.
 *
 * A 401 rarely reaches here: the session layer turns it into the sign-in page
 * before the card draws (`session.tsx`). A 403 is its own case — signed in, but
 * not allowed (an admin's page for a member) — and says so rather than "failed".
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
        <strong>{t(e.status === 401 ? 'error.signedOut.title' : 'error.forbidden.title')}</strong>
        {t(e.status === 401 ? 'error.signedOut.body' : 'error.forbidden.body')}
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

/** The ring for Apple's Move/Exercise/Stand trio — one ring each, the way the
 * mockup draws them, on a track tinted with the ring's own colour. */
export function Ring({
  value,
  goal,
  color,
  label,
  unit,
  size = 72,
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
  const stroke = Math.max(7, Math.round(size / 8))
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 0 }}>
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
          stroke={`color-mix(in srgb, ${color} 16%, var(--surface))`}
          strokeWidth={stroke}
        />
        {pct > 0 && (
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
        )}
      </svg>
      <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>{label}</div>
      <div style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: 14 }}>
        <span>{f.num(value)}</span>
        <span style={{ color: 'var(--text-dim)', fontWeight: 500 }}>
          {' / '}
          {f.num(goal)} {unit}
        </span>
      </div>
    </div>
  )
}
