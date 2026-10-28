/**
 * TV display board — D32 (client answer #6: the CloudKitchen outlet screen is
 * a big TV). platform-ia-navigation.md §6 "Device targets".
 *
 * A glanceable, read-only kitchen/ops board meant to be read from 3–5 meters:
 * three XL columns (NEW / PREPARING / READY) of live order cards, a top strip
 * (brand mark, outlet name, live clock, today's-activity KPI trio, connection
 * indicator), and nothing else interactive except a small exit link.
 *
 * Rendered OUTSIDE <AppShell/> (see App.tsx) — no sidebar/topbar — but still
 * behind <RequireAuth/> + <RequireAccess/> like every other route (access.ts
 * '/tv': same roles as '/kitchen', OWNER via the canAccess short-circuit).
 *
 * Data: shares ../hooks/useKitchenOrders with Kitchen.tsx (same order set,
 * same order.created/order.updated socket events, same reconnect-refetch —
 * Business Rule #9) rather than a second copy of the fetch/socket wiring.
 * This page adds no advance/cancel actions — the board is read-only.
 *
 * Colours come from the theme tokens (background/card/secondary/border/foreground), so the
 * board follows Light/Dark like the rest of ORION; stage accents use a darker shade in light
 * mode to stay readable from across the kitchen.
 *
 * KPI trio: an actual "gross sales today" figure would need /analytics/brands
 * (checked against Dashboard/Analytics.tsx), but that endpoint's RBAC is
 * OWNER/BRAND_MANAGER/ACCOUNTING only (backend analytics/routes.ts) — the
 * roles who actually staff a TV (OUTLET_MANAGER, KITCHEN_CREW) would 403 on
 * it. Per spec, falling back to figures already in hand: total active
 * orders, preparing count, ready count.
 */
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Building2, Flame, Orbit, PackageCheck, ReceiptText, WifiOff, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useKitchenOrders } from '../hooks/useKitchenOrders'
import { useOutlet } from '../context/OutletContext'
import { onSocketStatusChange } from '../lib/socket'
import {
  OVERDUE_MINS,
  elapsedMMSS,
  elapsedMins,
  shortOrderNo,
  timerStart,
  type KdsOrder,
} from '../lib/kds'
import type { Brand } from './Dashboard'
import { PLATFORM_NAME } from '../lib/branding'
import { cn } from '../lib/utils'
import BrandChip from '../components/common/BrandChip'
import AggregatorBadge from '../components/common/AggregatorBadge'

/** Cards shown per column before collapsing the rest into a "+N more" pill. */
const MAX_VISIBLE_CARDS = 8

// ─── Column accent tokens (mirrors Kitchen.tsx's per-stage colors) ────────────

const COLUMN_ACCENT: Record<'NEW' | 'PREPARING' | 'READY', string> = {
  NEW: 'text-blue-700 dark:text-blue-400',
  PREPARING: 'text-amber-700 dark:text-amber-400',
  READY: 'text-emerald-700 dark:text-emerald-400',
}

const OVERDUE_TEXT = 'text-red-600 dark:text-red-400'

// ─── TvOrderCard ──────────────────────────────────────────────────────────────

interface TvOrderCardProps {
  order: KdsOrder
  brand: Brand | undefined
}

function TvOrderCard({ order, brand }: TvOrderCardProps) {
  const start = timerStart(order)
  const isOverdue = elapsedMins(start) >= OVERDUE_MINS
  const itemCount = order.items.reduce((sum, item) => sum + item.qty, 0)

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-sm',
        isOverdue ? 'border-red-500/60 ring-2 ring-red-500/40' : 'border-border',
      )}
      style={{ borderLeftColor: brand?.color ?? '#52525B', borderLeftWidth: 5 }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <BrandChip brand={brand} className="text-xs px-3 py-1" />
        <AggregatorBadge aggregator={order.aggregator} />
        {isOverdue && (
          <AlertTriangle className={cn('ml-auto h-5 w-5 shrink-0', OVERDUE_TEXT)} aria-label="Overdue" />
        )}
      </div>

      <div className="flex items-end justify-between gap-3">
        <span className="text-4xl font-black leading-none tabular-nums text-foreground">
          #{shortOrderNo(order.externalRef)}
        </span>
        <span
          className={cn(
            'text-2xl font-bold leading-none tabular-nums',
            isOverdue ? OVERDUE_TEXT : 'text-foreground/80',
          )}
        >
          {elapsedMMSS(start)}
        </span>
      </div>

      <div className="text-sm font-medium text-muted-foreground">
        {itemCount} item{itemCount === 1 ? '' : 's'}
      </div>
    </div>
  )
}

// ─── TvColumn ─────────────────────────────────────────────────────────────────

interface TvColumnProps {
  label: string
  icon: LucideIcon
  accent: string
  orders: KdsOrder[]
  brandMap: Map<string, Brand>
}

function TvColumn({ label, icon: Icon, accent, orders, brandMap }: TvColumnProps) {
  const visible = orders.slice(0, MAX_VISIBLE_CARDS)
  const hiddenCount = orders.length - visible.length

  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-secondary/40 shadow-sm"
      aria-label={`${label} orders`}
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-secondary px-5 py-4">
        <Icon className={cn('h-7 w-7 shrink-0', accent)} aria-hidden />
        <h2 className={cn('text-2xl font-bold tracking-wide', accent)}>{label}</h2>
        <span className="ml-auto rounded-full bg-background px-3 py-1 text-lg font-bold tabular-nums text-foreground">
          {orders.length}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {visible.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            No {label.toLowerCase()} orders
          </div>
        ) : (
          visible.map(order => (
            <TvOrderCard key={order.id} order={order} brand={brandMap.get(order.brandId)} />
          ))
        )}
        {hiddenCount > 0 && (
          <div className="shrink-0 rounded-xl border border-dashed border-border py-3 text-center text-sm font-semibold text-muted-foreground">
            +{hiddenCount} more
          </div>
        )}
      </div>
    </section>
  )
}

// ─── Tv ───────────────────────────────────────────────────────────────────────

export default function Tv() {
  const { orders, brandMap, loading, error, now } = useKitchenOrders()
  const { outlets, selectedOutletId } = useOutlet()
  const [socketStatus, setSocketStatus] = useState<'connected' | 'disconnected'>('connected')

  useEffect(() => onSocketStatusChange(setSocketStatus), [])

  const outletName = useMemo(() => {
    if (selectedOutletId !== 'ALL') {
      return outlets.find(o => o.id === selectedOutletId)?.name
    }
    return outlets.length === 1 ? outlets[0].name : undefined
  }, [outlets, selectedOutletId])

  const clock = useMemo(
    () => new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    [now],
  )

  // Hook already sorts orders NEW -> PREPARING -> READY, oldest-first within
  // each stage — filtering preserves that order (longest-waiting on top).
  const newOrders = useMemo(() => orders.filter(o => o.status === 'NEW'), [orders])
  const preparingOrders = useMemo(() => orders.filter(o => o.status === 'PREPARING'), [orders])
  const readyOrders = useMemo(() => orders.filter(o => o.status === 'READY'), [orders])

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      {/* ── Top strip ── */}
      <header className="flex h-20 shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-b border-border bg-card px-6 sm:px-8">
        <div className="flex shrink-0 items-center gap-2.5">
          <Orbit className="h-7 w-7 text-emerald-500" aria-hidden />
          <span className="text-xl font-bold tracking-tight">{PLATFORM_NAME}</span>
        </div>

        {outletName && (
          <div className="flex shrink-0 items-center gap-2 text-muted-foreground">
            <Building2 className="h-5 w-5 shrink-0" aria-hidden />
            <span className="text-lg font-semibold text-foreground">{outletName}</span>
          </div>
        )}

        {/* KPI trio — orders / preparing / ready (see file header for why not gross sales) */}
        <div className="ml-auto flex items-center gap-4 sm:gap-8">
          <div className="flex items-center gap-2">
            <ReceiptText className="h-5 w-5 text-muted-foreground" aria-hidden />
            <span className="text-2xl font-bold tabular-nums text-foreground">{orders.length}</span>
            <span className="hidden text-xs font-medium uppercase tracking-wide text-muted-foreground sm:inline">
              Orders
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Flame className="h-5 w-5 text-amber-600 dark:text-amber-500" aria-hidden />
            <span className="text-2xl font-bold tabular-nums text-foreground">{preparingOrders.length}</span>
            <span className="hidden text-xs font-medium uppercase tracking-wide text-muted-foreground sm:inline">
              Preparing
            </span>
          </div>
          <div className="flex items-center gap-2">
            <PackageCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-500" aria-hidden />
            <span className="text-2xl font-bold tabular-nums text-foreground">{readyOrders.length}</span>
            <span className="hidden text-xs font-medium uppercase tracking-wide text-muted-foreground sm:inline">
              Ready
            </span>
          </div>
        </div>

        {/* Connection indicator + live clock */}
        <div className="flex shrink-0 items-center gap-4 border-l border-border pl-4 sm:pl-6">
          <span
            className={cn(
              'flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide',
              socketStatus === 'connected' ? 'text-muted-foreground' : OVERDUE_TEXT,
            )}
          >
            <span
              className={cn(
                'h-2 w-2 rounded-full',
                socketStatus === 'connected' ? 'bg-emerald-500' : 'bg-red-500 animate-pulse',
              )}
              aria-hidden
            />
            {socketStatus === 'connected' ? 'Live' : 'Offline'}
          </span>
          <span className="font-mono text-2xl font-bold tabular-nums text-foreground">{clock}</span>
        </div>
      </header>

      {/* ── Reconnecting banner (Business Rule #9 — a dead feed must be visible) ── */}
      {socketStatus === 'disconnected' && (
        <div className="flex shrink-0 items-center justify-center gap-2 bg-red-600 px-3 py-2 text-sm font-bold uppercase tracking-widest text-white">
          <WifiOff className="h-4 w-4" aria-hidden />
          Reconnecting — realtime updates paused
        </div>
      )}

      {/* ── Board ── */}
      <main className="min-h-0 flex-1 overflow-hidden p-4 sm:p-6">
        {loading ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-border border-t-emerald-500" />
            <p className="text-sm">Loading board…</p>
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center p-8">
            <div className="w-full max-w-md rounded-xl border border-red-500/20 bg-red-500/10 p-6 text-center">
              <AlertTriangle className={cn('mx-auto mb-3 h-8 w-8', OVERDUE_TEXT)} />
              <p className="text-sm font-semibold text-red-700 dark:text-red-300">{error}</p>
            </div>
          </div>
        ) : (
          <div className="grid h-full grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-6">
            <TvColumn label="New" icon={ReceiptText} accent={COLUMN_ACCENT.NEW} orders={newOrders} brandMap={brandMap} />
            <TvColumn label="Preparing" icon={Flame} accent={COLUMN_ACCENT.PREPARING} orders={preparingOrders} brandMap={brandMap} />
            <TvColumn label="Ready" icon={PackageCheck} accent={COLUMN_ACCENT.READY} orders={readyOrders} brandMap={brandMap} />
          </div>
        )}
      </main>

      {/* ── Exit (bottom corner, subtle) ── */}
      <Link
        to="/"
        className="fixed bottom-4 right-4 z-10 flex items-center gap-1.5 rounded-full border border-border bg-card/80 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur transition-colors hover:text-foreground"
        aria-label="Exit TV Mode"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
        Exit
      </Link>
    </div>
  )
}
