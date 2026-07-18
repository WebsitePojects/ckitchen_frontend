/**
 * useListingAttention — "which of my N listings needs action right now" for
 * the Merchant Console rail (SITE_VISIT_VIDEO_ANALYSIS.md §7: "an
 * all-listings alert surface so a new order on any of 50 listings is noticed
 * without hunting (today the chime fires only for the *selected* listing's
 * hook)"). MerchantConsole.tsx uses the returned counts to float listings
 * with a pending NEW order to the top of the rail with a badge.
 *
 * There is no bulk "counts across all listings" endpoint in the MC-1
 * contract (Documents/AGGREGATOR_API_INTEGRATION_SPEC.md), so this polls
 * `GET /orders` in *summary* mode (no `detail=1` — small payload, just
 * id/status/placedAt per lib/kds.ts's RawOrderSummary) once per listing on
 * an interval, scoped exactly like useMerchantConsoleOrders' single-listing
 * query (brand_id + aggregator + this listing's outlet header). At the
 * analysis doc's target scale (50 listings, §7) this is ~50 small indexed
 * reads every POLL_INTERVAL_MS — acceptable for this pass per §7's own
 * verdict ("No architectural blocker at 50 listings"); a future bulk summary
 * endpoint would be the real fix if this ever needs to go beyond ~50-150.
 *
 * Failures for one listing are swallowed silently (no toast spam for up to
 * 50 listings failing independently) — a listing that fails to report simply
 * keeps its last-known count (or 0) this tick and is retried next tick.
 * MerchantConsole.tsx overrides the selected listing's entry with its live
 * socket-driven count so the listing being actively watched is never stale.
 */
import { useEffect, useRef, useState } from 'react'
import { get } from '../lib/api'
import type { ChannelListing } from '../lib/merchant-console-api'

const POLL_INTERVAL_MS = 25_000

interface OrderSummaryRow {
  id: string
}

export function useListingAttention(listings: ChannelListing[]): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({})
  const listingsRef = useRef(listings)
  listingsRef.current = listings

  useEffect(() => {
    if (listings.length === 0) {
      setCounts({})
      return
    }

    let cancelled = false

    const pollOnce = async () => {
      const current = listingsRef.current
      const results = await Promise.allSettled(
        current.map(async l => {
          const { data } = await get<OrderSummaryRow[]>(
            `/orders?brand_id=${encodeURIComponent(l.brand.id)}&aggregator=${encodeURIComponent(l.aggregator)}&status=NEW`,
            { headers: { 'X-Outlet-Id': l.outlet.id } },
          )
          return [l.id, Array.isArray(data) ? data.length : 0] as const
        }),
      )
      if (cancelled) return
      setCounts(prev => {
        const next = { ...prev }
        for (const r of results) {
          if (r.status === 'fulfilled') {
            const [id, count] = r.value
            next[id] = count
          }
        }
        return next
      })
    }

    void pollOnce()
    const intervalId = setInterval(() => void pollOnce(), POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(intervalId)
    }
    // Re-poll the set of listings when membership changes (length is a cheap
    // proxy — individual listings don't change id/brand/outlet in place).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listings.length])

  return counts
}
