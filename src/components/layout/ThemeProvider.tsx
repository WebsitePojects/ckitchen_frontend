import { ThemeProvider as NextThemesProvider } from 'next-themes'
import type { ReactNode } from 'react'

interface ThemeProviderProps {
  children: ReactNode
}

/**
 * App-wide theme provider — dark | light | system, persisted to localStorage
 * under `orion-theme`. Toggles the `dark` class on `<html>` (Tailwind
 * `darkMode: ['class']`, src/index.css defines both a `:root` light token set
 * and a `.dark` override set). Wraps `next-themes` (already a dependency —
 * `src/components/ui/sonner.tsx`'s Toaster already calls its `useTheme()`)
 * instead of hand-rolling the same localStorage + matchMedia + class-toggle
 * logic.
 *
 * Light is the default (owner's decision 2026-10-28): a first-time visitor, or anyone who
 * never picked a theme, gets light. index.html has no `dark` class, and public/theme-boot.js
 * (an external script, because the CSP forbids inline ones) applies a saved "dark" or
 * "system" choice before first paint, so a returning dark-mode user sees no flash either.
 */
export default function ThemeProvider({ children }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      storageKey="orion-theme"
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  )
}
