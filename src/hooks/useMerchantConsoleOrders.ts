/**
 * useMerchantConsoleOrders — live NEW/PREPARING/READY order queue for ONE
 * selected channel listing (brand + aggregator + outlet), for the Merchant
 * Console (src/pages/MerchantConsole.tsx). Modeled on
 * ../hooks/useKitchenOrders.ts (same realtime pattern — GET .../orders + a
 * one-time station/order load, order.created/order.updated socket events,
 * reconnect refetch) but scoped to a single listing instead of "every active
 * order at this outlet":
 *
 *   - Uses the existing GET /orders?brand_id=&aggregator=&status=&detail=1
 *     filters (ckitchen_backend orders/routes.ts) instead of a
 *     listing-specific endpoint — the backend doesn't expose orders scoped by
 *     channel_listing_id yet, and brand_id + aggregator + an explicit
 *     per-request `X-Outlet-Id` header (the listing's outlet — NOT the
 *     global OutletContext selection) narrows a shared (brand, aggregator)
 *     pair down to this one listing's outlet.
 *   - Joins the listing's OWN outlet room (lib/socket.ts joinLocation) so a
 *     console viewing one listing gets that outlet's live events regardless
 *     of what the global outlet switcher elsewhere is set to.
 *   - Filters incoming order.created/order.updated socket payloads to this
 *     listing's brand_id + aggregator before touching state (the socket
 *     room is outlet-wide, so other brands/aggregators at the same outlet
 *     would otherwise leak into this listing's queue).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { get } from '../lib/api'
import {
  getSocket,
  initSocket,
  joinLocation,
  onSocketEvent,
  onSocketReconnect,
} from '../lib/socket'
import {
  ACTIVE_STATUSES,
  fetchOrderDetail,
  toKdsOrder,
  type KdsOrder,
  type RawOrderDetail,
} from '../lib/kds'
import type { ChannelListing } from '../lib/merchant-console-api'

export interface UseMerchantConsoleOrdersOptions {
  /** Fired for a genuinely new order (not the initial load) — e.g. toast + sound cue. */
  onOrderCreated?: (order: KdsOrder) => void
}

export interface UseMerchantConsoleOrdersResult {
  orders: KdsOrder[]
  setOrders: React.Dispatch<React.SetStateAction<KdsOrder[]>>
  loading: boolean
  error: string | null
  /** Ticks once per second — re-render trigger for live mm:ss elapsed timers. */
  now: number
  refetch: () => void
}

export function useMerchantConsoleOrders(
  listing: ChannelListing | null | undefined,
  options: UseMerchantConsoleOrdersOptions = {},
): UseMerchantConsoleOrdersResult {
  const [orders, setOrders] = useState<KdsOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const onOrderCreatedRef = useRef(options.onOrderCreated)
  onOrderCreatedRef.current = options.onOrderCreated

  const brandId = listing?.brand.id
  const outletId = listing?.outlet.id
  const aggregator = listing?.aggregator

  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(handle)
  }, [])

  const load = useCallback(
    async (cancelledRef?: { current: boolean }) => {
      if (!brandId || !outletId || !aggregator) {
        setOrders([])
        setLoading(false)
        setError(null)
        return
      }
      setLoading(true)
      setError(null)
      try {
        const { data } = await get<RawOrderDetail[]>(
          `/orders?brand_id=${encodeURIComponent(brandId)}&aggregator=${encodeURIComponent(aggregator)}&status=NEW,PREPARING,READY&detail=1`,
          // Per-request outlet override — this listing's outlet, independent
          // of whatever the global OutletContext switcher currently has
          // selected (lib/api.ts's interceptor only fills the header when the
          // caller hasn't already set one).
          { headers: { 'X-Outlet-Id': outletId } },
        )
        if (cancelledRef?.current) return

        if (!getSocket()) initSocket()
        joinLocation(outletId)

        const active = (Array.isArray(data) ? data : [])
          .filter(o => (ACTIVE_STATUSES as string[]).includes(o.status))
          .map(toKdsOrder)
        active.sort((a, b) => {
          const stageOrder: Record<string, number> = { NEW: 0, PREPARING: 1, READY: 2, COMPLETED: 3 }
          const sd = (stageOrder[a.status] ?? 0) - (stageOrder[b.status] ?? 0)
          if (sd !== 0) return sd
          return new Date(a.placedAt).getTime() - new Date(b.placedAt).getTime()
        })
        setOrders(active)
      } catch (e) {
        if (!cancelledRef?.current) {
          setError(e instanceof Error ? e.message : 'Failed to load this listing’s orders.')
        }
      } finally {
        if (!cancelledRef?.current) setLoading(false)
      }
    },
    [brandId, outletId, aggregator],
  )

  useEffect(() => {
    const cancelledRef = { current: false }
    void load(cancelledRef)
    return () => {
      cancelledRef.current = true
    }
  }, [load])

  useEffect(() => onSocketReconnect(() => void load()), [load])

  // ── Socket subscriptions, filtered to this listing's brand + aggregator ──
  useEffect(() => {
    if (!brandId || !aggregator) return

    const matchesListing = (payloadBrandId?: string, payloadAggregator?: string) =>
      payloadBrandId === brandId && payloadAggregator === aggregator

    const unsubCreated = onSocketEvent('order.created', payload => {
      const orderId = payload.order_id
      if (!orderId) return
      if (!matchesListing(payload.brand_id, payload.aggregator)) return
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

    const unsubUpdated = onSocketEvent('order.updated', payload => {
      const orderId = payload.order_id
      if (!orderId) return
      const newStatus = payload.status

      // Updates for an order not currently in this listing's queue are only
      // relevant if they match this listing (a brand-new PREPARING order we
      // haven't seen yet, say) — order.updated payloads don't reliably carry
      // brand_id/aggregator on every deploy, so an unmatched-but-unknown
      // order is fetched and re-checked rather than assumed foreign.
      if (payload.brand_id !== undefined || payload.aggregator !== undefined) {
        if (!matchesListing(payload.brand_id, payload.aggregator)) return
      }

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
                  prepAt: newStatus === 'PREPARING' && !o.prepAt ? new Date().toISOString() : o.prepAt,
                }
              : o,
          )
        }
        void fetchOrderDetail(orderId).then(detail => {
          if (!detail) return
          if (detail.brandId !== brandId || detail.aggregator !== aggregator) return
          if (!(ACTIVE_STATUSES as string[]).includes(detail.status)) return
          setOrders(p => (p.some(o => o.id === detail.id) ? p : [detail, ...p]))
        })
        return prev
      })
    })

    return () => {
      unsubCreated()
      unsubUpdated()
    }
  }, [brandId, aggregator])

  const refetch = useCallback(() => {
    void load()
  }, [load])

  return useMemo(
    () => ({ orders, setOrders, loading, error, now, refetch }),
    [orders, loading, error, now, refetch],
  )
}
