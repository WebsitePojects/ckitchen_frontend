import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { apiClient, CKApiError } from '../lib/api'
import { setClerkTokenGetter } from '../lib/authToken'
import { queryClient } from '../lib/queryClient'
import { destroySocket } from '../lib/socket'
import { decodeJwtPayload } from './jwt'

/**
 * Drops the attendance-gate query (RequireAttendance's SELF_TODAY_QUERY_KEY)
 * from the cache on every login/logout. Without this, on a shared device a
 * NEW login within staleTime could reuse the PREVIOUS user's cached
 * clocked_in state — passing the gate they should hit, or rendering the
 * previous user's identity card on the Attendance page. Key literal is
 * deliberately duplicated here (same pattern as 'orion.outletId' below)
 * because importing it from ./RequireAttendance would create a circular
 * import (RequireAttendance -> AuthContext -> RequireAttendance).
 */
function dropSelfAttendanceCache(): void {
  queryClient.removeQueries({ queryKey: ['attendance', 'self-today'] })
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type UserRole =
  // v1 (legacy) — retained so the alias map (auth/access.ts ROLE_ALIASES) can
  // normalize tokens issued before the v2 role migration lands server-side.
  | 'SUPER_ADMIN'
  | 'KITCHEN_STAFF'
  | 'WAREHOUSE'
  | 'SUPPLIER_COORDINATOR'
  | 'ACCOUNTANT'
  | 'RIDER'
  // v2 (D24/D29) — canonical role set
  | 'OWNER'
  | 'OUTLET_MANAGER'
  | 'BRAND_MANAGER'
  | 'KITCHEN_CREW'
  | 'WAREHOUSE_MAIN'
  | 'WAREHOUSE_OUTLET'
  | 'PURCHASING'
  | 'HR'
  | 'ACCOUNTING'

/** Tenancy scope (D22/W1) — mirrors backend modules/auth/roles.ts `OutletScope`. */
export type OutletScope = 'ALL' | 'ASSIGNED'

export interface AuthUser {
  id: string
  email: string
  name: string
  role: UserRole
  /**
   * Tenancy (D22/W1): 'ALL' for HQ roles, 'ASSIGNED' otherwise. Lives ONLY in
   * the JWT payload — the login/`/auth/me` response's `user` row has no
   * outlet columns (backend `users` table; see modules/auth/routes.ts
   * `toPublicUser`) — so this is populated client-side by decoding the JWT
   * (see `withTenancyClaims` below), not by the response body directly.
   * Undefined on legacy tokens minted before this claim existed.
   */
  outlet_scope?: OutletScope
  /**
   * Tenancy (D22/W1): outlet ids this user may act in (from
   * `user_outlet_access`), decoded from the JWT the same way as
   * `outlet_scope`. Always an array (possibly empty) when the claim is
   * present; undefined on legacy tokens.
   */
  outlet_ids?: string[]
}

/** Shape of the tenancy claims as they appear in the JWT payload (D22/W1). */
interface TenancyClaims {
  outlet_scope?: OutletScope
  outlet_ids?: string[]
}

/**
 * Merges the JWT's `outlet_scope`/`outlet_ids` claims onto a `user` object
 * fetched from `/auth/login` or `/auth/me` — those endpoints return the raw
 * `users` DB row (minus password hash), which has no outlet columns; the
 * claims only ride the token itself. A token that fails to decode (malformed,
 * or a pre-tenancy legacy token entirely lacking these fields) leaves `user`
 * untouched, i.e. both fields stay undefined — the "legacy, no claims" case
 * downstream contexts (OutletContext) must keep working under.
 */
function withTenancyClaims(user: AuthUser, token: string): AuthUser {
  const claims = decodeJwtPayload<TenancyClaims>(token)
  if (!claims) return user
  return {
    ...user,
    outlet_scope: claims.outlet_scope,
    outlet_ids: Array.isArray(claims.outlet_ids) ? claims.outlet_ids : undefined,
  }
}

interface AuthState {
  token: string | null
  user: AuthUser | null
  loading: boolean
  /** Why a signed-in Clerk user was refused (e.g. NOT_INVITED, ACCOUNT_BLOCKED). */
  authError: { code: string; message: string } | null
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  /** Asks ORION again who the Clerk user is (after joining a workspace with a link). */
  reloadUser: () => void
  /** True when Clerk (Google / email) sign-in is configured for this deployment. */
  clerkEnabled: boolean
  /** The signed-in Clerk account's primary email, shown so people can tell which Google account they used. */
  clerkEmail: string | null
}

/**
 * The slice of Clerk's session the provider needs, supplied by ClerkAuthAdapter (App.tsx)
 * so this module never imports Clerk and keeps working when Clerk is not configured.
 */
export interface ClerkSessionApi {
  isLoaded: boolean
  isSignedIn: boolean
  /** Clerk user id; a change means a different person signed in. */
  userKey: string | null
  email: string | null
  getToken: () => Promise<string | null>
  signOut: () => Promise<void>
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null)

const TOKEN_KEY = 'ck_jwt'

/**
 * The last account ORION confirmed for a Clerk user, so a reload can open the app at once
 * instead of waiting a full round trip to the API (about 1-2 s from the Philippines) before
 * anything renders. /auth/me still runs right after and replaces or revokes it; every data
 * request is authorized by the server on its own, so a stale copy can never grant access.
 */
const LAST_USER_KEY = 'orion.lastUser'

function readLastUser(clerkUserKey: string | null): AuthUser | null {
  if (!clerkUserKey) return null
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_USER_KEY) ?? 'null') as { clerkUserKey?: string; user?: AuthUser } | null
    return saved?.clerkUserKey === clerkUserKey && saved.user ? saved.user : null
  } catch {
    return null
  }
}

function saveLastUser(clerkUserKey: string | null, user: AuthUser | null): void {
  try {
    if (clerkUserKey && user) localStorage.setItem(LAST_USER_KEY, JSON.stringify({ clerkUserKey, user }))
    else localStorage.removeItem(LAST_USER_KEY)
  } catch {
    // Storage blocked: the app just waits for /auth/me as before.
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children, clerk }: { children: ReactNode; clerk?: ClerkSessionApi }) {
  const [state, setState] = useState<AuthState>({
    token: localStorage.getItem(TOKEN_KEY),
    user: null,
    loading: true,
    authError: null,
  })

  // On mount (or token change), validate the stored token via /auth/me
  useEffect(() => {
    const token = state.token
    if (!token) {
      // Clerk mode: the Clerk effect below decides once Clerk has loaded.
      if (!clerk) setState((s) => ({ ...s, loading: false }))
      return
    }

    apiClient
      .get<{ user: AuthUser }>('/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then(({ data }) => {
        // /auth/me returns { user: {...} } — unwrap it (login returns it nested too).
        setState({ token, user: withTenancyClaims(data.user, token), loading: false, authError: null })
      })
      .catch(() => {
        // Token invalid or expired — clear it
        localStorage.removeItem(TOKEN_KEY)
        setState({ token: null, user: null, loading: !!clerk, authError: null })
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // run once on mount

  // ── Clerk session (Google / email sign-in) ────────────────────────────────
  // A password-login token takes precedence (IT break-glass). Otherwise follow Clerk:
  // signed in -> load the ORION user (role/outlets decided by the server) with a fresh
  // Clerk token; refused -> keep the reason for the login page; signed out -> clear.
  const clerkLoaded = clerk?.isLoaded ?? false
  const clerkSignedIn = clerk?.isSignedIn ?? false
  const clerkUserKey = clerk?.userKey ?? null
  const clerkGetTokenRef = useRef(clerk?.getToken)
  clerkGetTokenRef.current = clerk?.getToken
  const [reloadNonce, setReloadNonce] = useState(0)
  const reloadUser = useCallback(() => setReloadNonce((n) => n + 1), [])
  useEffect(() => {
    if (!clerk || state.token || !clerkLoaded) return
    if (!clerkSignedIn) {
      setClerkTokenGetter(null)
      setState({ token: null, user: null, loading: false, authError: null })
      return
    }
    setClerkTokenGetter(() => clerkGetTokenRef.current?.() ?? Promise.resolve(null))
    let cancelled = false
    // Same Clerk account as last time: open with the remembered account while /auth/me confirms.
    const remembered = readLastUser(clerkUserKey)
    setState((s) =>
      remembered
        ? { token: null, user: remembered, loading: false, authError: null }
        : { ...s, loading: true, authError: null },
    )
    apiClient
      .get<{ user: AuthUser }>('/auth/me')
      .then(({ data }) => {
        if (cancelled) return
        if (!remembered) dropSelfAttendanceCache()
        saveLastUser(clerkUserKey, data.user)
        setState({ token: null, user: data.user, loading: false, authError: null })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        // 403 = ORION refused this person (message from the server); 401 = the sign-in itself
        // was not accepted; anything else = ORION could not be reached.
        const apiErr = err instanceof CKApiError ? err : null
        const refused = apiErr?.status === 401 || apiErr?.status === 403
        // ORION unreachable but this account was confirmed before: stay open (pages show
        // their own errors) rather than throw someone out over a network blip.
        if (!refused && remembered) return
        saveLastUser(null, null)
        setState({
          token: null,
          user: null,
          loading: false,
          authError:
            apiErr?.status === 403
              ? { code: apiErr.code, message: apiErr.message }
              : apiErr?.status === 401
                ? { code: 'SIGN_IN_REJECTED', message: 'ORION could not verify this sign-in. Try again, or use a different account. (401)' }
                : { code: 'UNAVAILABLE', message: 'Could not reach ORION. Check the connection and try again.' },
        })
      })
    return () => {
      cancelled = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clerkLoaded, clerkSignedIn, clerkUserKey, state.token, reloadNonce])

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await apiClient.post<{ token: string; user: AuthUser }>(
      '/auth/login',
      { email, password },
    )
    localStorage.setItem(TOKEN_KEY, data.token)
    dropSelfAttendanceCache()
    setState({ token: data.token, user: withTenancyClaims(data.user, data.token), loading: false, authError: null })
  }, [])

  const logout = useCallback(async () => {
    // Best-effort server invalidation — ignore errors (token may already be gone)
    if (state.token) {
      apiClient
        .post('/auth/logout', null, {
          headers: { Authorization: `Bearer ${state.token}` },
        })
        .catch(() => undefined)
    }
    // Tear down the realtime socket unconditionally — every logout path clears it,
    // not just useSignOut.
    destroySocket()
    localStorage.removeItem(TOKEN_KEY)
    // Clear the outlet switcher's persisted selection too (context/OutletContext.tsx
    // OUTLET_STORAGE_KEY) so the next login — possibly a different user with a
    // different outlet scope — never inherits a stale choice. Literal duplicated
    // here rather than imported, matching the same key already duplicated in
    // lib/api.ts, to avoid a circular import between auth/ and context/.
    localStorage.removeItem('orion.outletId')
    saveLastUser(null, null)
    dropSelfAttendanceCache()
    setClerkTokenGetter(null)
    setState({ token: null, user: null, loading: false, authError: null })
    // End the Clerk session too, so the next person at a shared tablet must sign in.
    if (clerk?.isSignedIn) void clerk.signOut().catch(() => undefined)
  }, [state.token, clerk])

  const clerkEmail = clerk?.email ?? null
  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, logout, reloadUser, clerkEnabled: !!clerk, clerkEmail }),
    [state, login, logout, reloadUser, clerk, clerkEmail],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
