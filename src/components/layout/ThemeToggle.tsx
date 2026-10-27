import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/utils'

const BURST_MS = 460
const STAR_POINTS = 16

/**
 * A star outline centred on (x, y): STAR_POINTS spikes alternating between radius r and
 * 0.82r. Same point count at every scale, so clip-path can interpolate between two stars.
 */
function starPolygon(x: number, y: number, r: number): string {
  const points: string[] = []
  for (let i = 0; i < STAR_POINTS * 2; i += 1) {
    const angle = (Math.PI * i) / STAR_POINTS - Math.PI / 2
    const radius = i % 2 === 0 ? r : r * 0.82
    points.push(`${(x + Math.cos(angle) * radius).toFixed(1)}px ${(y + Math.sin(angle) * radius).toFixed(1)}px`)
  }
  return `polygon(${points.join(', ')})`
}

type DocumentWithTransitions = Document & {
  startViewTransition?: (update: () => void) => { ready: Promise<void> }
}

/**
 * Applies a theme, bursting the new one out of `origin` as a growing star (View Transitions).
 * Instant when the browser lacks View Transitions or the user prefers reduced motion.
 */
export function useThemeSwitch() {
  const { theme, resolvedTheme, setTheme } = useTheme()

  function switchTo(next: 'light' | 'dark' | 'system', origin?: HTMLElement | null) {
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

    const box = origin?.getBoundingClientRect()
    const x = box ? box.left + box.width / 2 : window.innerWidth - 40
    const y = box ? box.top + box.height / 2 : 32
    const reach = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y)) * 1.25

    const transition = doc.startViewTransition(apply)
    transition.ready
      .then(() => {
        document.documentElement.animate(
          { clipPath: [starPolygon(x, y, 0), starPolygon(x, y, reach)] },
          { duration: BURST_MS, easing: 'cubic-bezier(0.77, 0, 0.175, 1)', pseudoElement: '::view-transition-new(root)' },
        )
      })
      .catch(() => {
        // The theme is already applied; only the animation was skipped.
      })
  }

  return { theme, resolvedTheme, switchTo }
}

/** One-click light/dark switch for the header (Light/Dark/System lives in the person menu). */
export default function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, switchTo } = useThemeSwitch()
  const buttonRef = useRef<HTMLButtonElement>(null)
  // next-themes resolves the theme after mount; render a stable icon until then.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const isDark = !mounted || resolvedTheme !== 'light'

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={() => switchTo(isDark ? 'light' : 'dark', buttonRef.current)}
      className={cn(
        'relative grid h-10 w-10 place-items-center rounded-full text-muted-foreground transition-colors duration-200 hover:bg-accent hover:text-foreground active:scale-95',
        className,
      )}
      data-testid="theme-toggle"
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      <Sun
        className={cn('absolute h-[18px] w-[18px] transition-all duration-300', isDark ? 'rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100')}
        aria-hidden
      />
      <Moon
        className={cn('absolute h-[18px] w-[18px] transition-all duration-300', isDark ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-0 opacity-0')}
        aria-hidden
      />
    </button>
  )
}
