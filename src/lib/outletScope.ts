import type { SelectedOutlet } from '../context/OutletContext'

/**
 * Outlet-scoping leak fix (2026-07-22 audit): several pages fetched brand/
 * station master data with NO outlet filter at all — the query re-ran on an
 * outlet switch (queryKey/effect deps included selectedOutletId), but always
 * requested the same platform-wide list, so a switch to e.g. Cubao/Araneta
 * still showed CloudKitchen ONE's brands or stations in pickers/filters.
 *
 * GET /brands and GET /stations now accept an optional `?location_id=<uuid>`
 * (backend, parallel wave) that scopes the result to that outlet. `'ALL'`
 * (HQ scope) omits the param and gets the full platform list, same as before.
 *
 * Use this for any GET whose backend route accepts `location_id` — do NOT
 * use it for endpoints that are intentionally platform-wide by design (e.g.
 * OutletProfile's "all brands" picker for deploying a brand to an outlet, or
 * pages the audit found already-scoped some other way).
 */
export function outletScopedPath(basePath: string, selectedOutletId: SelectedOutlet): string {
  if (selectedOutletId === 'ALL') return basePath
  const sep = basePath.includes('?') ? '&' : '?'
  return `${basePath}${sep}location_id=${encodeURIComponent(selectedOutletId)}`
}
