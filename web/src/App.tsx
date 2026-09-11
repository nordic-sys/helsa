import { useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { LanguageSwitcher } from './components/LanguageSwitcher'
import { useI18n } from './i18n'
import { DETAILS, LANDING, NAV, NAV_GROUPS, entriesIn, type NavEntry } from './nav'

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
  const [menuOpen, setMenuOpen] = useState(false)
  // Following a link closes it — otherwise the panel stands over the page it was
  // just asked for. Escape does the same, from anywhere inside the bar.
  const close = () => setMenuOpen(false)

  return (
    <div className="app">
      <nav
        className="sidebar"
        aria-label={t('nav.aria')}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
        }}
      >
        <div className="brand">Helsa</div>

        <div className="nav-groups" id="nav-groups" data-open={menuOpen}>
          {/* The landing page, above the headings and not under one. */}
          <div className="nav-group">
            {LANDING.map((n) => (
              <Item key={n.path} entry={n} onNavigate={close} />
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
              {entriesIn(group.key).map((n) => (
                <Item key={n.path} entry={n} onNavigate={close} />
              ))}
            </div>
          ))}
        </div>

        {/* ⚠️ Both of these come AFTER the groups in the markup, and the bar
            reorders them with `order` rather than the markup being written for
            it. The rail is a column with `margin-top: auto` on the switcher —
            put anything above the groups and that auto pushes the LINKS to the
            bottom of the screen with it. Which is exactly what happened. */}
        <LanguageSwitcher />

        {/* Drawn only in the bar layout. `aria-expanded` carries the state, so
            the label does not have to change between "Menu" and "Close". */}
        <button
          type="button"
          className="nav-toggle"
          aria-expanded={menuOpen}
          aria-controls="nav-groups"
          onClick={() => setMenuOpen((v) => !v)}
        >
          {t('nav.menu')}
          <Chevron open={menuOpen} />
        </button>
      </nav>

      <main className="main">
        <Routes>
          {NAV.map((n) => (
            <Route key={n.path} path={n.path} element={n.element} />
          ))}
          {/* The pages a listing opens. They are routed here and NOT drawn in
              the sidebar — see `DETAILS` in `nav.tsx` for why that is a second
              rule rather than an exception to the first. */}
          {DETAILS.map((d) => (
            <Route key={d.path} path={d.path} element={d.element} />
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

function Item({ entry, onNavigate }: { entry: NavEntry; onNavigate: () => void }) {
  const { t } = useI18n()
  return (
    <NavLink
      to={entry.path}
      end={entry.end}
      onClick={onNavigate}
      className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
    >
      {t(entry.label)}
    </NavLink>
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
