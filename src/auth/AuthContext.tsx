import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { apiClient } from '../lib/api'
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
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null)

const TOKEN_KEY = 'ck_jwt'

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    token: localStorage.getItem(TOKEN_KEY),
    user: null,
    loading: true,
  })

  // On mount (or token change), validate the stored token via /auth/me
  useEffect(() => {
    const token = state.token
    if (!token) {
      setState((s) => ({ ...s, loading: false }))
      return
    }

    apiClient
      .get<{ user: AuthUser }>('/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then(({ data }) => {
        // /auth/me returns { user: {...} } — unwrap it (login returns it nested too).
        setState({ token, user: withTenancyClaims(data.user, token), loading: false })
      })
      .catch(() => {
        // Token invalid or expired — clear it
        localStorage.removeItem(TOKEN_KEY)
        setState({ token: null, user: null, loading: false })
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // run once on mount

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await apiClient.post<{ token: string; user: AuthUser }>(
      '/auth/login',
      { email, password },
    )
    localStorage.setItem(TOKEN_KEY, data.token)
    dropSelfAttendanceCache()
    setState({ token: data.token, user: withTenancyClaims(data.user, data.token), loading: false })
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
    dropSelfAttendanceCache()
    setState({ token: null, user: null, loading: false })
  }, [state.token])

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, logout }),
    [state, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
