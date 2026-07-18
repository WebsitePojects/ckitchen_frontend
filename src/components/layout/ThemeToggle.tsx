import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { cn } from '../../lib/utils'

const OPTIONS = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const

/** Sun/moon theme toggle — dark | light | system (ThemeProvider.tsx, `orion-theme`). */
export default function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme()

  // next-themes reports `undefined` for `resolvedTheme` until it mounts (it
  // reads localStorage/matchMedia client-side only) — this is a CSR-only SPA
  // so the window is tiny, but render a stable icon rather than flashing.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const Icon = mounted && resolvedTheme === 'light' ? Sun : Moon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-zinc-400 hover:text-foreground"
          data-testid="theme-toggle"
          aria-label="Change theme"
        >
          <Icon className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        {OPTIONS.map(({ value, label, icon: OptIcon }) => (
          <DropdownMenuItem
            key={value}
            onClick={() => setTheme(value)}
            data-testid={`theme-toggle-${value}`}
            className={cn(
              'min-h-[2.25rem] gap-2',
              theme === value && 'bg-accent text-accent-foreground',
            )}
          >
            <OptIcon className="h-4 w-4" aria-hidden />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
