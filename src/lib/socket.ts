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

/** One insufficient-stock line, shared by the `stock.risk` socket event and the
 *  `stock_risk` / INSUFFICIENT_STOCK REST payloads. snake_case — matches the
 *  stock-reservation backend contract (NOT the camelCase REST GET responses). */
export interface StockShortfall {
  ingredient_id: string
  ingredient_name: string
  required: number
  available: number
}

/** `stock.risk` — emitted to the outlet room when an aggregator order was
 *  accepted despite insufficient available stock. snake_case fields. */
export interface StockRiskPayload {
  order_id: string
  external_ref: string
  brand_id: string
  shortfalls: StockShortfall[]
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
  'stock.risk': (payload: StockRiskPayload) => void
  'print.status': (payload: PrintStatusPayload) => void
  'printer.status': (payload: PrinterStatusPayload) => void
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _socket: Socket | null = null

// Room-join + reconnect bookkeeping (module state, mirrors the singleton above).
//
// M2 fix: a socket can be a member of several location rooms at once (an
// HQ-scope viewer with 'ALL' outlets selected needs every outlet's room, not
// just one) — the server's `join` handler (realtime/hub.ts) just calls
// `socket.join(locationId)`, which is additive and never evicts the socket
// from a room it already holds. Track the FULL set of rooms the app currently
// wants so a reconnect re-emits 'join' for all of them, not just the last one.
let _joinedLocationIds = new Set<string>()
let _hasConnectedBefore = false

// Registry of every handler subscribed via onSocketEvent, kept in module state
// so it can be (re)attached to the CURRENT socket. Two problems this solves:
//   1. Subscribe-before-init race: a page's subscription effect can run before
//      the effect that calls initSocket() (observed on a cold deployed load —
//      the handler was previously dropped with a warning, so live order.created
//      events never reached the page → "live orders don't update" on deploy).
//   2. Socket recreation: initSocket() replaces the singleton on (re)login; the
//      new socket must inherit the still-wanted handlers.
// Entry identity (the object) is the unsubscribe key.
interface EventHandlerEntry { event: string; handler: (...args: unknown[]) => void }
const _eventHandlers = new Set<EventHandlerEntry>()

function _attachHandlers(socket: Socket): void {
  for (const { event, handler } of _eventHandlers) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket.on(event, handler as any)
  }
}

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

  // Fresh session — the "first connect vs reconnect" distinction starts over,
  // and so does room membership bookkeeping (the old socket + its rooms are
  // gone with the disconnect() above).
  _hasConnectedBefore = false
  _joinedLocationIds = new Set()

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

    // Room join(s) must survive every reconnect, not just the first connect —
    // re-emit 'join' for every location the app currently wants (may be more
    // than one — see `_joinedLocationIds` above).
    for (const locationId of _joinedLocationIds) {
      _socket?.emit('join', locationId)
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

  // Attach handlers already registered via onSocketEvent — including any that
  // were subscribed BEFORE this initSocket() call (the cold-load race above).
  _attachHandlers(_socket)

  return _socket
}

export function getSocket(): Socket | null {
  return _socket
}

/**
 * Sets the location room the client should be joined to (replacing any prior
 * single-location selection tracked for reconnect purposes), and — if
 * currently connected — joins it immediately. This is the single-room
 * counterpart of `joinLocations` below; use that instead when a viewer needs
 * more than one outlet's room at once (M2 — KDS/TV with 'ALL' outlets
 * selected). Pages should call one of these instead of
 * `socket.emit('join', ...)` directly, so the room join is automatically
 * re-applied after every reconnect.
 *
 * NOTE: the backend (realtime/hub.ts) has no 'leave' handler — `socket.join`
 * is purely additive server-side. Calling this after `joinLocations([...])`
 * updates what gets re-joined on reconnect, but any previously-joined rooms
 * the server already added this socket to are NOT actively left; the socket
 * keeps receiving their events until it disconnects. Acceptable for now (no
 * server-side support to do otherwise) — see M2 fix notes in
 * useKitchenOrders.ts.
 */
export function joinLocation(locationId: string): void {
  _joinedLocationIds = new Set([locationId])
  if (_socket?.connected) {
    _socket.emit('join', locationId)
  }
}

/**
 * Sets the FULL list of location rooms the client should be joined to
 * (replacing whatever was joined before for reconnect-tracking purposes), and
 * — if currently connected — joins each of them immediately. Used by
 * HQ-scope viewers (OutletContext `selectedOutletId === 'ALL'`) that need
 * live events from every outlet at once, e.g. the KDS/TV board
 * (useKitchenOrders.ts) — see M2 fix.
 *
 * Same reconnect + no-leave caveats as `joinLocation` above.
 */
export function joinLocations(locationIds: string[]): void {
  _joinedLocationIds = new Set(locationIds)
  if (_socket?.connected) {
    for (const locationId of locationIds) {
      _socket.emit('join', locationId)
    }
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
  _joinedLocationIds = new Set()
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
  // Register in module state so the handler survives (and is attached to) a
  // socket created LATER — fixes the deployed cold-load race where a page's
  // subscription effect ran before initSocket() and the handler was dropped,
  // leaving live order.created/updated events with no listener.
  const entry: EventHandlerEntry = {
    event: event as string,
    handler: handler as (...args: unknown[]) => void,
  }
  _eventHandlers.add(entry)
  // If a socket already exists, attach now; otherwise _attachHandlers() will
  // attach it the moment initSocket() creates one.
  if (_socket) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _socket.on(event as string, handler as any)
  }
  return () => {
    _eventHandlers.delete(entry)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _socket?.off(event as string, handler as any)
  }
}
