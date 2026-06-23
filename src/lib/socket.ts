import { io, type Socket } from 'socket.io-client'

// ─── Event payload types (CK1-API-003 §10) ───────────────────────────────────

export interface OrderPayload {
  id: string
  status: 'NEW' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED'
  brand_id: string
  aggregator: string
  external_ref?: string
  customer_name?: string
  placed_at: string
  [key: string]: unknown
}

export interface StockPayload {
  ingredient_id: string
  ingredient_name: string
  warehouse: 'MAIN' | 'KITCHEN'
  quantity: number
  unit: string
  [key: string]: unknown
}

export interface LowStockAlert {
  ingredient_id: string
  ingredient_name: string
  quantity: number
  low_stock_threshold: number
  unit: string
}

export interface PrintStatusPayload {
  job_id: string
  status: 'PENDING' | 'PRINTED' | 'FAILED'
  error?: string
  printer_id: string
  station_id?: string
}

export interface PrinterStatusPayload {
  printer_id: string
  status: 'ONLINE' | 'OFFLINE' | 'ERROR'
  last_seen: string
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
