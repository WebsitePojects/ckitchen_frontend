/**
 * NotificationContext — sidebar "unseen live updates" notifiers (client review
 * 2026-07-08): when a page you are NOT currently viewing receives realtime
 * updates, its sidebar item shows a small pulsing red dot; visiting the page
 * clears it; events for the page you're already on never count.
 *
 * Mounted once in AppShell (always-on shell level, like the stock.risk toast
 * subscription — that toast concern stays in AppShell; this context only
 * tracks unseen-ness). Subscribes globally via `onSocketEvent`, which keeps
 * handlers registered across socket re-creation, so one subscription at shell
 * level is enough.
 *
 * Event → sidebar route mapping (event names verified against lib/socket.ts):
 *   order.created / order.updated       → /orders (Live Orders), /kitchen (KDS)
 *   stock.updated / lowstock.alert /
 *   stock.risk                          → /inventory
 *   print.status / printer.status       → /printers (Printers & Print Monitor)
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useLocation } from 'react-router-dom'
import { onSocketEvent } from '../lib/socket'

interface NotificationContextValue {
  /** Unseen live-update counts keyed by sidebar route (e.g. '/orders'). */
  unseen: Record<string, number>
}

// Default lets Sidebar render safely even if a caller ever mounts it outside
// the provider (e.g. an isolated preview) — no dots, no crash.
const NotificationContext = createContext<NotificationContextValue>({ unseen: {} })

// eslint-disable-next-line react-refresh/only-export-components
export function useNotifications(): NotificationContextValue {
  return useContext(NotificationContext)
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const [unseen, setUnseen] = useState<Record<string, number>>({})

  // Current pathname, readable from inside the long-lived socket handlers
  // without resubscribing on every navigation.
  const pathRef = useRef(location.pathname)
  pathRef.current = location.pathname

  // Visiting a page clears its unseen count.
  useEffect(() => {
    setUnseen((prev) => {
      if (!prev[location.pathname]) return prev
      const next = { ...prev }
      delete next[location.pathname]
      return next
    })
  }, [location.pathname])

  useEffect(() => {
    /** Increment the given routes' unseen counts — except the route currently
     *  being viewed (no dot for events on the page you're already on). */
    const bump = (routes: string[]) => () => {
      setUnseen((prev) => {
        let next: Record<string, number> | null = null
        for (const route of routes) {
          if (pathRef.current === route) continue
          if (!next) next = { ...prev }
          next[route] = (next[route] ?? 0) + 1
        }
        return next ?? prev
      })
    }

    const unsubs = [
      onSocketEvent('order.created', bump(['/orders', '/kitchen'])),
      onSocketEvent('order.updated', bump(['/orders', '/kitchen'])),
      onSocketEvent('stock.updated', bump(['/inventory'])),
      onSocketEvent('lowstock.alert', bump(['/inventory'])),
      onSocketEvent('stock.risk', bump(['/inventory'])),
      onSocketEvent('print.status', bump(['/printers'])),
      onSocketEvent('printer.status', bump(['/printers'])),
    ]
    return () => {
      for (const unsub of unsubs) unsub()
    }
  }, [])

  const value = useMemo(() => ({ unseen }), [unseen])

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  )
}
