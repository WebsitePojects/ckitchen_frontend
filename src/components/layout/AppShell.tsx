import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Toaster } from '../ui/sonner'
import { getSocket, initSocket } from '../../lib/socket'
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

  useEffect(() => {
    if (!getSocket()) initSocket()
    // Socket persists for the lifetime of the authenticated session; torn
    // down explicitly on sign-out (see useSignOut), not on AppShell unmount.
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
          <main className="flex-1 overflow-y-auto">
            <Outlet />
          </main>
        </div>
      </div>
      <Toaster richColors theme="dark" position="top-right" />
    </PageHeaderProvider>
  )
}
