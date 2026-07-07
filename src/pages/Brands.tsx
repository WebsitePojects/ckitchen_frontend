import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Tags, CheckCircle2, XCircle, Store, History } from 'lucide-react'
import { get } from '../lib/api'
import { useOutlet } from '../context/OutletContext'
import PageContainer from '../components/layout/PageContainer'
import PageHeader from '../components/common/PageHeader'
import KpiCard from '../components/common/KpiCard'
import KpiRibbon from '../components/common/KpiRibbon'
import EmptyState from '../components/common/EmptyState'
import { Card, CardContent } from '../components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../components/ui/dialog'

interface Brand {
  id: string
  name: string
  color: string
  logoUrl?: string | null
  salesPerfId?: string | null
  isActive: boolean
}

interface ActivityEvent {
  id: string
  status: 'ACTIVE' | 'INACTIVE'
  changed_at: string
  note?: string | null
}

/** A contiguous ACTIVE→INACTIVE window (INACTIVE end absent = still active). */
interface Window {
  start: string
  end: string | null
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

/** Groups chronological status events into active windows, bucketed per calendar day. */
function toDailyWindows(events: ActivityEvent[]): { day: string; windows: Window[] }[] {
  const byDay = new Map<string, ActivityEvent[]>()
  for (const e of events) {
    const key = new Date(e.changed_at).toDateString()
    const list = byDay.get(key) ?? []
    list.push(e)
    byDay.set(key, list)
  }

  const out: { day: string; windows: Window[] }[] = []
  for (const [, dayEvents] of byDay) {
    const windows: Window[] = []
    let open: string | null = null
    for (const e of dayEvents) {
      if (e.status === 'ACTIVE') {
        if (open === null) open = e.changed_at
      } else {
        if (open !== null) {
          windows.push({ start: open, end: e.changed_at })
          open = null
        } else {
          // INACTIVE with no matching ACTIVE this day — show as a closed marker.
          windows.push({ start: e.changed_at, end: e.changed_at })
        }
      }
    }
    if (open !== null) windows.push({ start: open, end: null })
    out.push({ day: dayLabel(dayEvents[0].changed_at), windows })
  }
  return out
}

export default function Brands() {
  const { selectedOutletId } = useOutlet()

  // Cache-first (perf): navigating back to Brands from another page shows
  // the last-fetched list instantly instead of a fresh loading spinner.
  // Keyed by selectedOutletId per the outlet-cache-correctness rule — GET
  // /brands isn't currently outlet-filtered server-side (it returns every
  // brand regardless of X-Outlet-Id), but keying by outlet anyway means this
  // stays correct for free if/when that filtering lands, at the cost of one
  // extra (identical) fetch per outlet switch today.
  const {
    data: brands = [],
    isLoading: loading,
    error: queryError,
  } = useQuery({
    queryKey: ['brands', selectedOutletId],
    queryFn: async () => (await get<Brand[]>('/brands')).data,
  })
  const error = queryError ? (queryError instanceof Error ? queryError.message : 'Failed to load brands') : null

  // Per-brand activity dialog state
  const [activityBrand, setActivityBrand] = useState<Brand | null>(null)
  const [activity, setActivity] = useState<ActivityEvent[]>([])
  const [activityLoading, setActivityLoading] = useState(false)
  const [activityError, setActivityError] = useState<string | null>(null)

  const openActivity = (brand: Brand) => {
    setActivityBrand(brand)
    setActivity([])
    setActivityError(null)
    setActivityLoading(true)
    get<{ events: ActivityEvent[] }>(`/brands/${brand.id}/activity`)
      .then((r) => setActivity(r.data.events))
      .catch((e) => setActivityError(e?.message ?? 'Failed to load activity'))
      .finally(() => setActivityLoading(false))
  }

  const dailyWindows = useMemo(() => toDailyWindows(activity), [activity])

  const active = useMemo(() => brands.filter((b) => b.isActive).length, [brands])

  return (
    <PageContainer>
      <PageHeader title="Brands" subtitle="Every food brand under this cloud kitchen" />

      <KpiRibbon>
        <KpiCard icon={Tags} label="Total Brands" value={brands.length} />
        <KpiCard icon={CheckCircle2} label="Active" value={active} />
        <KpiCard icon={XCircle} label="Inactive" value={brands.length - active} />
        <KpiCard icon={Store} label="Location" value="1" />
      </KpiRibbon>

      {loading ? (
        <p className="text-sm text-zinc-500">Loading brands…</p>
      ) : error ? (
        <p className="text-sm text-red-400">{error}</p>
      ) : brands.length === 0 ? (
        <EmptyState icon={Tags} title="No brands" description="Add a brand from Merchant Management." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {brands.map((b) => (
            <Card key={b.id} className="border-border bg-card">
              <CardContent className="p-5">
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg font-bold text-white"
                    style={{ backgroundColor: b.color }}
                  >
                    {b.name.charAt(0)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-zinc-100">{b.name}</p>
                    <p className="text-xs text-zinc-500">{b.salesPerfId ?? 'No sales ID'}</p>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${b.isActive ? 'bg-emerald-400' : 'bg-zinc-600'}`}
                    />
                    <span className={b.isActive ? 'text-emerald-400' : 'text-zinc-500'}>
                      {b.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                    <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: b.color }} />
                    {b.color}
                  </span>
                </div>
                <button
                  onClick={() => openActivity(b)}
                  className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-zinc-300 transition-colors duration-200 hover:bg-zinc-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                >
                  <History className="h-3.5 w-3.5" />
                  Activity history
                </button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Brand activity dialog (MOTM 2026-07-01) ── */}
      <Dialog open={activityBrand !== null} onOpenChange={(o) => { if (!o) setActivityBrand(null) }}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{activityBrand?.name} — activity this month</DialogTitle>
            <DialogDescription>
              Active/inactive windows per day (from the merchant on/off toggles).
            </DialogDescription>
          </DialogHeader>

          {activityLoading ? (
            <p className="text-sm text-zinc-500">Loading…</p>
          ) : activityError ? (
            <p className="text-sm text-red-400">{activityError}</p>
          ) : dailyWindows.length === 0 ? (
            <p className="text-sm text-zinc-500">No activity recorded this month.</p>
          ) : (
            <div className="space-y-3">
              {dailyWindows.map((d) => (
                <div key={d.day} className="rounded-lg border border-border p-3">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                    {d.day}
                  </p>
                  <ul className="space-y-1">
                    {d.windows.map((w, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm text-zinc-200">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        {w.end === null
                          ? `${timeLabel(w.start)} – still active`
                          : w.start === w.end
                            ? `${timeLabel(w.start)} – marked inactive`
                            : `${timeLabel(w.start)} – ${timeLabel(w.end)}`}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
