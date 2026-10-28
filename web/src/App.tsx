import { useRef, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { browserTz } from './api/client'
import { LanguageSwitcher } from './components/LanguageSwitcher'
import { UserMenu } from './components/UserMenu'
import { Alert } from './components/ui'
import { useI18n } from './i18n'
import { useFormat } from './lib/format'
import { queueBadge, type QueueBadge } from './lib/ingest'
import { useIngestStatus } from './lib/useIngestStatus'
import { useRefreshOnIngest } from './lib/useRefreshOnIngest'
import { DETAILS, LANDING, MENU, NAV, NAV_GROUPS, entriesIn, parentOf, type NavEntry } from './nav'
import { useSession } from './session'

/** The path whose link carries the queue badge. */
export const QUEUE_PATH = '/ingest'

/** How often the badge asks when the queue page is not open (it asks every 5 s). */
const BADGE_POLL_MS = 30_000

/**
 * The frame: a grouped sidebar and the router, both read off `nav.tsx`.
 *
 * There is no page-level state here beyond the one below, and no claim about the
 * content — which link exists and which heading it sits under belongs in one
 * file with the reasoning next to it.
 *
 * # The one piece of state
 *
 * Whether the navigation panel is open. It matters only in the bar layout
 * (`global.css`, under `--bar-at`): at rail width the CSS never hides the
 * groups, so this flag has nothing to act on and the button that sets it is not
 * drawn. That is why the panel is hidden by a stylesheet rule rather than by not
 * rendering it — the same markup has to be the whole navigation at 1440 and a
 * disclosure at 390, and only one of those is allowed to hide anything.
 */
export default function App() {
  const { t } = useI18n()
  const session = useSession()
  const { isAdmin } = session
  const [menuOpen, setMenuOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)
  // Following a link closes it — otherwise the panel stands over the page it was
  // just asked for. Escape does the same, from anywhere inside the bar.
  const close = () => setMenuOpen(false)
  /** Escape: close, and put focus back on the button that opened the panel —
   * the focused link is about to be hidden, and focus on a hidden element is
   * focus nowhere. Only while it is open: at rail width nothing is opened. */
  const dismiss = () => {
    if (!menuOpen) return
    setMenuOpen(false)
    toggleRef.current?.focus()
  }
  // ⚠️ A failed request is NOT a reading: a missing token or an older server
  // draws no badge rather than a "?" — the "?" means the server answered and
  // said it could not reach its queue, which is a different fact.
  const ingest = useIngestStatus(BADGE_POLL_MS)
  const badge = queueBadge(ingest.isError ? undefined : ingest.data)
  // The frame polls the queue on every page, so it is the one place that sees
  // the worker's written count advance — and refreshes the health data then.
  useRefreshOnIngest(ingest.data)

  return (
    <div className="app">
      <nav
        className="sidebar"
        aria-label={t('nav.aria')}
        onKeyDown={(e) => {
          if (e.key === 'Escape') dismiss()
        }}
      >
        <div className="brand">
          <BrandMark />
          <span>Helsa</span>
        </div>

        {/* Drawn only in the bar layout. `aria-expanded` carries the state, so
            the label does not have to change between "Menu" and "Close".
            ⚠️ BEFORE the groups in the markup, because it is before them on
            screen: opening the menu and pressing Tab has to reach the links it
            just revealed, not skip to the page. At rail width it is not drawn
            (`display: none`), so it takes no part in the column there. */}
        <button
          ref={toggleRef}
          type="button"
          className="nav-toggle"
          aria-expanded={menuOpen}
          aria-controls="nav-groups"
          onClick={() => setMenuOpen((v) => !v)}
        >
          {t('nav.menu')}
          {/* The badge rides on the button while the panel is shut — otherwise a
              phone would hide the one thing in the menu that needs a person. */}
          {badge && !menuOpen && <Badge badge={badge} />}
          <Chevron open={menuOpen} />
        </button>

        <div className="nav-groups" id="nav-groups" data-open={menuOpen}>
          {/* The landing page, above the headings and not under one. */}
          <div className="nav-group">
            {LANDING.map((n) => (
              <Item key={n.path} entry={n} onNavigate={close} badge={null} />
            ))}
          </div>

          {NAV_GROUPS.map((group) => (
            <div
              className="nav-group"
              key={group.key}
              role="group"
              aria-labelledby={`nav-group-${group.key}`}
            >
              <div className="nav-group-title" id={`nav-group-${group.key}`}>
                {t(group.label)}
              </div>
              {entriesIn(group.key, isAdmin).map((n) => (
                <Item
                  key={n.path}
                  entry={n}
                  onNavigate={close}
                  badge={n.path === QUEUE_PATH ? badge : null}
                />
              ))}
            </div>
          ))}
        </div>

        {/* ⚠️ AFTER the groups in the markup, and on screen in both layouts:
            in the rail it sits at the bottom (`margin-top: auto` — put it above
            the groups and that auto pushes the LINKS to the bottom with it,
            which is exactly what happened once); in the bar it follows the Menu
            button, and drops under the panel while the panel is open, so the
            order you see is the order Tab takes. */}
        <div className="sidebar-foot">
          <UserMenu onNavigate={close} />
          <LanguageSwitcher />
          <span className="sidebar-host" aria-label={t('nav.serverAria')}>
            {window.location.host} · {browserTz()}
          </span>
        </div>

      </nav>

      {/* ⚠️ Keyed by the person: should the session layer ever hand this frame
          somebody else without unmounting it, no page keeps state that was
          built for the one before (docs/36 §9, C12; `session.tsx`). */}
      <main className="main" key={session.me.id}>
        {session.legacyNotice && (
          <div style={{ marginBottom: 20 }}>
            <Alert tone="info" title={t('login.legacy.title')} live={false}>
              <p>{t('login.legacy.body')}</p>
              <div className="btn-row">
                <button type="button" className="btn" onClick={session.dismissLegacyNotice}>
                  {t('common.understood')}
                </button>
              </div>
            </Alert>
          </div>
        )}
        <Routes>
          {NAV.map((n) => (
            <Route key={n.path} path={n.path} element={allowed(n, isAdmin) ? n.element : <Navigate to="/" replace />} />
          ))}
          {/* The pages a listing opens. They are routed here and NOT drawn in
              the sidebar — see `DETAILS` in `nav.tsx` for why that is a second
              rule rather than an exception to the first. A detail page is as
              admin-only as the listing it opens from. */}
          {DETAILS.map((d) => {
            const parent = parentOf(d)
            const ok = !parent || allowed(parent, isAdmin)
            return <Route key={d.path} path={d.path} element={ok ? d.element : <Navigate to="/" replace />} />
          })}
          {MENU.map((m) => (
            <Route key={m.path} path={m.path} element={m.element} />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        {/* ⚠️ On EVERY page, not only the Observations one.
            The dashboard draws rule output — "your resting heart rate is above your
            usual" — and carried no medical line anywhere at all, while the app and
            the documentation site both state it in several places. A reader who only
            ever opens the browser reader saw none of it. It is one line, and the
            argument for it is exactly the argument for the app's version. */}
        <footer className="app-footer">{t('app.notMedical')}</footer>
      </main>
    </div>
  )
}

function allowed(entry: NavEntry, isAdmin: boolean): boolean {
  return isAdmin || !entry.adminOnly
}

function Item({
  entry,
  onNavigate,
  badge,
}: {
  entry: NavEntry
  onNavigate: () => void
  badge: QueueBadge | null
}) {
  const { t } = useI18n()
  // `NavLink` sets `aria-current="page"` on the active link by itself.
  return (
    <NavLink
      to={entry.path}
      end={entry.end}
      onClick={onNavigate}
      className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
    >
      <span>{t(entry.label)}</span>
      {badge && <Badge badge={badge} />}
    </NavLink>
  )
}

/**
 * The queue badge: the number that needs attention, coloured by severity — busy
 * teal while the worker drains, amber when nothing moves, red when something was
 * set aside. The colour never carries the meaning alone: the visible number
 * comes with a sentence for screen readers, and an unreadable queue is a "?",
 * never a 0.
 */
export function Badge({ badge }: { badge: QueueBadge }) {
  const { t, tp } = useI18n()
  const f = useFormat()
  const label =
    badge.kind === 'unknown'
      ? t('nav.badge.unknown')
      : tp(badge.kind === 'setAside' ? 'nav.badge.setAside' : 'nav.badge.waiting', badge.count, {
          n: f.num(badge.count),
        })
  return (
    <span className={`badge badge--${badge.tone}`} data-tone={badge.tone} title={label}>
      <span aria-hidden="true">
        {badge.kind === 'unknown' ? '?' : f.num(badge.count)}
        {badge.kind === 'setAside' ? ' !' : ''}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  )
}

/** The Aurora arc over a pulse line — the brand mark, drawn in the brand colours. */
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

/** Drawn rather than typed, for the same reason as the workout months': "›" is
 * punctuation to a screen reader, and the button already carries its name and
 * its state. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d={open ? 'M3 10 L8 5 L13 10' : 'M3 6 L8 11 L13 6'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
