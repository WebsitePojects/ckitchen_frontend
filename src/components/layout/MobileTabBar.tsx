import { useState } from 'react'
import { LayoutGrid, LogOut, Monitor, Moon, Sun } from 'lucide-react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { usePermissions } from '../../context/PermissionsContext'
import { cn } from '../../lib/utils'
import { Sheet, SheetContent, SheetTitle } from '../ui/sheet'
import { NAV_GROUPS, TAB_BAR_PRIORITY, type NavItem } from './nav-items'
import { useThemeSwitch } from './ThemeToggle'
import { useSignOut } from './useSignOut'

const ALL_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items)
const ITEM_BY_PATH = new Map(ALL_ITEMS.map((i) => [i.to, i]))
const THEMES = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const

/**
 * Phone navigation (below lg): four daily screens the user can open + Menu. Lives in the
 * shell's flex column (not position:fixed), so sticky page bars end above it. The Menu sheet
 * holds every other page as a tile grid, the theme choice and sign-out; the hamburger drawer
 * stays available as well.
 */
export default function MobileTabBar() {
  const { user } = useAuth()
  const { canAccessPage } = usePermissions()
  const { pathname } = useLocation()
  const { theme, switchTo } = useThemeSwitch()
  const signOut = useSignOut()
  const [menuOpen, setMenuOpen] = useState(false)

  const allowed = (to: string) => user != null && canAccessPage(to)
  const tabs = TAB_BAR_PRIORITY.filter(allowed)
    .slice(0, 4)
    .map((to) => ITEM_BY_PATH.get(to))
    .filter((i): i is NavItem => i != null)
  const rest = ALL_ITEMS.filter((i) => allowed(i.to) && !tabs.some((t) => t.to === i.to))
  const activeIndex = tabs.findIndex((t) => (t.to === '/' ? pathname === '/' : pathname.startsWith(t.to)))
  const slots = tabs.length + 1

  return (
    <nav aria-label="Quick" className="relative shrink-0 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      {activeIndex >= 0 && (
        <span
          aria-hidden
          className="absolute top-0 h-[2px] bg-ink-accent transition-transform duration-300 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]"
          style={{ width: `${100 / slots}%`, transform: `translateX(${activeIndex * 100}%)` }}
        />
      )}
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${slots}, minmax(0, 1fr))` }}>
        {tabs.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cn('flex h-[68px] flex-col items-center justify-center gap-1 text-[11px] font-medium transition-transform active:scale-95', isActive ? 'text-foreground' : 'text-muted-foreground')
              }
            >
              {({ isActive }) => (
                <>
                  <span className={cn('grid h-8 w-14 place-items-center rounded-full transition-colors duration-200', isActive && 'bg-secondary text-ink-accent')}>
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="max-w-full truncate px-1">{label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="flex h-[68px] w-full flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground transition-transform active:scale-95"
          >
            <span className="grid h-8 w-14 place-items-center rounded-full">
              <LayoutGrid className="h-5 w-5" aria-hidden />
            </span>
            Menu
          </button>
        </li>
      </ul>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-3xl border-border bg-card px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3">
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-border" aria-hidden />
          <p className="eyebrow">Menu</p>
          <SheetTitle className="text-ws-title font-semibold tracking-tight">Everything else</SheetTitle>
          <ul className="mt-4 grid grid-cols-3 gap-2">
            {rest.map(({ to, label, icon: Icon }, index) => (
              <li key={to} className="animate-fade-in-up" style={{ animationDelay: `${index * 40}ms`, animationFillMode: 'both' }}>
                <NavLink
                  to={to}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'flex h-24 flex-col items-center justify-center gap-2 rounded-2xl px-2 text-center text-xs font-medium transition-colors active:scale-95',
                      isActive ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                    )
                  }
                >
                  <Icon className="h-5 w-5 text-ink-accent" aria-hidden />
                  <span className="line-clamp-2">{label}</span>
                </NavLink>
              </li>
            ))}
          </ul>

          <div className="mt-5 border-t border-border pt-4">
            <p className="eyebrow mb-2">Theme</p>
            <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-1 rounded-full bg-secondary p-1">
              {THEMES.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={theme === value}
                  onClick={() => switchTo(value)}
                  className={cn(
                    'flex h-10 items-center justify-center gap-1.5 rounded-full text-xs font-medium transition-colors',
                    theme === value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden /> {label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setMenuOpen(false)
              signOut()
            }}
            className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-destructive/10 text-sm font-medium text-danger-text active:scale-[0.98]"
          >
            <LogOut className="h-4 w-4" aria-hidden /> Sign out{user?.name ? ` (${user.name})` : ''}
          </button>
        </SheetContent>
      </Sheet>
    </nav>
  )
}
