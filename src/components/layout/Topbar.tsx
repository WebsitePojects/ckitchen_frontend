import { Bell, Building2, CalendarDays, Menu, SlidersHorizontal } from 'lucide-react'
import { useAuth } from '../../auth/AuthContext'
import { useOutlet, type SelectedOutlet } from '../../context/OutletContext'
import { Avatar, AvatarFallback } from '../ui/avatar'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Sheet, SheetContent, SheetTitle } from '../ui/sheet'
import { usePageHeaderContext } from './PageHeaderContext'
import Sidebar from './Sidebar'
import { useSignOut } from './useSignOut'

function initials(name: string | undefined): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

interface TopbarProps {
  mobileNavOpen: boolean
  onMobileNavChange: (open: boolean) => void
}

export default function Topbar({ mobileNavOpen, onMobileNavChange }: TopbarProps) {
  const { title, subtitle } = usePageHeaderContext()
  const { user } = useAuth()
  const signOut = useSignOut()
  const { outlets, selectedOutletId, setSelectedOutletId, isHqScope } = useOutlet()

  // HQ-scope roles (D31) always get the switcher (plus "All outlets"); scoped
  // roles only see it once there's more than one outlet to choose from —
  // otherwise their single outlet is auto-selected and the control stays
  // hidden (platform-ia-navigation.md §5).
  const showOutletSwitcher = isHqScope || outlets.length > 1

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-card px-4 sm:px-6">
      {/* Mobile hamburger -> Sheet */}
      <Sheet open={mobileNavOpen} onOpenChange={onMobileNavChange}>
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={() => onMobileNavChange(true)}
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <SheetContent side="left" className="w-72 border-sidebar-border bg-sidebar p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Sidebar onNavigate={() => onMobileNavChange(false)} />
        </SheetContent>
      </Sheet>

      {/* Outlet context switcher (platform-ia-navigation.md §5) */}
      {showOutletSwitcher && (
        <Select
          value={selectedOutletId}
          onValueChange={(value) => setSelectedOutletId(value as SelectedOutlet)}
        >
          <SelectTrigger
            className="h-8 w-auto min-w-[7.5rem] max-w-[11rem] shrink-0 gap-1.5 border-border bg-secondary/50 px-2.5 text-xs text-zinc-300"
            aria-label="Select outlet"
          >
            <Building2 className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden />
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

      {/* Title / subtitle */}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold text-zinc-50 sm:text-lg">{title}</h1>
        {subtitle && <p className="truncate text-xs text-zinc-500">{subtitle}</p>}
      </div>

      {/* Right cluster */}
      <div className="flex shrink-0 items-center gap-2">
        {/* Date-range chip (presentational) */}
        <button
          type="button"
          className="hidden items-center gap-1.5 rounded-lg border border-border bg-secondary/50 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors duration-200 hover:text-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 sm:flex"
        >
          <CalendarDays className="h-3.5 w-3.5" aria-hidden />
          Last 30 days
        </button>

        {/* Filters (presentational) */}
        <Button variant="outline" size="sm" className="hidden gap-1.5 sm:flex">
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
          Filters
        </Button>

        {/* Notifications (presentational) */}
        <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
          <Bell className="h-4.5 w-4.5" />
        </Button>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="ml-1 rounded-full ring-offset-background transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label="User menu"
            >
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-emerald-500/15 text-xs font-semibold text-emerald-400">
                  {initials(user?.name)}
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>
              <p className="truncate text-sm font-medium">{user?.name ?? '—'}</p>
              <p className="truncate text-xs font-normal text-muted-foreground">
                {user?.email ?? '—'}
              </p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => signOut()}>Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
