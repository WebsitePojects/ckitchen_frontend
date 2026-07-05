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
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { get } from '../lib/api'
import { getSocket, initSocket, joinLocation, onSocketEvent, onSocketReconnect } from '../lib/socket'
import {
  ACTIVE_STATUSES,
  fetchOrderDetail,
  type KdsOrder,
  type RawOrderSummary,
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
  // Wrapped in useCallback (stable identity, no external deps — it fetches
  // brands/stations/orders fresh from the API every call) so it can also be
  // re-invoked on socket reconnect to catch up on any missed events
  // (Business Rule #9).
  const load = useCallback(async (cancelledRef?: { current: boolean }) => {
    setLoading(true)
    setError(null)
    try {
      const [brandsRes, stationsRes, ordersRes] = await Promise.all([
        get<Brand[]>('/brands'),
        get<Station[]>('/stations'),
        // Comma-separated single param — backend accepts this form.
        get<RawOrderSummary[]>('/orders?status=NEW,PREPARING,READY'),
      ])
      if (cancelledRef?.current) return

      setBrands(brandsRes.data)
      setStations(stationsRes.data)

      // Ensure socket connected and joined to the location room.
      if (!getSocket()) initSocket()
      if (brandsRes.data.length > 0) {
        joinLocation(brandsRes.data[0].locationId)
      }

      // Fetch full details for active orders.
      const summaries = ordersRes.data.filter(
        o => (ACTIVE_STATUSES as string[]).includes(o.status),
      )
      const details = await Promise.all(summaries.map(o => fetchOrderDetail(o.id)))
      if (cancelledRef?.current) return

      const active = details.filter((d): d is KdsOrder => d !== null)
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
  }, [])

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
