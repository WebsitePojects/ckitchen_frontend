import { Building2, LogOut, Menu, Monitor, Moon, Sun } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { useOutlet, type SelectedOutlet } from '../../context/OutletContext'
import { Avatar, AvatarFallback } from '../ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Sheet, SheetContent, SheetTitle } from '../ui/sheet'
import { NAV_LOOKUP } from './nav-items'
import { PLATFORM_NAME } from '../../lib/branding'
import Wordmark from '../brand/Wordmark'
import { usePageHeaderContext } from './PageHeaderContext'
import Sidebar from './Sidebar'
import ThemeToggle, { useThemeSwitch } from './ThemeToggle'
import { useSignOut } from './useSignOut'

export function initials(name: string | undefined): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

interface TopbarProps {
  mobileNavOpen: boolean
  onMobileNavChange: (open: boolean) => void
}

/**
 * Header: phone drawer button, outlet switcher, breadcrumb + page title, theme switch and the
 * person menu (round avatar: you) — distinct from the sidebar's business navigation.
 */
export default function Topbar({ mobileNavOpen, onMobileNavChange }: TopbarProps) {
  const { header, inPageTitles } = usePageHeaderContext()
  const { user } = useAuth()
  const signOut = useSignOut()
  const { pathname } = useLocation()
  const { theme, switchTo } = useThemeSwitch()
  const { outlets, selectedOutletId, setSelectedOutletId, isHqScope } = useOutlet()
  const crumb = NAV_LOOKUP.get(pathname)
  // A title pushed by the current page wins; otherwise the nav label; otherwise the wordmark.
  const own = header?.path === pathname ? header : null
  const title = own?.title ?? crumb?.label ?? PLATFORM_NAME
  const subtitle = own?.subtitle

  // HQ-scope roles always get the switcher ("All outlets"); scoped roles only with 2+ outlets.
  const showOutletSwitcher = isHqScope || outlets.length > 1

  return (
    <header className="relative z-10 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-card/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-card/70 sm:px-6">
      <Sheet open={mobileNavOpen} onOpenChange={onMobileNavChange}>
        <button
          type="button"
          className="-ml-2 grid h-10 w-10 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground lg:hidden"
          onClick={() => onMobileNavChange(true)}
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </button>
        <SheetContent side="left" className="w-72 border-sidebar-border bg-sidebar p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Sidebar onNavigate={() => onMobileNavChange(false)} />
        </SheetContent>
      </Sheet>

      <div className="min-w-0 flex-1">
        {inPageTitles > 0 ? (
          // The page draws its own h1 (PageHeader): show where we are, plus the wordmark on phones.
          <>
            <Wordmark className="lg:hidden" />
            {crumb && (
              <nav aria-label="Breadcrumb" className="hidden truncate text-sm lg:block">
                <span className="text-muted-foreground">{crumb.group}</span>
                <span className="mx-2 text-muted-foreground" aria-hidden>/</span>
                <span className="font-medium text-foreground" aria-current="page">{crumb.label}</span>
              </nav>
            )}
          </>
        ) : (
          <>
            {crumb && (
              <p className="eyebrow hidden truncate sm:block">
                {crumb.group} <span aria-hidden>/</span> {crumb.label}
              </p>
            )}
            <h1 className="truncate text-ws-section font-semibold tracking-tight text-foreground">{title}</h1>
            {subtitle && <p className="hidden truncate text-xs text-muted-foreground md:block">{subtitle}</p>}
          </>
        )}
      </div>

      {showOutletSwitcher && (
        <Select value={selectedOutletId} onValueChange={(value) => setSelectedOutletId(value as SelectedOutlet)}>
          <SelectTrigger
            className="h-10 w-auto min-w-[7.5rem] max-w-[11rem] shrink-0 gap-1.5 rounded-full border-border bg-transparent px-3 text-xs text-foreground"
            aria-label="Select outlet"
          >
            <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <SelectValue placeholder="Outlet" />
          </SelectTrigger>
          <SelectContent>
            {isHqScope && <SelectItem value="ALL">All outlets</SelectItem>}
            {outlets.map((outlet) => (
              <SelectItem key={outlet.id} value={outlet.id}>
                {outlet.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <div className="flex shrink-0 items-center gap-1">
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="ml-1 rounded-full transition-transform active:scale-95"
              aria-label={`Account menu for ${user?.name ?? 'you'}`}
            >
              <Avatar className="h-9 w-9">
                <AvatarFallback className="bg-secondary text-xs font-semibold text-ink-accent">{initials(user?.name)}</AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="font-normal">
              <p className="truncate text-sm font-medium text-foreground">{user?.name ?? '—'}</p>
              <p className="truncate text-xs text-muted-foreground">{user?.email ?? '—'}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <p className="eyebrow px-2 pb-1 pt-1.5">Theme</p>
            <DropdownMenuRadioGroup value={theme ?? 'light'} onValueChange={(v) => switchTo(v as 'light' | 'dark' | 'system')}>
              <DropdownMenuRadioItem value="light" className="gap-2">
                <Sun className="h-4 w-4" aria-hidden /> Light
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark" className="gap-2">
                <Moon className="h-4 w-4" aria-hidden /> Dark
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system" className="gap-2">
                <Monitor className="h-4 w-4" aria-hidden /> Match system
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => signOut()} className="gap-2 text-danger-text focus:text-danger-text">
              <LogOut className="h-4 w-4" aria-hidden /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
