import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { cn } from '../../lib/utils'

type DocumentWithTransitions = Document & {
  startViewTransition?: (update: () => void) => unknown
}

/**
 * Applies a theme with a short crossfade (View Transitions; timing in index.css).
 * Instant when the browser lacks View Transitions or the user prefers reduced motion.
 */
export function useThemeSwitch() {
  const { theme, resolvedTheme, setTheme } = useTheme()

  function switchTo(next: 'light' | 'dark' | 'system') {
    const resolvedNext =
      next === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : next
    const apply = () => {
      // Set the class ourselves so the new frame is ready inside the transition callback;
      // next-themes then persists the choice and re-applies the same class (a no-op).
      document.documentElement.classList.toggle('dark', resolvedNext === 'dark')
      setTheme(next)
    }

    const doc = document as DocumentWithTransitions
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!doc.startViewTransition || reduced || resolvedNext === resolvedTheme) {
      apply()
      return
    }
    doc.startViewTransition(apply)
  }

  return { theme, resolvedTheme, switchTo }
}

/** One-click light/dark switch for the header (Light/Dark/System lives in the person menu). */
export default function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, switchTo } = useThemeSwitch()
  // next-themes resolves the theme after mount; render a stable icon until then.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const isDark = !mounted || resolvedTheme !== 'light'

  return (
    <button
      type="button"
      onClick={() => switchTo(isDark ? 'light' : 'dark')}
      className={cn(
        'grid h-ws-control w-ws-control place-items-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground',
        className,
      )}
      data-testid="theme-toggle"
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {isDark ? <Moon className="h-[18px] w-[18px]" aria-hidden /> : <Sun className="h-[18px] w-[18px]" aria-hidden />}
    </button>
  )
}
