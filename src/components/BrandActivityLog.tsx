import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, History, TrendingUp } from 'lucide-react'
import { toast } from 'sonner'
import { get } from '../lib/api'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'
import EmptyState from './common/EmptyState'

/** Minimal brand shape the dialog needs — callers can pass the full Brand row. */
export interface ActivityLogBrand {
  id: string
  name: string
}

interface BrandActivityLogProps {
  brand: ActivityLogBrand | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Mirrors `GET /brands/:id/activity` (MOTM 2026-07-01 item 10). Field names
 * are camelCase straight off the backend response — do NOT snake_case these,
 * that mismatch silently dropped every event in the earlier draft of this view.
 */
interface ActivityEvent {
  id: string
  brandId: string
  aggregatorAccountId: string | null
  status: 'ACTIVE' | 'INACTIVE'
  changedAt: string
  changedBy: string | null
  note: string | null
}

/** One dense per-day roll-up from `?detail=daily&month=` (client 2026-07-08:
 *  "activity per month is not showing the simulated runs"). */
interface DailyStat {
  date: string // 'YYYY-MM-DD'
  orders: number
  revenue: number
}

/** Merged view of one calendar day: order roll-up + status-toggle change rows. */
interface MergedDay {
  key: number
  label: string
  orders: number
  revenue: number
  events: ActivityEvent[]
  /** Best-effort "Active 7:00 AM – 10:00 PM" summary; null if nothing to pair. */
  summary: string | null
}

interface MonthCursor {
  year: number
  month: number // 0-indexed, matches Date
}

const MONTH_FMT = new Intl.DateTimeFormat([], { month: 'long', year: 'numeric' })

function fmtPHP(v: number | null | undefined): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(v ?? 0)
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

/** Local-midnight ms key for a Date — the shared bucket id across events + stats. */
function dayKeyOf(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Parse a 'YYYY-MM-DD' as a LOCAL calendar day (not UTC) so keys line up with events. */
function parseLocalDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

function currentCursor(): MonthCursor {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() }
}

function shiftMonth(c: MonthCursor, delta: number): MonthCursor {
  const d = new Date(c.year, c.month + delta, 1)
  return { year: d.getFullYear(), month: d.getMonth() }
}

/** `YYYY-MM` for the `?month=` param (backend's dense-daily trigger). */
function monthParam(c: MonthCursor): string {
  return `${c.year}-${String(c.month + 1).padStart(2, '0')}`
}

/** [from, to] ISO bounds for a calendar month; `to` clamps to "now" for the current month. */
function monthRange(c: MonthCursor): { from: string; to: string } {
  const from = new Date(c.year, c.month, 1, 0, 0, 0, 0)
  const now = new Date()
  const isCurrent = c.year === now.getFullYear() && c.month === now.getMonth()
  const to = isCurrent ? now : new Date(c.year, c.month + 1, 0, 23, 59, 59, 999)
  return { from: from.toISOString(), to: to.toISOString() }
}

interface Activity {
  changes: ActivityEvent[]
  daily: DailyStat[]
}

/**
 * Coerce whatever the endpoint returns into `{ changes, daily }`. Handles all
 * three shapes we may hit across deploys:
 *   - new dense-daily:   `{ changes: [...], daily: [...] }`
 *   - older object form: `{ events: [...] }`            → changes only
 *   - oldest plain array `[...]`                         → changes only
 */
function normalizeActivity(data: unknown): Activity {
  if (Array.isArray(data)) return { changes: data as ActivityEvent[], daily: [] }
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    const changes = Array.isArray(obj.changes)
      ? (obj.changes as ActivityEvent[])
      : Array.isArray(obj.events)
        ? (obj.events as ActivityEvent[])
        : []
    const daily = Array.isArray(obj.daily) ? (obj.daily as DailyStat[]) : []
    return { changes, daily }
  }
  return { changes: [], daily: [] }
}

/**
 * Merge order roll-ups (daily) with status-toggle change rows into a single
 * newest-first list of days. A day appears if it has orders > 0 OR any change
 * rows — empty days are skipped so the list stays a real activity log, not a
 * 30-row calendar of zeros. Per day, consecutive ACTIVE → INACTIVE transitions
 * are paired into a human "Active 7:00 AM – 10:00 PM" summary.
 */
function mergeDays(changes: ActivityEvent[], daily: DailyStat[]): MergedDay[] {
  const byDay = new Map<number, { events: ActivityEvent[]; orders: number; revenue: number }>()

  const bucket = (key: number) => {
    let b = byDay.get(key)
    if (!b) {
      b = { events: [], orders: 0, revenue: 0 }
      byDay.set(key, b)
    }
    return b
  }

  for (const stat of daily) {
    if (!stat?.date) continue
    const key = dayKeyOf(parseLocalDate(stat.date))
    const b = bucket(key)
    b.orders += stat.orders ?? 0
    b.revenue += stat.revenue ?? 0
  }

  for (const e of changes) {
    const key = dayKeyOf(new Date(e.changedAt))
    bucket(key).events.push(e)
  }

  const days: MergedDay[] = []
  for (const [key, b] of byDay.entries()) {
    if (b.orders <= 0 && b.events.length === 0) continue

    // Events arrive oldest-first from the backend; pair Active→Inactive windows.
    const windows: string[] = []
    let openStart: string | null = null
    for (const e of b.events) {
      if (e.status === 'ACTIVE') {
        if (openStart === null) openStart = e.changedAt
      } else if (openStart !== null) {
        windows.push(`${timeLabel(openStart)} – ${timeLabel(e.changedAt)}`)
        openStart = null
      }
    }
    if (openStart !== null) windows.push(`${timeLabel(openStart)} – now`)

    days.push({
      key,
      label:
        b.events.length > 0
          ? dayLabel(b.events[0].changedAt)
          : dayLabel(new Date(key).toISOString()),
      orders: b.orders,
      revenue: b.revenue,
      events: b.events,
      summary: windows.length > 0 ? `Active ${windows.join(', ')}` : null,
    })
  }

  days.sort((a, b) => b.key - a.key) // newest day first
  return days
}

/**
 * Per-brand activity log (MOTM 2026-07-01 item 10; reworked 2026-07-08 so the
 * month view surfaces the SIMULATED ORDER RUNS, not just manual Active/Inactive
 * toggles). Each day shows its order count + revenue (emerald) interleaved with
 * any status-toggle change rows. Opened from a row action on the Brands page;
 * scoped to one brand + one calendar month at a time.
 */
export default function BrandActivityLog({ brand, open, onOpenChange }: BrandActivityLogProps) {
  const [cursor, setCursor] = useState<MonthCursor>(currentCursor)

  // Reset to the current month whenever the dialog opens (fresh brand or
  // reopened) — avoids showing a stale month left over from a prior brand.
  useEffect(() => {
    if (open) setCursor(currentCursor())
  }, [open, brand?.id])

  const { from, to } = useMemo(() => monthRange(cursor), [cursor])
  const month = useMemo(() => monthParam(cursor), [cursor])
  const isCurrentMonth = useMemo(() => {
    const now = currentCursor()
    return cursor.year === now.year && cursor.month === now.month
  }, [cursor])

  const {
    data: activity = { changes: [], daily: [] } as Activity,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['brand-activity', brand?.id, cursor.year, cursor.month],
    queryFn: async () => {
      // Send both the new (detail+month) and legacy (from/to) params: a new
      // deploy returns `{ changes, daily }` keyed off detail=daily; an old
      // deploy ignores the unknowns and still honours from/to → we normalize
      // whichever shape comes back.
      const res = await get<unknown>(`/brands/${brand!.id}/activity`, {
        params: { detail: 'daily', month, from, to },
      })
      return normalizeActivity(res.data)
    },
    enabled: open && !!brand,
  })

  useEffect(() => {
    if (error) {
      toast.error('Failed to load activity log', {
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }, [error])

  const days = useMemo(() => mergeDays(activity.changes, activity.daily), [activity])
  const totals = useMemo(
    () =>
      activity.daily.reduce(
        (acc, d) => ({ orders: acc.orders + (d.orders ?? 0), revenue: acc.revenue + (d.revenue ?? 0) }),
        { orders: 0, revenue: 0 },
      ),
    [activity.daily],
  )
  const isEmpty = totals.orders === 0 && activity.changes.length === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{brand?.name ?? 'Brand'} — activity log</DialogTitle>
          <DialogDescription>
            Orders and Active / Inactive changes for this brand, per day.
          </DialogDescription>
        </DialogHeader>

        {/* Month selector — defaults to current month, no future months */}
        <div className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-3 py-2">
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => setCursor((c) => shiftMonth(c, -1))}
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold text-zinc-200">
            {MONTH_FMT.format(new Date(cursor.year, cursor.month, 1))}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => setCursor((c) => shiftMonth(c, 1))}
            disabled={isCurrentMonth}
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Month totals — only when there were orders this month. */}
        {!isLoading && !error && totals.orders > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
            <TrendingUp className="h-4 w-4 shrink-0" />
            <span className="font-semibold tabular-nums">{totals.orders.toLocaleString()}</span>
            <span className="text-emerald-400/80">orders</span>
            <span className="text-emerald-500/50">·</span>
            <span className="font-semibold tabular-nums">{fmtPHP(totals.revenue)}</span>
            <span className="text-emerald-400/80">this month</span>
          </div>
        )}

        {isLoading ? (
          <p className="py-6 text-center text-sm text-zinc-500">Loading activity…</p>
        ) : error ? (
          <p className="py-6 text-center text-sm text-red-400">Failed to load activity log.</p>
        ) : isEmpty ? (
          <EmptyState
            icon={History}
            title="No orders or status changes this month"
            description="This brand had no simulated/real orders and no active/inactive changes in the selected month."
            className="border-none bg-transparent py-10"
          />
        ) : (
          <div className="space-y-3">
            {days.map((g) => (
              <Card key={g.key} className="border-border bg-card">
                <CardContent className="p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                      {g.label}
                    </p>
                    {g.summary && <p className="text-xs text-zinc-500">{g.summary}</p>}
                  </div>

                  {/* Order roll-up for the day (the "simulated runs"). */}
                  {g.orders > 0 && (
                    <div className="mb-2 flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-1.5 text-sm">
                      <TrendingUp className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      <span className="font-semibold tabular-nums text-emerald-300">
                        {g.orders.toLocaleString()}
                      </span>
                      <span className="text-emerald-400/70">
                        {g.orders === 1 ? 'order' : 'orders'}
                      </span>
                      <span className="ml-auto font-semibold tabular-nums text-emerald-300">
                        {fmtPHP(g.revenue)}
                      </span>
                    </div>
                  )}

                  {/* Status-toggle change rows (existing rendering). */}
                  {g.events.length > 0 && (
                    <ul className="space-y-1.5">
                      {g.events.map((e) => (
                        <li key={e.id} className="flex flex-wrap items-center gap-2 text-sm">
                          <Badge
                            variant="outline"
                            className={
                              e.status === 'ACTIVE'
                                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                                : 'border-zinc-600/50 bg-zinc-800/60 text-zinc-400'
                            }
                          >
                            {e.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                          </Badge>
                          <span className="text-zinc-300">{timeLabel(e.changedAt)}</span>
                          {e.note && <span className="text-zinc-500">— {e.note}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
