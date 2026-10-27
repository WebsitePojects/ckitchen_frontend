import { useEffect } from 'react'
import { ChevronsLeft, ChevronsRight, Orbit } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { cn } from '../../lib/utils'
import { NAV_GROUPS } from './nav-items'
import { usePermissions } from '../../context/PermissionsContext'
import { useNotifications } from '../../context/NotificationContext'
import { PLATFORM_NAME } from '../../lib/branding'
import { prefetchPage, prefetchPages } from '../../lib/pageLoaders'

interface SidebarProps {
  /** Called after a nav link is clicked — closes the phone drawer. */
  onNavigate?: () => void
  /** Desktop only: icon rail (72px) instead of the full sidebar. */
  collapsed?: boolean
  onToggleCollapsed?: () => void
}

/**
 * Business navigation: wordmark, grouped links (2px accent bar on the active page), and the
 * rail toggle. Personal things (theme, sign-out) live in the header's person menu, so the two
 * identities never repeat each other. Rendered in the desktop column and in the phone drawer.
 */
export default function Sidebar({ onNavigate, collapsed = false, onToggleCollapsed }: SidebarProps) {
  const { user } = useAuth()
  const { canAccessPage } = usePermissions()
  // Pages you are NOT viewing that received realtime events show a dot until visited.
  const { unseen } = useNotifications()

  // Warm the code of every page this user can open during idle time.
  const accessibleKey = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.to))
    .filter((to) => user != null && canAccessPage(to))
    .join('|')
  useEffect(() => prefetchPages(accessibleKey ? accessibleKey.split('|') : []), [accessibleKey])

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className={cn('flex h-16 shrink-0 items-center gap-2.5 border-b border-sidebar-border', collapsed ? 'justify-center px-0' : 'px-5')}>
        <Orbit className="h-6 w-6 shrink-0 text-ink-accent" aria-hidden />
        {!collapsed && <span className="font-display text-2xl leading-none tracking-tight">{PLATFORM_NAME}</span>}
      </div>

      <nav aria-label="Main" className={cn('flex-1 overflow-y-auto py-4', collapsed ? 'px-2' : 'px-3')}>
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((item) => user != null && canAccessPage(item.to))
          if (items.length === 0) return null
          return (
            <div key={group.label} className="mt-5 first:mt-0">
              {collapsed ? (
                <div className="mx-3 mb-2 border-t border-sidebar-border" aria-hidden />
              ) : (
                <p className="eyebrow mb-1.5 px-3">{group.label}</p>
              )}
              <div className="space-y-0.5">
                {items.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/'}
                    onClick={onNavigate}
                    onMouseEnter={() => prefetchPage(to)}
                    onFocus={() => prefetchPage(to)}
                    onTouchStart={() => prefetchPage(to)}
                    title={collapsed ? label : undefined}
                    aria-label={collapsed ? label : undefined}
                    className={({ isActive }) =>
                      cn(
                        'group relative flex min-h-10 items-center gap-3 rounded-md text-sm transition-colors duration-200',
                        collapsed ? 'justify-center px-0' : 'px-3',
                        isActive
                          ? 'bg-sidebar-accent font-medium text-foreground before:absolute before:inset-y-2 before:left-0 before:w-[2px] before:rounded-full before:bg-ink-accent'
                          : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon className={cn('h-[18px] w-[18px] shrink-0 transition-transform duration-200 group-hover:translate-x-0.5', isActive && 'text-ink-accent')} aria-hidden />
                        {!collapsed && <span className="truncate">{label}</span>}
                        {(unseen[to] ?? 0) > 0 && (
                          <span
                            className={cn('h-2 w-2 shrink-0 animate-pulse rounded-full bg-danger-text', collapsed ? 'absolute right-2 top-2' : 'ml-auto')}
                            role="status"
                            aria-label={`${label} has new updates`}
                          />
                        )}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          )
        })}
      </nav>

      {onToggleCollapsed && (
        <button
          type="button"
          onClick={onToggleCollapsed}
          className={cn(
            'flex h-12 shrink-0 items-center gap-2 border-t border-sidebar-border text-xs text-muted-foreground transition-colors hover:text-foreground',
            collapsed ? 'justify-center' : 'px-5',
          )}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : undefined}
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" aria-hidden /> : <ChevronsLeft className="h-4 w-4" aria-hidden />}
          {!collapsed && 'Collapse'}
        </button>
      )}
    </div>
  )
}
