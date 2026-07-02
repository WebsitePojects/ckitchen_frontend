/**
 * Kitchen Display System (KDS) — FR-KD-01..05
 * M4 dark back-of-house reskin (build/prototype).
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
 * Business Rule #8 : lowstock.alert toasted prominently (sonner)
 *
 * Tablet-first layout: buttons large/touch-friendly, columns responsive.
 * Fix: orders fetched with comma-separated status (single param, backend compatible).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChefHat,
  Clock,
  Flame,
  LayoutGrid,
  PackageCheck,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { get, post } from '../lib/api'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '../components/ui/dialog'
import { getSocket, initSocket, joinLocation, onSocketEvent, onSocketReconnect } from '../lib/socket'
import type { LowStockAlert, StockPayload } from '../lib/socket'
import type { Brand, Station } from './Dashboard'
import PageHeader from '../components/common/PageHeader'
import BrandChip from '../components/common/BrandChip'
import AggregatorBadge from '../components/common/AggregatorBadge'
import StatusBadge from '../components/common/StatusBadge'
import EmptyState from '../components/common/EmptyState'

// ─── Config ──────────────────────────────────────────────────────────────────

/** Orders older than this many minutes are considered overdue (FR-KD-05). */
const OVERDUE_MINS = 15

// ─── Types ────────────────────────────────────────────────────────────────────

type OrderStatus = 'NEW' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED'

/** Active statuses shown on the KDS (COMPLETED/CANCELLED are excluded from the board) */
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
  prepAt: string | null
  items: KdsOrderItem[]
  stationIds: string[]
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build KdsOrderItems from print-job payloads and raw order items.
 * Print-job payloads carry item names; raw order items carry stationId.
 */
function buildItems(rawItems: RawOrderItem[], printJobs: RawPrintJob[]): KdsOrderItem[] {
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

/** Elapsed milliseconds from the given ISO timestamp to now. */
function elapsedMs(iso: string): number {
  return Date.now() - new Date(iso).getTime()
}

/** Elapsed minutes from the given ISO timestamp to now. */
function elapsedMins(iso: string): number {
  return elapsedMs(iso) / 60_000
}

/** Live mm:ss timer label — used on the KDS card. For >= 1 h: Xh YYm format. */
function elapsedMMSS(iso: string): string {
  const totalSecs = Math.floor(elapsedMs(iso) / 1000)
  if (totalSecs < 0) return '00:00'
  const mins = Math.floor(totalSecs / 60)
  const secs = totalSecs % 60
  if (mins < 60) {
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }
  const hours = Math.floor(mins / 60)
  const remainMins = mins % 60
  return `${hours}h ${String(remainMins).padStart(2, '0')}m`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Returns the timestamp to use for elapsed / overdue check. */
function timerStart(order: KdsOrder): string {
  if (order.status === 'PREPARING' && order.prepAt) return order.prepAt
  return order.placedAt
}

// ─── Stage config ─────────────────────────────────────────────────────────────

const NEXT_STAGE: Record<string, string> = {
  NEW:       'PREPARING',
  PREPARING: 'READY',
  READY:     'COMPLETED',
}

// ─── Dark-mode stage color tokens ─────────────────────────────────────────────

interface StageStyle {
  cardBorder: string
  btnClass: string
}

const STAGE_STYLE: Record<string, StageStyle> = {
  NEW: {
    cardBorder: 'border-blue-500/40',
    btnClass:   'bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white',
  },
  PREPARING: {
    cardBorder: 'border-amber-500/40',
    btnClass:   'bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-zinc-900',
  },
  READY: {
    cardBorder: 'border-emerald-500/40',
    btnClass:   'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white',
  },
  COMPLETED: {
    cardBorder: 'border-zinc-700',
    btnClass:   'bg-zinc-800 text-zinc-500 cursor-not-allowed',
  },
}

// ─── Stage tab definitions ────────────────────────────────────────────────────

type StageFilter = 'ALL' | OrderStatus

interface StageTab {
  key: StageFilter
  label: string
  icon: React.ComponentType<{ className?: string }>
  countKey?: keyof StageCounts
}

const STAGE_TABS: StageTab[] = [
  { key: 'ALL',       label: 'All Active', icon: LayoutGrid   },
  { key: 'NEW',       label: 'New',        icon: Clock,       countKey: 'NEW'       },
  { key: 'PREPARING', label: 'Preparing',  icon: Flame,       countKey: 'PREPARING' },
  { key: 'READY',     label: 'Ready',      icon: PackageCheck, countKey: 'READY'    },
  { key: 'COMPLETED', label: 'Completed',  icon: CheckCircle2, countKey: 'COMPLETED'},
]

interface StageCounts {
  ALL: number
  NEW: number
  PREPARING: number
  READY: number
  COMPLETED: number
}

// ─── OrderCard ────────────────────────────────────────────────────────────────

interface OrderCardProps {
  order: KdsOrder
  brand: Brand | undefined
  stationId: string
  now: number           // tick from parent — triggers elapsed re-render
  onAdvance: (id: string) => void
  onCancel: (id: string, reason: string) => Promise<void>
  advancing: boolean
}

function OrderCard({ order, brand, stationId, now: _now, onAdvance, onCancel, advancing }: OrderCardProps) {
  const style   = STAGE_STYLE[order.status] ?? STAGE_STYLE.NEW
  const next    = NEXT_STAGE[order.status]
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)

  const submitCancel = async () => {
    const reason = cancelReason.trim()
    if (reason.length === 0) return
    setCancelling(true)
    try {
      await onCancel(order.id, reason)
      setCancelOpen(false)
      setCancelReason('')
    } finally {
      setCancelling(false)
    }
  }
  const start   = timerStart(order)
  const mins    = elapsedMins(start)
  const isOverdue = mins >= OVERDUE_MINS && order.status !== 'COMPLETED'
  const elapsed = elapsedMMSS(start)

  // Items relevant to THIS station only; fall back to all items
  const stationItems  = order.items.filter(i => i.stationId === stationId)
  const displayItems  = stationItems.length > 0 ? stationItems : order.items

  return (
    <div
      className={[
        'group relative flex flex-col rounded-xl border bg-[#121A17] shadow-lg',
        'transition-all duration-300',
        style.cardBorder,
        isOverdue
          ? 'animate-pulse ring-2 ring-red-500/60 ring-offset-2 ring-offset-[#0A0F0D] border-red-500/60'
          : '',
      ].join(' ')}
      style={{ borderLeftColor: brand?.color ?? '#52525B', borderLeftWidth: 3 }}
    >
      {/* ── Card header ── */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 pt-3 pb-2">
        <BrandChip brand={brand} />
        <AggregatorBadge aggregator={order.aggregator} />
        <span className="font-mono text-[11px] text-zinc-500 tabular-nums">
          {order.externalRef}
        </span>
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          {isOverdue && (
            <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" aria-label="Overdue" />
          )}
          <StatusBadge status={order.status} />
        </div>
      </div>

      {/* ── Customer + timer row ── */}
      <div className="flex items-center justify-between px-3 pb-2">
        <span className="text-sm font-semibold text-zinc-100 truncate max-w-[55%]">
          {order.customerName ?? 'Guest'}
        </span>
        <span
          title={`Placed ${formatTime(order.placedAt)}`}
          className={[
            'shrink-0 text-sm font-bold tabular-nums font-mono',
            isOverdue ? 'text-red-400' : 'text-zinc-400',
          ].join(' ')}
        >
          {elapsed}
        </span>
      </div>

      {/* ── Items for this station ── */}
      {displayItems.length > 0 && (
        <ul className="border-t border-[#1F2A24] px-3 py-2 space-y-1">
          {displayItems.map((item, idx) => (
            <li key={idx} className="flex gap-2 text-sm text-zinc-200">
              <span className="w-6 shrink-0 text-right font-bold text-emerald-400 tabular-nums">
                {item.qty}×
              </span>
              <span className="flex-1 leading-snug">
                {item.name}
                {item.notes && (
                  <span className="ml-1.5 text-[10px] italic text-zinc-500">
                    ({item.notes})
                  </span>
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
              'w-full flex items-center justify-center gap-2',
              'rounded-lg px-4 py-3.5 text-sm font-bold tracking-wide',
              'transition-colors duration-150 select-none',
              'min-h-[52px]',        // large touch target
              'disabled:opacity-50 disabled:cursor-not-allowed',
              style.btnClass,
            ].join(' ')}
          >
            {advancing ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Advancing…
              </>
            ) : next === 'COMPLETED' ? (
              <>
                <CheckCircle2 className="h-4 w-4" />
                Mark Ready
              </>
            ) : (
              <>
                <ArrowRight className="h-4 w-4" />
                {next.charAt(0) + next.slice(1).toLowerCase()}
              </>
            )}
          </button>
        ) : (
          <div className="w-full flex items-center justify-center gap-2 rounded-lg px-4 py-3.5 min-h-[52px] bg-zinc-800/50 text-sm font-semibold text-zinc-600">
            <CheckCircle2 className="h-4 w-4" />
            Completed
          </div>
        )}

        {/* ── Cancel (requires a reason) — only while the order is still active ── */}
        {next && (
          <button
            onClick={() => setCancelOpen(true)}
            className="mt-2 w-full flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-red-300/80 hover:text-red-200 hover:bg-red-500/10 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
            Cancel order
          </button>
        )}
      </div>

      {/* ── Cancel-reason dialog (MOTM 2026-07-01: cancellations must be justified) ── */}
      <Dialog open={cancelOpen} onOpenChange={(o) => { if (!cancelling) setCancelOpen(o) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel order {order.externalRef}</DialogTitle>
            <DialogDescription>
              A reason is required and is saved to the audit log.
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            maxLength={500}
            rows={3}
            autoFocus
            placeholder="e.g. customer cancelled, item unavailable, duplicate order…"
            className="w-full rounded-lg border border-[#1F2A24] bg-[#0A0F0D] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-red-500/50"
          />
          <DialogFooter>
            <button
              onClick={() => { setCancelOpen(false); setCancelReason('') }}
              disabled={cancelling}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
            >
              Keep order
            </button>
            <button
              onClick={() => void submitCancel()}
              disabled={cancelling || cancelReason.trim().length === 0}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {cancelling ? 'Cancelling…' : 'Cancel order'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Kitchen ──────────────────────────────────────────────────────────────────

export default function Kitchen() {
  const [orders,    setOrders]    = useState<KdsOrder[]>([])
  const [brands,    setBrands]    = useState<Brand[]>([])
  const [stations,  setStations]  = useState<Station[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [advancing, setAdvancing] = useState<Set<string>>(new Set())
  const [now,       setNow]       = useState(() => Date.now())
  const [activeStage, setActiveStage] = useState<StageFilter>('ALL')

  const brandMap = useMemo(() => new Map(brands.map(b => [b.id, b])), [brands])

  // ── Tick every second for mm:ss timers (single shared interval) ───────────

  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(handle)
  }, [])

  // ── Initial data load ──────────────────────────────────────────────────────
  // Wrapped in useCallback (stable identity, no external deps — it fetches
  // brands/stations/orders fresh from the API every call) so it can also be
  // re-invoked on socket reconnect to catch up on any missed events
  // (Business Rule #9).

  const load = useCallback(async (cancelledRef?: { current: boolean }) => {
    setLoading(true)
    setError(null)
    try {
      const [brandsRes, stationsRes, ordersRes] = await Promise.all([
        get<Brand[]>('/brands'),
        get<Station[]>('/stations'),
        // Fix: comma-separated single param — backend now accepts this form
        get<RawOrderSummary[]>('/orders?status=NEW,PREPARING,READY'),
      ])
      if (cancelledRef?.current) return

      setBrands(brandsRes.data)
      setStations(stationsRes.data)

      // Ensure socket connected and joined to the location room
      if (!getSocket()) initSocket()
      if (brandsRes.data.length > 0) {
        joinLocation(brandsRes.data[0].locationId)
      }

      // Fetch full details for active orders
      const summaries = ordersRes.data.filter(
        o => (ACTIVE_STATUSES as string[]).includes(o.status),
      )
      const details = await Promise.all(summaries.map(o => fetchOrderDetail(o.id)))
      if (cancelledRef?.current) return

      const active = details.filter((d): d is KdsOrder => d !== null)
      // Sort: NEW first, then PREPARING, then READY; within stage oldest first (longest wait)
      active.sort((a, b) => {
        const stageOrder: Record<string, number> = { NEW: 0, PREPARING: 1, READY: 2, COMPLETED: 3 }
        const sd = (stageOrder[a.status] ?? 0) - (stageOrder[b.status] ?? 0)
        if (sd !== 0) return sd
        return new Date(a.placedAt).getTime() - new Date(b.placedAt).getTime()
      })
      setOrders(active)
    } catch (e) {
      if (!cancelledRef?.current) {
        setError(e instanceof Error ? e.message : 'Failed to load kitchen orders.')
      }
    } finally {
      if (!cancelledRef?.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const cancelledRef = { current: false }
    void load(cancelledRef)
    return () => { cancelledRef.current = true }
  }, [load])

  // ── Reconnect recovery ─────────────────────────────────────────────────────
  // A dropped-then-restored socket may have missed order.created/updated
  // events entirely — refetch to catch up (Business Rule #9).
  useEffect(() => {
    return onSocketReconnect(() => { void load() })
  }, [load])

  // ── Socket subscriptions ───────────────────────────────────────────────────

  useEffect(() => {
    // order.created → fetch detail and add to active list
    const unsubCreated = onSocketEvent('order.created', payload => {
      const orderId = payload.order_id
      if (!orderId) return
      void fetchOrderDetail(orderId).then(detail => {
        if (!detail) return
        if (!(ACTIVE_STATUSES as string[]).includes(detail.status)) return
        setOrders(prev => {
          if (prev.some(o => o.id === detail.id)) return prev
          return [detail, ...prev]
        })
        toast.info(`New order: ${detail.externalRef}`, {
          description: detail.customerName ? `Customer: ${detail.customerName}` : undefined,
        })
      })
    })

    // order.updated → update status in place; remove if COMPLETED/CANCELLED
    const unsubUpdated = onSocketEvent('order.updated', payload => {
      const orderId = payload.order_id
      if (!orderId) return
      const newStatus = payload.status

      if (!(ACTIVE_STATUSES as string[]).includes(newStatus)) {
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
      if (payload.warehouseType === 'KITCHEN' && payload.quantity < 20) {
        toast.info(`Stock updated: ${payload.ingredientName}`, {
          description: `${payload.quantity} remaining in Kitchen`,
          duration: 4000,
        })
      }
    })

    // lowstock.alert (Business Rule #8 — non-negotiable prominent alert)
    const unsubLowstock = onSocketEvent('lowstock.alert', (alert: LowStockAlert) => {
      toast.error(`Low stock: ${alert.ingredientName}`, {
        description: `${alert.quantity} remaining — threshold is ${alert.threshold}`,
        duration: 10_000,
        icon: <AlertTriangle className="h-4 w-4" />,
      })
    })

    return () => {
      unsubCreated()
      unsubUpdated()
      unsubStock()
      unsubLowstock()
    }
  }, [])

  // ── Advance handler ────────────────────────────────────────────────────────

  const handleAdvance = useCallback(async (orderId: string) => {
    setAdvancing(prev => new Set(prev).add(orderId))
    try {
      const { data } = await post<{ id: string; status: OrderStatus; prepAt?: string }>(
        `/orders/${orderId}/advance`,
      )
      const newStatus = data.status

      if (!(ACTIVE_STATUSES as string[]).includes(newStatus)) {
        setOrders(prev => prev.filter(o => o.id !== orderId))
        toast.success('Order completed', { description: `Order advanced to ${newStatus}` })
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
      toast.error('Failed to advance order', {
        description: e instanceof Error ? e.message : 'Unknown error',
      })
    } finally {
      setAdvancing(prev => {
        const next = new Set(prev)
        next.delete(orderId)
        return next
      })
    }
  }, [])

  // ── Cancel handler (reason required; backend records it + audits) ────────────
  const handleCancel = useCallback(async (orderId: string, reason: string) => {
    try {
      await post(`/orders/${orderId}/cancel`, { reason })
      setOrders(prev => prev.filter(o => o.id !== orderId))
      toast.success('Order cancelled', { description: reason })
    } catch (e) {
      toast.error('Failed to cancel order', {
        description: e instanceof Error ? e.message : 'Unknown error',
      })
      throw e // let the dialog keep itself open on failure
    }
  }, [])

  // ── Station-grouped view ───────────────────────────────────────────────────

  /**
   * For each station, collect orders that have at least one item routed to it.
   * Filtered by activeStage if not 'ALL'.
   */
  const visibleOrders = useMemo(() => {
    if (activeStage === 'ALL') return orders
    return orders.filter(o => o.status === activeStage)
  }, [orders, activeStage])

  const stationOrders = useMemo(() => {
    const map = new Map<string, KdsOrder[]>()
    for (const station of stations) {
      map.set(station.id, [])
    }
    for (const order of visibleOrders) {
      const targetStations = order.stationIds.length > 0 ? order.stationIds : stations.map(s => s.id)
      for (const sid of targetStations) {
        if (map.has(sid)) {
          map.get(sid)!.push(order)
        }
      }
    }
    return map
  }, [visibleOrders, stations])

  // ── Stage summary counts ──────────────────────────────────────────────────

  const stageCounts = useMemo<StageCounts>(
    () => ({
      ALL:       orders.length,
      NEW:       orders.filter(o => o.status === 'NEW').length,
      PREPARING: orders.filter(o => o.status === 'PREPARING').length,
      READY:     orders.filter(o => o.status === 'READY').length,
      COMPLETED: 0, // COMPLETED orders are removed from the KDS board
    }),
    [orders],
  )

  const overdueCount = useMemo(
    () => orders.filter(o => elapsedMins(timerStart(o)) >= OVERDUE_MINS && o.status !== 'COMPLETED').length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orders, now],
  )

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Page content wrapper (matches Dashboard padding) ── */}
      <div className="shrink-0 space-y-4 px-5 pt-5 pb-4 sm:px-6">
        <PageHeader
          title="Kitchen Display"
          subtitle="Station-grouped · real-time · tablet-ready"
          actions={
            overdueCount > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-3 py-1 text-xs font-semibold text-red-400 ring-1 ring-inset ring-red-500/30 animate-pulse tabular-nums">
                <AlertTriangle className="h-3.5 w-3.5" />
                {overdueCount} overdue (&gt;{OVERDUE_MINS}m)
              </span>
            ) : undefined
          }
        />

        {/* ── Stage tabs ── */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {STAGE_TABS.map(tab => {
            const count = tab.countKey ? stageCounts[tab.countKey] : stageCounts.ALL
            const isActive = activeStage === tab.key
            const Icon = tab.icon
            return (
              <button
                key={tab.key}
                onClick={() => setActiveStage(tab.key)}
                aria-pressed={isActive}
                className={[
                  'flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold',
                  'transition-colors duration-150 select-none min-h-[40px]',
                  isActive
                    ? 'bg-emerald-600/20 text-emerald-400 ring-1 ring-inset ring-emerald-500/40'
                    : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200',
                ].join(' ')}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
                <span
                  className={[
                    'inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 py-0.5',
                    'text-[11px] font-bold tabular-nums',
                    isActive
                      ? 'bg-emerald-500/25 text-emerald-300'
                      : 'bg-zinc-700/70 text-zinc-400',
                  ].join(' ')}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Divider ── */}
      <div className="shrink-0 border-t border-[#1F2A24]" />

      {/* ── Body ── */}
      {loading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-zinc-500">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-zinc-700 border-t-emerald-500" />
          <p className="text-sm">Loading kitchen orders…</p>
        </div>
      ) : error ? (
        <div className="flex flex-1 flex-col items-center justify-center p-8">
          <div className="w-full max-w-md rounded-xl border border-red-500/20 bg-red-500/10 p-6 text-center">
            <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-red-400" />
            <p className="text-sm font-semibold text-red-300">{error}</p>
            <p className="mt-1 text-xs text-red-500">Make sure the backend is running on :4000</p>
          </div>
        </div>
      ) : stations.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <EmptyState
            icon={ChefHat}
            title="No stations configured"
            description="Create kitchen stations via the API to enable the display."
            className="max-w-md"
          />
        </div>
      ) : (
        /* ── Station columns ── */
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div
            className="flex h-full gap-3 p-4 sm:gap-4"
            style={{ minWidth: `${Math.max(stations.length * 296, 100)}px` }}
          >
            {stations.map(station => {
              const col = stationOrders.get(station.id) ?? []
              const colOverdue = col.filter(
                o => elapsedMins(timerStart(o)) >= OVERDUE_MINS && o.status !== 'COMPLETED',
              ).length

              return (
                <section
                  key={station.id}
                  className="flex w-72 shrink-0 flex-col rounded-2xl border border-[#1F2A24] bg-[#0C1310] overflow-hidden shadow-xl"
                  aria-label={`${station.name} station`}
                >
                  {/* Station header */}
                  <div className="shrink-0 flex items-center justify-between border-b border-[#1F2A24] bg-[#121A17] px-4 py-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <ChefHat className="h-4 w-4 shrink-0 text-emerald-500" />
                      <h2 className="text-sm font-bold text-zinc-100 tracking-wide truncate">
                        {station.name}
                      </h2>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 pl-2">
                      {colOverdue > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-bold text-red-400 ring-1 ring-inset ring-red-500/30 animate-pulse tabular-nums">
                          <AlertTriangle className="h-2.5 w-2.5" />
                          {colOverdue}
                        </span>
                      )}
                      <span className="rounded-full bg-zinc-700/60 px-2 py-0.5 text-[11px] font-bold text-zinc-300 tabular-nums">
                        {col.length}
                      </span>
                    </div>
                  </div>

                  {/* Order cards */}
                  <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
                    {col.length === 0 ? (
                      <EmptyState
                        icon={CheckCircle2}
                        title="No active orders"
                        description={activeStage !== 'ALL' ? `No ${activeStage.toLowerCase()} orders at this station` : undefined}
                        className="mt-4 border-[#1F2A24] bg-transparent"
                      />
                    ) : (
                      col.map(order => (
                        <OrderCard
                          key={order.id}
                          order={order}
                          brand={brandMap.get(order.brandId)}
                          stationId={station.id}
                          now={now}
                          onAdvance={id => void handleAdvance(id)}
                          onCancel={handleCancel}
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
    </div>
  )
}
