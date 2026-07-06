/**
 * Dashboard — Unified Order Feed (FR-OD-01..07)  [Reskin: M1 dark mockup]
 *
 * Implements:
 *   FR-OD-01  One chronological feed across all brands + aggregators
 *   FR-OD-02  Brand color chip + aggregator badge (pink=FoodPanda, green=GrabFood)
 *   FR-OD-03  Real-time: order.created prepends; order.updated updates in place
 *   FR-OD-04  Distinct audible alert on order.created; mute toggle
 *   FR-OD-06  Filters by brand / aggregator / status + per-stage counts
 *   NFR-05    Responsive layout (phone / tablet / desktop)
 *
 * Business Rule #6: web app NEVER prints — only shows print-job status.
 * Business Rule #9: real-time within ~2 s; distinct audible alert.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  BarChart3,
  Bell,
  BellOff,
  CheckCircle2,
  Clock,
  Flame,
  PackageCheck,
  ReceiptText,
  XCircle,
} from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { toast } from 'sonner'
import { get } from '../lib/api'
import { getSocket, initSocket, joinLocation, onSocketEvent, onSocketReconnect } from '../lib/socket'
import { useOutlet } from '../context/OutletContext'
import { Button } from '../components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Skeleton } from '../components/ui/skeleton'
import PageHeader from '../components/common/PageHeader'
import KpiCard from '../components/common/KpiCard'
import KpiRibbon from '../components/common/KpiRibbon'
import DataTable from '../components/common/DataTable'
import StatusBadge from '../components/common/StatusBadge'
import AggregatorBadge from '../components/common/AggregatorBadge'
import BrandChip from '../components/common/BrandChip'
import EmptyState from '../components/common/EmptyState'
import SimulatorPanel from '../components/SimulatorPanel'
import { AGGREGATOR_COLOR, AGGREGATOR_LABEL, CHART_SINGLE, type Aggregator } from '../lib/theme'

// ─── Public types (consumed by SimulatorPanel) ────────────────────────────────

export interface Brand {
  id: string
  name: string
  color: string
  isActive: boolean
  locationId: string
  salesPerfId: string
}

export interface Station {
  id: string
  name: string
  locationId: string
  defaultPrinterId: string | null
}

export interface KotItem {
  qty: number
  name: string
  notes?: string | null
}

export interface PrintJobSummary {
  id: string
  status: 'PENDING' | 'PRINTED' | 'FAILED'
  stationId: string
  error: string | null
}

export interface OrderDetail {
  id: string
  brandId: string
  aggregator: 'FOODPANDA' | 'GRABFOOD' | 'OTHER'
  externalRef: string
  customerName: string | null
  status: 'NEW' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED'
  total: string
  placedAt: string
  items: KotItem[]
  printJobs: PrintJobSummary[]
}

// ─── Internal raw shapes from the API ────────────────────────────────────────

interface RawOrder {
  id: string
  brandId: string
  aggregator: 'FOODPANDA' | 'GRABFOOD' | 'OTHER'
  externalRef: string
  customerName: string | null
  status: 'NEW' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED'
  total: string
  placedAt: string
}

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

interface RawOrderDetail extends RawOrder {
  items: Array<{ id: string; menuItemId: string; qty: number; stationId: string; notes: string | null }>
  print_jobs: RawPrintJob[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Aggregate item names + quantities across all print-job payloads for an order.
 * Items in the KOT payload have names; raw order_items only have menuItemId.
 */
function aggregateItems(printJobs: RawPrintJob[]): KotItem[] {
  const map = new Map<string, KotItem>()
  // Defensive: a malformed/partial payload could have print_jobs missing — never
  // let one bad order crash the whole dashboard with "X is not iterable".
  for (const job of Array.isArray(printJobs) ? printJobs : []) {
    for (const item of job.payload?.items ?? []) {
      const existing = map.get(item.name)
      if (existing) {
        map.set(item.name, { ...existing, qty: existing.qty + item.qty })
      } else {
        map.set(item.name, { qty: item.qty, name: item.name, notes: item.notes ?? null })
      }
    }
  }
  return [...map.values()]
}

function toOrderDetail(data: RawOrderDetail): OrderDetail {
  return {
    id: data.id,
    brandId: data.brandId,
    aggregator: data.aggregator,
    externalRef: data.externalRef,
    customerName: data.customerName,
    status: data.status,
    total: data.total,
    placedAt: data.placedAt,
    items: aggregateItems(data.print_jobs),
    printJobs: (Array.isArray(data.print_jobs) ? data.print_jobs : []).map(j => ({
      id: j.id,
      status: j.status,
      stationId: j.stationId,
      error: j.error,
    })),
  }
}

/** Per-event detail fetch (order.created/order.updated socket handlers) — one request per
 *  live event is fine (Business Rule #9); the N+1 this file used to have was the INITIAL
 *  load fetching this once per order on the board (see load() below, now a single bulk call). */
async function fetchOrderDetail(id: string): Promise<OrderDetail | null> {
  try {
    const { data } = await get<RawOrderDetail>(`/orders/${id}`)
    return toOrderDetail(data)
  } catch {
    return null
  }
}

// ─── Audio alert (Business Rule #9: distinct audible alert on order.created) ──

function playBeep(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor = (window.AudioContext ?? (window as any).webkitAudioContext) as typeof AudioContext | undefined
    if (!Ctor) return
    const ctx = new Ctor()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    // Two-tone "ding-dong" kitchen alert
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.18)
    gain.gain.setValueAtTime(0.35, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.45)
    osc.onended = () => { void ctx.close() }
  } catch {
    // Web Audio unavailable or blocked — fail silently
  }
}

// ─── Time helpers ─────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function formatElapsed(isoStart: string): string {
  const secs = Math.floor((Date.now() - new Date(isoStart).getTime()) / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

function hourLabel(h: number): string {
  if (h === 0)  return '12am'
  if (h < 12)   return `${h}am`
  if (h === 12) return '12pm'
  return `${h - 12}pm`
}

// ─── Chart shared styles (LOCKED W4a palette — see lib/theme.ts) ──────────────
// Same grid/tooltip/skeleton treatment as Analytics.tsx for cross-page consistency.

const CHART_GRID = '#27272a'
const CHART_TICK = '#71717A' // zinc-500
const CHART_TOOLTIP_STYLE = {
  background: '#18181b',
  border: '1px solid #27272a',
  borderRadius: 8,
}
const CHART_CURSOR_FILL = 'rgba(16,185,129,0.06)'

// ─── Filters interface ────────────────────────────────────────────────────────

interface Filters {
  brand_id: string
  aggregator: string
  status: string
  station_id: string
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { selectedOutletId } = useOutlet()
  const [orders, setOrders]     = useState<OrderDetail[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [muted, setMuted]       = useState(false)
  const [filters, setFilters]   = useState<Filters>({ brand_id: '', aggregator: '', status: '', station_id: '' })

  // Keep muted state accessible inside stale socket callbacks
  const mutedRef = useRef(muted)
  mutedRef.current = muted

  // ── Cache-first summary data (perf) ─────────────────────────────────────
  // Brands/stations rarely change — same query keys as Brands.tsx / Menu.tsx
  // / Inventory.tsx so navigating here reuses their cache entry instead of
  // refetching. This is the "Dashboard summary data" half of the migration;
  // the order feed below stays on the realtime socket-driven path (Business
  // Rule #9), NOT useQuery.
  const { data: brands = [] } = useQuery({
    queryKey: ['brands', selectedOutletId],
    queryFn: async () => (await get<Brand[]>('/brands')).data,
  })
  const { data: stations = [] } = useQuery({
    queryKey: ['stations', selectedOutletId],
    queryFn: async () => (await get<Station[]>('/stations')).data,
  })

  const brandMap = useMemo(() => new Map(brands.map(b => [b.id, b])), [brands])

  // ── Initial data load (orders — the realtime feed) ─────────────────────────
  // Wrapped in useCallback (stable identity, no external deps — it fetches
  // orders fresh from the API every call) so it can also be re-invoked on
  // socket reconnect to catch up on any missed events (Business Rule #9).
  // Perf fix (N+1 KDS fetch): this used to fetch a plain order-summary list,
  // sort/cap it at 100, then `Promise.all(toFetch.map(o =>
  // fetchOrderDetail(o.id)))` — up to 100 extra sequential-latency round
  // trips just to hydrate items/print_jobs for the feed. `?detail=1`
  // bulk-hydrates every order's items[]/print_jobs[] in the SAME response
  // (O(1) extra queries server-side — see listOrdersWithDetail in
  // ckitchen_backend's orders/service.ts), so this is now a single request.
  const load = useCallback(async (cancelledRef?: { current: boolean }) => {
    setLoading(true)
    setError(null)

    try {
      const { data: rawOrders } = await get<RawOrderDetail[]>('/orders?detail=1')
      if (cancelledRef?.current) return

      // Defensive: never assume the body is an array (a proxy/edge error page, a
      // partial response on a cold backend, etc. could yield a non-array) — a
      // bad body must not crash the dashboard with "X is not iterable".
      const list = Array.isArray(rawOrders) ? rawOrders : []
      // Sort newest-first, cap at 100 for initial load performance (FR-OD-07)
      // — same cap as before, just applied to the already-detailed rows
      // instead of gating which orders get a follow-up detail fetch.
      list.sort((a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime())
      const loaded = list.slice(0, 100).map(toOrderDetail)
      setOrders(loaded)
    } catch (e) {
      if (!cancelledRef?.current) {
        const msg = e instanceof Error ? e.message : 'Failed to load orders.'
        setError(msg)
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

  // ── Socket connect + room join ──────────────────────────────────────────
  // Runs whenever `brands` (from the cache-first query above) changes — this
  // covers the initial load regardless of whether brands or orders resolves
  // first, now that they're no longer a single Promise.all.
  useEffect(() => {
    if (brands.length === 0) return
    if (!getSocket()) initSocket()
    joinLocation(brands[0].locationId)
  }, [brands])

  // ── Reconnect recovery ─────────────────────────────────────────────────────
  // A dropped-then-restored socket may have missed order.created/updated
  // events entirely — refetch orders AND rejoin the room (a reconnected
  // socket has left every room server-side) to catch up (Business Rule #9).
  useEffect(() => {
    return onSocketReconnect(() => {
      if (brands.length > 0) {
        if (!getSocket()) initSocket()
        joinLocation(brands[0].locationId)
      }
      void load()
    })
  }, [load, brands])

  // ── Socket subscriptions (FR-OD-03, FR-OD-04) ────────────────────────────
  useEffect(() => {
    const unsubCreated = onSocketEvent('order.created', payload => {
      const orderId = payload.order_id
      if (!orderId) return

      // Audible alert — Business Rule #9
      if (!mutedRef.current) playBeep()

      void fetchOrderDetail(orderId).then(detail => {
        if (!detail) return
        setOrders(prev => {
          if (prev.some(o => o.id === detail.id)) return prev
          return [detail, ...prev]
        })
      })
    })

    const unsubUpdated = onSocketEvent('order.updated', payload => {
      const orderId = payload.order_id
      if (!orderId) return
      const newStatus = payload.status
      setOrders(prev =>
        prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o),
      )
    })

    const unsubPrint = onSocketEvent('print.status', payload => {
      const { print_job_id: jobId, status: jobStatus, error: jobError } = payload
      setOrders(prev =>
        prev.map(o => {
          if (!o.printJobs.some(j => j.id === jobId)) return o
          return {
            ...o,
            printJobs: o.printJobs.map(j =>
              j.id === jobId
                ? { ...j, status: jobStatus, error: jobError ?? j.error }
                : j,
            ),
          }
        }),
      )
    })

    // Low-stock alert toast (FR-OD-XX)
    const unsubLowStock = onSocketEvent('lowstock.alert', payload => {
      toast.warning('Low stock alert', {
        description: `${payload.ingredientName} is running low (${payload.quantity} remaining, threshold: ${payload.threshold}).`,
      })
    })

    return () => {
      unsubCreated()
      unsubUpdated()
      unsubPrint()
      unsubLowStock()
    }
  }, [])

  // ── Derived state ─────────────────────────────────────────────────────────

  const filteredOrders = useMemo(() => {
    return orders.filter(o => {
      if (filters.brand_id   && o.brandId    !== filters.brand_id)   return false
      if (filters.aggregator && o.aggregator !== filters.aggregator)  return false
      if (filters.status     && o.status     !== filters.status)      return false
      if (filters.station_id) {
        const hasStation = o.printJobs.some(j => j.stationId === filters.station_id)
        if (!hasStation) return false
      }
      return true
    })
  }, [orders, filters])

  const stageCounts = useMemo(
    () => ({
      NEW:       orders.filter(o => o.status === 'NEW').length,
      PREPARING: orders.filter(o => o.status === 'PREPARING').length,
      READY:     orders.filter(o => o.status === 'READY').length,
      COMPLETED: orders.filter(o => o.status === 'COMPLETED').length,
    }),
    [orders],
  )

  // ── Chart data (derived client-side from the already-loaded `orders` +
  //    `brands` state — no extra endpoints/GETs) ─────────────────────────────

  /** Today's orders bucketed by hour-of-day (local time), 24-hour scaffold. */
  const hourlyData = useMemo(() => {
    const todayKey = new Date().toDateString()
    const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }))
    for (const o of orders) {
      const placed = new Date(o.placedAt)
      if (placed.toDateString() !== todayKey) continue
      buckets[placed.getHours()].count += 1
    }
    return buckets
  }, [orders])
  const hasOrdersToday = hourlyData.some(d => d.count > 0)

  /** Aggregator split across the loaded order set (fixed brand colors, D-locked). */
  const aggregatorData = useMemo(() => {
    const counts: Record<Aggregator, number> = { FOODPANDA: 0, GRABFOOD: 0, OTHER: 0 }
    for (const o of orders) {
      const key = (o.aggregator in counts ? o.aggregator : 'OTHER') as Aggregator
      counts[key] += 1
    }
    return (Object.keys(counts) as Aggregator[])
      .map(agg => ({ aggregator: agg, name: AGGREGATOR_LABEL[agg], value: counts[agg], color: AGGREGATOR_COLOR[agg] }))
      .filter(d => d.value > 0)
  }, [orders])

  /** Top 6 brands by order count (single-hue bar — never rainbow one measure). */
  const topBrandsData = useMemo(() => {
    const counts = new Map<string, number>()
    for (const o of orders) counts.set(o.brandId, (counts.get(o.brandId) ?? 0) + 1)
    return [...counts.entries()]
      .map(([brandId, count]) => ({ brandId, name: brandMap.get(brandId)?.name ?? 'Unknown', count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)
  }, [orders, brandMap])

  const hasActiveFilters = !!(filters.brand_id || filters.aggregator || filters.status || filters.station_id)

  function clearFilters() {
    setFilters({ brand_id: '', aggregator: '', status: '', station_id: '' })
  }

  // ── Table columns (memoized; captures brandMap via closure) ───────────────

  const columns = useMemo<ColumnDef<OrderDetail, unknown>[]>(
    () => [
      {
        accessorKey: 'externalRef',
        header: 'Order #',
        cell: ({ row }) => (
          <span className="font-mono text-xs tabular-nums text-zinc-200">
            {row.original.externalRef}
          </span>
        ),
      },
      {
        accessorKey: 'placedAt',
        header: 'Time',
        sortingFn: 'datetime',
        cell: ({ row }) => (
          <span className="tabular-nums text-xs text-zinc-400">
            <span className="block">{formatTime(row.original.placedAt)}</span>
            <span className="text-zinc-600">{formatDate(row.original.placedAt)}</span>
          </span>
        ),
      },
      {
        accessorKey: 'aggregator',
        header: 'Platform',
        cell: ({ row }) => (
          <AggregatorBadge aggregator={row.original.aggregator} />
        ),
      },
      {
        id: 'brand',
        header: 'Brand',
        enableSorting: false,
        cell: ({ row }) => (
          <BrandChip brand={brandMap.get(row.original.brandId)} />
        ),
      },
      {
        accessorKey: 'customerName',
        header: 'Customer',
        cell: ({ row }) => (
          <span className="text-sm text-zinc-300">
            {row.original.customerName ?? '—'}
          </span>
        ),
      },
      {
        id: 'items',
        header: 'Items',
        enableSorting: false,
        cell: ({ row }) => {
          const totalQty = row.original.items.reduce((s, i) => s + i.qty, 0)
          return (
            <span className="tabular-nums text-sm text-zinc-400">
              {totalQty > 0 ? totalQty : '—'}
            </span>
          )
        },
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <StatusBadge status={row.original.status} />
        ),
      },
      {
        id: 'prep',
        header: 'Prep',
        enableSorting: false,
        cell: ({ row }) => {
          const { status, placedAt } = row.original
          if (status === 'COMPLETED' || status === 'CANCELLED') {
            return <span className="text-zinc-600 text-xs">—</span>
          }
          return (
            <span className="tabular-nums text-xs text-zinc-400">
              {formatElapsed(placedAt)}
            </span>
          )
        },
      },
    ],
    [brandMap],
  )

  // ── Render ────────────────────────────────────────────────────────────────

  // Error state (full-page)
  if (error) {
    return (
      <div className="flex min-h-full flex-col gap-6 px-4 py-6 sm:px-6">
        <PageHeader
          title="Unified Order Dashboard"
          subtitle="All orders across every brand & platform, in real time"
        />
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center">
          <p className="text-sm font-medium text-red-400">{error}</p>
          <p className="mt-1 text-xs text-red-500/70">
            Make sure the backend is running on :4000
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-full flex-col gap-6 px-4 py-6 sm:px-6">

      {/* ── Page header ────────────────────────────────────────────────────── */}
      <PageHeader
        title="Unified Order Dashboard"
        subtitle="All orders across every brand & platform, in real time"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMuted(m => !m)}
            aria-label={muted ? 'Unmute order alerts' : 'Mute order alerts'}
            className={
              muted
                ? 'border-zinc-700 text-zinc-400 hover:text-zinc-200'
                : 'border-emerald-500/40 text-emerald-400 hover:border-emerald-500/70 hover:text-emerald-300'
            }
          >
            {muted
              ? <><BellOff className="h-3.5 w-3.5" />Muted</>
              : <><Bell className="h-3.5 w-3.5" />Alert on</>
            }
          </Button>
        }
      />

      {/* ── KPI ribbon ─────────────────────────────────────────────────────── */}
      <KpiRibbon>
        <KpiCard
          icon={ReceiptText}
          label="Total Orders"
          value={orders.length}
        />
        <KpiCard
          icon={Clock}
          label="New"
          value={stageCounts.NEW}
        />
        <KpiCard
          icon={Flame}
          label="Preparing"
          value={stageCounts.PREPARING}
        />
        <KpiCard
          icon={CheckCircle2}
          label="Ready"
          value={stageCounts.READY}
        />
        <KpiCard
          icon={PackageCheck}
          label="Completed"
          value={stageCounts.COMPLETED}
        />
      </KpiRibbon>

      {/* ── Charts (W4a — Dashboard's biggest gap; derived client-side from the
          orders/brands state already fetched above, no new endpoints) ────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">

        {/* Orders today, by hour — single-measure area, brand emerald */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-zinc-100">Orders Today</CardTitle>
            <p className="mt-0.5 text-xs text-zinc-500">Hourly order volume, today</p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[240px] w-full rounded-xl" />
            ) : !hasOrdersToday ? (
              <EmptyState
                icon={BarChart3}
                title="No orders today yet"
                description="Today's orders will appear here by hour."
                className="border-none bg-transparent py-10"
              />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={hourlyData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                  <defs>
                    <linearGradient id="ordersTodayFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_SINGLE} stopOpacity={0.35} />
                      <stop offset="95%" stopColor={CHART_SINGLE} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                  <XAxis
                    dataKey="hour"
                    tickFormatter={hourLabel}
                    tick={{ fontSize: 10, fill: CHART_TICK }}
                    tickLine={false}
                    axisLine={{ stroke: CHART_GRID }}
                    interval={2}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: CHART_TICK }}
                    tickLine={false}
                    axisLine={false}
                    width={28}
                  />
                  <Tooltip
                    labelFormatter={label => hourLabel(Number(label))}
                    formatter={(v) => [`${v} orders`, '']}
                    contentStyle={CHART_TOOLTIP_STYLE}
                  />
                  <Area type="monotone" dataKey="count" stroke={CHART_SINGLE} strokeWidth={2} fill="url(#ordersTodayFill)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Aggregator split — fixed brand colors + legend + direct labels */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-zinc-100">Aggregator Split</CardTitle>
            <p className="mt-0.5 text-xs text-zinc-500">Loaded orders by platform</p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[240px] w-full rounded-xl" />
            ) : aggregatorData.length === 0 ? (
              <EmptyState
                icon={BarChart3}
                title="No orders yet"
                description="Platform share appears once orders come in."
                className="border-none bg-transparent py-10"
              />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={aggregatorData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={56}
                    outerRadius={86}
                    paddingAngle={3}
                    strokeWidth={0}
                    label={({ percent }) => `${((percent ?? 0) * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {aggregatorData.map(entry => (
                      <Cell key={entry.aggregator} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value, name) => [`${value} orders`, String(name)]}
                    contentStyle={CHART_TOOLTIP_STYLE}
                  />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    formatter={(value) => (
                      <span style={{ fontSize: 12, color: '#A1A1AA' }}>{value}</span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Top brands by order count — single-measure bar, brand emerald */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-zinc-100">Top Brands</CardTitle>
            <p className="mt-0.5 text-xs text-zinc-500">Orders by brand, top 6</p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[240px] w-full rounded-xl" />
            ) : topBrandsData.length === 0 ? (
              <EmptyState
                icon={BarChart3}
                title="No orders yet"
                description="Brand ranking appears once orders come in."
                className="border-none bg-transparent py-10"
              />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={topBrandsData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 10, fill: CHART_TICK }}
                    tickLine={false}
                    axisLine={{ stroke: CHART_GRID }}
                    interval={0}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: CHART_TICK }}
                    tickLine={false}
                    axisLine={false}
                    width={28}
                  />
                  <Tooltip
                    formatter={(v) => [`${v} orders`, 'Orders']}
                    contentStyle={CHART_TOOLTIP_STYLE}
                    cursor={{ fill: CHART_CURSOR_FILL }}
                  />
                  <Bar dataKey="count" fill={CHART_SINGLE} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Feed + Simulator ────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-col gap-4 lg:flex-row">

        {/* ── Order feed ─────────────────────────────────────────────────── */}
        <section className="flex min-w-0 flex-1 flex-col gap-3">

          {/* Filter bar */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Brand */}
            <Select
              value={filters.brand_id || '_all'}
              onValueChange={v => setFilters(f => ({ ...f, brand_id: v === '_all' ? '' : v }))}
            >
              <SelectTrigger className="h-8 w-36 text-xs">
                <SelectValue placeholder="All Brands" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All Brands</SelectItem>
                {brands.map(b => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Aggregator */}
            <Select
              value={filters.aggregator || '_all'}
              onValueChange={v => setFilters(f => ({ ...f, aggregator: v === '_all' ? '' : v }))}
            >
              <SelectTrigger className="h-8 w-36 text-xs">
                <SelectValue placeholder="All Platforms" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All Platforms</SelectItem>
                <SelectItem value="FOODPANDA">foodpanda</SelectItem>
                <SelectItem value="GRABFOOD">GrabFood</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>

            {/* Status */}
            <Select
              value={filters.status || '_all'}
              onValueChange={v => setFilters(f => ({ ...f, status: v === '_all' ? '' : v }))}
            >
              <SelectTrigger className="h-8 w-36 text-xs">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All Statuses</SelectItem>
                <SelectItem value="NEW">New</SelectItem>
                <SelectItem value="PREPARING">Preparing</SelectItem>
                <SelectItem value="READY">Ready</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
              </SelectContent>
            </Select>

            {/* Station */}
            {stations.length > 0 && (
              <Select
                value={filters.station_id || '_all'}
                onValueChange={v => setFilters(f => ({ ...f, station_id: v === '_all' ? '' : v }))}
              >
                <SelectTrigger className="h-8 w-36 text-xs">
                  <SelectValue placeholder="All Stations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All Stations</SelectItem>
                  {stations.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Clear */}
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="h-8 gap-1 text-xs text-zinc-400 hover:text-zinc-200"
              >
                <XCircle className="h-3.5 w-3.5" />
                Clear
              </Button>
            )}

            {/* Count */}
            <span className="ml-auto text-xs tabular-nums text-zinc-500">
              {filteredOrders.length} order{filteredOrders.length !== 1 ? 's' : ''}
              {filteredOrders.length !== orders.length ? ` of ${orders.length}` : ''}
            </span>
          </div>

          {/* DataTable */}
          <DataTable<OrderDetail>
            columns={columns}
            data={filteredOrders}
            loading={loading}
            searchPlaceholder="Search by order #, customer..."
            emptyTitle={hasActiveFilters ? 'No matching orders' : 'No orders yet'}
            emptyDescription={
              hasActiveFilters
                ? 'Try adjusting the filters above.'
                : 'Start the simulator in the panel on the right, or wait for a live order.'
            }
            pageSize={15}
          />
        </section>

        {/* ── Simulator panel ─────────────────────────────────────────────── */}
        <aside className="w-full shrink-0 lg:w-72">
          <SimulatorPanel brands={brands} />
        </aside>
      </div>
    </div>
  )
}
