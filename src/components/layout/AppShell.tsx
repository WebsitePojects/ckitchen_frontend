import { Suspense, useEffect, useRef, useState } from 'react'
import { WifiOff } from 'lucide-react'
import { Outlet } from 'react-router-dom'
import { toast } from 'sonner'
import { Toaster } from '../ui/sonner'
import { getSocket, initSocket, onSocketEvent, onSocketStatusChange } from '../../lib/socket'
import { ErrorDialogProvider } from '../../context/ErrorDialogContext'
import { NotificationProvider } from '../../context/NotificationContext'
import { PageHeaderProvider } from './PageHeaderContext'
import Sidebar from './Sidebar'
import MobileTabBar from './MobileTabBar'
import { OrionBackdrop } from '../brand/OrionArt'
import Topbar from './Topbar'
import PageFallback from './PageFallback'

/**
 * AppShell — Sidebar (fixed on desktop, Sheet on mobile) + Topbar + <Outlet/>.
 * Replaces the old emoji-based Shell. Owns the realtime socket lifecycle for
 * the authenticated session (same behavior the old Shell had); sign-out
 * (which tears the socket down) is triggered from Sidebar/Topbar via
 * useSignOut() so it's identical regardless of which UI surface is used.
 *
 * Also mounts the two global shell-level providers (client review 2026-07-08):
 *   - ErrorDialogProvider — CRUCIAL-error pop-up, fed by the axios interceptor
 *     in lib/api.ts (mutation network/5xx failures + session-expired 401s).
 *   - NotificationProvider — sidebar pulsing-dot "unseen live updates" state;
 *     owns its own onSocketEvent subscriptions. The stock.risk TOAST below is a
 *     separate concern and deliberately stays here (dedupe per order_id).
 */
export default function AppShell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  // Desktop rail preference is per device; storage may be blocked (private mode), so guard it.
  const [railCollapsed, setRailCollapsed] = useState(() => {
    try {
      return localStorage.getItem('orion-sidebar') === 'rail'
    } catch {
      return false
    }
  })
  const toggleRail = () =>
    setRailCollapsed((prev) => {
      try {
        localStorage.setItem('orion-sidebar', prev ? 'full' : 'rail')
      } catch {
        // Preference just won't persist.
      }
      return !prev
    })
  // Optimistic default — flips to 'disconnected' only once the socket
  // actually reports a drop (see onSocketStatusChange in lib/socket.ts).
  const [socketStatus, setSocketStatus] = useState<'connected' | 'disconnected'>('connected')

  useEffect(() => {
    if (!getSocket()) initSocket()
    // Socket persists for the lifetime of the authenticated session; torn
    // down explicitly on sign-out (see useSignOut), not on AppShell unmount.
  }, [])

  // Surface realtime connection health so a dead feed is visible instead of
  // silently going stale (Business Rule #9 — "real-time or it doesn't count").
  useEffect(() => {
    const unsubscribe = onSocketStatusChange(setSocketStatus)
    return unsubscribe
  }, [])

  // Global `stock.risk` toast (stock-reservation contract): fired to the outlet
  // room when an aggregator order was accepted despite insufficient available
  // stock. Subscribed here (always-mounted shell) so it surfaces on every page,
  // alongside the Toaster this shell owns. Deduped per order_id — the backend
  // can emit for the same order more than once (retry/replay) and we don't want
  // a toast storm.
  const seenRiskOrdersRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    return onSocketEvent('stock.risk', payload => {
      const orderId = payload.order_id
      if (orderId) {
        if (seenRiskOrdersRef.current.has(orderId)) return
        seenRiskOrdersRef.current.add(orderId)
      }
      const names = (payload.shortfalls ?? []).map(s => s.ingredient_name).filter(Boolean)
      const nameList =
        names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3} more` : names.join(', ')
      toast.error(`Stock risk: order ${payload.external_ref ?? orderId}`, {
        description: nameList
          ? `Accepted despite insufficient stock: ${nameList}`
          : 'Accepted despite insufficient available stock.',
        duration: 10_000,
      })
    })
  }, [])

  return (
    <PageHeaderProvider>
      <ErrorDialogProvider>
        <NotificationProvider>
          <OrionBackdrop />
          <div className="relative flex h-dvh overflow-hidden text-foreground">
            {/* Desktop sidebar: full (256px) or icon rail (72px) */}
            <div
              className={`hidden shrink-0 border-r border-sidebar-border transition-[width] duration-300 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] lg:block ${railCollapsed ? 'w-[72px]' : 'w-64'}`}
            >
              <Sidebar collapsed={railCollapsed} onToggleCollapsed={toggleRail} />
            </div>

            {/* Main column */}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <Topbar mobileNavOpen={mobileNavOpen} onMobileNavChange={setMobileNavOpen} />
              {socketStatus === 'disconnected' && (
                <div role="status" className="flex shrink-0 items-center justify-center gap-1.5 border-b border-border bg-card px-3 py-1.5 text-xs font-medium text-warn-text">
                  <WifiOff className="h-3.5 w-3.5" aria-hidden />
                  Reconnecting… realtime updates paused
                </div>
              )}
              <main className="flex-1 overflow-y-auto">
                {/* Page chunks load lazily; the shell stays put while a page arrives. */}
                <Suspense fallback={<PageFallback />}>
                  <Outlet />
                </Suspense>
              </main>
              <MobileTabBar />
            </div>
          </div>
          {/* No `theme` prop — Toaster (ui/sonner.tsx) reads the live theme via
              next-themes' useTheme() now that <ThemeProvider> wraps the app
              (App.tsx), so toasts follow the user's dark/light/system choice
              instead of being locked to dark. */}
          <Toaster richColors position="top-right" />
        </NotificationProvider>
      </ErrorDialogProvider>
    </PageHeaderProvider>
  )
}
