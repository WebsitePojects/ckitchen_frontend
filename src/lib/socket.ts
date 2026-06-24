import { io, type Socket } from 'socket.io-client'

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

  _socket = io('/', {
    // Same-origin — Vite proxies /socket.io to the backend in dev
    path: '/socket.io',
    auth: { locationId },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 10,
  })

  _socket.on('connect', () => {
    console.log('[socket] connected', _socket?.id)
  })

  _socket.on('disconnect', (reason) => {
    console.log('[socket] disconnected', reason)
  })

  _socket.on('connect_error', (err) => {
    console.warn('[socket] connect_error', err.message)
  })

  return _socket
}

export function getSocket(): Socket | null {
  return _socket
}

export function destroySocket(): void {
  if (_socket) {
    _socket.disconnect()
    _socket = null
  }
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
