import { useCallback, useEffect, useMemo, useState } from 'react'
import { ReceiptText, Clock, Flame, PackageCheck, CheckCircle2, Search } from 'lucide-react'
import { get } from '../lib/api'
import {
  getSocket,
  initSocket,
  joinLocation,
  joinLocations,
  onSocketEvent,
  onSocketReconnect,
} from '../lib/socket'
import { useOutlet } from '../context/OutletContext'
import PageHeader from '../components/common/PageHeader'
import KpiCard from '../components/common/KpiCard'
import KpiRibbon from '../components/common/KpiRibbon'
import StatusBadge from '../components/common/StatusBadge'
import AggregatorBadge from '../components/common/AggregatorBadge'
import BrandChip from '../components/common/BrandChip'
import EmptyState from '../components/common/EmptyState'
import PageContainer from '../components/layout/PageContainer'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table'

interface Brand {
  id: string
  name: string
  color: string
  isActive: boolean
}
interface Order {
  id: string
  brandId: string
  aggregator: string
  externalRef: string
  customerName: string | null
  status: string
  total: string
  placedAt: string
}

const STATUSES = ['NEW', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED']

function fmtTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function Orders() {
  const { outlets, selectedOutletId } = useOutlet()
  const [orders, setOrders] = useState<Order[]>([])
  const [brands, setBrands] = useState<Record<string, Brand>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [search, setSearch] = useState('')

  // ── Initial load ──────────────────────────────────────────────────────────
  // Wrapped in useCallback so it can also re-run when the outlet switcher
  // changes (selectedOutletId/outlets are in its deps — same M2 pattern as
  // useKitchenOrders.ts): a specific outlet joins exactly that outlet's
  // socket room; 'ALL' (HQ-scope viewers) joins every outlet's room. This
  // ALSO toggles `loading`, showing the "Loading orders…" placeholder — that
  // is correct for a genuinely fresh fetch (mount, or an outlet switch) but
  // NOT for a live realtime refresh, which must update the table in place
  // without flashing a reload — see `refetchSilently` below for that case.
  const load = useCallback(async (cancelledRef?: { current: boolean }) => {
    setLoading(true)
    setError(null)
    try {
      const [ordersRes, brandsRes] = await Promise.all([
        get<Order[]>('/orders'),
        get<Brand[]>('/brands'),
      ])
      if (cancelledRef?.current) return
      setOrders(ordersRes.data)
      setBrands(Object.fromEntries(brandsRes.data.map((x) => [x.id, x])))

      // Ensure the socket is connected + joined to the room(s) for the
      // selected outlet (mirrors useKitchenOrders.ts's M2 fix) so
      // order.created/order.updated events for the right outlet(s) actually
      // reach this page.
      if (!getSocket()) initSocket()
      if (selectedOutletId === 'ALL') {
        if (outlets.length > 0) joinLocations(outlets.map((o) => o.id))
      } else {
        joinLocation(selectedOutletId)
      }
    } catch (e) {
      if (!cancelledRef?.current) {
        setError(e instanceof Error ? e.message : 'Failed to load orders')
      }
    } finally {
      if (!cancelledRef?.current) setLoading(false)
    }
  }, [selectedOutletId, outlets])

  useEffect(() => {
    const cancelledRef = { current: false }
    void load(cancelledRef)
    return () => {
      cancelledRef.current = true
    }
  }, [load])

  // ── Background refetch (realtime events + reconnect) ────────────────────
  // Re-fetches the same list but WITHOUT touching `loading` — the table
  // already has data on screen, so a live update must patch it in place
  // (Business Rule #9: "real-time or it doesn't count" implies no visible
  // reload). Socket room membership is already established by `load` above
  // (and re-applied automatically on reconnect by lib/socket.ts), so this
  // doesn't need to repeat the join step. Soft-fails on error (keeps
  // whatever was last shown rather than blanking the page over a transient
  // background refresh failure) — the next event or reconnect gets another
  // chance.
  const refetchSilently = useCallback(async () => {
    try {
      const [ordersRes, brandsRes] = await Promise.all([
        get<Order[]>('/orders'),
        get<Brand[]>('/brands'),
      ])
      setOrders(ordersRes.data)
      setBrands(Object.fromEntries(brandsRes.data.map((x) => [x.id, x])))
    } catch {
      // Soft-fail — see comment above.
    }
  }, [])

  // A dropped-then-restored socket may have missed order.created/updated
  // events entirely — refetch to catch up (Business Rule #9).
  useEffect(() => {
    return onSocketReconnect(() => { void refetchSilently() })
  }, [refetchSilently])

  // order.created / order.updated → refetch the list. Debounced so a burst
  // of events (e.g. the simulator running at a high rate) coalesces into one
  // refetch instead of one per order.
  useEffect(() => {
    const debounceHandle = { current: null as ReturnType<typeof setTimeout> | null }
    function scheduleRefetch() {
      if (debounceHandle.current) clearTimeout(debounceHandle.current)
      debounceHandle.current = setTimeout(() => { void refetchSilently() }, 300)
    }
    const unsubCreated = onSocketEvent('order.created', scheduleRefetch)
    const unsubUpdated = onSocketEvent('order.updated', scheduleRefetch)
    return () => {
      if (debounceHandle.current) clearTimeout(debounceHandle.current)
      unsubCreated()
      unsubUpdated()
    }
  }, [refetchSilently])

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const o of orders) c[o.status] = (c[o.status] ?? 0) + 1
    return c
  }, [orders])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return orders
      .filter((o) => statusFilter === 'ALL' || o.status === statusFilter)
      .filter((o) => {
        if (!q) return true
        const brand = brands[o.brandId]?.name ?? ''
        return (
          o.externalRef.toLowerCase().includes(q) ||
          brand.toLowerCase().includes(q) ||
          (o.customerName ?? '').toLowerCase().includes(q)
        )
      })
      .sort((a, b) => +new Date(b.placedAt) - +new Date(a.placedAt))
  }, [orders, brands, statusFilter, search])

  return (
    <PageContainer>
      <PageHeader title="Orders" subtitle="Every order across all brands and platforms" />

      <KpiRibbon>
        <KpiCard icon={ReceiptText} label="Total Orders" value={orders.length} />
        <KpiCard icon={Clock} label="New" value={counts.NEW ?? 0} />
        <KpiCard icon={Flame} label="Preparing" value={counts.PREPARING ?? 0} />
        <KpiCard icon={CheckCircle2} label="Ready" value={counts.READY ?? 0} />
        <KpiCard icon={PackageCheck} label="Completed" value={counts.COMPLETED ?? 0} />
      </KpiRibbon>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-500" />
          <Input
            placeholder="Search order #, brand, customer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-72 pl-8"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-zinc-500">{rows.length} shown</span>
      </div>

      <Card className="border-border bg-card">
        {loading ? (
          <p className="p-6 text-sm text-zinc-500">Loading orders…</p>
        ) : error ? (
          <p className="p-6 text-sm text-red-400">{error}</p>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title="No orders"
            description="Start the simulator on the Dashboard to generate orders."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead>Order #</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>Brand</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((o) => (
                <TableRow key={o.id} className="border-border">
                  <TableCell className="font-mono text-xs text-zinc-300">{o.externalRef}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-zinc-400">{fmtTime(o.placedAt)}</TableCell>
                  <TableCell><AggregatorBadge aggregator={o.aggregator} /></TableCell>
                  <TableCell><BrandChip brand={brands[o.brandId]} /></TableCell>
                  <TableCell className="text-sm text-zinc-300">{o.customerName ?? '—'}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums text-zinc-100">
                    ₱{Number(o.total ?? 0).toLocaleString()}
                  </TableCell>
                  <TableCell><StatusBadge status={o.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </PageContainer>
  )
}
