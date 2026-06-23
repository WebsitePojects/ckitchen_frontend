/**
 * Dashboard — Unified Order Feed (FR-OD-01..07)
 *
 * Implements:
 *   FR-OD-01  One chronological feed across all brands + aggregators
 *   FR-OD-02  Brand color chip + aggregator badge (pink=FoodPanda, green=GrabFood)
 *   FR-OD-03  Real-time: order.created prepends; order.updated updates in place
 *   FR-OD-04  Distinct audible alert on order.created; mute toggle
 *   FR-OD-06  Filters by brand / aggregator / station / status + per-stage counts
 *   NFR-05    Responsive layout (phone / tablet / desktop)
 *
 * Business Rule #6: web app NEVER prints — only shows print-job status.
 * Business Rule #9: real-time within ~2 s; distinct audible alert.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { get } from '../lib/api'
import { getSocket, initSocket, onSocketEvent } from '../lib/socket'
import OrderCard from '../components/OrderCard'
import SimulatorPanel from '../components/SimulatorPanel'

// ─── Public types (consumed by OrderCard / SimulatorPanel) ────────────────────

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
  items: KotItem[]        // aggregated from print-job payloads (have item names)
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
 * We merge by name to collapse duplicates if the same item appears across stations.
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

// ─── Stage summary config ─────────────────────────────────────────────────────

const STAGES = ['NEW', 'PREPARING', 'READY', 'COMPLETED'] as const
type Stage = (typeof STAGES)[number]

const STAGE_STYLES: Record<Stage, string> = {
  NEW:       'bg-blue-100 text-blue-800 ring-blue-400',
  PREPARING: 'bg-amber-100 text-amber-800 ring-amber-400',
  READY:     'bg-emerald-100 text-emerald-800 ring-emerald-400',
  COMPLETED: 'bg-gray-100 text-gray-600 ring-gray-400',
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

interface Filters {
  brand_id: string
  aggregator: string
  status: string
  station_id: string
}

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
        // The prototype has one location; join via its UUID so we receive events.
        if (!getSocket()) initSocket()
        const socket = getSocket()
        if (socket && loadedBrands.length > 0) {
          socket.emit('join', loadedBrands[0].locationId)
        }

        // Sort newest-first, cap at 100 for initial load performance (FR-OD-07)
        rawOrders.sort((a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime())
        const toFetch = rawOrders.slice(0, 100)

        // Fetch full detail for each order in parallel (gets items + print-job status)
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
      // Backend emits { order_id, ... }; OrderPayload.id is a fallback alias
      const orderId = (payload['order_id'] as string | undefined) ?? payload.id
      if (!orderId) return

      // Audible alert — Business Rule #9
      if (!mutedRef.current) playBeep()

      // Fetch full detail (socket payload is summary-only, lacks items)
      void fetchOrderDetail(orderId).then(detail => {
        if (!detail) return
        setOrders(prev => {
          if (prev.some(o => o.id === detail.id)) return prev   // idempotent
          return [detail, ...prev]                              // prepend (newest first)
        })
      })
    })

    const unsubUpdated = onSocketEvent('order.updated', payload => {
      const orderId = (payload['order_id'] as string | undefined) ?? payload.id
      if (!orderId) return
      const newStatus = payload.status
      setOrders(prev =>
        prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o),
      )
    })

    const unsubPrint = onSocketEvent('print.status', payload => {
      const { job_id: jobId, status: jobStatus, error: jobError } = payload
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

    return () => {
      unsubCreated()
      unsubUpdated()
      unsubPrint()
    }
  }, []) // empty deps — mutedRef handles mute state without stale closure

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
    () =>
      STAGES.reduce<Record<Stage, number>>(
        (acc, s) => { acc[s] = orders.filter(o => o.status === s).length; return acc },
        { NEW: 0, PREPARING: 0, READY: 0, COMPLETED: 0 },
      ),
    [orders],
  )

  const hasActiveFilters = !!(filters.brand_id || filters.aggregator || filters.status || filters.station_id)

  function clearFilters() {
    setFilters({ brand_id: '', aggregator: '', status: '', station_id: '' })
  }

  function toggleStageFilter(stage: Stage) {
    setFilters(f => ({ ...f, status: f.status === stage ? '' : stage }))
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col overflow-hidden bg-gray-50">

      {/* ── Page header ── */}
      <header className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-5 py-3 sm:px-6">
        <div>
          <h1 className="text-lg font-bold text-gray-900 sm:text-xl">Unified Order Dashboard</h1>
          <p className="text-[11px] text-gray-400">All brands · All aggregators · Real-time</p>
        </div>

        {/* Mute toggle */}
        <button
          onClick={() => setMuted(m => !m)}
          aria-label={muted ? 'Unmute order alerts' : 'Mute order alerts'}
          title={muted ? 'Unmute order alerts' : 'Mute order alerts'}
          className={[
            'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border transition',
            muted
              ? 'border-gray-200 bg-gray-50 text-gray-400 hover:text-gray-600'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
          ].join(' ')}
        >
          {muted ? '🔇 Muted' : '🔔 Alert on'}
        </button>
      </header>

      {/* ── Main layout: feed + sidebar ── */}
      <div className="flex flex-1 overflow-hidden flex-col lg:flex-row">

        {/* ── Left: order feed ── */}
        <main className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 space-y-4 min-w-0">

          {/* Stage-count cards (clickable to filter) */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
            {STAGES.map(stage => (
              <button
                key={stage}
                onClick={() => toggleStageFilter(stage)}
                className={[
                  'rounded-xl p-3 text-center transition ring-2',
                  STAGE_STYLES[stage],
                  filters.status === stage ? 'ring-current' : 'ring-transparent hover:opacity-80',
                ].join(' ')}
              >
                <div className="text-3xl font-bold tabular-nums">{stageCounts[stage]}</div>
                <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide">{stage}</div>
              </button>
            ))}
          </div>

          {/* Filter bar */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Brand */}
            <select
              value={filters.brand_id}
              onChange={e => setFilters(f => ({ ...f, brand_id: e.target.value }))}
              className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">All Brands</option>
              {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>

            {/* Aggregator */}
            <select
              value={filters.aggregator}
              onChange={e => setFilters(f => ({ ...f, aggregator: e.target.value }))}
              className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">All Aggregators</option>
              <option value="FOODPANDA">FoodPanda</option>
              <option value="GRABFOOD">GrabFood</option>
              <option value="OTHER">Other</option>
            </select>

            {/* Status */}
            <select
              value={filters.status}
              onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
              className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">All Statuses</option>
              <option value="NEW">New</option>
              <option value="PREPARING">Preparing</option>
              <option value="READY">Ready</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>

            {/* Station */}
            <select
              value={filters.station_id}
              onChange={e => setFilters(f => ({ ...f, station_id: e.target.value }))}
              className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">All Stations</option>
              {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>

            {/* Clear */}
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="text-xs text-gray-400 underline hover:text-gray-700"
              >
                Clear filters
              </button>
            )}

            {/* Count */}
            <span className="ml-auto text-xs text-gray-400 tabular-nums">
              {filteredOrders.length} order{filteredOrders.length !== 1 ? 's' : ''}
              {filteredOrders.length !== orders.length ? ` of ${orders.length}` : ''}
            </span>
          </div>

          {/* ── Feed states ── */}
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <div className="mb-3 h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-brand-500" />
              <p className="text-sm">Loading orders…</p>
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
              <p className="text-sm font-medium text-red-700">{error}</p>
              <p className="mt-1 text-xs text-red-400">
                Make sure the backend is running on :4000
              </p>
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
              <p className="text-4xl mb-3" aria-hidden>📋</p>
              <p className="text-sm font-medium text-gray-600">No orders</p>
              <p className="mt-1 text-xs text-gray-400">
                {orders.length > 0
                  ? 'No orders match the active filters.'
                  : 'Start the simulator (right panel) or ingest an order manually.'}
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {filteredOrders.map(order => (
                <li key={order.id}>
                  <OrderCard order={order} brand={brandMap.get(order.brandId)} />
                </li>
              ))}
            </ul>
          )}
        </main>

        {/* ── Right: simulator sidebar ── */}
        <aside className="w-full shrink-0 border-t border-gray-200 bg-gray-50 p-4 lg:w-72 lg:border-t-0 lg:border-l">
          <SimulatorPanel brands={brands} />
        </aside>
      </div>
    </div>
  )
}
