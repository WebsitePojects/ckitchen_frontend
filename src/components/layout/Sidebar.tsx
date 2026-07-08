import { Orbit, LogOut } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { Avatar, AvatarFallback } from '../ui/avatar'
import { cn } from '../../lib/utils'
import { NAV_GROUPS } from './nav-items'
import { usePermissions } from '../../context/PermissionsContext'
import { useNotifications } from '../../context/NotificationContext'
import { useSignOut } from './useSignOut'
import { PLATFORM_NAME } from '../../lib/branding'

function initials(name: string | undefined): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

interface SidebarProps {
  /** Called after a nav link is clicked — used to close the mobile Sheet. */
  onNavigate?: () => void
}

/**
 * Sidebar — brand mark, nav links, user footer with sign-out.
 * Rendered both in the fixed desktop rail and inside the mobile Sheet.
 */
export default function Sidebar({ onNavigate }: SidebarProps) {
  const { user } = useAuth()
  const { canAccessPage } = usePermissions()
  // Unseen live-update counts per route (NotificationContext, mounted in
  // AppShell) — a page you're NOT viewing that received realtime events shows
  // a pulsing red dot on its nav item; visiting it clears the dot.
  const { unseen } = useNotifications()
  const signOut = useSignOut()

  function handleLogout() {
    signOut()
    onNavigate?.()
  }

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Brand mark */}
      <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-sidebar-border px-5">
        <Orbit className="h-6 w-6 text-emerald-500" aria-hidden />
        <span className="text-base font-bold tracking-tight">{PLATFORM_NAME}</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {NAV_GROUPS.map((group) => {
          // canAccessPage layers the persisted RBAC matrix on top of canAccess — it
          // itself falls back to canAccess (code defaults) when the matrix hasn't
          // loaded / failed to load / came back empty (fail-open — see
          // context/PermissionsContext.tsx).
          const items = group.items.filter((item) => user != null && canAccessPage(item.to))
          if (items.length === 0) return null
          return (
            <div key={group.label} className="mt-4 first:mt-0">
              <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                {group.label}
              </p>
              <div className="space-y-1">
                {items.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/'}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'group flex items-center gap-3 rounded-lg border-l-2 border-transparent px-3 py-2.5 text-sm font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50',
                        isActive
                          ? 'border-emerald-500 bg-emerald-500/15 text-emerald-400'
                          : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-50',
                      )
                    }
                  >
                    <Icon className="h-4.5 w-4.5 shrink-0" aria-hidden />
                    <span className="truncate">{label}</span>
                    {(unseen[to] ?? 0) > 0 && (
                      <span
                        className="ml-auto h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-500"
                        role="status"
                        aria-label={`${label} has new updates`}
                      />
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          )
        })}
      </nav>

      {/* User footer */}
      <div className="shrink-0 border-t border-sidebar-border p-4">
        <div className="mb-3 flex items-center gap-3">
          <Avatar className="h-9 w-9">
            <AvatarFallback className="bg-emerald-500/15 text-sm font-semibold text-emerald-400">
              {initials(user?.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-zinc-50">{user?.name ?? '—'}</p>
            <p className="truncate text-xs text-zinc-500">
              {user?.role ? user.role.replace(/_/g, ' ') : '—'}
            </p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-2 rounded-lg border border-sidebar-border px-3 py-2 text-xs font-medium text-zinc-400 transition-colors duration-200 hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
        >
          <LogOut className="h-4 w-4" aria-hidden />
          Sign out
        </button>
      </div>
    </div>
  )
}
