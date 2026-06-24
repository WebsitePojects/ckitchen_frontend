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
import { useEffect, useMemo, useRef, useState } from 'react'
import {
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
import { getSocket, initSocket, onSocketEvent } from '../lib/socket'
import { Button } from '../components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import PageHeader from '../components/common/PageHeader'
import KpiCard from '../components/common/KpiCard'
import KpiRibbon from '../components/common/KpiRibbon'
import DataTable from '../components/common/DataTable'
import StatusBadge from '../components/common/StatusBadge'
import AggregatorBadge from '../components/common/AggregatorBadge'
import BrandChip from '../components/common/BrandChip'
import SimulatorPanel from '../components/SimulatorPanel'

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
  for (const job of printJobs) {
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

async function fetchOrderDetail(id: string): Promise<OrderDetail | null> {
  try {
    const { data } = await get<RawOrderDetail>(`/orders/${id}`)
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
      printJobs: data.print_jobs.map(j => ({
        id: j.id,
        status: j.status,
        stationId: j.stationId,
        error: j.error,
      })),
    }
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

// ─── Filters interface ────────────────────────────────────────────────────────

interface Filters {
  brand_id: string
  aggregator: string
  status: string
  station_id: string
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [orders, setOrders]     = useState<OrderDetail[]>([])
  const [brands, setBrands]     = useState<Brand[]>([])
  const [stations, setStations] = useState<Station[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [muted, setMuted]       = useState(false)
  const [filters, setFilters]   = useState<Filters>({ brand_id: '', aggregator: '', status: '', station_id: '' })

  // Keep muted state accessible inside stale socket callbacks
  const mutedRef = useRef(muted)
  mutedRef.current = muted

  const brandMap = useMemo(() => new Map(brands.map(b => [b.id, b])), [brands])

  // ── Initial data load ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      try {
        // Fetch brands, stations, and order list in parallel
        const [brandsRes, stationsRes, ordersRes] = await Promise.all([
          get<Brand[]>('/brands'),
          get<Station[]>('/stations'),
          get<RawOrder[]>('/orders'),
        ])
        if (cancelled) return

        const loadedBrands   = brandsRes.data
        const loadedStations = stationsRes.data
        const rawOrders      = ordersRes.data

        setBrands(loadedBrands)
        setStations(loadedStations)

        // Ensure socket is connected and joined to the correct location room.
        if (!getSocket()) initSocket()
        const socket = getSocket()
        if (socket && loadedBrands.length > 0) {
          socket.emit('join', loadedBrands[0].locationId)
        }

        // Sort newest-first, cap at 100 for initial load performance (FR-OD-07)
        rawOrders.sort((a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime())
        const toFetch = rawOrders.slice(0, 100)

        // Fetch full detail for each order in parallel
        const details = await Promise.all(toFetch.map(o => fetchOrderDetail(o.id)))
        if (cancelled) return

        const loaded = details.filter((d): d is OrderDetail => d !== null)
        loaded.sort((a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime())
        setOrders(loaded)
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : 'Failed to load orders.'
          setError(msg)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => { cancelled = true }
  }, [])

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
