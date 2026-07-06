/**
 * Shared KDS (Kitchen Display) data types + helpers.
 *
 * Extracted from Kitchen.tsx (originally inline) so the Kitchen page and the
 * TV board (src/pages/Tv.tsx, ORION W3 — platform-ia-navigation.md §6) share
 * one definition of "what an active kitchen order looks like" instead of two
 * copies drifting apart. Pure data helpers only — no React, no sockets.
 * See src/hooks/useKitchenOrders.ts for the data-loading/socket half.
 */
import { get } from './api'

/** Orders older than this many minutes are considered overdue (FR-KD-05). */
export const OVERDUE_MINS = 15

/**
 * A NEW order older than this many hours is treated as "stale" (abandoned/never
 * cooked), NOT "overdue". In a long-lived pilot, demo/test orders that never
 * advance would otherwise pile into the "overdue" alert and bury genuinely-late
 * fresh orders (W4b gap #7). Stale orders get their own muted visual + are
 * excluded from the overdue count.
 */
export const STALE_HOURS = 24

export type OrderStatus = 'NEW' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED'

/** Active statuses shown on the KDS / TV board (COMPLETED/CANCELLED are excluded). */
export const ACTIVE_STATUSES: OrderStatus[] = ['NEW', 'PREPARING', 'READY']

export interface KdsOrderItem {
  qty: number
  name: string
  notes?: string | null
  stationId: string
}

export interface KdsOrder {
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

export interface RawOrderSummary {
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

export async function fetchOrderDetail(id: string): Promise<KdsOrder | null> {
  try {
    const { data } = await get<RawOrderDetail>(`/orders/${id}`)
    return toKdsOrder(data)
  } catch {
    return null
  }
}

/** Elapsed milliseconds from the given ISO timestamp to now. */
export function elapsedMs(iso: string): number {
  return Date.now() - new Date(iso).getTime()
}

/** Elapsed minutes from the given ISO timestamp to now. */
export function elapsedMins(iso: string): number {
  return elapsedMs(iso) / 60_000
}

/** Live mm:ss timer label — used on the KDS/TV card. For >= 1 h: Xh YYm format. */
export function elapsedMMSS(iso: string): string {
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

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Returns the timestamp to use for elapsed / overdue check. */
export function timerStart(order: KdsOrder): string {
  if (order.status === 'PREPARING' && order.prepAt) return order.prepAt
  return order.placedAt
}

/** A NEW order abandoned for > STALE_HOURS — shown muted, not counted as overdue. */
export function isStale(order: KdsOrder): boolean {
  return order.status === 'NEW' && elapsedMins(timerStart(order)) > STALE_HOURS * 60
}

/** Genuinely late (past OVERDUE_MINS) but NOT stale — this is what the overdue alert counts. */
export function isOverdue(order: KdsOrder): boolean {
  return !isStale(order) && elapsedMins(timerStart(order)) > OVERDUE_MINS
}

/** Short, glanceable order number for big-type display (TV board) — last 6 chars of the aggregator's external ref, uppercased. */
export function shortOrderNo(externalRef: string): string {
  const trimmed = externalRef.trim()
  return trimmed.length > 6 ? trimmed.slice(-6).toUpperCase() : trimmed.toUpperCase()
}
