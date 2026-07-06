/**
 * useKitchenOrders — shared data-loading + realtime hook for "active kitchen
 * orders" (NEW / PREPARING / READY).
 *
 * Originally lived inline in Kitchen.tsx; extracted so the TV board
 * (src/pages/Tv.tsx, ORION W3 — platform-ia-navigation.md §6) can show the
 * same live order set without a second copy of the fetch/socket wiring
 * (Business Rule #9: real-time or it doesn't count).
 *
 * Consumers that need to mutate the order list directly (e.g. Kitchen's
 * advance/cancel handlers, which optimistically update after a REST call)
 * should use the returned `setOrders`. This hook intentionally does NOT
 * expose advance/cancel actions — those are Kitchen-page-specific; the TV
 * board is read-only.
 *
 * M2 fix (2026-07-05): this hook used to join `brands[0].locationId`'s socket
 * room unconditionally — for an outlet-2 KDS/TV viewer that room was simply
 * wrong (whichever brand happened to sort first), so outlet-2 crew got no
 * live order/stock/print events for their own outlet. Room selection now
 * follows OutletContext's `selectedOutletId`: a specific outlet joins exactly
 * that outlet's room; 'ALL' (HQ-scope viewers per D31) joins every outlet's
 * room via `joinLocations` (lib/socket.ts) so nothing is missed. Switching
 * outlets re-runs `load()` (selectedOutletId/outlets are in its deps), which
 * both re-joins the correct room(s) and refetches — the GET /orders call
 * already gets `X-Outlet-Id` from the axios interceptor (lib/api.ts, reads
 * localStorage) when a specific outlet is selected, so the refetched order
 * list is correctly outlet-scoped too.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { get } from '../lib/api'
import {
  getSocket,
  initSocket,
  joinLocation,
  joinLocations,
  onSocketEvent,
  onSocketReconnect,
} from '../lib/socket'
import { useOutlet } from '../context/OutletContext'
import {
  ACTIVE_STATUSES,
  fetchOrderDetail,
  toKdsOrder,
  type KdsOrder,
  type RawOrderDetail,
} from '../lib/kds'
import type { Brand, Station } from '../pages/Dashboard'

export interface UseKitchenOrdersOptions {
  /**
   * Called (in addition to the internal state update) whenever a brand-new
   * order arrives via `order.created` — e.g. so Kitchen.tsx can show a toast.
   * Not called for orders discovered during the initial load.
   */
  onOrderCreated?: (order: KdsOrder) => void
}

export interface UseKitchenOrdersResult {
  orders: KdsOrder[]
  setOrders: React.Dispatch<React.SetStateAction<KdsOrder[]>>
  brands: Brand[]
  stations: Station[]
  brandMap: Map<string, Brand>
  loading: boolean
  error: string | null
  /** Ticks once per second — re-render trigger for live mm:ss timers / clocks. */
  now: number
}

export function useKitchenOrders(options: UseKitchenOrdersOptions = {}): UseKitchenOrdersResult {
  const { outlets, selectedOutletId } = useOutlet()
  const [orders, setOrders] = useState<KdsOrder[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [stations, setStations] = useState<Station[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  // Kept as a ref so the socket subscription effect below never needs to
  // re-subscribe just because the caller passed a fresh callback identity.
  const onOrderCreatedRef = useRef(options.onOrderCreated)
  onOrderCreatedRef.current = options.onOrderCreated

  const brandMap = useMemo(() => new Map(brands.map(b => [b.id, b])), [brands])

  // ── Tick every second for mm:ss timers / live clocks (single shared interval) ──
  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(handle)
  }, [])

  // ── Initial data load ──────────────────────────────────────────────────────
  // Wrapped in useCallback so it can also be re-invoked on socket reconnect to
  // catch up on any missed events (Business Rule #9). Depends on
  // selectedOutletId/outlets (M2 fix) so switching the outlet switcher both
  // re-joins the correct socket room(s) AND refetches (the refetch picks up
  // the new X-Outlet-Id header lib/api.ts's interceptor now sends).
  const load = useCallback(async (cancelledRef?: { current: boolean }) => {
    setLoading(true)
    setError(null)
    try {
      // Perf fix (N+1 KDS fetch): this used to be a summary call
      // (`/orders?status=...`) followed by `Promise.all(summaries.map(o =>
      // fetchOrderDetail(o.id)))` — one extra round-trip PER ORDER on the
      // board. The backend's `?detail=1` bulk-hydrates items[]/print_jobs[]
      // for every matching order in the SAME response (O(1) extra queries
      // server-side, not one per order — see listOrdersWithDetail in
      // ckitchen_backend's orders/service.ts), so this is now a single call
      // for brands/stations/orders instead of 2 + N.
      const [brandsRes, stationsRes, ordersRes] = await Promise.all([
        get<Brand[]>('/brands'),
        get<Station[]>('/stations'),
        // Comma-separated single param — backend accepts this form.
        get<RawOrderDetail[]>('/orders?status=NEW,PREPARING,READY&detail=1'),
      ])
      if (cancelledRef?.current) return

      setBrands(brandsRes.data)
      setStations(stationsRes.data)

      // Ensure socket connected and joined to the room(s) for the SELECTED
      // outlet (M2 fix) — NOT brands[0].locationId, which was wrong for any
      // outlet other than whichever brand happened to sort first. A specific
      // outlet selection joins exactly that outlet's room; 'ALL' (HQ-scope
      // viewers, D31) joins every outlet's room so no outlet's live events
      // are missed (Business Rule #9).
      if (!getSocket()) initSocket()
      if (selectedOutletId === 'ALL') {
        if (outlets.length > 0) joinLocations(outlets.map(o => o.id))
      } else {
        joinLocation(selectedOutletId)
      }

      // Backend already filtered to status=NEW,PREPARING,READY, but keep the
      // client-side ACTIVE_STATUSES filter as a defensive belt-and-suspenders
      // (matches the previous behavior exactly).
      const active = ordersRes.data
        .filter(o => (ACTIVE_STATUSES as string[]).includes(o.status))
        .map(toKdsOrder)
      // Sort: NEW first, then PREPARING, then READY; within stage oldest first (longest wait).
      active.sort((a, b) => {
        const stageOrder: Record<string, number> = { NEW: 0, PREPARING: 1, READY: 2, COMPLETED: 3 }
        const sd = (stageOrder[a.status] ?? 0) - (stageOrder[b.status] ?? 0)
        if (sd !== 0) return sd
        return new Date(a.placedAt).getTime() - new Date(b.placedAt).getTime()
      })
      setOrders(active)
    } catch (e) {
      if (!cancelledRef?.current) {
        setError(e instanceof Error ? e.message : 'Failed to load kitchen orders.')
      }
    } finally {
      if (!cancelledRef?.current) setLoading(false)
    }
  }, [selectedOutletId, outlets])

  useEffect(() => {
    const cancelledRef = { current: false }
    void load(cancelledRef)
    return () => { cancelledRef.current = true }
  }, [load])

  // ── Reconnect recovery ─────────────────────────────────────────────────────
  // A dropped-then-restored socket may have missed order.created/updated
  // events entirely — refetch to catch up (Business Rule #9).
  useEffect(() => {
    return onSocketReconnect(() => { void load() })
  }, [load])

  // ── Socket subscriptions ───────────────────────────────────────────────────
  useEffect(() => {
    // order.created → fetch detail and add to active list
    const unsubCreated = onSocketEvent('order.created', payload => {
      const orderId = payload.order_id
      if (!orderId) return
      void fetchOrderDetail(orderId).then(detail => {
        if (!detail) return
        if (!(ACTIVE_STATUSES as string[]).includes(detail.status)) return
        setOrders(prev => {
          if (prev.some(o => o.id === detail.id)) return prev
          return [detail, ...prev]
        })
        onOrderCreatedRef.current?.(detail)
      })
    })

    // order.updated → update status in place; remove if COMPLETED/CANCELLED
    const unsubUpdated = onSocketEvent('order.updated', payload => {
      const orderId = payload.order_id
      if (!orderId) return
      const newStatus = payload.status

      if (!(ACTIVE_STATUSES as string[]).includes(newStatus)) {
        setOrders(prev => prev.filter(o => o.id !== orderId))
        return
      }

      setOrders(prev => {
        const existing = prev.find(o => o.id === orderId)
        if (existing) {
          return prev.map(o =>
            o.id === orderId
              ? {
                  ...o,
                  status: newStatus,
                  prepAt: newStatus === 'PREPARING' && !o.prepAt
                    ? new Date().toISOString()
                    : o.prepAt,
                }
              : o,
          )
        }
        // Not in list yet — fetch and add
        void fetchOrderDetail(orderId).then(detail => {
          if (!detail) return
          if (!(ACTIVE_STATUSES as string[]).includes(detail.status)) return
          setOrders(p => p.some(o => o.id === detail.id) ? p : [detail, ...p])
        })
        return prev
      })
    })

    return () => {
      unsubCreated()
      unsubUpdated()
    }
  }, [])

  return { orders, setOrders, brands, stations, brandMap, loading, error, now }
}
