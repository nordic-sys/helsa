import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { LanguageSwitcher } from './components/LanguageSwitcher'
import { useI18n } from './i18n'
import { LANDING, NAV, NAV_GROUPS, entriesIn, type NavEntry } from './nav'

/**
 * The frame: a grouped sidebar and the router, both read off `nav.tsx`.
 *
 * There is no page-level state and no layout decision here on purpose — which
 * link exists and which heading it sits under is a claim about the content, and
 * that claim belongs in one file with the reasoning written next to it.
 */
export default function App() {
  const { t } = useI18n()

  return (
    <div className="app">
      <nav className="sidebar" aria-label={t('nav.aria')}>
        <div className="brand">Helsa</div>

        <div className="nav-groups">
          {/* The landing page, above the headings and not under one. */}
          <div className="nav-group">
            {LANDING.map((n) => (
              <Item key={n.path} entry={n} />
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
                <Item key={n.path} entry={n} />
              ))}
            </div>
          ))}
        </div>

        <LanguageSwitcher />
      </nav>

      <main className="main">
        <Routes>
          {NAV.map((n) => (
            <Route key={n.path} path={n.path} element={n.element} />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}

function Item({ entry }: { entry: NavEntry }) {
  const { t } = useI18n()
  return (
    <NavLink
      to={entry.path}
      end={entry.end}
      className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
    >
      {t(entry.label)}
    </NavLink>
  )
}
