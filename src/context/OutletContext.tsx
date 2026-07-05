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
import { normalizeRole } from '../auth/access'

/**
 * Outlet context switcher — platform-ia-navigation.md §5.
 *
 * Selection persists to localStorage (read directly by the API client's
 * request interceptor — see lib/api.ts) and is sent as `X-Outlet-Id` on every
 * request when a specific outlet is selected. Backend W1 landed the D22
 * membership middleware: a non-member `X-Outlet-Id` now 403s, so this
 * context restricts ASSIGNED-scope users to their real `outlet_ids` (from
 * the JWT — see auth/AuthContext.tsx `withTenancyClaims`) and validates any
 * persisted selection against that set on load, with a runtime 403 backstop
 * (see lib/api.ts) for whatever load-time validation can't catch (e.g. a
 * legacy token, whose effective `outlet_ids` is always `[]` server-side).
 */

export interface OutletSummary {
  id: string
  code: string
  name: string
}

export type SelectedOutlet = string | 'ALL'

interface OutletContextValue {
  outlets: OutletSummary[]
  loading: boolean
  selectedOutletId: SelectedOutlet
  setSelectedOutletId: (id: SelectedOutlet) => void
  /** True for roles with cross-outlet ("All outlets") visibility — D31. */
  isHqScope: boolean
}

const OutletContext = createContext<OutletContextValue | null>(null)

export const OUTLET_STORAGE_KEY = 'orion.outletId'

/**
 * Fired by lib/api.ts when the backend 403s an `X-Outlet-Id` header. Kept as
 * a duplicated literal (mirrors OUTLET_STORAGE_KEY above) — see lib/api.ts's
 * own copy for why this isn't a shared import.
 */
const OUTLET_FORBIDDEN_EVENT = 'orion:outlet-forbidden'

/**
 * HQ-scope roles per D31: OWNER, HR, ACCOUNTING, WAREHOUSE_MAIN (+ legacy
 * SUPER_ADMIN via alias). Used ONLY as a fallback for legacy tokens minted
 * before the outlet_scope/outlet_ids JWT claims existed (backend W1) — any
 * token carrying a real `outlet_scope` claim is authoritative over this.
 */
const HQ_SCOPE_ROLES = new Set(['OWNER', 'HR', 'ACCOUNTING', 'WAREHOUSE_MAIN'])

export function OutletProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [outlets, setOutlets] = useState<OutletSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedOutletId, setSelectedOutletIdState] = useState<SelectedOutlet>(
    () => (localStorage.getItem(OUTLET_STORAGE_KEY) as SelectedOutlet | null) ?? 'ALL',
  )

  // Tenancy (D22/W1): outlet_scope/outlet_ids ride the JWT only (decoded
  // client-side onto `user` — see auth/AuthContext.tsx `withTenancyClaims`),
  // never the login/`/auth/me` response body. `outletScope === undefined`
  // means a legacy token minted before this claim existed.
  const outletScope = user?.outlet_scope
  const outletIdsClaim = user?.outlet_ids
  const isLegacyToken = user != null && outletScope === undefined

  // 'All outlets' is offered ONLY for real ALL-scope claims, plus legacy
  // tokens whose role falls in the old HQ set (backward compat — a token
  // minted before W1 has no claim to check, so we fall back to the same
  // role-based rule the frontend used pre-tenancy rather than breaking the
  // switcher for anyone still holding one until it expires/they re-login).
  const isHqScope =
    user != null &&
    (outletScope === 'ALL' || (isLegacyToken && HQ_SCOPE_ROLES.has(normalizeRole(user.role))))

  // Options actually offered/allowed. ALL-scope (+ legacy HQ fallback) sees
  // every fetched outlet. Real ASSIGNED claims restrict to outlet_ids
  // intersected with what's live (a stale id just drops out silently).
  // Legacy non-HQ fallback has no claim to filter by — same "show everything,
  // don't break" compromise as before W1; a stale specific selection there is
  // caught by the runtime 403 handler below instead of load-time validation.
  const allowedOutlets = useMemo(() => {
    if (isHqScope) return outlets
    if (outletScope === 'ASSIGNED') {
      const allowed = new Set(outletIdsClaim ?? [])
      return outlets.filter((o) => allowed.has(o.id))
    }
    return outlets
  }, [outlets, isHqScope, outletScope, outletIdsClaim])

  function setSelectedOutletId(id: SelectedOutlet) {
    setSelectedOutletIdState(id)
    localStorage.setItem(OUTLET_STORAGE_KEY, id)
  }

  /** Safe fallback when the current selection can't be trusted. */
  function defaultSelection(): SelectedOutlet {
    if (isHqScope) return 'ALL'
    return allowedOutlets[0]?.id ?? 'ALL'
  }

  // Load the outlet list once a user session exists (skip on the public /login route).
  useEffect(() => {
    if (!user) {
      setLoading(false)
      return
    }
    let alive = true
    ;(async () => {
      try {
        const { data } = await get<OutletSummary[]>('/outlets')
        if (alive) setOutlets(data)
      } catch {
        // Non-fatal: the switcher just stays empty. lib/api.ts already handles
        // auth-level failures (401 redirect) — this is a soft-fail for a
        // presentational control.
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [user])

  // Validate the persisted selection against the allowed set once outlets +
  // tenancy claims are known. A stale/forbidden choice (outlet deleted,
  // access revoked, or simply never valid for this user) must never be
  // resent as-is — the backend now 403s a non-member X-Outlet-Id (D22), and
  // a stale header must never wedge every request. Falls back to the
  // default instead: ALL-scope keeps 'ALL' (or a still-live specific pick);
  // ASSIGNED auto-selects the first allowed outlet (this also covers "exactly
  // one assigned outlet" auto-select — the control then hides itself via
  // Topbar's `outlets.length > 1` check, now driven by this filtered list).
  useEffect(() => {
    if (loading) return
    if (!user) return

    const persisted = localStorage.getItem(OUTLET_STORAGE_KEY)

    if (isHqScope) {
      if (persisted === 'ALL' || outlets.some((o) => o.id === persisted)) return
      setSelectedOutletId('ALL')
      return
    }

    if (outletScope === 'ASSIGNED') {
      if (persisted && allowedOutlets.some((o) => o.id === persisted)) return
      if (allowedOutlets.length > 0) {
        setSelectedOutletId(allowedOutlets[0].id)
      } else if (persisted !== null) {
        // No allowed outlet at all (e.g. unprovisioned access) — nothing
        // safe to select; clear so we stop sending a doomed header.
        localStorage.removeItem(OUTLET_STORAGE_KEY)
        setSelectedOutletIdState('ALL')
      }
      return
    }

    // Legacy non-HQ fallback: no claim data to validate a specific pick
    // against — left as-is (matches pre-W1 behavior); the runtime 403
    // handler below is the safety net if it actually turns out forbidden.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, isHqScope, outletScope, outlets, allowedOutlets])

  // Backend 403'd an X-Outlet-Id header mid-session (D22 resolveOutletContext
  // membership check) — clear the stale selection and fall back to the
  // default WITHOUT logging the user out (see lib/api.ts's response
  // interceptor for the dispatch + why this isn't an auth failure).
  useEffect(() => {
    function handleForbidden() {
      localStorage.removeItem(OUTLET_STORAGE_KEY)
      setSelectedOutletIdState(defaultSelection())
    }
    window.addEventListener(OUTLET_FORBIDDEN_EVENT, handleForbidden)
    return () => window.removeEventListener(OUTLET_FORBIDDEN_EVENT, handleForbidden)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHqScope, allowedOutlets])

  const value = useMemo<OutletContextValue>(
    () => ({ outlets: allowedOutlets, loading, selectedOutletId, setSelectedOutletId, isHqScope }),
    [allowedOutlets, loading, selectedOutletId, isHqScope],
  )

  return <OutletContext.Provider value={value}>{children}</OutletContext.Provider>
}

export function useOutlet(): OutletContextValue {
  const ctx = useContext(OutletContext)
  if (!ctx) throw new Error('useOutlet must be used inside <OutletProvider>')
  return ctx
}
