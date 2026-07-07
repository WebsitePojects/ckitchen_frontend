import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { get } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { canAccess, normalizeRole, ROLE_LANDING } from '../auth/access'

/**
 * Permissions context — consumes the persisted RBAC matrix via
 * `GET /me/permissions` and closes the loop the admin matrix editor
 * (Settings > RBAC) previously had no runtime effect on.
 *
 * SAFETY: this is fail-OPEN by construction. `allowedPages` starts `null`
 * ("not loaded yet") and ONLY ever becomes a non-null Set after a
 * successful fetch that returned at least one page. Any of the following
 * leaves it `null` (i.e. `canAccessPage` falls back to the code-defined
 * defaults in auth/access.ts — the same access rules the app shipped with
 * before this endpoint existed):
 *   - the fetch is still in flight ("slow")
 *   - the fetch errored (network failure, 401, 500, ...)
 *   - the fetch succeeded but returned an empty page list ("empty" — e.g. an
 *     admin fat-fingered every row for a role to `allowed=false`; a bug here
 *     must never be able to fully lock a role out of the app)
 * A bug in the matrix, the endpoint, or the network can therefore only ever
 * ADD restrictions relative to a healthy known-good state that itself never
 * denies more than the shipped code-defaults — never silently deny access
 * beyond what the code already governs today.
 *
 * OWNER and the caller's own landing route (`ROLE_LANDING`) are always
 * accessible regardless of load state — short-circuited before the matrix
 * is even consulted.
 */

interface PermissionsContextValue {
  /** null = not loaded / failed / empty (fail-open state). Non-null = the persisted matrix's allowed pageKeys. */
  allowedPages: Set<string> | null
  loading: boolean
  /** True if `key` (a page path, e.g. '/reports') is accessible to the current user. */
  canAccessPage: (key: string) => boolean
}

const PermissionsContext = createContext<PermissionsContextValue | null>(null)

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [allowedPages, setAllowedPages] = useState<Set<string> | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) {
      setAllowedPages(null)
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    ;(async () => {
      try {
        const { data } = await get<{ pages: string[] }>('/me/permissions')
        if (!alive) return
        // Fail OPEN on a malformed or empty response — see class doc above.
        if (Array.isArray(data?.pages) && data.pages.length > 0) {
          setAllowedPages(new Set(data.pages))
        } else {
          setAllowedPages(null)
        }
      } catch {
        // Fetch failed (network, 401, 500, ...) — fail OPEN: leave null so
        // canAccessPage falls back to the code-defined defaults.
        if (alive) setAllowedPages(null)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [user])

  const canAccessPage = useMemo(() => {
    return (key: string): boolean => {
      if (!user) return false
      const role = normalizeRole(user.role)
      // OWNER is never restricted — always full access, regardless of the matrix or load state.
      if (role === 'OWNER') return true
      // A user's own landing route is always reachable (never bounce someone off the one page
      // they're guaranteed to land on after login).
      if (ROLE_LANDING[role] === key) return true
      // Fail OPEN: not loaded yet / fetch failed / empty response → code-defined defaults.
      if (allowedPages === null) return canAccess(user.role, key)
      return allowedPages.has(key)
    }
  }, [user, allowedPages])

  const value = useMemo<PermissionsContextValue>(
    () => ({ allowedPages, loading, canAccessPage }),
    [allowedPages, loading, canAccessPage],
  )

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>
}

export function usePermissions(): PermissionsContextValue {
  const ctx = useContext(PermissionsContext)
  if (!ctx) throw new Error('usePermissions must be used inside <PermissionsProvider>')
  return ctx
}
