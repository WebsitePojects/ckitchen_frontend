import { io, type Socket } from 'socket.io-client'

// Same origin resolution as api.ts: absolute backend URL in production (Vercel → Render),
// empty (same-origin, Vite-proxied) in dev. Set VITE_API_URL / VITE_API_PROXY_TARGET at build.
const _env = import.meta.env as unknown as Record<string, string | undefined>
const SOCKET_ORIGIN = String(_env.VITE_API_URL || _env.VITE_API_PROXY_TARGET || '').replace(/\/+$/, '')

// ─── Event payload types ──────────────────────────────────────────────────────
//
// NOTE: verified directly against the live backend source
// (ckitchen_backend/src/modules/orders/routes.ts, inventory/routes.ts,
// printing/routes.ts). The backend's Socket.IO emit payloads are NOT
// consistently camelCase like the REST GET responses — casing is mixed
// per-event (and sometimes per-field within the same event). Do not
// "normalize" these to camelCase without re-checking the backend emit call.

/** `order.created` / `order.updated` — emitted with snake_case fields, unlike REST. */
export interface OrderPayload {
  order_id: string
  status: 'NEW' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED'
  brand_id?: string
  aggregator?: string
  external_ref?: string
  customer_name?: string | null
  print_jobs?: unknown[]
  prepAt?: string | null
  readyAt?: string | null
  completedAt?: string | null
  [key: string]: unknown
}

/** `stock.updated` — camelCase fields, but `warehouseType` (not `warehouse`), no `unit`. */
export interface StockPayload {
  ingredientId: string
  ingredientName: string
  warehouseType: 'MAIN' | 'KITCHEN'
  quantity: number
  [key: string]: unknown
}

/** `lowstock.alert` — camelCase fields, but `threshold` (not `lowStockThreshold`), no `unit`. */
export interface LowStockAlert {
  ingredientId: string
  ingredientName: string
  quantity: number
  threshold: number
}

/** `print.status` — snake_case fields; job id key is `print_job_id` (not `job_id`). */
export interface PrintStatusPayload {
  print_job_id: string
  order_id: string
  station_id: string
  status: 'PENDING' | 'PRINTED' | 'FAILED'
  error?: string | null
  printed_at?: string | null
}

/** `printer.status` — snake_case fields. */
export interface PrinterStatusPayload {
  printer_id: string
  status: 'ONLINE' | 'OFFLINE' | 'ERROR'
  last_seen: string | null
}

// Map event names to their payload types
export interface ServerEvents {
  'order.created': (payload: OrderPayload) => void
  'order.updated': (payload: OrderPayload) => void
  'stock.updated': (payload: StockPayload) => void
  'lowstock.alert': (payload: LowStockAlert) => void
  'print.status': (payload: PrintStatusPayload) => void
  'printer.status': (payload: PrinterStatusPayload) => void
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _socket: Socket | null = null

// Room-join + reconnect bookkeeping (module state, mirrors the singleton above).
let _lastJoinedLocationId: string | null = null
let _hasConnectedBefore = false

// Handlers notified when the socket reconnects (i.e. `connect` fires again
// after the first connection) — used by pages to refetch and catch up on
// any events missed while offline (Business Rule #9).
const _reconnectHandlers = new Set<() => void>()

// Handlers notified on connection status transitions, so the UI can show a
// "reconnecting / offline" indicator (see AppShell.tsx).
const _statusHandlers = new Set<(status: 'connected' | 'disconnected') => void>()

function _emitStatus(status: 'connected' | 'disconnected'): void {
  _statusHandlers.forEach(handler => handler(status))
}

const DEFAULT_LOCATION_ID = 'default'

/**
 * Returns the singleton Socket.IO client.
 * The socket connects to same-origin (proxied by Vite in dev) with the
 * locationId in the auth handshake so the server adds the client to the
 * correct room.
 *
 * Call `initSocket(locationId)` once after login to (re-)connect with the
 * correct locationId. Call `destroySocket()` on logout.
 */
export function initSocket(locationId: string = DEFAULT_LOCATION_ID): Socket {
  if (_socket) {
    _socket.disconnect()
    _socket = null
  }

  // Fresh session — the "first connect vs reconnect" distinction starts over.
  _hasConnectedBefore = false

  _socket = io(SOCKET_ORIGIN || '/', {
    // Dev: same-origin (Vite proxies /socket.io). Prod: absolute backend origin.
    path: '/socket.io',
    // Send the user JWT in the handshake — the backend rejects sockets without a
    // valid token (see backend realtime/hub.ts). Read directly from storage to
    // avoid a circular import with api.ts (which imports destroySocket here).
    // socket.io re-sends this same auth payload on every reconnect.
    auth: { token: localStorage.getItem('ck_jwt') ?? undefined, locationId },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,
    reconnectionAttempts: Infinity,
  })

  _socket.on('connect', () => {
    console.log('[socket] connected', _socket?.id)

    // Room join must survive every reconnect, not just the first connect —
    // re-emit whatever location the app last asked to join.
    if (_lastJoinedLocationId) {
      _socket?.emit('join', _lastJoinedLocationId)
    }

    // If we've connected before, this `connect` is a reconnect after a drop —
    // let subscribers (pages) know so they can refetch and catch up on any
    // events missed while offline.
    if (_hasConnectedBefore) {
      _reconnectHandlers.forEach(handler => handler())
    }
    _hasConnectedBefore = true

    _emitStatus('connected')
  })

  _socket.on('disconnect', (reason) => {
    console.log('[socket] disconnected', reason)
    _emitStatus('disconnected')
  })

  _socket.on('connect_error', (err) => {
    console.warn('[socket] connect_error', err.message)
    _emitStatus('disconnected')
  })

  return _socket
}

export function getSocket(): Socket | null {
  return _socket
}

/**
 * Sets the location room the client should be joined to, and (if currently
 * connected) joins it immediately. This is the one place that emits 'join' —
 * pages should call this instead of `socket.emit('join', ...)` directly, so
 * the room join is automatically re-applied after every reconnect.
 */
export function joinLocation(locationId: string): void {
  _lastJoinedLocationId = locationId
  if (_socket?.connected) {
    _socket.emit('join', locationId)
  }
}

/**
 * Subscribes to socket reconnect events (fired when `connect` occurs again
 * after the initial connection, i.e. the client dropped and came back).
 * Returns an unsubscribe function.
 */
export function onSocketReconnect(handler: () => void): () => void {
  _reconnectHandlers.add(handler)
  return () => {
    _reconnectHandlers.delete(handler)
  }
}

/**
 * Subscribes to connection status changes ('connected' | 'disconnected') so
 * the UI can surface a "reconnecting / offline" indicator. Returns an
 * unsubscribe function.
 */
export function onSocketStatusChange(
  handler: (status: 'connected' | 'disconnected') => void,
): () => void {
  _statusHandlers.add(handler)
  return () => {
    _statusHandlers.delete(handler)
  }
}

export function destroySocket(): void {
  if (_socket) {
    _socket.disconnect()
    _socket = null
  }
  _lastJoinedLocationId = null
  _hasConnectedBefore = false
}

/**
 * Typed event listener helper.
 * Usage: `onSocketEvent('order.created', (payload) => { ... })`
 * Returns an unsubscribe function.
 */
export function onSocketEvent<K extends keyof ServerEvents>(
  event: K,
  handler: ServerEvents[K],
): () => void {
  const socket = _socket
  if (!socket) {
    console.warn('[socket] onSocketEvent called before initSocket — handler not attached')
    return () => undefined
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  socket.on(event as string, handler as any)
  return () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket.off(event as string, handler as any)
  }
}
