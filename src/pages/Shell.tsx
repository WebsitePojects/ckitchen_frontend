import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { destroySocket } from '../lib/socket'

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: '📋' },
  { to: '/kitchen',   label: 'Kitchen',   icon: '🍳' },
  { to: '/inventory', label: 'Inventory', icon: '📦' },
  { to: '/analytics', label: 'Analytics', icon: '📊' },
]

export default function Shell() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  function handleLogout() {
    destroySocket()
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100">
      {/* Sidebar */}
      <aside className="flex w-56 flex-col bg-brand-900 text-white">
        {/* Logo */}
        <div className="flex h-16 items-center px-5 border-b border-brand-700">
          <span className="text-lg font-bold tracking-tight">CloudKitchen ONE</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {NAV_ITEMS.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                [
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition',
                  isActive
                    ? 'bg-brand-700 text-white'
                    : 'text-brand-100 hover:bg-brand-800 hover:text-white',
                ].join(' ')
              }
            >
              <span aria-hidden="true">{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>

        {/* User */}
        <div className="border-t border-brand-700 p-4">
          <div className="mb-2">
            <p className="text-xs font-medium text-brand-100 truncate">{user?.name ?? '—'}</p>
            <p className="text-xs text-brand-300 truncate">{user?.email ?? '—'}</p>
            <span className="mt-1 inline-block rounded bg-brand-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-100">
              {user?.role?.replace(/_/g, ' ') ?? '—'}
            </span>
          </div>
          <button
            onClick={handleLogout}
            className="w-full rounded-lg bg-brand-800 px-3 py-1.5 text-xs font-medium text-brand-100 transition hover:bg-red-600 hover:text-white"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
