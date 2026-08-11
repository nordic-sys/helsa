import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { LanguageSwitcher } from './components/LanguageSwitcher'
import { useI18n } from './i18n'
import type { UiKey } from './i18n'
import Dashboard from './pages/Dashboard'
import Trends from './pages/Trends'
import Workouts from './pages/Workouts'
import Sleep from './pages/Sleep'
import Nutrition from './pages/Nutrition'
import SettingsPage from './pages/Settings'

const NAV: { to: string; label: UiKey; end?: boolean }[] = [
  { to: '/', label: 'nav.today', end: true },
  { to: '/trends', label: 'nav.trends' },
  { to: '/workouts', label: 'nav.workouts' },
  { to: '/sleep', label: 'nav.sleep' },
  { to: '/nutrition', label: 'nav.nutrition' },
  { to: '/settings', label: 'nav.settings' },
]

export default function App() {
  const { t } = useI18n()

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">Helsa</div>
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            {t(n.label)}
          </NavLink>
        ))}
        <LanguageSwitcher />
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/trends" element={<Trends />} />
          <Route path="/workouts" element={<Workouts />} />
          <Route path="/sleep" element={<Sleep />} />
          <Route path="/nutrition" element={<Nutrition />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
