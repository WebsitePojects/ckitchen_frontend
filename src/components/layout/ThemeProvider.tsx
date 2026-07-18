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
 * `defaultTheme="dark"` matches index.html's static `<html class="dark">`,
 * so a first-time visitor (no persisted choice yet) sees zero flash — the
 * provider's mount effect confirms what's already painted instead of
 * changing it. A returning visitor who chose "light" gets one brief
 * dark->light flash on load; this is a CSR-only SPA (no SSR/static
 * pre-render to read localStorage before first paint), and index.html's
 * strict CSP (`script-src 'self'`, no `unsafe-inline`) rules out the usual
 * blocking inline anti-flash script. Acceptable tradeoff — documented rather
 * than silently left unexplained.
 */
export default function ThemeProvider({ children }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      storageKey="orion-theme"
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  )
}
