import { type FormEvent, lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { Loader2, AlertCircle, Mail, Lock } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { CKApiError, warmUpApi } from '../lib/api'
import { pendingJoinToken } from '../lib/joinToken'
import AuthShell from '../components/auth/AuthShell'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'

// Clerk's sign-in widget is its own chunk: password-only deployments never download it.
const ClerkSignInPanel = lazy(() => import('../auth/ClerkSignInPanel'))

export default function Login() {
  const { login, user, authError, clerkEnabled } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // When a submit takes long, the API is likely cold-starting. Say so instead of a silent spinner.
  const [slowHint, setSlowHint] = useState(false)
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // With Clerk on, business users sign in with Google/email only; Prince IT's own access
  // moves to a separate operator console. The password form remains for Clerk-less local dev.
  const showPassword = !clerkEnabled

  // A Clerk sign-in completes outside handleSubmit: leave the page once ORION accepts it.
  useEffect(() => {
    if (user) navigate(from, { replace: true })
  }, [user, from, navigate])

  // Someone who opened a join link and came back here after signing in with Google (not in
  // ORION yet): finish joining on the join page instead of showing "not added".
  useEffect(() => {
    if (authError?.code === 'NOT_INVITED' && pendingJoinToken()) navigate('/join', { replace: true })
  }, [authError, navigate])

  // Start waking the backend as soon as the login page loads (cold-start mitigation).
  useEffect(() => {
    warmUpApi()
    return () => { if (slowTimer.current) clearTimeout(slowTimer.current) }
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    // Early-return guard: Enter-key repeat re-fires submit regardless of the disabled button.
    if (submitting) return
    setError(null)
    setSlowHint(false)
    setSubmitting(true)
    slowTimer.current = setTimeout(() => setSlowHint(true), 6_000)
    try {
      await login(email.trim(), password)
      navigate(from, { replace: true })
    } catch (err) {
      if (err instanceof CKApiError) setError(err.message)
      else if (err instanceof Error) setError(err.message)
      else setError('Login failed. Please try again.')
    } finally {
      if (slowTimer.current) clearTimeout(slowTimer.current)
      setSlowHint(false)
      setSubmitting(false)
    }
  }

  const iconClass = 'pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground'

  return (
    <AuthShell title="Sign in" subtitle="Use the Google account or email your business invited.">
      {clerkEnabled && (
        <Suspense fallback={<div className="h-64 w-full animate-pulse rounded-md bg-secondary" role="status" aria-label="Loading sign-in" />}>
          <ClerkSignInPanel />
        </Suspense>
      )}

      {showPassword && (
        <form onSubmit={handleSubmit} className="space-y-ws-gap" noValidate>
          <div>
            <label htmlFor="email" className="mb-1.5 block text-ws-small font-medium text-foreground">
              Email address
            </label>
            <div className="relative">
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                className="bg-card pl-10"
                placeholder="you@company.com"
              />
              <Mail className={iconClass} aria-hidden />
            </div>
          </div>

          <div>
            <label htmlFor="password" className="mb-1.5 block text-ws-small font-medium text-foreground">
              Password
            </label>
            <div className="relative">
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                className="bg-card pl-10"
                placeholder="••••••••"
              />
              <Lock className={iconClass} aria-hidden />
            </div>
          </div>

          {error && (
            <p role="alert" className="flex items-start gap-2 text-ws-small text-danger-text">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{error}</span>
            </p>
          )}

          <Button type="submit" disabled={submitting} className="w-full font-semibold">
            {submitting ? (
              <>
                <Loader2 className="animate-spin" aria-hidden />
                Signing in…
              </>
            ) : (
              'Sign in'
            )}
          </Button>

          {slowHint && (
            <p className="text-center text-ws-micro text-muted-foreground">
              Waking up the server. This can take up to a minute on first use.
            </p>
          )}

          {import.meta.env.DEV && (
            <p className="border-t border-border pt-3 text-center text-ws-micro text-muted-foreground">
              Demo: <span className="text-foreground">admin@cloudkitchen.local</span> / <span className="text-foreground">admin123</span>
            </p>
          )}
        </form>
      )}
      {clerkEnabled && (
        <p className="mt-ws-gutter text-center text-ws-small text-muted-foreground">
          New business? <Link to="/signup" className="font-medium text-foreground underline-offset-4 hover:underline">Create a workspace</Link>
        </p>
      )}
    </AuthShell>
  )
}
