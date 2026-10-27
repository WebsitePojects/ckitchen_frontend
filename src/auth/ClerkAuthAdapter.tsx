import { lazy, Suspense, type ReactNode } from 'react'
import { AuthProvider } from './AuthContext'

/**
 * Clerk (Google / email) sign-in, enabled only when VITE_CLERK_PUBLISHABLE_KEY is set at
 * build time. Without it the app uses ORION's own password login exactly as before.
 * Clerk proves who someone is; their role and outlets still come from ORION (/auth/me).
 */
export const CLERK_PUBLISHABLE_KEY: string | undefined = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || undefined

// The Clerk SDK is ~90 KB; a password-only deployment should not download it at all.
const ClerkBoundary = CLERK_PUBLISHABLE_KEY ? lazy(() => import('./ClerkBoundary')) : null

/** Drop-in replacement for <AuthProvider>: adds Clerk when configured. */
export function AppAuthProvider({ children }: { children: ReactNode }) {
  if (!ClerkBoundary) return <AuthProvider>{children}</AuthProvider>
  // Nothing can render before auth state exists; the chunk arrives within one round trip.
  return (
    <Suspense fallback={null}>
      <ClerkBoundary>{children}</ClerkBoundary>
    </Suspense>
  )
}
