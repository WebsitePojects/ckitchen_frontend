import { SignIn, SignUp } from '@clerk/clerk-react'
import { dark } from '@clerk/themes'
import { AlertCircle } from 'lucide-react'
import { useAuth } from './AuthContext'

/**
 * Google / email sign-in through Clerk. Rendered only when Clerk is configured.
 *
 * Invitation links (sent when the owner adds staff) arrive with a `__clerk_ticket`, which
 * Clerk's <SignUp> consumes to create the account; everyone else sees <SignIn>. After Clerk
 * signs someone in, ORION decides whether they may enter (AuthContext loads /auth/me).
 */
const appearance = {
  baseTheme: dark,
  variables: { colorPrimary: '#10b981', colorBackground: '#0f1513', borderRadius: '0.6rem' },
  elements: { card: 'shadow-none', rootBox: 'w-full', cardBox: 'w-full shadow-none' },
}

export default function ClerkSignInPanel() {
  const { authError, logout } = useAuth()

  if (authError) {
    return (
      <div className="space-y-4 rounded-2xl border border-border bg-card/90 p-6" role="alert">
        <div className="flex items-start gap-2 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div>
            <p className="font-medium text-zinc-100">You can't open ORION yet</p>
            <p className="mt-1 text-zinc-400">{authError.message}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={logout}
          className="h-11 w-full rounded-lg border border-border text-sm font-medium text-zinc-200 hover:bg-zinc-800/60"
        >
          Use a different account
        </button>
      </div>
    )
  }

  const invited = new URLSearchParams(window.location.search).has('__clerk_ticket')
  return invited ? (
    <SignUp routing="hash" appearance={appearance} signInUrl="/login" />
  ) : (
    <SignIn routing="hash" appearance={appearance} signUpUrl="/login" />
  )
}
