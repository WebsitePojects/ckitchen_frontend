import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, Loader2 } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { CKApiError, post } from '../lib/api'
import { captureJoinTokenFromUrl, clearJoinToken, pendingJoinToken } from '../lib/joinToken'
import AuthShell from '../components/auth/AuthShell'
import { Button } from '../components/ui/button'
import { ROLE_LABEL } from '../components/users/roles'

const ClerkSignInPanel = lazy(() => import('../auth/ClerkSignInPanel'))

interface JoinPreview {
  workspaceName: string
  role: string
  inviteeName: string
  expiresAt: string
}

type PreviewState = { kind: 'loading' } | { kind: 'ready'; preview: JoinPreview } | { kind: 'invalid'; message: string }

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof CKApiError || err instanceof Error ? err.message : fallback
}

/**
 * Where a join link lands (/join#<token>). The person signs in with any Google account, then
 * presses Join; ORION creates their account with the role the owner chose. Works for
 * someone ORION does not know yet, which is why it sits outside RequireAuth.
 */
export default function Join() {
  const { user, loading, authError, clerkEnabled, clerkEmail, logout, reloadUser } = useAuth()
  const navigate = useNavigate()
  // On first render: take the token out of the address bar (and keep it across the Google
  // sign-in redirect), or pick it up from storage when coming back from that redirect.
  const [token] = useState(() => {
    captureJoinTokenFromUrl()
    return pendingJoinToken()
  })
  const [preview, setPreview] = useState<PreviewState>(() =>
    token ? { kind: 'loading' } : { kind: 'invalid', message: 'This join link is incomplete. Open the full link the owner sent you.' },
  )
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)
  const [joined, setJoined] = useState(false)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    post<JoinPreview>('/auth/join/preview', { token })
      .then(({ data }) => { if (!cancelled) setPreview({ kind: 'ready', preview: data }) })
      .catch((err: unknown) => {
        if (cancelled) return
        if (err instanceof CKApiError && err.status === 410) clearJoinToken()
        setPreview({ kind: 'invalid', message: errorMessage(err, 'Could not check this link. Try again.') })
      })
    return () => { cancelled = true }
  }, [token])

  // After joining, AuthContext reloads the account; enter ORION once it arrives.
  useEffect(() => {
    if (joined && user) navigate('/', { replace: true })
  }, [joined, user, navigate])

  async function handleJoin() {
    // Early-return guard: a double tap must not send a second request (the server is
    // one-use anyway, but the second answer would replace the first in the UI).
    if (joining || !token) return
    setJoining(true)
    setJoinError(null)
    try {
      await post('/auth/join', { token })
      clearJoinToken()
      setJoined(true)
      reloadUser()
    } catch (err) {
      setJoinError(errorMessage(err, 'Could not join. Try again.'))
      setJoining(false)
    }
  }

  const ready = preview.kind === 'ready' ? preview.preview : null
  const title = ready ? `Join ${ready.workspaceName}` : 'Join a workspace'
  const subtitle = ready
    ? `${ready.inviteeName}, you're invited as ${ROLE_LABEL[ready.role] ?? ready.role}. Sign in with your Google account to continue.`
    : 'Open the link your business owner sent you.'

  let body
  if (!clerkEnabled) {
    body = <Notice message="Join links need Google sign-in, which is not set up on this server." />
  } else if (preview.kind === 'loading' || joined) {
    body = <Working label={joined ? 'Opening ORION…' : 'Checking the link…'} />
  } else if (preview.kind === 'invalid') {
    body = (
      <div className="space-y-4">
        <Notice message={preview.message} />
        <Button asChild variant="outline" className="w-full">
          <Link to="/login">Go to sign in</Link>
        </Button>
      </div>
    )
  } else if (user) {
    body = (
      <div className="space-y-4">
        <Notice message={`You already have ORION access as ${user.name}. This link is for someone new.`} />
        <div className="grid gap-2 sm:grid-cols-2">
          <Button asChild><Link to="/">Open ORION</Link></Button>
          <Button variant="outline" onClick={logout}>Use a different account</Button>
        </div>
      </div>
    )
  } else if (authError && authError.code !== 'NOT_INVITED') {
    body = (
      <div className="space-y-4">
        <Notice message={authError.message} />
        <Button variant="outline" className="w-full" onClick={logout}>Use a different account</Button>
      </div>
    )
  } else if (authError) {
    // Signed in with Google, not in ORION yet: exactly who this link is for.
    body = (
      <div className="space-y-4 border-y border-border py-5">
        <p className="text-ws-small text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{clerkEmail ?? 'your Google account'}</span>.
        </p>
        {joinError && (
          <p role="alert" className="flex items-start gap-2 text-ws-small text-danger-text">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{joinError}</span>
          </p>
        )}
        <Button className="w-full font-semibold" disabled={joining} onClick={() => void handleJoin()}>
          {joining ? <><Loader2 className="animate-spin" aria-hidden /> Joining…</> : `Join ${ready!.workspaceName}`}
        </Button>
        <button type="button" onClick={logout} disabled={joining} className="w-full text-center text-ws-small text-muted-foreground underline-offset-4 hover:underline">
          Use a different Google account
        </button>
      </div>
    )
  } else if (loading) {
    body = <Working label="Checking your sign-in…" />
  } else {
    body = (
      <Suspense fallback={<div className="h-64 w-full animate-pulse rounded-md bg-secondary" role="status" aria-label="Loading sign-in" />}>
        <ClerkSignInPanel redirectUrl="/join" />
      </Suspense>
    )
  }

  return (
    <AuthShell title={title} subtitle={subtitle}>
      {body}
    </AuthShell>
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
