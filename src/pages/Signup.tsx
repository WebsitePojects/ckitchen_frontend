import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, Check, Loader2 } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { CKApiError, get, post } from '../lib/api'
import AuthShell from '../components/auth/AuthShell'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { cn } from '../lib/utils'

const ClerkSignInPanel = lazy(() => import('../auth/ClerkSignInPanel'))

/** Brand colour choices; any of them reads on the kitchen screen in both themes. */
const BRAND_COLORS = ['#0A5C41', '#1D4ED8', '#B91C1C', '#C2410C', '#7C3AED', '#0F766E', '#BE185D', '#334155'] as const

type Status = { kind: 'loading' } | { kind: 'enabled' } | { kind: 'disabled' }

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof CKApiError || err instanceof Error ? err.message : fallback
}

/**
 * /signup: a business owner signs in with any Google account, names the business, its first
 * outlet and first brand, and lands in their own empty workspace. Outside RequireAuth: the
 * person has no ORION account yet. The server creates everything in one transaction.
 */
export default function Signup() {
  const { user, loading, authError, clerkEnabled, clerkEmail, logout, reloadUser } = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState<Status>({ kind: 'loading' })
  const [businessName, setBusinessName] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [outletName, setOutletName] = useState('')
  const [brandName, setBrandName] = useState('')
  const [brandColor, setBrandColor] = useState<string>(BRAND_COLORS[0])
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [created, setCreated] = useState(false)

  useEffect(() => {
    let cancelled = false
    get<{ enabled: boolean }>('/auth/signup/status')
      .then(({ data }) => { if (!cancelled) setStatus({ kind: data.enabled ? 'enabled' : 'disabled' }) })
      .catch(() => { if (!cancelled) setStatus({ kind: 'disabled' }) })
    return () => { cancelled = true }
  }, [])

  // Already in ORION (or just created the workspace): open the app.
  useEffect(() => {
    if (user) navigate('/', { replace: true })
  }, [user, navigate])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    // Ref guard: Enter-key repeat and double taps must not send a second request.
    if (submittingRef.current) return
    if (businessName.trim().length < 2 || !ownerName.trim() || !outletName.trim() || !brandName.trim()) {
      setFormError('Fill in every field.')
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    setFormError(null)
    try {
      await post('/auth/signup', {
        business_name: businessName.trim(),
        owner_name: ownerName.trim(),
        outlet_name: outletName.trim(),
        brand_name: brandName.trim(),
        brand_color: brandColor,
      })
      setCreated(true)
      reloadUser()
    } catch (err) {
      setFormError(errorMessage(err, 'Could not create the workspace. Try again.'))
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  let body
  if (!clerkEnabled || status.kind === 'disabled') {
    body = (
      <div className="space-y-4">
        <Notice message="Creating a new workspace is not open yet. If your business already uses ORION, ask the owner for a join link." />
        <Button asChild variant="outline" className="w-full"><Link to="/login">Go to sign in</Link></Button>
      </div>
    )
  } else if (status.kind === 'loading' || created || (loading && !authError)) {
    body = <Working label={created ? 'Setting up your workspace…' : 'Loading…'} />
  } else if (authError && authError.code !== 'NOT_INVITED') {
    body = (
      <div className="space-y-4">
        <Notice message={authError.message} />
        <Button variant="outline" className="w-full" onClick={logout}>Use a different account</Button>
      </div>
    )
  } else if (authError) {
    body = (
      <form onSubmit={handleSubmit} className="space-y-ws-gap" noValidate>
        <p className="text-ws-small text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{clerkEmail ?? 'your Google account'}</span>. You'll be the owner.
        </p>
        <Field id="su-business" label="Business name" hint="Shown to your staff." value={businessName} onChange={setBusinessName} disabled={submitting} placeholder="e.g. Dela Cruz Foods" autoFocus />
        <Field id="su-owner" label="Your name" value={ownerName} onChange={setOwnerName} disabled={submitting} placeholder="e.g. Juan dela Cruz" />
        <Field id="su-outlet" label="First outlet" hint="Your kitchen or branch. You can add more later." value={outletName} onChange={setOutletName} disabled={submitting} placeholder="e.g. Quezon City kitchen" />
        <Field id="su-brand" label="First brand" hint="The food concept customers order from. You can add more later." value={brandName} onChange={setBrandName} disabled={submitting} placeholder="e.g. Kusina ni Juan" />
        <fieldset>
          <legend className="mb-1.5 text-ws-small font-medium text-foreground">Brand colour</legend>
          <div className="flex flex-wrap gap-2">
            {BRAND_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => setBrandColor(color)}
                disabled={submitting}
                aria-label={`Brand colour ${color}`}
                aria-pressed={brandColor === color}
                className={cn(
                  'grid h-9 w-9 place-items-center rounded-full ring-offset-2 ring-offset-background transition-shadow',
                  brandColor === color ? 'ring-2 ring-foreground' : 'hover:ring-2 hover:ring-border',
                )}
                style={{ backgroundColor: color }}
              >
                {brandColor === color && <Check className="h-4 w-4 text-white" aria-hidden />}
              </button>
            ))}
          </div>
        </fieldset>
        {formError && (
          <p role="alert" className="flex items-start gap-2 text-ws-small text-danger-text">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{formError}</span>
          </p>
        )}
        <Button type="submit" disabled={submitting} className="w-full font-semibold">
          {submitting ? <><Loader2 className="animate-spin" aria-hidden /> Creating your workspace…</> : 'Create workspace'}
        </Button>
        <button type="button" onClick={logout} disabled={submitting} className="w-full text-center text-ws-small text-muted-foreground underline-offset-4 hover:underline">
          Use a different Google account
        </button>
      </form>
    )
  } else {
    body = (
      <Suspense fallback={<div className="h-64 w-full animate-pulse rounded-md bg-secondary" role="status" aria-label="Loading sign-in" />}>
        <ClerkSignInPanel redirectUrl="/signup" />
      </Suspense>
    )
  }

  return (
    <AuthShell title="Create your workspace" subtitle="Sign in with Google, then tell us about your business. Takes a minute.">
      {body}
      <p className="mt-ws-gutter text-center text-ws-small text-muted-foreground">
        Already using ORION? <Link to="/login" className="font-medium text-foreground underline-offset-4 hover:underline">Sign in</Link>
      </p>
    </AuthShell>
  )
}

function Field({
  id, label, hint, value, onChange, disabled, placeholder, autoFocus,
}: {
  id: string
  label: string
  hint?: string
  value: string
  onChange: (value: string) => void
  disabled: boolean
  placeholder: string
  autoFocus?: boolean
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-ws-small font-medium text-foreground">{label}</label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder={placeholder} maxLength={120} autoFocus={autoFocus} className="bg-card" />
      {hint && <p className="mt-1 text-ws-micro text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Notice({ message }: { message: string }) {
  return (
    <p role="alert" className="flex items-start gap-2 border-y border-border py-5 text-ws-small text-muted-foreground">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warn-text" aria-hidden />
      <span>{message}</span>
    </p>
  )
}

function Working({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2 border-y border-border py-5 text-ws-small text-muted-foreground" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {label}
    </p>
  )
}
