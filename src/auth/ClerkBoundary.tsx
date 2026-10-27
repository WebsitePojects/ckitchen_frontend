import type { ReactNode } from 'react'
import { ClerkProvider, useAuth as useClerkAuth, useUser } from '@clerk/clerk-react'
import { AuthProvider } from './AuthContext'
import { CLERK_PUBLISHABLE_KEY } from './ClerkAuthAdapter'

function ClerkSessionBridge({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, userId, getToken, signOut } = useClerkAuth()
  const { user } = useUser()
  return (
    <AuthProvider
      clerk={{
        isLoaded,
        isSignedIn: !!isSignedIn,
        userKey: userId ?? null,
        email: user?.primaryEmailAddress?.emailAddress ?? null,
        getToken: () => getToken(),
        signOut: () => signOut(),
      }}
    >
      {children}
    </AuthProvider>
  )
}

/**
 * ClerkProvider + the bridge into ORION's AuthProvider. Its own chunk, loaded by
 * ClerkAuthAdapter only when a publishable key is configured.
 */
export default function ClerkBoundary({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY!} afterSignOutUrl="/login" signInUrl="/login" signUpUrl="/login">
      <ClerkSessionBridge>{children}</ClerkSessionBridge>
    </ClerkProvider>
  )
}
