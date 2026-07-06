/**
 * Shared TanStack Query client — cache-first data layer (perf: "preload,
 * cache first, update only new data").
 *
 * Defaults here apply to every `useQuery` in the app unless a call site
 * overrides them:
 *   - staleTime: 30s   — data is considered fresh for 30s after a fetch, so
 *     navigating back to a page (e.g. Inventory -> Menu -> Inventory) shows
 *     the cached result INSTANTLY with no network request, only refetching
 *     once it's actually gone stale.
 *   - gcTime: 5 min     — how long an unused (unmounted) query stays cached
 *     before being garbage-collected, so a brief visit to another page
 *     doesn't evict the cache.
 *   - refetchOnWindowFocus: false — this is a kitchen/back-office app left
 *     open on tablets/monitors all day; refetching every alt-tab would just
 *     add noise. Realtime pages (Kitchen/TV/Dashboard feed) get their
 *     freshness from Socket.IO, not from window-focus polling.
 *   - retry: 1 — one retry on failure, not the default 3 (fail fast, let the
 *     page's own error state / retry action take over).
 *
 * NOT used for the realtime pages (Kitchen, TV, Dashboard's live order feed)
 * — those stay on the existing socket-driven useState/useKitchenOrders path.
 * This client is for the read-heavy, non-realtime pages (Inventory, Brands,
 * Menu, Master Data, Dashboard's brands/stations summary data).
 */
import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})
