import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'
import { Outlet } from 'react-router-dom'
import { Toaster } from '../ui/sonner'
import { getSocket, initSocket, onSocketStatusChange } from '../../lib/socket'
import { PageHeaderProvider } from './PageHeaderContext'
import Sidebar from './Sidebar'
import Topbar from './Topbar'

/**
 * AppShell — Sidebar (fixed on desktop, Sheet on mobile) + Topbar + <Outlet/>.
 * Replaces the old emoji-based Shell. Owns the realtime socket lifecycle for
 * the authenticated session (same behavior the old Shell had); sign-out
 * (which tears the socket down) is triggered from Sidebar/Topbar via
 * useSignOut() so it's identical regardless of which UI surface is used.
 */
export default function AppShell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
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

  return (
    <PageHeaderProvider>
      <div className="flex h-screen overflow-hidden bg-background text-foreground">
        {/* Desktop fixed sidebar */}
        <div className="hidden w-64 shrink-0 border-r border-sidebar-border lg:block">
          <Sidebar />
        </div>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Topbar mobileNavOpen={mobileNavOpen} onMobileNavChange={setMobileNavOpen} />
          {socketStatus === 'disconnected' && (
            <div className="flex shrink-0 items-center justify-center gap-1.5 border-b border-amber-500/30 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-400 ring-1 ring-inset ring-amber-500/30">
              <WifiOff className="h-3.5 w-3.5" aria-hidden />
              Reconnecting… realtime updates paused
            </div>
          )}
          <main className="flex-1 overflow-y-auto">
            <Outlet />
          </main>
        </div>
      </div>
      <Toaster richColors theme="dark" position="top-right" />
    </PageHeaderProvider>
  )
}
