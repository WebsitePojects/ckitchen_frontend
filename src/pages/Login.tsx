import { type FormEvent, useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Orbit, Loader2, AlertCircle } from 'lucide-react'
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
    'block w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60'

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      {/* ambient emerald glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-1/3 h-72 w-72 -translate-x-1/2 rounded-full bg-emerald-600/10 blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600/15 ring-1 ring-emerald-500/30">
            <Orbit className="h-6 w-6 text-emerald-400" aria-hidden />
          </span>
          <span className="text-2xl font-bold tracking-tight text-zinc-50">{PLATFORM_NAME}</span>
          <p className="mt-1 text-sm text-zinc-500">{PLATFORM_TAGLINE}</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-border bg-card p-7 shadow-xl shadow-black/30"
          noValidate
        >
          <div className="space-y-5">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-zinc-300">
                Email address
              </label>
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
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-zinc-300">
                Password
              </label>
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
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
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
            <p className="mt-5 rounded-lg bg-zinc-900/60 px-3 py-2 text-center text-xs text-zinc-500">
              Demo: <span className="text-zinc-300">admin@cloudkitchen.local</span> /{' '}
              <span className="text-zinc-300">admin123</span>
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
