import { useCallback, useEffect, useMemo, useState } from 'react'
import { ReceiptText, Clock, ClipboardEdit, Copy, Flame, PackageCheck, CheckCircle2, Search, Plus, Percent, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
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
import { outletScopedPath } from '../lib/outletScope'
import { useAuth } from '../auth/AuthContext'
import { hasRole } from '../auth/access'
import PageHeader from '../components/common/PageHeader'
import KpiCard from '../components/common/KpiCard'
import KpiRibbon from '../components/common/KpiRibbon'
import StatusBadge from '../components/common/StatusBadge'
import AggregatorBadge from '../components/common/AggregatorBadge'
import BrandChip from '../components/common/BrandChip'
import EmptyState from '../components/common/EmptyState'
import PageContainer from '../components/layout/PageContainer'
import WalkInOrderDialog from '../components/WalkInOrderDialog'
import LogOrderDialog from '../components/LogOrderDialog'
import OrderDiscountDialog from '../components/OrderDiscountDialog'
import DiscountApprovalsDialog from '../components/DiscountApprovalsDialog'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
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
  /**
   * Short human-friendly order code (e.g. "TOK-FP-7K3QD"). camelCase on REST
   * responses; socket payloads may send snake_case `order_code` — both are
   * optional/defensive: old rows (pre-backfill) and old deploys send neither.
   */
  orderCode?: string | null
  order_code?: string | null
  customerName: string | null
  status: string
  total: string
  placedAt: string
}

/** Display code for a row: short order code when present, external ref as fallback. */
function orderDisplayCode(o: Order): string {
  return o.orderCode ?? o.order_code ?? o.externalRef
}

const STATUSES = ['NEW', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED']

function fmtTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function Orders() {
  const { outlets, selectedOutletId } = useOutlet()
  const { user } = useAuth()
  // Walk-in manual order entry (MOTM 2026-06-24). Reuses the same gate style
  // as Menu.tsx's canWrite — OWNER passes automatically via hasRole's
  // short-circuit.
  const canCreateWalkIn = hasRole(user?.role, ['OUTLET_MANAGER', 'BRAND_MANAGER'])
  const [walkInOpen, setWalkInOpen] = useState(false)

  // Staff "Log order" manual encode (interim operations workflow,
  // 2026-07-22) — distinct from the walk-in dialog above: this is for
  // encoding an order that was ALREADY taken on a physical aggregator
  // device, keyed by that device's own order number. Visible to the same
  // staff roles that act on orders elsewhere (Kitchen.tsx's
  // ORDER_STAGE_ROLES = KITCHEN_CREW, plus this page's own
  // OUTLET_MANAGER/BRAND_MANAGER manual-entry roles above; OWNER always
  // passes via hasRole's short-circuit). The 409 INSUFFICIENT_STOCK oversell
  // override (S4, walk-in/OTHER channel only) is narrower — managers only,
  // mirroring canCreateWalkIn — so a KITCHEN_CREW operator can log orders
  // but not force an oversell.
  const canLogOrder = hasRole(user?.role, ['OUTLET_MANAGER', 'BRAND_MANAGER', 'KITCHEN_CREW'])
  const canOversellLogOrder = hasRole(user?.role, ['OUTLET_MANAGER', 'BRAND_MANAGER'])
  const [logOrderOpen, setLogOrderOpen] = useState(false)

  // Discount + 3-layer approval UI (live backend, 2026-07-08). Additive to
  // this page — does not touch the socket/refetch effects above. Approvals
  // queue is gated to OUTLET_MANAGER+ (OWNER passes automatically via
  // hasRole's short-circuit), matching the backend's own SUPERVISOR-level
  // approval gate.
  const canApproveDiscounts = hasRole(user?.role, ['OUTLET_MANAGER'])
  const [discountOrder, setDiscountOrder] = useState<Order | null>(null)
  const [approvalsOpen, setApprovalsOpen] = useState(false)
  const [pendingDiscountCount, setPendingDiscountCount] = useState(0)

  const refreshPendingDiscountCount = useCallback(async () => {
    if (!canApproveDiscounts) return
    try {
      const res = await get<{ id: string }[]>('/discounts/approvals', { params: { status: 'PENDING' } })
      setPendingDiscountCount(res.data.length)
    } catch {
      // Soft-fail — the badge just won't update this cycle; not worth surfacing a toast for.
    }
  }, [canApproveDiscounts])

  useEffect(() => {
    void refreshPendingDiscountCount()
  }, [refreshPendingDiscountCount])

  function handleDiscountDialogChange(next: boolean) {
    if (!next) {
      setDiscountOrder(null)
      void refreshPendingDiscountCount()
    }
  }

  function handleApprovalsDialogChange(next: boolean) {
    setApprovalsOpen(next)
    if (!next) void refreshPendingDiscountCount()
  }

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
        get<Brand[]>(outletScopedPath('/brands', selectedOutletId)),
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
        get<Brand[]>(outletScopedPath('/brands', selectedOutletId)),
      ])
      setOrders(ordersRes.data)
      setBrands(Object.fromEntries(brandsRes.data.map((x) => [x.id, x])))
    } catch {
      // Soft-fail — see comment above.
    }
    // selectedOutletId must be a dep — it's read in the body via
    // outletScopedPath (Brand fetch), so an empty dep array here would close
    // over a stale outlet forever after the first render.
  }, [selectedOutletId])

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

  // Copy the row's order code (or external-ref fallback) to the clipboard.
  const copyOrderCode = useCallback(async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      toast.success('Order code copied')
    } catch {
      toast.error('Could not copy to clipboard')
    }
  }, [])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return orders
      .filter((o) => statusFilter === 'ALL' || o.status === statusFilter)
      .filter((o) => {
        if (!q) return true
        const brand = brands[o.brandId]?.name ?? ''
        return (
          o.externalRef.toLowerCase().includes(q) ||
          (o.orderCode ?? o.order_code ?? '').toLowerCase().includes(q) ||
          brand.toLowerCase().includes(q) ||
          (o.customerName ?? '').toLowerCase().includes(q)
        )
      })
      .sort((a, b) => +new Date(b.placedAt) - +new Date(a.placedAt))
  }, [orders, brands, statusFilter, search])

  return (
    <PageContainer>
      <PageHeader
        title="Orders"
        subtitle="Every order across all brands and platforms"
        actions={
          canApproveDiscounts || canCreateWalkIn || canLogOrder ? (
            <>
              {canApproveDiscounts && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setApprovalsOpen(true)}
                  className="gap-1.5"
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Approvals
                  {pendingDiscountCount > 0 && (
                    <Badge className="h-5 min-w-5 justify-center rounded-full border-transparent bg-amber-500/20 px-1.5 text-[10px] text-amber-300">
                      {pendingDiscountCount}
                    </Badge>
                  )}
                </Button>
              )}
              {canLogOrder && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setLogOrderOpen(true)}
                  className="gap-1.5"
                >
                  <ClipboardEdit className="h-3.5 w-3.5" />
                  Log order
                </Button>
              )}
              {canCreateWalkIn && (
                <Button
                  size="sm"
                  onClick={() => setWalkInOpen(true)}
                  className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-500"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New Walk-in Order
                </Button>
              )}
            </>
          ) : undefined
        }
      />

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
                <TableHead className="text-right">Discount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((o) => (
                // P1: a new order arriving live is a freshly-keyed row, so it
                // animates in on mount (stable keys mean existing rows never
                // re-animate on a re-sort/refetch).
                <TableRow key={o.id} className="border-border animate-in fade-in slide-in-from-top-1 duration-500">
                  <TableCell className="font-mono text-xs text-zinc-300">
                    <span className="inline-flex items-center gap-1">
                      {orderDisplayCode(o)}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => void copyOrderCode(orderDisplayCode(o))}
                        aria-label={`Copy order code ${orderDisplayCode(o)}`}
                        title="Copy order code"
                        className="h-5 w-5 shrink-0 text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-200"
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-zinc-400">{fmtTime(o.placedAt)}</TableCell>
                  <TableCell><AggregatorBadge aggregator={o.aggregator} /></TableCell>
                  <TableCell><BrandChip brand={brands[o.brandId]} /></TableCell>
                  <TableCell className="text-sm text-zinc-300">{o.customerName ?? '—'}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums text-zinc-100">
                    ₱{Number(o.total ?? 0).toLocaleString()}
                  </TableCell>
                  <TableCell><StatusBadge status={o.status} /></TableCell>
                  <TableCell className="text-right">
                    {/* Manual discounts are walk-in (OTHER) only — the backend
                        409s AGGREGATOR_ORDER for FOODPANDA/GRABFOOD, whose
                        totals come from the platform. Omitted entirely (no
                        disabled stub) for aggregator orders. */}
                    {o.aggregator === 'OTHER' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 px-2 text-xs"
                        onClick={() => setDiscountOrder(o)}
                      >
                        <Percent className="h-3 w-3" />
                        Discount
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Controlled dialog — no trigger of its own; opened via the header button above. */}
      <WalkInOrderDialog open={walkInOpen} onOpenChange={setWalkInOpen} />

      {/* Staff manual encode — controlled dialog, opened via the header "Log order" button. */}
      <LogOrderDialog
        open={logOrderOpen}
        onOpenChange={setLogOrderOpen}
        canOversell={canOversellLogOrder}
      />

      {/* Per-order discount apply/view — opened via each row's "Discount" button. */}
      <OrderDiscountDialog
        order={discountOrder}
        open={!!discountOrder}
        onOpenChange={handleDiscountDialogChange}
        onChanged={refreshPendingDiscountCount}
      />

      {/* Supervisor/Admin approval queue — opened via the toolbar "Approvals" button. */}
      <DiscountApprovalsDialog
        open={approvalsOpen}
        onOpenChange={handleApprovalsDialogChange}
        onChanged={refreshPendingDiscountCount}
      />
    </PageContainer>
  )
}
