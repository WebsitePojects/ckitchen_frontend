import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { get, post } from '../lib/api'
import type { CKApiError } from '../lib/api'
import { useAuth } from '../auth/AuthContext'

/**
 * Order-simulator context — persists Start/Stop state across page navigation.
 *
 * SimulatorPanel (components/SimulatorPanel.tsx) used to keep `running` in
 * local component state. The panel lives on the Dashboard, so navigating to
 * another page and back unmounted/remounted it — even though the BACKEND
 * simulator kept running, the panel reset to "Start" on return, which is
 * wrong and confusing (the user has no way to tell it's still generating
 * orders). Lifting the state up here (mounted once at the app root,
 * alongside OutletProvider — see App.tsx) means the panel just reflects
 * whatever this context holds, regardless of mount/unmount.
 *
 * Hydration: on mount (only once a user session exists — mirrors
 * OutletContext's gate, which also skips the public /login route), fetch
 * GET /simulator/status so a page reload or a fresh navigation to the
 * Dashboard shows the TRUE backend state, not just "not running" by default.
 * That endpoint is new (added alongside this change by a backend teammate)
 * — coded defensively: a 404 or any other failure is treated as
 * `running=false` and never surfaces an error, so the panel still works
 * standalone even before/without that endpoint deployed.
 */

interface SimulatorStatusResponse {
  running: boolean
  brand_ids: string[]
  rate_per_min: number | null
}

interface SimulatorContextValue {
  running: boolean
  brandIds: string[]
  rate: number
  loading: boolean
  error: string | null
  start: (brandIds: string[], rate: number) => Promise<void>
  stop: () => Promise<void>
}

/** Matches SimulatorPanel's previous local default. */
const DEFAULT_RATE = 20

const SimulatorContext = createContext<SimulatorContextValue | null>(null)

export function SimulatorProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [running, setRunning] = useState(false)
  const [brandIds, setBrandIds] = useState<string[]>([])
  const [rate, setRate] = useState<number>(DEFAULT_RATE)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Hydrate from the backend once a user session exists (skip on the public
  // /login route, same as OutletContext.tsx). Defensive: GET /simulator/status
  // is a new endpoint landing alongside this change — a 404 (not deployed
  // yet) or any other failure must never surface as an error here, it just
  // means "assume not running" so the panel stays usable.
  useEffect(() => {
    if (!user) return
    let alive = true
    ;(async () => {
      try {
        const { data } = await get<SimulatorStatusResponse>('/simulator/status')
        if (!alive) return
        setRunning(!!data.running)
        if (Array.isArray(data.brand_ids)) setBrandIds(data.brand_ids)
        if (typeof data.rate_per_min === 'number') setRate(data.rate_per_min)
      } catch {
        // Non-fatal: endpoint may 404 (not deployed yet) or fail for any
        // other reason — soft-fail to "not running", never a surfaced error.
        if (alive) setRunning(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [user])

  const start = useCallback(async (ids: string[], rt: number) => {
    setLoading(true)
    setError(null)
    try {
      await post('/simulator/start', { brand_ids: ids, rate_per_min: rt })
      setRunning(true)
      setBrandIds(ids)
      setRate(rt)
    } catch (e) {
      const ce = e as CKApiError
      setError(ce?.message ?? 'Failed to start simulator.')
    } finally {
      setLoading(false)
    }
  }, [])

  const stop = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await post('/simulator/stop')
      setRunning(false)
    } catch (e) {
      const ce = e as CKApiError
      setError(ce?.message ?? 'Failed to stop simulator.')
    } finally {
      setLoading(false)
    }
  }, [])

  const value = useMemo<SimulatorContextValue>(
    () => ({ running, brandIds, rate, loading, error, start, stop }),
    [running, brandIds, rate, loading, error, start, stop],
  )

  return <SimulatorContext.Provider value={value}>{children}</SimulatorContext.Provider>
}

export function useSimulator(): SimulatorContextValue {
  const ctx = useContext(SimulatorContext)
  if (!ctx) throw new Error('useSimulator must be used inside <SimulatorProvider>')
  return ctx
}
