import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, History } from 'lucide-react'
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

interface DayGroup {
  key: number
  label: string
  events: ActivityEvent[]
  /** Best-effort "Active 7:00 AM – 10:00 PM" summary; null if nothing to pair. */
  summary: string | null
}

interface MonthCursor {
  year: number
  month: number // 0-indexed, matches Date
}

const MONTH_FMT = new Intl.DateTimeFormat([], { month: 'long', year: 'numeric' })

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

function currentCursor(): MonthCursor {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() }
}

function shiftMonth(c: MonthCursor, delta: number): MonthCursor {
  const d = new Date(c.year, c.month + delta, 1)
  return { year: d.getFullYear(), month: d.getMonth() }
}

/** [from, to] ISO bounds for a calendar month; `to` clamps to "now" for the current month. */
function monthRange(c: MonthCursor): { from: string; to: string } {
  const from = new Date(c.year, c.month, 1, 0, 0, 0, 0)
  const now = new Date()
  const isCurrent = c.year === now.getFullYear() && c.month === now.getMonth()
  const to = isCurrent ? now : new Date(c.year, c.month + 1, 0, 23, 59, 59, 999)
  return { from: from.toISOString(), to: to.toISOString() }
}

/**
 * Groups chronological events into calendar-day buckets (newest day first).
 * Per day, pairs consecutive ACTIVE → INACTIVE transitions into a human
 * summary ("Active 7:00 AM – 10:00 PM"); a trailing unmatched ACTIVE means the
 * brand was still active at day's end (or is active right now, for today).
 */
function groupByDay(events: ActivityEvent[]): DayGroup[] {
  const byDay = new Map<number, ActivityEvent[]>()
  for (const e of events) {
    const d = new Date(e.changedAt)
    const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    const list = byDay.get(key) ?? []
    list.push(e)
    byDay.set(key, list)
  }

  const groups: DayGroup[] = Array.from(byDay.entries()).map(([key, dayEvents]) => {
    // dayEvents are already chronological — the backend returns oldest-first.
    const windows: string[] = []
    let openStart: string | null = null
    for (const e of dayEvents) {
      if (e.status === 'ACTIVE') {
        if (openStart === null) openStart = e.changedAt
      } else if (openStart !== null) {
        windows.push(`${timeLabel(openStart)} – ${timeLabel(e.changedAt)}`)
        openStart = null
      }
    }
    if (openStart !== null) windows.push(`${timeLabel(openStart)} – now`)

    return {
      key,
      label: dayLabel(dayEvents[0].changedAt),
      events: dayEvents,
      summary: windows.length > 0 ? `Active ${windows.join(', ')}` : null,
    }
  })

  groups.sort((a, b) => b.key - a.key) // newest day first
  return groups
}

/**
 * Per-brand Active/Inactive activity log (MOTM 2026-07-01 item 10): "Wants to
 * see a log of which brand is active at a specific time per day — per brand
 * per day, Active and Inactive, sorted per month." Opened from a row action
 * on the Brands page; scoped to one brand + one calendar month at a time.
 */
export default function BrandActivityLog({ brand, open, onOpenChange }: BrandActivityLogProps) {
  const [cursor, setCursor] = useState<MonthCursor>(currentCursor)

  // Reset to the current month whenever the dialog opens (fresh brand or
  // reopened) — avoids showing a stale month left over from a prior brand.
  useEffect(() => {
    if (open) setCursor(currentCursor())
  }, [open, brand?.id])

  const { from, to } = useMemo(() => monthRange(cursor), [cursor])
  const isCurrentMonth = useMemo(() => {
    const now = currentCursor()
    return cursor.year === now.year && cursor.month === now.month
  }, [cursor])

  const {
    data: events = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['brand-activity', brand?.id, cursor.year, cursor.month],
    queryFn: async () =>
      (
        await get<{ events: ActivityEvent[] }>(`/brands/${brand!.id}/activity`, {
          params: { from, to },
        })
      ).data.events,
    enabled: open && !!brand,
  })

  useEffect(() => {
    if (error) {
      toast.error('Failed to load activity log', {
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }, [error])

  const groups = useMemo(() => groupByDay(events), [events])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{brand?.name ?? 'Brand'} — activity log</DialogTitle>
          <DialogDescription>
            Active / Inactive history for this brand, grouped per day.
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

        {isLoading ? (
          <p className="py-6 text-center text-sm text-zinc-500">Loading activity…</p>
        ) : error ? (
          <p className="py-6 text-center text-sm text-red-400">Failed to load activity log.</p>
        ) : groups.length === 0 ? (
          <EmptyState
            icon={History}
            title="No activity this month"
            description="No active/inactive changes were recorded for this brand in the selected month."
            className="border-none bg-transparent py-10"
          />
        ) : (
          <div className="space-y-3">
            {groups.map((g) => (
              <Card key={g.key} className="border-border bg-card">
                <CardContent className="p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                      {g.label}
                    </p>
                    {g.summary && <p className="text-xs text-zinc-500">{g.summary}</p>}
                  </div>
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
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
