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
 *
 * Data loading + realtime order state live in ../hooks/useKitchenOrders (shared
 * with the TV board, src/pages/Tv.tsx — platform-ia-navigation.md §6) so this
 * page owns only Kitchen-specific concerns: station grouping, advance/cancel
 * actions, stage tabs, and the stock/lowstock toasts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChefHat,
  Clock,
  Flame,
  LayoutGrid,
  PackageCheck,
  Tv,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { post } from '../lib/api'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '../components/ui/dialog'
import { Button } from '../components/ui/button'
import { useAuth } from '../auth/AuthContext'
import type { UserRole } from '../auth/AuthContext'
import { hasRole } from '../auth/access'
import { onSocketEvent } from '../lib/socket'
import type { LowStockAlert, StockPayload } from '../lib/socket'
import {
  ACTIVE_STATUSES,
  OVERDUE_MINS,
  STALE_HOURS,
  elapsedMMSS,
  formatTime,
  isOverdue as isOrderOverdue,
  isStale as isOrderStale,
  sortStationsPackingLast,
  timerStart,
  type KdsOrder,
  type OrderStatus,
} from '../lib/kds'
import { useKitchenOrders } from '../hooks/useKitchenOrders'
import { playNewOrderChime, playFirePrepCue } from '../lib/kdsSound'
import type { Brand } from './Dashboard'
import PageHeader from '../components/common/PageHeader'
import BrandChip from '../components/common/BrandChip'
import AggregatorBadge from '../components/common/AggregatorBadge'
import StatusBadge from '../components/common/StatusBadge'
import EmptyState from '../components/common/EmptyState'

// ─── Stage config ─────────────────────────────────────────────────────────────

const NEXT_STAGE: Record<string, string> = {
  NEW:       'PREPARING',
  PREPARING: 'READY',
  READY:     'COMPLETED',
}

// ─── RBAC ──────────────────────────────────────────────────────────────────────

/**
 * Roles that may advance/cancel an order's stage (FR-KD-02, business-rules #2).
 * Matches backend ORDER_STAGE_ROLES as of 2026-07-05 (ckitchen_backend
 * src/modules/orders/routes.ts: `const ORDER_STAGE_ROLES = ["OWNER", "KITCHEN_CREW"]`,
 * used for both POST /orders/:id/advance and /orders/:id/cancel). OUTLET_MANAGER
 * can view /kitchen (PAGE_ROLES['/kitchen']) but the advance/cancel buttons were
 * previously ungated, guaranteeing a 403 for that role — hidden here until the
 * backend D31 matrix widens ORDER_STAGE_ROLES. OWNER (+ legacy SUPER_ADMIN)
 * always passes via `hasRole`.
 */
const ORDER_STAGE_ROLES: UserRole[] = ['KITCHEN_CREW']

/** localStorage key for the KDS sound-cue mute toggle (MoM June-24). */
const SOUND_STORAGE_KEY = 'ck_kds_sound'

function readSoundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_STORAGE_KEY) !== '0'
  } catch {
    return true
  }
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
  /** Gates the advance/cancel actions to ORDER_STAGE_ROLES (M3) — read-only card otherwise. */
  canAct: boolean
}

function OrderCard({ order, brand, stationId, now: _now, onAdvance, onCancel, advancing, canAct }: OrderCardProps) {
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
  const stale   = isOrderStale(order)
  const isOverdue = isOrderOverdue(order) && order.status !== 'COMPLETED'
  const elapsed = elapsedMMSS(start)
  // Short order code (e.g. "TOK-FP-7K3QD") when the backend sends one; the
  // aggregator external ref (e.g. "SIM-17835…") remains the fallback for old
  // rows/deploys. No copy button here — KDS is touch-first (big targets only).
  const displayRef = order.orderCode ?? order.externalRef

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
        stale ? 'opacity-60' : '',
      ].join(' ')}
      style={{ borderLeftColor: brand?.color ?? '#52525B', borderLeftWidth: 3 }}
    >
      {/* ── Card header ── */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 pt-3 pb-2">
        <BrandChip brand={brand} />
        <AggregatorBadge aggregator={order.aggregator} />
        <span className="font-mono text-[11px] text-zinc-500 tabular-nums">
          {displayRef}
        </span>
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          {stale && (
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500 ring-1 ring-inset ring-zinc-700"
              title={`No activity for over ${STALE_HOURS}h — likely abandoned`}
            >
              Stale
            </span>
          )}
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
        {next && canAct ? (
          <button
            onClick={() => onAdvance(order.id)}
            disabled={advancing}
            aria-label={`Advance order ${displayRef} to ${next}`}
            className={[
              'w-full flex items-center justify-center gap-2',
              'rounded-lg px-4 py-3.5 text-sm font-bold tracking-wide',
              'transition-colors duration-150 select-none',
              'min-h-[52px]',        // large touch target
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50',
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
                Complete
              </>
            ) : (
              <>
                <ArrowRight className="h-4 w-4" />
                {next.charAt(0) + next.slice(1).toLowerCase()}
              </>
            )}
          </button>
        ) : next ? (
          // View-only role (M3): the backend's ORDER_STAGE_ROLES would 403 an
          // advance/cancel call for this account — show status, not a dead button.
          <div
            className="w-full flex items-center justify-center gap-2 rounded-lg px-4 py-3.5 min-h-[52px] bg-zinc-800/50 text-sm font-semibold text-zinc-500"
            title="Your role can view this board but not advance orders"
          >
            View only
          </div>
        ) : (
          <div className="w-full flex items-center justify-center gap-2 rounded-lg px-4 py-3.5 min-h-[52px] bg-zinc-800/50 text-sm font-semibold text-zinc-600">
            <CheckCircle2 className="h-4 w-4" />
            Completed
          </div>
        )}

        {/* ── Cancel (requires a reason) — only while the order is still active ── */}
        {next && canAct && (
          <button
            onClick={() => setCancelOpen(true)}
            className="mt-2 w-full flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-red-300/80 hover:text-red-200 hover:bg-red-500/10 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
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
            <DialogTitle>Cancel order {displayRef}</DialogTitle>
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
              className="rounded-lg px-4 py-2 text-sm font-semibold text-zinc-400 transition-colors duration-200 hover:text-zinc-200 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
            >
              Keep order
            </button>
            <button
              onClick={() => void submitCancel()}
              disabled={cancelling || cancelReason.trim().length === 0}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white transition-colors duration-200 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
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
  const { user } = useAuth()
  const canAct = hasRole(user?.role, ORDER_STAGE_ROLES)

  const [advancing, setAdvancing] = useState<Set<string>>(new Set())
  const [activeStage, setActiveStage] = useState<StageFilter>('ALL')

  // ── Prep sound cues (MoM June-24) ──────────────────────────────────────────
  // Mute toggle persisted in localStorage. `soundOnRef` mirrors the state so the
  // hook's onOrderCreated closure always sees the current value without needing
  // to re-subscribe. Dedup sets ensure one sound per order EVENT (not per
  // re-render): `chimedRef` for order.created, `firedPrepRef` for the PREPARING
  // ("fire") cue. `prepSeededRef` seeds firedPrepRef with orders already past
  // NEW on first paint so we never retro-fire the cue for the initial board.
  const [soundOn, setSoundOn] = useState<boolean>(readSoundEnabled)
  const soundOnRef = useRef(soundOn)
  soundOnRef.current = soundOn
  const chimedRef = useRef<Set<string>>(new Set())
  const firedPrepRef = useRef<Set<string>>(new Set())
  const prepSeededRef = useRef(false)

  const toggleSound = useCallback(() => {
    setSoundOn(prev => {
      const next = !prev
      try {
        localStorage.setItem(SOUND_STORAGE_KEY, next ? '1' : '0')
      } catch {
        /* storage blocked — keep the in-memory toggle working anyway */
      }
      return next
    })
  }, [])

  const { orders, setOrders, stations, brandMap, loading, error, now } = useKitchenOrders({
    // Page-specific side effect (toast + NEW-order chime) on top of the hook's
    // own state update — the TV board (src/pages/Tv.tsx) shares the same hook
    // but skips toasts/sounds. Fires only for genuinely new orders (not the
    // initial load); chimedRef dedups against duplicate order.created events.
    onOrderCreated: (detail) => {
      toast.info(`New order: ${detail.orderCode ?? detail.externalRef}`, {
        description: detail.customerName ? `Customer: ${detail.customerName}` : undefined,
      })
      if (!chimedRef.current.has(detail.id)) {
        chimedRef.current.add(detail.id)
        if (soundOnRef.current) playNewOrderChime()
      }
    },
  })

  // ── PREPARING ("fire") cue ─────────────────────────────────────────────────
  // Watch the live order set: when an order first reaches PREPARING (whether via
  // this crew's own Advance click or a remote order.updated), play the fire cue
  // once. firedPrepRef dedups so a re-render of an order already PREPARING is
  // silent. On the very first settled render we SEED the set with every order
  // that's already past NEW, so opening the board mid-shift doesn't blast a cue
  // for orders that were fired long ago.
  useEffect(() => {
    if (loading) return
    const fired = firedPrepRef.current
    if (!prepSeededRef.current) {
      for (const o of orders) {
        if (o.status !== 'NEW') fired.add(o.id)
      }
      prepSeededRef.current = true
      return
    }
    for (const o of orders) {
      if (fired.has(o.id)) continue
      if (o.status === 'PREPARING') {
        fired.add(o.id)
        if (soundOnRef.current) playFirePrepCue()
      } else if (o.status === 'READY' || o.status === 'COMPLETED') {
        // Skipped straight past PREPARING in our view (fast advance / late join)
        // — mark as fired so we never retro-play the cue for it.
        fired.add(o.id)
      }
    }
  }, [orders, loading])

  // ── Kitchen-only socket subscriptions (stock/low-stock toasts) ────────────
  useEffect(() => {
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
  }, [setOrders])

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
  }, [setOrders])

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

  // Column display order — Packing always last (July 15 site-visit finding;
  // see sortStationsPackingLast in lib/kds.ts for what this does and does not
  // fix). Lookups above stay keyed off the unsorted `stations` (order-agnostic
  // Map); only the rendered column order below uses this.
  const orderedStations = useMemo(() => sortStationsPackingLast(stations), [stations])

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
    // Stale (abandoned NEW) orders are excluded — they get their own muted tag (gap #7).
    () => orders.filter(o => isOrderOverdue(o) && o.status !== 'COMPLETED').length,
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
            <div className="flex items-center gap-2">
              {overdueCount > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-3 py-1 text-xs font-semibold text-red-400 ring-1 ring-inset ring-red-500/30 animate-pulse tabular-nums">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {overdueCount} overdue (&gt;{OVERDUE_MINS}m)
                </span>
              )}
              <Button
                variant="outline"
                size="icon"
                onClick={toggleSound}
                aria-pressed={soundOn}
                title={soundOn ? 'Mute prep sound cues' : 'Unmute prep sound cues'}
                className="h-8 w-8"
              >
                {soundOn ? (
                  <Volume2 className="h-3.5 w-3.5" />
                ) : (
                  <VolumeX className="h-3.5 w-3.5 text-zinc-500" />
                )}
                <span className="sr-only">
                  {soundOn ? 'Mute prep sound cues' : 'Unmute prep sound cues'}
                </span>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link to="/tv" target="_blank" rel="noopener noreferrer" aria-label="Open TV Mode board in a new tab">
                  <Tv className="h-3.5 w-3.5" />
                  TV Mode
                </Link>
              </Button>
            </div>
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
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50',
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
            {orderedStations.map(station => {
              const col = stationOrders.get(station.id) ?? []
              const colOverdue = col.filter(
                o => isOrderOverdue(o) && o.status !== 'COMPLETED',
              ).length

              return (
                <section
                  key={station.id}
                  data-testid="kds-station-column"
                  data-station-name={station.name}
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
                          canAct={canAct}
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
