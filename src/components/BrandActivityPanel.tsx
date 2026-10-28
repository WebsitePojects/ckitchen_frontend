import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, History } from 'lucide-react'
import { get } from '../lib/api'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
import EmptyState from './common/EmptyState'

/**
 * Mirrors `GET /brands/:id/activity?detail=daily&month=` (MOTM 2026-07-01 item 10, reworked
 * 2026-07-08). Field names are camelCase straight off the backend response: a snake_case
 * mismatch once silently dropped every event here.
 */
interface ActivityEvent {
  id: string
  status: 'ACTIVE' | 'INACTIVE'
  changedAt: string
  note: string | null
}

/** One business day of orders (dense: every day of the month, zeros included). */
interface DailyStat {
  date: string // 'YYYY-MM-DD'
  orders: number
  revenue: number
}

interface Activity {
  changes: ActivityEvent[]
  daily: DailyStat[]
}

/** One day worth showing: its orders plus any Active / Inactive switches. */
interface MergedDay {
  date: string
  orders: number
  revenue: number
  events: ActivityEvent[]
  /** "Open 7:00 AM – 10:00 PM" from paired ACTIVE → INACTIVE switches; null when none pair up. */
  summary: string | null
}

const MONTH_FMT = new Intl.DateTimeFormat([], { month: 'long', year: 'numeric' })
const php = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 })

const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/** 'YYYY-MM-DD' of an instant in the viewer's calendar (the business runs in one timezone). */
function localDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y!, m! - 1, d!).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

/** The month this calendar is on, as 'YYYY-MM'. */
export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function isMonthKey(v: string | null): v is string {
  return !!v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v)
}

function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number)
  return currentMonthKey(new Date(y!, m! - 1 + delta, 1))
}

/**
 * Days with orders or switches, newest first. Empty days are skipped so this reads as a log,
 * not a calendar of zeros. Switches arrive oldest-first, so ACTIVE → INACTIVE pairs in order.
 */
function mergeDays({ changes, daily }: Activity): MergedDay[] {
  const eventsByDay = new Map<string, ActivityEvent[]>()
  for (const e of changes) {
    const key = localDate(e.changedAt)
    eventsByDay.set(key, [...(eventsByDay.get(key) ?? []), e])
  }
  const dates = new Set([...daily.filter((d) => d.orders > 0).map((d) => d.date), ...eventsByDay.keys()])
  const statByDay = new Map(daily.map((d) => [d.date, d]))

  return [...dates]
    .sort((a, b) => b.localeCompare(a))
    .map((date) => {
      const events = eventsByDay.get(date) ?? []
      const windows: string[] = []
      let openedAt: string | null = null
      for (const e of events) {
        if (e.status === 'ACTIVE') openedAt ??= e.changedAt
        else if (openedAt !== null) {
          windows.push(`${timeLabel(openedAt)} – ${timeLabel(e.changedAt)}`)
          openedAt = null
        }
      }
      if (openedAt !== null) windows.push(`${timeLabel(openedAt)} onwards`)
      const stat = statByDay.get(date)
      return {
        date,
        orders: stat?.orders ?? 0,
        revenue: stat?.revenue ?? 0,
        events,
        summary: windows.length > 0 ? `Open ${windows.join(', ')}` : null,
      }
    })
}

/**
 * One brand's activity for one month: orders and revenue per day, and every time the brand was
 * switched Active / Inactive. Lives in the Activity Log page's Brands tab; the parent owns the
 * brand and month (both in the URL, so a link opens the same view).
 *
 * The server scopes it like every report: the selected outlet's orders only, and a brand outside
 * the viewer's brands or outlets is a 404 ("not found" below).
 */
export default function BrandActivityPanel({
  brandId,
  outletId,
  month,
  onMonthChange,
}: {
  brandId: string
  outletId: string | null
  month: string
  onMonthChange: (month: string) => void
}) {
  const query = useQuery({
    queryKey: ['brand-activity', brandId, month, outletId ?? 'ALL'],
    queryFn: async () => (await get<Activity>(`/brands/${brandId}/activity`, { params: { detail: 'daily', month } })).data,
    // Paging months keeps the last month on screen (dimmed) instead of blanking; another brand
    // or outlet starts empty so its numbers never sit under the wrong name.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === brandId && previousQuery.queryKey[3] === (outletId ?? 'ALL') ? previous : undefined,
  })

  const days = useMemo(() => (query.data ? mergeDays(query.data) : []), [query.data])
  const totals = useMemo(
    () => ({
      orders: query.data?.daily.reduce((n, d) => n + d.orders, 0) ?? 0,
      revenue: query.data?.daily.reduce((n, d) => n + d.revenue, 0) ?? 0,
      switches: query.data?.changes.length ?? 0,
    }),
    [query.data],
  )
  const isCurrentMonth = month === currentMonthKey()
  const [y, m] = month.split('-').map(Number)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2" role="group" aria-label="Month">
        <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => onMonthChange(shiftMonth(month, -1))} aria-label="Previous month">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-36 text-center text-sm font-semibold tabular-nums text-foreground" aria-live="polite">
          {MONTH_FMT.format(new Date(y!, m! - 1, 1))}
        </span>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9"
          onClick={() => onMonthChange(shiftMonth(month, 1))}
          disabled={isCurrentMonth}
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {query.isPending ? (
        <div className="h-40 animate-pulse rounded-lg bg-secondary/60" aria-busy="true" aria-label="Loading activity" />
      ) : query.isError ? (
        <p className="text-sm text-danger-text">
          {query.error instanceof Error ? query.error.message : 'Could not load this brand\'s activity.'}
        </p>
      ) : (
        <div
          className={cn('flex flex-col gap-4 transition-opacity duration-200', query.isPlaceholderData && 'pointer-events-none opacity-50')}
          aria-busy={query.isPlaceholderData}
        >
          <section aria-label="Month totals" className="figures">
            <div>
              <p className="eyebrow">Orders</p>
              <p className="mt-1 text-ws-figure font-semibold tabular-nums text-foreground">{totals.orders.toLocaleString()}</p>
            </div>
            <div>
              <p className="eyebrow">Revenue</p>
              <p className="mt-1 text-ws-figure font-semibold tabular-nums text-foreground">{php.format(totals.revenue)}</p>
            </div>
            <div>
              <p className="eyebrow">Active / inactive switches</p>
              <p className="mt-1 text-ws-figure font-semibold tabular-nums text-foreground">{totals.switches}</p>
            </div>
          </section>

          {days.length === 0 ? (
            <EmptyState
              icon={History}
              title="Nothing this month"
              description="No orders and no Active / Inactive switches for this brand in the selected month."
            />
          ) : (
            <ol className="divide-y divide-border border-y border-border" aria-label="Days">
              {days.map((d) => (
                <li key={d.date} className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-start sm:gap-6">
                  <div className="sm:w-40 sm:shrink-0">
                    <p className="text-sm font-medium text-foreground">{dayLabel(d.date)}</p>
                    {d.summary && <p className="text-xs text-muted-foreground">{d.summary}</p>}
                  </div>
                  <ul className="flex min-w-0 flex-1 flex-col gap-1">
                    {d.events.map((e) => (
                      <li key={e.id} className={cn('status text-sm', e.status === 'ACTIVE' ? 'status-ok' : 'status-warn')}>
                        {e.status === 'ACTIVE' ? 'Switched active' : 'Switched inactive'} at {timeLabel(e.changedAt)}
                        {e.note && <span className="text-muted-foreground"> · {e.note}</span>}
                      </li>
                    ))}
                  </ul>
                  <p className="text-sm tabular-nums text-foreground sm:w-44 sm:text-right">
                    {d.orders > 0 ? (
                      <>
                        {d.orders.toLocaleString()} {d.orders === 1 ? 'order' : 'orders'} · <span className="font-semibold">{php.format(d.revenue)}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">No orders</span>
                    )}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  )
}
