/**
 * Merchant Console — the per-merchant Grab tablet / foodpanda phone
 * replacement screen (Documents/AGGREGATOR_API_INTEGRATION_SPEC.md §4
 * "Merchant console UI", §5 "Cutover plan"). One physical device today runs
 * one channel listing (a brand's Foodpanda or GrabFood listing at one
 * outlet); this page is ORION's device-zero equivalent — pick a listing in
 * the left rail, work its live order queue, control store pause and item
 * availability, all from one screen instead of 50 devices.
 *
 * `control_mode` (DEVICE | SHADOW | API — see lib/merchant-console-api.ts) is
 * the cutover gate from the spec's rollout plan: while a listing is still
 * DEVICE or SHADOW, ORION does not actually control it yet, so every write
 * action here (accept/reject/ready, pause/resume, availability) is disabled
 * with an inline explanation instead of silently doing nothing on a live
 * order — this is deliberate, not a bug: clicking Accept on a device-mode
 * listing would NOT accept the order on the aggregator.
 *
 * RBAC (spec §4 "Security" — "server-side RBAC (OWNER/OUTLET_MANAGER for
 * store pause; KITCHEN_CREW for order actions)"), mirrored client-side:
 *   - Store pause/resume  -> OWNER / OUTLET_MANAGER
 *   - Order actions       -> OWNER / KITCHEN_CREW
 *   - Item availability   -> OWNER / BRAND_MANAGER (matches Menu.tsx's
 *     existing availability-edit gate — auth/access.ts's PAGE_ROLES comment
 *     for '/menu' documents this precedent)
 * Page-level access (auth/access.ts PAGE_ROLES['/merchant-console']):
 * OUTLET_MANAGER, BRAND_MANAGER, KITCHEN_CREW (+ OWNER via hasRole's
 * short-circuit) — the union of everyone who can act here.
 *
 * Backend endpoints (lib/merchant-console-api.ts) are being built in
 * parallel — every call here can 404/fail at runtime; every fetch has a
 * loading/error/empty state and every mutation is wrapped in try/catch with
 * a toast, so a not-yet-live backend degrades gracefully instead of
 * crashing the page.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Building2,
  Check,
  Clock,
  Loader2,
  Package,
  PackageCheck,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Store,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../auth/AuthContext'
import type { UserRole } from '../auth/AuthContext'
import { hasRole } from '../auth/access'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import { Button } from '../components/ui/button'
import { Switch } from '../components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import AggregatorBadge from '../components/common/AggregatorBadge'
import BrandChip from '../components/common/BrandChip'
import EmptyState from '../components/common/EmptyState'
import { elapsedMMSS, timerStart, type KdsOrder } from '../lib/kds'
import { playNewOrderChime } from '../lib/kdsSound'
import { cn } from '../lib/utils'
import { useMerchantConsoleOrders } from '../hooks/useMerchantConsoleOrders'
import {
  fetchChannelListingItems,
  fetchChannelListings,
  pauseChannelListing,
  postChannelListingCommand,
  resumeChannelListing,
  setChannelListingItemAvailability,
  type ChannelListing,
  type ChannelListingItem,
  type ControlMode,
} from '../lib/merchant-console-api'

// ─── RBAC ──────────────────────────────────────────────────────────────────────

const PAUSE_ROLES: UserRole[] = ['OUTLET_MANAGER']
const ORDER_ACTION_ROLES: UserRole[] = ['KITCHEN_CREW']
const ITEM_AVAILABILITY_ROLES: UserRole[] = ['BRAND_MANAGER']

const PAUSE_DURATION_OPTIONS = [
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '60', label: '1 hour' },
  { value: '120', label: '2 hours' },
  { value: '1440', label: 'Rest of day' },
] as const

// ─── Control-mode chip ──────────────────────────────────────────────────────────

const CONTROL_MODE_STYLE: Record<ControlMode, string> = {
  DEVICE: 'bg-zinc-200 text-zinc-700 ring-zinc-500/20 dark:bg-zinc-500/15 dark:text-zinc-400 dark:ring-zinc-500/30',
  SHADOW: 'bg-amber-100 text-amber-800 ring-amber-600/20 dark:bg-amber-500/15 dark:text-amber-400 dark:ring-amber-500/30',
  API: 'bg-emerald-100 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/15 dark:text-emerald-400 dark:ring-emerald-500/30',
}

function ControlModeChip({ mode }: { mode: ControlMode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset',
        CONTROL_MODE_STYLE[mode],
      )}
      title={
        mode === 'API'
          ? 'ORION controls this listing directly'
          : mode === 'SHADOW'
            ? 'ORION reads orders read-only; the physical device is still authoritative'
            : 'This listing still runs on its physical device'
      }
    >
      <Radio className="h-2.5 w-2.5" aria-hidden />
      {mode}
    </span>
  )
}

// ─── Listing rail item ────────────────────────────────────────────────────────

interface ListingRailItemProps {
  listing: ChannelListing
  selected: boolean
  onSelect: () => void
}

function ListingRailItem({ listing, selected, onSelect }: ListingRailItemProps) {
  const dotClass =
    listing.status === 'ACTIVE'
      ? 'bg-emerald-500'
      : listing.status === 'PAUSED'
        ? 'bg-amber-500'
        : 'bg-zinc-400 dark:bg-zinc-600'

  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid="listing-rail-item"
      data-listing-id={listing.id}
      aria-pressed={selected}
      className={cn(
        'flex w-full min-h-[44px] flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-left transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50',
        selected
          ? 'border-emerald-500/50 bg-emerald-500/10'
          : 'border-transparent hover:bg-accent',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <BrandChip brand={listing.brand} />
        <span className="flex shrink-0 items-center gap-1">
          <span
            className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dotClass)}
            aria-hidden
          />
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {listing.status === 'ACTIVE' ? 'Live' : listing.status === 'PAUSED' ? 'Paused' : 'Inactive'}
          </span>
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <AggregatorBadge aggregator={listing.aggregator} />
        <ControlModeChip mode={listing.controlMode} />
      </div>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Building2 className="h-3 w-3 shrink-0" aria-hidden />
        <span className="truncate">{listing.outlet.name}</span>
      </div>
    </button>
  )
}

// ─── Order card ───────────────────────────────────────────────────────────────

interface OrderCardProps {
  order: KdsOrder
  now: number
  stage: 'NEW' | 'PREPARING' | 'READY'
  canAct: boolean
  disabledReason?: string
  busy: boolean
  onAccept: () => void
  onReject: () => void
  onMarkReady: () => void
}

const STAGE_ACCENT: Record<OrderCardProps['stage'], string> = {
  NEW: 'border-blue-500/40',
  PREPARING: 'border-amber-500/40',
  READY: 'border-emerald-500/40',
}

function OrderCard({ order, now: _now, stage, canAct, disabledReason, busy, onAccept, onReject, onMarkReady }: OrderCardProps) {
  const elapsed = elapsedMMSS(timerStart(order))
  const displayRef = order.orderCode ?? order.externalRef
  const itemSummary = order.items.map(i => `${i.qty}× ${i.name}`).join(', ')

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-xl border bg-card p-3 shadow-sm',
        STAGE_ACCENT[stage],
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold text-foreground">
          {order.customerName ?? 'Guest'}
        </span>
        <span className="flex shrink-0 items-center gap-1 font-mono text-sm font-bold tabular-nums text-muted-foreground">
          <Clock className="h-3.5 w-3.5" aria-hidden />
          {elapsed}
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="font-mono">{displayRef}</span>
      </div>
      {itemSummary && (
        <p className="text-xs leading-snug text-muted-foreground">{itemSummary}</p>
      )}

      {stage === 'READY' ? (
        <div className="mt-1 flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 py-2.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
          <PackageCheck className="h-3.5 w-3.5" aria-hidden />
          Awaiting pickup
        </div>
      ) : (
        <div className="mt-1 flex items-center gap-2">
          {stage === 'NEW' ? (
            <>
              <Button
                size="sm"
                disabled={!canAct || busy}
                onClick={onAccept}
                data-testid="order-accept-button"
                data-order-id={order.id}
                title={!canAct ? disabledReason : undefined}
                className="min-h-[44px] flex-1 bg-emerald-600 text-white hover:bg-emerald-500"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Accept
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!canAct || busy}
                onClick={onReject}
                data-testid="order-reject-button"
                data-order-id={order.id}
                title={!canAct ? disabledReason : undefined}
                className="min-h-[44px] flex-1 border-red-500/40 text-red-600 hover:bg-red-500/10 hover:text-red-500 dark:text-red-400"
              >
                <X className="h-4 w-4" />
                Reject
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              disabled={!canAct || busy}
              onClick={onMarkReady}
              data-testid="order-ready-button"
              data-order-id={order.id}
              title={!canAct ? disabledReason : undefined}
              className="min-h-[44px] w-full bg-amber-500 text-zinc-900 hover:bg-amber-400"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
              Mark ready
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Queue column ─────────────────────────────────────────────────────────────

interface QueueColumnProps {
  title: string
  stage: OrderCardProps['stage']
  orders: KdsOrder[]
  now: number
  canAct: boolean
  disabledReason?: string
  busyIds: Set<string>
  onAccept: (order: KdsOrder) => void
  onReject: (order: KdsOrder) => void
  onMarkReady: (order: KdsOrder) => void
}

function QueueColumn({ title, stage, orders, now, canAct, disabledReason, busyIds, onAccept, onReject, onMarkReady }: QueueColumnProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card/40">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2.5">
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums text-muted-foreground">
          {orders.length}
        </span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-2.5">
        {orders.length === 0 ? (
          <p className="pt-6 text-center text-xs text-muted-foreground">No {title.toLowerCase()} orders</p>
        ) : (
          orders.map(order => (
            <OrderCard
              key={order.id}
              order={order}
              now={now}
              stage={stage}
              canAct={canAct}
              disabledReason={disabledReason}
              busy={busyIds.has(order.id)}
              onAccept={() => onAccept(order)}
              onReject={() => onReject(order)}
              onMarkReady={() => onMarkReady(order)}
            />
          ))
        )}
      </div>
    </section>
  )
}

// ─── Items panel ──────────────────────────────────────────────────────────────

interface ItemsPanelProps {
  listing: ChannelListing
  canEdit: boolean
  disabledReason?: string
}

function ItemsPanel({ listing, canEdit, disabledReason }: ItemsPanelProps) {
  const [items, setItems] = useState<ChannelListingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchChannelListingItems(listing.id)
      setItems(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load menu items.')
    } finally {
      setLoading(false)
    }
  }, [listing.id])

  useEffect(() => {
    void load()
  }, [load])

  const handleToggle = useCallback(
    async (item: ChannelListingItem, next: boolean) => {
      setPendingIds(prev => new Set(prev).add(item.id))
      setItems(prev => prev.map(i => (i.id === item.id ? { ...i, available: next } : i)))
      try {
        await setChannelListingItemAvailability(listing.id, item.id, next)
        toast.success(`${item.name} ${next ? 'marked available' : 'marked sold out'}`)
      } catch (e) {
        // Revert on failure — the toggle above was optimistic.
        setItems(prev => prev.map(i => (i.id === item.id ? { ...i, available: !next } : i)))
        toast.error('Failed to update availability', {
          description: e instanceof Error ? e.message : 'Unknown error',
        })
      } finally {
        setPendingIds(prev => {
          const nextSet = new Set(prev)
          nextSet.delete(item.id)
          return nextSet
        })
      }
    },
    [listing.id],
  )

  if (loading) {
    return <p className="p-6 text-sm text-muted-foreground">Loading menu items…</p>
  }
  if (error) {
    return (
      <div className="p-6">
        <EmptyState
          icon={AlertTriangle}
          title="Could not load menu items"
          description={error}
          action={
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </Button>
          }
        />
      </div>
    )
  }
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="No menu items"
        description="This listing has no items published yet."
        className="m-4"
      />
    )
  }

  return (
    <div className="divide-y divide-border">
      {items.map(item => (
        <div key={item.id} className="flex min-h-[44px] items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{item.name}</p>
            {(item.category || item.price !== undefined) && (
              <p className="truncate text-xs text-muted-foreground">
                {item.category}
                {item.category && item.price !== undefined && item.price !== null ? ' · ' : ''}
                {item.price !== undefined && item.price !== null ? `₱${item.price.toFixed(2)}` : ''}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2" title={!canEdit ? disabledReason : undefined}>
            <span className="text-xs font-medium text-muted-foreground">
              {item.available ? 'Available' : 'Sold out'}
            </span>
            <Switch
              checked={item.available}
              disabled={!canEdit || pendingIds.has(item.id)}
              onCheckedChange={checked => void handleToggle(item, checked)}
              data-testid="availability-switch"
              data-item-id={item.id}
              aria-label={`${item.name} availability`}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Pause dialog ─────────────────────────────────────────────────────────────

interface PauseDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (durationMinutes: number, reason: string) => Promise<void>
}

function PauseStoreDialog({ open, onOpenChange, onSubmit }: PauseDialogProps) {
  const [duration, setDuration] = useState<string>('30')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    const trimmed = reason.trim()
    if (trimmed.length === 0) return
    setSubmitting(true)
    try {
      await onSubmit(Number(duration), trimmed)
      setReason('')
      setDuration('30')
      onOpenChange(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!submitting) onOpenChange(o) }}>
      <DialogContent data-testid="pause-dialog">
        <DialogHeader>
          <DialogTitle>Pause this listing</DialogTitle>
          <DialogDescription>
            New orders stop while paused. A duration and reason are required and saved to the audit log.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Duration</label>
            <Select value={duration} onValueChange={setDuration}>
              <SelectTrigger className="min-h-[44px]" data-testid="pause-duration-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAUSE_DURATION_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Reason</label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              maxLength={500}
              rows={3}
              autoFocus
              placeholder="e.g. out of key ingredient, kitchen overloaded, closing early…"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="min-h-[44px]"
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={submitting || reason.trim().length === 0}
            className="min-h-[44px] bg-red-600 text-white hover:bg-red-500"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4" />}
            Pause listing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Reject dialog ────────────────────────────────────────────────────────────

interface RejectDialogProps {
  order: KdsOrder | null
  onOpenChange: (open: boolean) => void
  onSubmit: (order: KdsOrder, reason: string) => Promise<void>
}

function RejectOrderDialog({ order, onOpenChange, onSubmit }: RejectDialogProps) {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!order) setReason('')
  }, [order])

  const handleSubmit = async () => {
    if (!order) return
    const trimmed = reason.trim()
    if (trimmed.length === 0) return
    setSubmitting(true)
    try {
      await onSubmit(order, trimmed)
      setReason('')
      onOpenChange(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={order !== null} onOpenChange={o => { if (!submitting) onOpenChange(o) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject order {order?.orderCode ?? order?.externalRef}</DialogTitle>
          <DialogDescription>A reason is required and is sent back to the customer/aggregator.</DialogDescription>
        </DialogHeader>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          maxLength={500}
          rows={3}
          autoFocus
          placeholder="e.g. item unavailable, kitchen closed, duplicate order…"
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-red-500/50"
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting} className="min-h-[44px]">
            Keep order
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={submitting || reason.trim().length === 0}
            className="min-h-[44px] bg-red-600 text-white hover:bg-red-500"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
            Reject order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MerchantConsole() {
  const { user } = useAuth()

  const [listings, setListings] = useState<ChannelListing[]>([])
  const [listingsLoading, setListingsLoading] = useState(true)
  const [listingsError, setListingsError] = useState<string | null>(null)
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null)
  const [pauseOpen, setPauseOpen] = useState(false)
  const [rejectTarget, setRejectTarget] = useState<KdsOrder | null>(null)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())

  const loadListings = useCallback(async () => {
    setListingsLoading(true)
    setListingsError(null)
    try {
      const data = await fetchChannelListings()
      setListings(Array.isArray(data) ? data : [])
    } catch (e) {
      setListingsError(e instanceof Error ? e.message : 'Failed to load channel listings.')
    } finally {
      setListingsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadListings()
  }, [loadListings])

  // Auto-select the first listing once the list loads, if nothing is picked yet.
  useEffect(() => {
    if (selectedListingId === null && listings.length > 0) {
      setSelectedListingId(listings[0].id)
    }
  }, [listings, selectedListingId])

  const selectedListing = useMemo(
    () => listings.find(l => l.id === selectedListingId) ?? null,
    [listings, selectedListingId],
  )

  // ── Sound cue dedupe (mirrors Kitchen.tsx's chimedRef) ────────────────────
  const chimedRef = useRef<Set<string>>(new Set())

  const { orders, setOrders, loading: ordersLoading, error: ordersError, now, refetch } =
    useMerchantConsoleOrders(selectedListing, {
      onOrderCreated: detail => {
        toast.info(`New order: ${detail.orderCode ?? detail.externalRef}`, {
          description: detail.customerName ? `Customer: ${detail.customerName}` : undefined,
        })
        if (!chimedRef.current.has(detail.id)) {
          chimedRef.current.add(detail.id)
          playNewOrderChime()
        }
      },
    })

  const newOrders = useMemo(() => orders.filter(o => o.status === 'NEW'), [orders])
  const preparingOrders = useMemo(() => orders.filter(o => o.status === 'PREPARING'), [orders])
  const readyOrders = useMemo(() => orders.filter(o => o.status === 'READY'), [orders])

  // ── RBAC + control-mode write gates ────────────────────────────────────────
  const hasPauseRole = hasRole(user?.role, PAUSE_ROLES)
  const hasOrderActionRole = hasRole(user?.role, ORDER_ACTION_ROLES)
  const hasItemRole = hasRole(user?.role, ITEM_AVAILABILITY_ROLES)
  const isApiControlled = selectedListing?.controlMode === 'API'

  const orderActionDisabledReason = !hasOrderActionRole
    ? 'Your role can view this queue but not act on orders.'
    : !isApiControlled
      ? `This listing is in ${selectedListing?.controlMode} mode — actions happen on the device, not here.`
      : undefined
  const canActOnOrders = hasOrderActionRole && isApiControlled

  const pauseDisabledReason = !hasPauseRole
    ? 'Your role cannot pause or resume a listing.'
    : !isApiControlled
      ? `This listing is in ${selectedListing?.controlMode} mode — pause it on the device instead.`
      : undefined
  const canPause = hasPauseRole && isApiControlled

  const itemDisabledReason = !hasItemRole
    ? 'Your role cannot edit item availability.'
    : !isApiControlled
      ? `This listing is in ${selectedListing?.controlMode} mode — availability changes happen on the device.`
      : undefined
  const canEditItems = hasItemRole && isApiControlled

  // ── Order actions ──────────────────────────────────────────────────────────

  const withBusy = useCallback(async (orderId: string, fn: () => Promise<void>) => {
    setBusyIds(prev => new Set(prev).add(orderId))
    try {
      await fn()
    } finally {
      setBusyIds(prev => {
        const next = new Set(prev)
        next.delete(orderId)
        return next
      })
    }
  }, [])

  const handleAccept = useCallback(
    (order: KdsOrder) => {
      if (!selectedListing) return
      void withBusy(order.id, async () => {
        try {
          await postChannelListingCommand(selectedListing.id, {
            command_type: 'ACCEPT_ORDER',
            order_id: order.id,
          })
          setOrders(prev => prev.map(o => (o.id === order.id ? { ...o, status: 'PREPARING' } : o)))
          toast.success('Order accepted')
        } catch (e) {
          toast.error('Failed to accept order', {
            description: e instanceof Error ? e.message : 'Unknown error',
          })
        }
      })
    },
    [selectedListing, withBusy, setOrders],
  )

  const handleReject = useCallback(
    async (order: KdsOrder, reason: string) => {
      if (!selectedListing) return
      await withBusy(order.id, async () => {
        try {
          await postChannelListingCommand(selectedListing.id, {
            command_type: 'REJECT_ORDER',
            order_id: order.id,
            payload: { reason },
          })
          setOrders(prev => prev.filter(o => o.id !== order.id))
          toast.success('Order rejected', { description: reason })
        } catch (e) {
          toast.error('Failed to reject order', {
            description: e instanceof Error ? e.message : 'Unknown error',
          })
          throw e // keep the dialog open on failure
        }
      })
    },
    [selectedListing, withBusy, setOrders],
  )

  const handleMarkReady = useCallback(
    (order: KdsOrder) => {
      if (!selectedListing) return
      void withBusy(order.id, async () => {
        try {
          await postChannelListingCommand(selectedListing.id, {
            command_type: 'MARK_READY',
            order_id: order.id,
          })
          setOrders(prev => prev.map(o => (o.id === order.id ? { ...o, status: 'READY' } : o)))
          toast.success('Order marked ready')
        } catch (e) {
          toast.error('Failed to mark order ready', {
            description: e instanceof Error ? e.message : 'Unknown error',
          })
        }
      })
    },
    [selectedListing, withBusy, setOrders],
  )

  // ── Store pause / resume ───────────────────────────────────────────────────

  const handlePauseSubmit = useCallback(
    async (durationMinutes: number, reason: string) => {
      if (!selectedListing) return
      try {
        await pauseChannelListing(selectedListing.id, { duration_minutes: durationMinutes, reason })
        const pausedUntil = new Date(Date.now() + durationMinutes * 60_000).toISOString()
        setListings(prev =>
          prev.map(l =>
            l.id === selectedListing.id
              ? { ...l, status: 'PAUSED', pausedReason: reason, pausedUntil }
              : l,
          ),
        )
        toast.success('Listing paused', { description: reason })
      } catch (e) {
        toast.error('Failed to pause listing', {
          description: e instanceof Error ? e.message : 'Unknown error',
        })
      }
    },
    [selectedListing],
  )

  const handleResume = useCallback(async () => {
    if (!selectedListing) return
    try {
      await resumeChannelListing(selectedListing.id)
      setListings(prev =>
        prev.map(l =>
          l.id === selectedListing.id ? { ...l, status: 'ACTIVE', pausedReason: null, pausedUntil: null } : l,
        ),
      )
      toast.success('Listing resumed')
    } catch (e) {
      toast.error('Failed to resume listing', {
        description: e instanceof Error ? e.message : 'Unknown error',
      })
    }
  }, [selectedListing])

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden" data-testid="merchant-console-page">
      {/* ── Left rail: channel listings ── */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-card sm:w-80">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3.5">
          <div>
            <h1 className="text-sm font-bold text-foreground">Merchant Console</h1>
            <p className="text-xs text-muted-foreground">{listings.length} listing{listings.length === 1 ? '' : 's'}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => void loadListings()}
            aria-label="Refresh listings"
            title="Refresh listings"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', listingsLoading && 'animate-spin')} />
          </Button>
        </div>

        <div className="flex-1 space-y-1.5 overflow-y-auto p-2" data-testid="listing-rail">
          {listingsLoading ? (
            <p className="p-4 text-center text-xs text-muted-foreground">Loading listings…</p>
          ) : listingsError ? (
            <EmptyState
              icon={AlertTriangle}
              title="Could not load listings"
              description={listingsError}
              action={
                <Button variant="outline" size="sm" onClick={() => void loadListings()}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  Retry
                </Button>
              }
              className="border-none bg-transparent"
            />
          ) : listings.length === 0 ? (
            <EmptyState
              icon={Store}
              title="No channel listings"
              description="Foodpanda/GrabFood listings assigned to you will appear here."
              className="border-none bg-transparent"
            />
          ) : (
            listings.map(listing => (
              <ListingRailItem
                key={listing.id}
                listing={listing}
                selected={listing.id === selectedListingId}
                onSelect={() => setSelectedListingId(listing.id)}
              />
            ))
          )}
        </div>
      </aside>

      {/* ── Main: selected listing's console ── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {!selectedListing ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <EmptyState
              icon={Store}
              title="Select a listing"
              description="Choose a channel listing from the left to view its live order queue."
            />
          </div>
        ) : (
          <>
            {/* Store controls header */}
            <div className="shrink-0 space-y-2 border-b border-border px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <BrandChip brand={selectedListing.brand} />
                  <AggregatorBadge aggregator={selectedListing.aggregator} />
                  <ControlModeChip mode={selectedListing.controlMode} />
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Building2 className="h-3.5 w-3.5" aria-hidden />
                    {selectedListing.outlet.name}
                  </span>
                </div>

                {selectedListing.status === 'PAUSED' ? (
                  <Button
                    onClick={() => void handleResume()}
                    disabled={!canPause}
                    title={!canPause ? pauseDisabledReason : undefined}
                    data-testid="resume-store-button"
                    className="min-h-[44px] bg-emerald-600 text-white hover:bg-emerald-500"
                  >
                    <Play className="h-4 w-4" />
                    Resume
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => setPauseOpen(true)}
                    disabled={!canPause}
                    title={!canPause ? pauseDisabledReason : undefined}
                    data-testid="pause-store-button"
                    className="min-h-[44px] border-red-500/40 text-red-600 hover:bg-red-500/10 dark:text-red-400"
                  >
                    <Pause className="h-4 w-4" />
                    Pause store
                  </Button>
                )}
              </div>

              {selectedListing.status === 'PAUSED' && (
                <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-400">
                  <Pause className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>
                    Paused{selectedListing.pausedReason ? ` — ${selectedListing.pausedReason}` : ''}
                    {selectedListing.pausedUntil
                      ? ` (until ${new Date(selectedListing.pausedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`
                      : ''}
                  </span>
                </div>
              )}

              {!isApiControlled && (
                <div className="flex items-center gap-2 rounded-lg bg-blue-500/10 px-3 py-2 text-xs text-blue-800 dark:text-blue-400">
                  <Radio className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>
                    {selectedListing.controlMode === 'SHADOW'
                      ? 'Shadow mode — ORION reads this listing’s orders read-only. The physical device still accepts/rejects/pauses until this listing cuts over to API mode.'
                      : 'Device mode — this listing still runs on its physical tablet/phone. Actions here are disabled until it cuts over to API mode.'}
                  </span>
                </div>
              )}
            </div>

            <Tabs defaultValue="orders" className="flex min-h-0 flex-1 flex-col">
              <div className="shrink-0 px-5 pt-3">
                <TabsList>
                  <TabsTrigger value="orders" className="min-h-[44px]">Orders</TabsTrigger>
                  <TabsTrigger value="items" className="min-h-[44px]">Items</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="orders" className="min-h-0 flex-1 overflow-hidden px-5 pb-5">
                {ordersLoading ? (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : ordersError ? (
                  <div className="flex h-full items-center justify-center">
                    <EmptyState
                      icon={AlertTriangle}
                      title="Could not load this listing's orders"
                      description={ordersError}
                      action={
                        <Button variant="outline" size="sm" onClick={refetch}>
                          <RefreshCw className="h-3.5 w-3.5" />
                          Retry
                        </Button>
                      }
                    />
                  </div>
                ) : (
                  <div className="grid h-full grid-cols-1 gap-3 sm:grid-cols-3">
                    <QueueColumn
                      title="New"
                      stage="NEW"
                      orders={newOrders}
                      now={now}
                      canAct={canActOnOrders}
                      disabledReason={orderActionDisabledReason}
                      busyIds={busyIds}
                      onAccept={handleAccept}
                      onReject={setRejectTarget}
                      onMarkReady={handleMarkReady}
                    />
                    <QueueColumn
                      title="Preparing"
                      stage="PREPARING"
                      orders={preparingOrders}
                      now={now}
                      canAct={canActOnOrders}
                      disabledReason={orderActionDisabledReason}
                      busyIds={busyIds}
                      onAccept={handleAccept}
                      onReject={setRejectTarget}
                      onMarkReady={handleMarkReady}
                    />
                    <QueueColumn
                      title="Ready"
                      stage="READY"
                      orders={readyOrders}
                      now={now}
                      canAct={canActOnOrders}
                      disabledReason={orderActionDisabledReason}
                      busyIds={busyIds}
                      onAccept={handleAccept}
                      onReject={setRejectTarget}
                      onMarkReady={handleMarkReady}
                    />
                  </div>
                )}
              </TabsContent>

              <TabsContent value="items" className="min-h-0 flex-1 overflow-y-auto pb-5">
                <ItemsPanel listing={selectedListing} canEdit={canEditItems} disabledReason={itemDisabledReason} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>

      <PauseStoreDialog open={pauseOpen} onOpenChange={setPauseOpen} onSubmit={handlePauseSubmit} />
      <RejectOrderDialog
        order={rejectTarget}
        onOpenChange={open => { if (!open) setRejectTarget(null) }}
        onSubmit={handleReject}
      />
    </div>
  )
}
