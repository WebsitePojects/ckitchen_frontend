/**
 * useRecentCancelledOrders — minimal "recently cancelled" list for one
 * channel listing, enough to surface the Contest-cancellation workflow
 * (SITE_VISIT_VIDEO_ANALYSIS.md §5 audio evidence + §6 gap row N2: refunds
 * are NOT automatic — "Hindi po automatic i-refund... kailangan i-contest mo
 * po lagi" — the merchant must actively contest a cancel-after-accept order,
 * a client-confirmed fraud pattern) without building the full History tab
 * (§6 row J — explicitly out of scope for this pass; §1a shows Grab/foodpanda
 * both have a dedicated History tab that ORION does not attempt to clone
 * here).
 *
 * Fetches CANCELLED orders the same way useMerchantConsoleOrders fetches
 * NEW/PREPARING/READY — scoped by this listing's brand_id + aggregator +
 * outlet header — and keeps only the most recent RECENT_LIMIT, newest first.
 * No realtime subscription: cancellations are comparatively rare next to
 * order volume, and this list is refetched on tab open / after a successful
 * contest submission, which is enough for an operator glancing at "did
 * anything just get cancelled."
 */
import { useCallback, useEffect, useState } from 'react'
import { get } from '../lib/api'
import { toKdsOrder, type KdsOrder, type RawOrderDetail } from '../lib/kds'
import type { ChannelListing } from '../lib/merchant-console-api'

const RECENT_LIMIT = 10

export interface UseRecentCancelledOrdersResult {
  orders: KdsOrder[]
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useRecentCancelledOrders(
  listing: ChannelListing | null | undefined,
): UseRecentCancelledOrdersResult {
  const [orders, setOrders] = useState<KdsOrder[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const brandId = listing?.brand.id
  const outletId = listing?.outlet.id
  const aggregator = listing?.aggregator

  const load = useCallback(async () => {
    if (!brandId || !outletId || !aggregator) {
      setOrders([])
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const { data } = await get<RawOrderDetail[]>(
        `/orders?brand_id=${encodeURIComponent(brandId)}&aggregator=${encodeURIComponent(aggregator)}&status=CANCELLED&detail=1`,
        { headers: { 'X-Outlet-Id': outletId } },
      )
      const list = (Array.isArray(data) ? data : [])
        .map(toKdsOrder)
        .sort((a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime())
        .slice(0, RECENT_LIMIT)
      setOrders(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load recently cancelled orders.')
    } finally {
      setLoading(false)
    }
  }, [brandId, outletId, aggregator])

  useEffect(() => {
    void load()
  }, [load])

  return { orders, loading, error, refetch: load }
}
