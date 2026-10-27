import { useQuery } from '@tanstack/react-query'
import { get } from '../lib/api'
import { useOutlet } from '../context/OutletContext'

/**
 * Cached GET for read-only report/list sections.
 *
 * Replaces the per-section `useState` + `useEffect(get…)` pattern, which refetched and
 * blanked to a spinner on every visit. Now a revisit paints the cached result instantly
 * and refreshes in the background, and changing a filter (date range, page) keeps the
 * previous result on screen until the new one arrives instead of flashing empty.
 *
 * `loading` is true only when there is nothing to show yet. A failed background refresh
 * keeps the last good data; only a first load that fails reports `error`.
 *
 * The selected outlet is part of the cache key: the API scopes results by the X-Outlet-Id
 * header (lib/api.ts), so keying on the URL alone would show one outlet's data under another.
 */
export function useApiQuery<T>(url: string | null, options: { fallbackError: string; staleTimeMs?: number }) {
  const { selectedOutletId } = useOutlet()
  const query = useQuery({
    queryKey: ['api', selectedOutletId, url],
    queryFn: async () => (await get<T>(url!)).data,
    enabled: url !== null,
    // Keep the previous result while a new filter loads, but never across an outlet
    // switch: that would show one outlet's figures under another outlet's name.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === selectedOutletId ? previous : undefined,
    staleTime: options.staleTimeMs ?? 60_000,
  })
  const error = query.data === undefined && query.error
    ? query.error instanceof Error ? query.error.message : options.fallbackError
    : null
  return {
    data: query.data,
    loading: query.isPending && url !== null,
    error,
    refreshing: query.isFetching,
    /** Re-fetch after a mutation on this page (keeps the current data on screen meanwhile). */
    refetch: query.refetch,
  }
}
