/**
 * Kitchen Display System (KDS) — FR-KD-01..05
 *
 * Implements:
 *   FR-KD-01  Four-stage lifecycle: NEW → PREPARING → READY → COMPLETED
 *   FR-KD-02  One-click stage advance (POST /orders/{id}/advance); timestamps persisted by API
 *   FR-KD-03  Station-grouped view; active orders (NEW/PREPARING/READY) per station
 *   FR-KD-04  Deduction fires on NEW→PREPARING (backend responsibility; we surface stock events)
 *   FR-KD-05  Overdue highlight: orders exceeding OVERDUE_MINS flagged red + pulsing
 *
 * Business Rule #2 : advancing to PREPARING triggers backend deduction → stock.updated
 * Business Rule #9 : real-time via order.created / order.updated; ~2 s propagation
 * Business Rule #8 : lowstock.alert toasted prominently
 *
 * Tablet-first layout: buttons large/touch-friendly, columns responsive.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { get, post } from '../lib/api'
import { getSocket, initSocket, onSocketEvent } from '../lib/socket'
import type { LowStockAlert, StockPayload } from '../lib/socket'
import type { Brand, Station } from './Dashboard'

// ─── Config ──────────────────────────────────────────────────────────────────

/** Orders older than this many minutes are considered overdue (FR-KD-05). */
const OVERDUE_MINS = 15

// ─── Types ────────────────────────────────────────────────────────────────────

type OrderStatus = 'NEW' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED'

/** Active statuses shown on the KDS (COMPLETED/CANCELLED are excluded) */
const ACTIVE_STATUSES: OrderStatus[] = ['NEW', 'PREPARING', 'READY']

interface KdsOrderItem {
  qty: number
  name: string
  notes?: string | null
  stationId: string
}

interface KdsOrder {
  id: string
  brandId: string
  aggregator: 'FOODPANDA' | 'GRABFOOD' | 'OTHER'
  externalRef: string
  customerName: string | null
  status: OrderStatus
  total: string
  placedAt: string
  prepAt: string | null   // when status moved to PREPARING (if available from API)
  items: KdsOrderItem[]
  stationIds: string[]    // derived: unique stations this order touches
}

// ─── Raw API shapes ───────────────────────────────────────────────────────────

interface RawPrintJobPayload {
  station?: string
  items?: Array<{ qty: number; name: string; notes?: string | null }>
  [key: string]: unknown
}

interface RawPrintJob {
  id: string
  status: 'PENDING' | 'PRINTED' | 'FAILED'
  stationId: string
  error: string | null
  payload: RawPrintJobPayload | null
}

interface RawOrderItem {
  id: string
  menuItemId: string
  qty: number
  stationId: string
  notes: string | null
}

interface RawOrderDetail {
  id: string
  brandId: string
  aggregator: 'FOODPANDA' | 'GRABFOOD' | 'OTHER'
  externalRef: string
  customerName: string | null
  status: OrderStatus
  total: string
  placedAt: string
  prepAt?: string | null
  items: RawOrderItem[]
  print_jobs: RawPrintJob[]
}

interface RawOrderSummary {
  id: string
  status: OrderStatus
  placedAt: string
}

// ─── Toast ────────────────────────────────────────────────────────────────────

interface Toast {
  id: string
  kind: 'lowstock' | 'stock' | 'error' | 'info'
  message: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build KdsOrderItems from print-job payloads and raw order items.
 * Print-job payloads carry item names; raw order items carry stationId.
 * We merge by name (best-effort) so each item record has both name + stationId.
 */
function buildItems(rawItems: RawOrderItem[], printJobs: RawPrintJob[]): KdsOrderItem[] {
  // Build a name→stationId map from print-job payloads keyed by stationId
  const stationByName = new Map<string, string>()
  for (const job of printJobs) {
    for (const item of job.payload?.items ?? []) {
      if (!stationByName.has(item.name)) {
        stationByName.set(item.name, job.stationId)
      }
    }
  }

  // Collect unique items from print-job payloads (they have the display name)
  const seen = new Map<string, KdsOrderItem>()
  for (const job of printJobs) {
    for (const pi of job.payload?.items ?? []) {
      const key = `${pi.name}|${job.stationId}`
      if (seen.has(key)) {
        const ex = seen.get(key)!
        seen.set(key, { ...ex, qty: ex.qty + pi.qty })
      } else {
        seen.set(key, {
          qty: pi.qty,
          name: pi.name,
          notes: pi.notes ?? null,
          stationId: job.stationId,
        })
      }
    }
  }

  // Fallback: if no print-job items, use raw items (names unavailable → use menuItemId)
  if (seen.size === 0) {
    return rawItems.map(ri => ({
      qty: ri.qty,
      name: ri.menuItemId,
      notes: ri.notes,
      stationId: ri.stationId,
    }))
  }

  return [...seen.values()]
}

function toKdsOrder(raw: RawOrderDetail): KdsOrder {
  const items = buildItems(raw.items, raw.print_jobs)
  const stationIds = [...new Set(items.map(i => i.stationId).filter(Boolean))]
  return {
    id: raw.id,
    brandId: raw.brandId,
    aggregator: raw.aggregator,
    externalRef: raw.externalRef,
    customerName: raw.customerName,
    status: raw.status,
    total: raw.total,
    placedAt: raw.placedAt,
    prepAt: raw.prepAt ?? null,
    items,
    stationIds,
  }
}

async function fetchOrderDetail(id: string): Promise<KdsOrder | null> {
  try {
    const { data } = await get<RawOrderDetail>(`/orders/${id}`)
    return toKdsOrder(data)
  } catch {
    return null
  }
}

/** Elapsed minutes from the given ISO timestamp to now. */
function elapsedMins(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 60_000
}

/** Human-readable elapsed label (e.g. "4m", "1h 3m"). */
function elapsedLabel(iso: string): string {
  const mins = Math.floor(elapsedMins(iso))
  if (mins < 1) return '<1m'
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Returns the timestamp to use for elapsed / overdue check. */
function timerStart(order: KdsOrder): string {
  // Once in PREPARING, measure from prep_at if available (more meaningful)
  if (order.status === 'PREPARING' && order.prepAt) return order.prepAt
  return order.placedAt
}

// ─── Stage config ─────────────────────────────────────────────────────────────

const NEXT_STAGE: Record<string, string> = {
  NEW:       'PREPARING',
  PREPARING: 'READY',
  READY:     'COMPLETED',
}

const STAGE_COLORS: Record<string, { card: string; badge: string; btn: string }> = {
  NEW: {
    card:  'border-blue-400 bg-blue-50',
    badge: 'bg-blue-100 text-blue-800',
    btn:   'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white',
  },
  PREPARING: {
    card:  'border-amber-400 bg-amber-50',
    badge: 'bg-amber-100 text-amber-800',
    btn:   'bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white',
  },
  READY: {
    card:  'border-emerald-400 bg-emerald-50',
    badge: 'bg-emerald-100 text-emerald-800',
    btn:   'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white',
  },
  COMPLETED: {
    card:  'border-gray-300 bg-gray-50',
    badge: 'bg-gray-100 text-gray-500',
    btn:   'bg-gray-300 text-gray-400 cursor-not-allowed',
  },
}

const AGG_STYLES: Record<string, { label: string; cls: string }> = {
  FOODPANDA: { label: 'FP',  cls: 'bg-pink-100 text-pink-700 border border-pink-200' },
  GRABFOOD:  { label: 'GF',  cls: 'bg-emerald-100 text-emerald-700 border border-emerald-200' },
  OTHER:     { label: 'OTH', cls: 'bg-gray-100 text-gray-600 border border-gray-200' },
}

// ─── OrderTile ────────────────────────────────────────────────────────────────

interface OrderTileProps {
  order: KdsOrder
  brand: Brand | undefined
  stationId: string
  now: number           // tick from parent — triggers elapsed re-render
  onAdvance: (id: string) => void
  advancing: boolean
}

function OrderTile({ order, brand, stationId, now: _now, onAdvance, advancing }: OrderTileProps) {
  const styles    = STAGE_COLORS[order.status] ?? STAGE_COLORS.NEW
  const agg       = AGG_STYLES[order.aggregator] ?? AGG_STYLES.OTHER
  const brandColor = brand?.color ?? '#9ca3af'
  const next      = NEXT_STAGE[order.status]

  // Elapsed time for this order at this moment (parent ticks `now` every 30 s)
  const elapsed   = elapsedLabel(timerStart(order))
  const mins      = elapsedMins(timerStart(order))
  const isOverdue = mins >= OVERDUE_MINS

  // Items relevant to THIS station only
  const stationItems = order.items.filter(i => i.stationId === stationId)
  // If no per-station items resolved, show all items (graceful fallback)
  const displayItems = stationItems.length > 0 ? stationItems : order.items

  return (
    <div
      className={[
        'rounded-xl border-2 shadow-sm transition-all duration-300',
        styles.card,
        isOverdue && order.status !== 'COMPLETED'
          ? 'animate-pulse border-red-500 bg-red-50 ring-2 ring-red-400 ring-offset-1'
          : '',
      ].join(' ')}
      style={{ borderLeftColor: brandColor, borderLeftWidth: 4 }}
    >
      {/* ── Card header ── */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5 pb-1.5">
        {/* Brand chip */}
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white"
          style={{ backgroundColor: brandColor }}
        >
          {brand?.name ?? '—'}
        </span>

        {/* Aggregator badge */}
        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${agg.cls}`}>
          {agg.label}
        </span>

        {/* Ref */}
        <span className="text-[11px] font-mono text-gray-500">{order.externalRef}</span>

        {/* Status badge */}
        <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${styles.badge}`}>
          {order.status}
        </span>
      </div>

      {/* ── Customer + timer ── */}
      <div className="flex items-center justify-between px-3 pb-2">
        <span className="text-sm font-semibold text-gray-800 truncate max-w-[55%]">
          {order.customerName ?? 'Guest'}
        </span>
        <span
          title={`Placed ${formatTime(order.placedAt)}`}
          className={[
            'shrink-0 text-xs font-bold tabular-nums',
            isOverdue && order.status !== 'COMPLETED'
              ? 'text-red-600'
              : 'text-gray-500',
          ].join(' ')}
        >
          {isOverdue && order.status !== 'COMPLETED' ? '⚠ ' : ''}{elapsed}
        </span>
      </div>

      {/* ── Items for this station ── */}
      {displayItems.length > 0 && (
        <ul className="border-t border-white/60 px-3 py-2 space-y-0.5">
          {displayItems.map((item, idx) => (
            <li key={idx} className="flex gap-2 text-sm text-gray-800">
              <span className="w-5 shrink-0 text-right font-bold text-gray-900">{item.qty}×</span>
              <span className="flex-1 leading-snug">
                {item.name}
                {item.notes && (
                  <span className="ml-1 text-[10px] italic text-gray-400">({item.notes})</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* ── Advance button ── */}
      <div className="px-3 pb-3 pt-2">
        {next ? (
          <button
            onClick={() => onAdvance(order.id)}
            disabled={advancing}
            aria-label={`Advance order ${order.externalRef} to ${next}`}
            className={[
              'w-full rounded-lg px-4 py-3 text-sm font-bold tracking-wide transition',
              'disabled:opacity-60 disabled:cursor-not-allowed',
              styles.btn,
            ].join(' ')}
          >
            {advancing
              ? 'Advancing…'
              : `→ ${next.charAt(0) + next.slice(1).toLowerCase()}`}
          </button>
        ) : (
          <div className="w-full rounded-lg px-4 py-3 text-center text-sm font-bold text-gray-400 bg-gray-100">
            Completed
          </div>
        )}
      </div>
    </div>
  )
}

// ─── ToastBanner ──────────────────────────────────────────────────────────────

interface ToastBannerProps {
  toasts: Toast[]
  onDismiss: (id: string) => void
}

function ToastBanner({ toasts, onDismiss }: ToastBannerProps) {
  if (toasts.length === 0) return null
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-xs w-full pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={[
            'pointer-events-auto flex items-start gap-2 rounded-xl px-4 py-3 shadow-lg text-sm font-medium',
            t.kind === 'lowstock'
              ? 'bg-red-600 text-white'
              : t.kind === 'error'
                ? 'bg-red-100 text-red-800 border border-red-300'
                : 'bg-gray-800 text-white',
          ].join(' ')}
        >
          <span className="flex-1 leading-snug">{t.message}</span>
          <button
            onClick={() => onDismiss(t.id)}
            aria-label="Dismiss"
            className="shrink-0 opacity-70 hover:opacity-100 text-lg leading-none"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

// ─── Kitchen ──────────────────────────────────────────────────────────────────

export default function Kitchen() {
  const [orders, setOrders]     = useState<KdsOrder[]>([])
  const [brands, setBrands]     = useState<Brand[]>([])
  const [stations, setStations] = useState<Station[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [advancing, setAdvancing] = useState<Set<string>>(new Set())
  const [toasts, setToasts]     = useState<Toast[]>([])
  const [now, setNow]           = useState(() => Date.now())

  const brandMap = useMemo(() => new Map(brands.map(b => [b.id, b])), [brands])

  // ── Toast helpers ──────────────────────────────────────────────────────────

  const addToast = useCallback((kind: Toast['kind'], message: string, ttl = 6000) => {
    const id = `${Date.now()}-${Math.random()}`
    setToasts(prev => [...prev.slice(-4), { id, kind, message }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, ttl)
  }, [])

  function dismissToast(id: string) {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  // ── Tick every 30 s so elapsed timers update without per-order intervals ───

  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(handle)
  }, [])

  // ── Initial data load ──────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [brandsRes, stationsRes, ordersRes] = await Promise.all([
          get<Brand[]>('/brands'),
          get<Station[]>('/stations'),
          get<RawOrderSummary[]>('/orders?status=NEW&status=PREPARING&status=READY'),
        ])
        if (cancelled) return

        setBrands(brandsRes.data)
        setStations(stationsRes.data)

        // Ensure socket connected and joined to the location room
        if (!getSocket()) initSocket()
        const socket = getSocket()
        if (socket && brandsRes.data.length > 0) {
          socket.emit('join', brandsRes.data[0].locationId)
        }

        // Fetch full details for active orders
        const summaries = ordersRes.data.filter(
          o => (ACTIVE_STATUSES as string[]).includes(o.status),
        )
        const details = await Promise.all(summaries.map(o => fetchOrderDetail(o.id)))
        if (cancelled) return

        const active = details.filter((d): d is KdsOrder => d !== null)
        // Sort: NEW first, then PREPARING, then READY; within stage newest first
        active.sort((a, b) => {
          const stageOrder: Record<string, number> = { NEW: 0, PREPARING: 1, READY: 2, COMPLETED: 3 }
          const sd = (stageOrder[a.status] ?? 0) - (stageOrder[b.status] ?? 0)
          if (sd !== 0) return sd
          return new Date(a.placedAt).getTime() - new Date(b.placedAt).getTime()
        })
        setOrders(active)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load kitchen orders.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => { cancelled = true }
  }, [])

  // ── Socket subscriptions ───────────────────────────────────────────────────

  useEffect(() => {
    // order.created → fetch detail and add to active list
    const unsubCreated = onSocketEvent('order.created', payload => {
      // Backend emits { order_id, ... } (snake_case) — see lib/socket.ts notes.
      const orderId = payload.order_id
      if (!orderId) return
      void fetchOrderDetail(orderId).then(detail => {
        if (!detail) return
        if (!(ACTIVE_STATUSES as string[]).includes(detail.status)) return
        setOrders(prev => {
          if (prev.some(o => o.id === detail.id)) return prev
          return [detail, ...prev]
        })
      })
    })

    // order.updated → update status in place; remove if COMPLETED/CANCELLED
    const unsubUpdated = onSocketEvent('order.updated', payload => {
      const orderId = payload.order_id
      if (!orderId) return
      const newStatus = payload.status

      if (!(ACTIVE_STATUSES as string[]).includes(newStatus)) {
        // Remove from KDS (completed / cancelled)
        setOrders(prev => prev.filter(o => o.id !== orderId))
        return
      }

      setOrders(prev => {
        const existing = prev.find(o => o.id === orderId)
        if (existing) {
          return prev.map(o =>
            o.id === orderId
              ? {
                  ...o,
                  status: newStatus,
                  prepAt: newStatus === 'PREPARING' && !o.prepAt
                    ? new Date().toISOString()
                    : o.prepAt,
                }
              : o,
          )
        }
        // Not in list yet — fetch and add
        void fetchOrderDetail(orderId).then(detail => {
          if (!detail) return
          if (!(ACTIVE_STATUSES as string[]).includes(detail.status)) return
          setOrders(p => p.some(o => o.id === detail.id) ? p : [detail, ...p])
        })
        return prev
      })
    })

    // stock.updated (Business Rule #2 — surfaces result of PREPARING deduction)
    const unsubStock = onSocketEvent('stock.updated', (payload: StockPayload) => {
      if (payload.warehouseType === 'KITCHEN') {
        // Only surface if it looks like a significant drop (below 20 units) — brief info toast
        if (payload.quantity < 20) {
          addToast(
            'info',
            `Stock updated: ${payload.ingredientName} → ${payload.quantity} (Kitchen)`,
            4000,
          )
        }
      }
    })

    // lowstock.alert (Business Rule #8 — non-negotiable alert)
    const unsubLowstock = onSocketEvent('lowstock.alert', (alert: LowStockAlert) => {
      addToast(
        'lowstock',
        `⚠ LOW STOCK: ${alert.ingredientName} — ${alert.quantity} remaining (threshold: ${alert.threshold})`,
        10_000,
      )
    })

    return () => {
      unsubCreated()
      unsubUpdated()
      unsubStock()
      unsubLowstock()
    }
  }, [addToast])

  // ── Advance handler ────────────────────────────────────────────────────────

  async function handleAdvance(orderId: string) {
    setAdvancing(prev => new Set(prev).add(orderId))
    try {
      const { data } = await post<{ id: string; status: OrderStatus; prepAt?: string }>(
        `/orders/${orderId}/advance`,
      )
      const newStatus = data.status

      if (!(ACTIVE_STATUSES as string[]).includes(newStatus)) {
        // Completed — remove from KDS
        setOrders(prev => prev.filter(o => o.id !== orderId))
      } else {
        setOrders(prev =>
          prev.map(o =>
            o.id === orderId
              ? {
                  ...o,
                  status: newStatus,
                  prepAt: data.prepAt ?? (newStatus === 'PREPARING' ? new Date().toISOString() : o.prepAt),
                }
              : o,
          ),
        )
      }
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Failed to advance order.')
    } finally {
      setAdvancing(prev => {
        const next = new Set(prev)
        next.delete(orderId)
        return next
      })
    }
  }

  // ── Station-grouped view ───────────────────────────────────────────────────

  /**
   * For each station, collect orders that have at least one item routed to it.
   * An order can appear in multiple station columns if its items span stations.
   */
  const stationOrders = useMemo(() => {
    const map = new Map<string, KdsOrder[]>()
    for (const station of stations) {
      map.set(station.id, [])
    }
    for (const order of orders) {
      // If no stationIds resolved (no print-job items), show in every column
      const targetStations = order.stationIds.length > 0 ? order.stationIds : stations.map(s => s.id)
      for (const sid of targetStations) {
        if (map.has(sid)) {
          map.get(sid)!.push(order)
        }
      }
    }
    return map
  }, [orders, stations])

  const totalActive = orders.length
  const overdueCount = orders.filter(
    o => elapsedMins(timerStart(o)) >= OVERDUE_MINS && o.status !== 'COMPLETED',
  ).length

  // ── Stage summary counts ──────────────────────────────────────────────────

  const stageCounts = useMemo(
    () => ({
      NEW:       orders.filter(o => o.status === 'NEW').length,
      PREPARING: orders.filter(o => o.status === 'PREPARING').length,
      READY:     orders.filter(o => o.status === 'READY').length,
    }),
    [orders],
  )

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col overflow-hidden bg-gray-100">
      {/* ── Page header ── */}
      <header className="shrink-0 flex items-center justify-between border-b border-gray-200 bg-white px-5 py-3 sm:px-6">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-gray-900 sm:text-xl truncate">Kitchen Display</h1>
          <p className="text-[11px] text-gray-400">Station-grouped · Real-time · Tablet-ready</p>
        </div>

        {/* Summary pills */}
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-800 tabular-nums">
            {stageCounts.NEW} New
          </span>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800 tabular-nums">
            {stageCounts.PREPARING} Preparing
          </span>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800 tabular-nums">
            {stageCounts.READY} Ready
          </span>
          {overdueCount > 0 && (
            <span className="rounded-full bg-red-600 px-3 py-1 text-xs font-bold text-white tabular-nums animate-pulse">
              {overdueCount} Overdue (&gt;{OVERDUE_MINS}m)
            </span>
          )}
          <span className="text-xs text-gray-400 tabular-nums">{totalActive} active</span>
        </div>
      </header>

      {/* ── Body ── */}
      {loading ? (
        <div className="flex flex-1 flex-col items-center justify-center text-gray-400">
          <div className="mb-3 h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-brand-500" />
          <p className="text-sm">Loading kitchen orders…</p>
        </div>
      ) : error ? (
        <div className="flex flex-1 flex-col items-center justify-center p-8">
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center max-w-md">
            <p className="text-sm font-medium text-red-700">{error}</p>
            <p className="mt-1 text-xs text-red-400">Make sure the backend is running on :4000</p>
          </div>
        </div>
      ) : stations.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-8">
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center max-w-md">
            <p className="text-4xl mb-3" aria-hidden>🍳</p>
            <p className="text-sm font-medium text-gray-600">No stations configured</p>
            <p className="mt-1 text-xs text-gray-400">
              Create kitchen stations via the API to enable the display.
            </p>
          </div>
        </div>
      ) : (
        /* ── Station columns ── */
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div
            className="flex h-full gap-3 p-3 sm:gap-4 sm:p-4"
            style={{ minWidth: `${stations.length * 280}px` }}
          >
            {stations.map(station => {
              const col = stationOrders.get(station.id) ?? []
              const colOverdue = col.filter(
                o => elapsedMins(timerStart(o)) >= OVERDUE_MINS && o.status !== 'COMPLETED',
              ).length

              return (
                <section
                  key={station.id}
                  className="flex w-72 shrink-0 flex-col rounded-2xl bg-white shadow-sm border border-gray-200 overflow-hidden"
                  aria-label={`${station.name} station`}
                >
                  {/* Station header */}
                  <div className="shrink-0 flex items-center justify-between bg-gray-800 px-4 py-3">
                    <h2 className="text-base font-bold text-white tracking-wide truncate">
                      {station.name}
                    </h2>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {colOverdue > 0 && (
                        <span className="rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-bold text-white animate-pulse tabular-nums">
                          {colOverdue}⚠
                        </span>
                      )}
                      <span className="rounded-full bg-gray-600 px-2 py-0.5 text-[11px] font-bold text-gray-200 tabular-nums">
                        {col.length}
                      </span>
                    </div>
                  </div>

                  {/* Order tiles */}
                  <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {col.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-gray-300">
                        <p className="text-3xl" aria-hidden>✓</p>
                        <p className="mt-2 text-xs font-medium text-gray-400">No active orders</p>
                      </div>
                    ) : (
                      col.map(order => (
                        <OrderTile
                          key={order.id}
                          order={order}
                          brand={brandMap.get(order.brandId)}
                          stationId={station.id}
                          now={now}
                          onAdvance={id => void handleAdvance(id)}
                          advancing={advancing.has(order.id)}
                        />
                      ))
                    )}
                  </div>
                </section>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Toast notifications (low-stock + stock.updated + errors) ── */}
      <ToastBanner toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
