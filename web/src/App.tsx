import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Trends from './pages/Trends'
import Workouts from './pages/Workouts'
import Sleep from './pages/Sleep'
import Nutrition from './pages/Nutrition'
import SettingsPage from './pages/Settings'

const NAV = [
  { to: '/', label: 'Ma', end: true },
  { to: '/trends', label: 'Trendek' },
  { to: '/workouts', label: 'Edzések' },
  { to: '/sleep', label: 'Alvás' },
  { to: '/nutrition', label: 'Táplálkozás' },
  { to: '/settings', label: 'Beállítások' },
]

export default function App() {
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
            {n.label}
          </NavLink>
        ))}
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
