import { Building2, Menu } from 'lucide-react'
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
import ThemeToggle from './ThemeToggle'
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
            className="h-8 w-auto min-w-[7.5rem] max-w-[11rem] shrink-0 gap-1.5 border-border bg-secondary/50 px-2.5 text-xs text-foreground"
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

      {/* Title / subtitle */}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold text-foreground sm:text-lg">{title}</h1>
        {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
      </div>

      {/* Right cluster */}
      <div className="flex shrink-0 items-center gap-1">
        <ThemeToggle />

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
