import { SignIn, SignUp } from '@clerk/clerk-react'
import { dark } from '@clerk/themes'
import { AlertCircle } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useAuth } from './AuthContext'

/**
 * Google / email sign-in through Clerk. Rendered only when Clerk is configured.
 *
 * Invitation links (sent when the owner adds staff) arrive with a `__clerk_ticket`, which
 * Clerk's <SignUp> consumes to create the account; everyone else sees <SignIn>. After Clerk
 * signs someone in, ORION decides whether they may enter (AuthContext loads /auth/me).
 */
// Same palette as index.css; Clerk needs concrete colours, so one map per theme.
const elements = { card: 'shadow-none border-0 bg-transparent', rootBox: 'w-full', cardBox: 'w-full shadow-none', headerTitle: 'hidden', headerSubtitle: 'hidden' }
const APPEARANCE = {
  dark: {
    baseTheme: dark,
    variables: { colorPrimary: '#34D399', colorTextOnPrimaryBackground: '#04261A', colorBackground: '#0A0F0D', colorInputBackground: '#111815', colorText: '#E8EFEA', colorTextSecondary: '#9DADA4', colorDanger: '#FF8A7A', borderRadius: '0.6rem', fontFamily: '"Hanken Grotesk Variable", system-ui, sans-serif' },
    elements,
  },
  light: {
    variables: { colorPrimary: '#0A5C41', colorTextOnPrimaryBackground: '#FFFFFF', colorBackground: '#F5F2EA', colorInputBackground: '#FFFDF8', colorText: '#15201B', colorTextSecondary: '#56645C', colorDanger: '#B3311F', borderRadius: '0.6rem', fontFamily: '"Hanken Grotesk Variable", system-ui, sans-serif' },
    elements,
  },
}

export default function ClerkSignInPanel() {
  const { authError, logout } = useAuth()
  const { resolvedTheme } = useTheme()
  const appearance = resolvedTheme === 'light' ? APPEARANCE.light : APPEARANCE.dark

  if (authError) {
    return (
      <div className="space-y-4 border-y border-border py-5" role="alert">
        <div className="flex items-start gap-2 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warn-text" aria-hidden />
          <div>
            <p className="font-medium text-foreground">You can't open ORION yet</p>
            <p className="mt-1 text-muted-foreground">{authError.message}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={logout}
          className="h-11 w-full rounded-lg border border-input text-sm font-medium text-foreground transition-colors hover:bg-secondary"
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
