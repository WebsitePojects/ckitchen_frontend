import { lazy, type ComponentType } from 'react'

/**
 * One loader per routed page. Pages used to be imported eagerly, so the first visit
 * downloaded and parsed every page (one 1.58 MB bundle, charts included) before showing
 * anything. Each page is now its own chunk; `prefetchPage` warms a chunk on sidebar
 * hover/focus and `prefetchPages` warms the rest when the browser is idle, so clicking a
 * page never waits on a download.
 *
 * Keys are route paths (same keys as auth/access.ts PAGE_ROLES) so the router, sidebar
 * and access rules share one vocabulary.
 */
type Loader = () => Promise<{ default: ComponentType }>

export const PAGE_LOADERS: Record<string, Loader> = {
  '/': () => import('../pages/Dashboard'),
  '/pos': () => import('../pages/Pos'),
  '/orders': () => import('../pages/Orders'),
  '/kitchen': () => import('../pages/Kitchen'),
  '/tv': () => import('../pages/Tv'),
  '/merchant-console': () => import('../pages/MerchantConsole'),
  '/printers': () => import('../pages/Printers'),
  '/brands': () => import('../pages/Brands'),
  '/menu': () => import('../pages/Menu'),
  '/channel-listings': () => import('../pages/ChannelListings'),
  '/merchant-management': () => import('../pages/MerchantManagement'),
  '/inventory': () => import('../pages/Inventory'),
  '/stock-ledger': () => import('../pages/StockLedger'),
  '/purchasing': () => import('../pages/Purchasing'),
  '/master-data': () => import('../pages/MasterData'),
  '/employees': () => import('../pages/Employees'),
  '/employee-profile': () => import('../pages/EmployeeProfile'),
  '/attendance': () => import('../pages/Attendance'),
  '/kiosk/attendance': () => import('../pages/AttendanceKiosk'),
  '/users': () => import('../pages/Users'),
  '/audit': () => import('../pages/AuditTrail'),
  '/reports': () => import('../pages/Analytics'),
  '/outlets': () => import('../pages/Outlets'),
  '/outlet-profile': () => import('../pages/OutletProfile'),
  '/settings': () => import('../pages/Settings'),
  '/join': () => import('../pages/Join'),
  '/signup': () => import('../pages/Signup'),
}

const lazyCache = new Map<string, ComponentType>()

/** React.lazy component for a page, created once per key. */
export function lazyPage(key: string): ComponentType {
  const loader = PAGE_LOADERS[key]
  if (!loader) throw new Error(`No page loader registered for "${key}"`)
  let component = lazyCache.get(key)
  if (!component) {
    component = lazy(loader)
    lazyCache.set(key, component)
  }
  return component
}

const warmed = new Set<string>()

/** Starts downloading a page's chunk (no-op if already started or unknown). */
export function prefetchPage(key: string): void {
  const loader = PAGE_LOADERS[key]
  if (!loader || warmed.has(key)) return
  warmed.add(key)
  // A failed prefetch only means the chunk loads on click instead; allow a later retry.
  loader().catch(() => warmed.delete(key))
}

/** Prefetches several pages one at a time during browser idle time. */
export function prefetchPages(keys: string[]): () => void {
  let cancelled = false
  const queue = keys.filter((k) => PAGE_LOADERS[k] && !warmed.has(k))
  const idle: (cb: () => void) => void =
    typeof window.requestIdleCallback === 'function'
      ? (cb) => window.requestIdleCallback(cb, { timeout: 2000 })
      : (cb) => window.setTimeout(cb, 300)
  const next = () => {
    if (cancelled) return
    const key = queue.shift()
    if (!key) return
    prefetchPage(key)
    idle(next)
  }
  idle(next)
  return () => { cancelled = true }
}
