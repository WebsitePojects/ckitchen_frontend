import { type FormEvent, lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Orbit, Loader2, AlertCircle, Mail, Lock } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { CKApiError, warmUpApi } from '../lib/api'
import { PLATFORM_NAME, PLATFORM_TAGLINE, PLATFORM_ATTRIBUTION } from '../lib/branding'
import { NightSky, PaperGeometry } from '../components/brand/OrionArt'
import ThemeToggle from '../components/layout/ThemeToggle'

// Clerk's sign-in widget is its own chunk: password-only deployments never download it.
const ClerkSignInPanel = lazy(() => import('../auth/ClerkSignInPanel'))

export default function Login() {
  const { login, user, clerkEnabled } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // When a submit takes long, the API is likely cold-starting (Render free tier,
  // ~50s wake). Show that instead of a silent spinner so it doesn't read as broken.
  const [slowHint, setSlowHint] = useState(false)
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // With Clerk on, the password form is the IT team's break-glass, tucked behind a toggle.
  const [showPassword, setShowPassword] = useState(!clerkEnabled)

  // A Clerk sign-in completes outside handleSubmit: leave the page once ORION accepts it.
  useEffect(() => {
    if (user) navigate(from, { replace: true })
  }, [user, from, navigate])

  // Start waking the backend as soon as the login page loads, so it's usually
  // warm by the time the user finishes typing (fixes the cold-start timeout).
  useEffect(() => {
    warmUpApi()
    return () => { if (slowTimer.current) clearTimeout(slowTimer.current) }
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    // Early-return guard: Enter-key repeat re-fires the form's submit event
    // regardless of the button's disabled attribute (that only blocks clicks
    // on the button itself), so the disabled prop alone isn't enough here.
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

  const inputClass =
    'peer block h-11 w-full rounded-lg border border-input bg-card pl-10 pr-3 text-base text-foreground placeholder:text-muted-foreground outline-none transition-colors duration-200 focus:border-ink-accent focus:ring-2 focus:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm'

  const iconClass =
    'pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors duration-200 peer-focus:text-ink-accent'

  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,1.1fr)_minmax(26rem,0.9fr)]">
      {/* Art panel: the ORION sky by night, geometry on paper by day. Phones get a short band. */}
      <section className="relative isolate flex h-56 flex-col justify-end overflow-hidden border-b border-border p-6 sm:h-72 lg:h-auto lg:border-b-0 lg:border-r lg:p-12">
        <NightSky className="orion-art-dark absolute inset-0 -z-10 h-full w-full" />
        <PaperGeometry className="orion-art-light absolute inset-0 -z-10 h-full w-full" placement="side" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-background via-background/40 to-transparent" aria-hidden />
        <div className="flex items-center gap-2.5">
          <Orbit className="h-6 w-6 text-ink-accent" aria-hidden />
          <span className="font-display text-3xl leading-none">{PLATFORM_NAME}</span>
        </div>
        <h2 className="mt-4 hidden max-w-xl font-display text-5xl leading-[1.02] tracking-tight lg:block xl:text-6xl">
          Every brand, every outlet, <em className="text-ink-accent">one sky.</em>
        </h2>
        <ul className="mt-6 hidden max-w-md divide-y divide-border border-y border-border text-sm text-muted-foreground lg:block">
          <li className="py-2.5">GrabFood and foodpanda orders in one live board</li>
          <li className="py-2.5">Recipe costing and stock that deduct as you cook</li>
          <li className="py-2.5">Staff time, attendance and alerts when something is left</li>
        </ul>
      </section>

      {/* Form column */}
      <section className="relative flex flex-col px-4 py-8 sm:px-10">
        <div className="flex justify-end">
          <ThemeToggle />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center motion-safe:animate-fade-in-up">
          <p className="eyebrow">{PLATFORM_TAGLINE}</p>
          <h1 className="mt-2 font-display text-4xl leading-tight tracking-tight">Sign in</h1>
          <div className="rule-double mb-6 mt-4" aria-hidden />

          {clerkEnabled && (
            <Suspense fallback={<div className="h-80 w-full animate-pulse rounded-xl bg-secondary" role="status" aria-label="Loading sign-in" />}>
              <ClerkSignInPanel />
            </Suspense>
          )}

          {clerkEnabled && (
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-expanded={showPassword}
              className="mt-5 self-start text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {showPassword ? 'Hide Prince IT sign-in' : 'Prince IT staff: sign in with password'}
            </button>
          )}

          {showPassword && (
            <form onSubmit={handleSubmit} className="mt-4 space-y-5 border-t border-border pt-5" noValidate>
              <div>
                <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-foreground">
                  Email address
                </label>
                <div className="relative">
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={submitting}
                    className={inputClass}
                    placeholder="you@company.com"
                  />
                  <Mail className={iconClass} aria-hidden />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-foreground">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={submitting}
                    className={inputClass}
                    placeholder="••••••••"
                  />
                  <Lock className={iconClass} aria-hidden />
                </div>
              </div>

              {error && (
                <p role="alert" className="flex items-start gap-2 text-sm text-danger-text">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>{error}</span>
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-[transform,opacity] duration-200 hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Signing in…
                  </>
                ) : (
                  'Sign in'
                )}
              </button>

              {slowHint && (
                <p className="text-center text-xs text-muted-foreground">
                  Waking up the server — this can take up to a minute on first use. Hang tight.
                </p>
              )}

              {import.meta.env.DEV && (
                <p className="border-t border-border pt-3 text-center text-xs text-muted-foreground">
                  Demo: <span className="text-foreground">admin@cloudkitchen.local</span> / <span className="text-foreground">admin123</span>
                </p>
              )}
            </form>
          )}
        </div>
        <p className="mt-8 text-center text-xs text-muted-foreground">
          {PLATFORM_NAME} · {PLATFORM_ATTRIBUTION}
        </p>
      </section>
    </div>
  )
}
