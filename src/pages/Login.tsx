import { type FormEvent, useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Orbit, Loader2, AlertCircle, Mail, Lock } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { CKApiError, warmUpApi } from '../lib/api'
import { PLATFORM_NAME, PLATFORM_TAGLINE, PLATFORM_ATTRIBUTION } from '../lib/branding'

export default function Login() {
  const { login } = useAuth()
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
    'peer block h-11 w-full rounded-lg border border-border bg-background/60 pl-10 pr-3 text-sm text-foreground placeholder-zinc-500 outline-none transition-colors duration-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-60'

  const iconClass =
    'pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500 transition-colors duration-200 peer-focus:text-emerald-400'

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-4">
      {/* aurora — soft, low-opacity emerald/teal blobs behind the card */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/4 top-1/4 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-600/10 blur-3xl" />
        <div className="absolute right-1/4 top-2/3 h-72 w-72 translate-x-1/3 rounded-full bg-teal-500/10 blur-3xl" />
        <div className="absolute bottom-0 left-1/2 h-64 w-64 -translate-x-1/2 translate-y-1/3 rounded-full bg-emerald-500/5 blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm motion-safe:animate-fade-in-up">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500/20 to-emerald-700/10 shadow-lg shadow-emerald-500/10 ring-1 ring-emerald-500/40">
            <Orbit className="h-7 w-7 text-emerald-400" aria-hidden />
          </span>
          <span className="text-2xl font-bold tracking-tight text-foreground">{PLATFORM_NAME}</span>
          <p className="mt-1 text-sm text-zinc-500">{PLATFORM_TAGLINE}</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-border bg-card/90 p-7 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.55),0_0_45px_-10px_rgba(16,185,129,0.25)] backdrop-blur-xl"
          noValidate
        >
          <div className="space-y-5">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-muted-foreground">
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
                  placeholder="you@cloudkitchen.local"
                />
                <Mail className={iconClass} aria-hidden />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-muted-foreground">
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
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-400"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition-colors duration-200 hover:bg-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Signing in…
                </>
              ) : (
                'Sign in'
              )}
            </button>

            {slowHint && (
              <p className="text-center text-xs text-zinc-500">
                Waking up the server — this can take up to a minute on first use. Hang tight.
              </p>
            )}
          </div>

          {import.meta.env.DEV && (
            <p className="mt-5 rounded-lg bg-muted px-3 py-2 text-center text-xs text-muted-foreground">
              Demo: <span className="text-foreground">admin@cloudkitchen.local</span> /{' '}
              <span className="text-foreground">admin123</span>
            </p>
          )}
        </form>

        <p className="mt-4 text-center text-xs text-zinc-600">
          {PLATFORM_NAME} — {PLATFORM_ATTRIBUTION}
        </p>
      </div>
    </div>
  )
}
