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
 * request when a specific outlet is selected. The backend doesn't scope by
 * it yet (D22 membership middleware is a separate backend-wave item) so the
 * header is inert today — shipping the frontend switcher first is safe.
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

/** HQ-scope roles per D31: OWNER, HR, ACCOUNTING, WAREHOUSE_MAIN (+ legacy SUPER_ADMIN via alias). */
const HQ_SCOPE_ROLES = new Set(['OWNER', 'HR', 'ACCOUNTING', 'WAREHOUSE_MAIN'])

export function OutletProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [outlets, setOutlets] = useState<OutletSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedOutletId, setSelectedOutletIdState] = useState<SelectedOutlet>(
    () => (localStorage.getItem(OUTLET_STORAGE_KEY) as SelectedOutlet | null) ?? 'ALL',
  )

  const isHqScope = user != null && HQ_SCOPE_ROLES.has(normalizeRole(user.role))

  function setSelectedOutletId(id: SelectedOutlet) {
    setSelectedOutletIdState(id)
    localStorage.setItem(OUTLET_STORAGE_KEY, id)
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

  // Resolve a sane default exactly once outlets are known, unless the user
  // already made an explicit choice (persisted). Non-HQ roles auto-select
  // when there is exactly one outlet to be in — the only case "their
  // assigned outlet" is determinable without backend user_outlet_access data
  // (a separate backend-wave item); otherwise they fall back to ALL like
  // everyone else, per platform-ia-navigation.md §5.
  useEffect(() => {
    if (loading) return
    if (localStorage.getItem(OUTLET_STORAGE_KEY)) return
    if (!isHqScope && outlets.length === 1) {
      setSelectedOutletId(outlets[0].id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, isHqScope, outlets])

  const value = useMemo<OutletContextValue>(
    () => ({ outlets, loading, selectedOutletId, setSelectedOutletId, isHqScope }),
    [outlets, loading, selectedOutletId, isHqScope],
  )

  return <OutletContext.Provider value={value}>{children}</OutletContext.Provider>
}

export function useOutlet(): OutletContextValue {
  const ctx = useContext(OutletContext)
  if (!ctx) throw new Error('useOutlet must be used inside <OutletProvider>')
  return ctx
}
