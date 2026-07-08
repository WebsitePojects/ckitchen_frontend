import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, ListChecks, Store, Wallet, History } from 'lucide-react'
import { get } from '../lib/api'
import type { OutletSummary } from '../context/OutletContext'
import EmptyState from './common/EmptyState'
import { Badge } from './ui/badge'
import { Input } from './ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'

// ---------------------------------------------------------------------------
// Types (mirror backend GET /admin/users/:id/performance —
// ckitchen_backend src/modules/admin/routes.ts)
// ---------------------------------------------------------------------------

/** Minimal user shape this dialog needs; the page passes a full AdminUser. */
export interface PerfTargetUser {
  id: string
  name: string
  role: string
}

interface PerformanceReport {
  user: { id: string; name: string; role: string }
  period: { from: string; to: string }
  activity: { total: number; byAction: Array<{ action: string; count: number }> }
  /**
   * PROXY METRIC (see backend comment): distinct orders this user advanced a
   * stage on (audit `order.advance`), NOT a first-class "orders handled" fact.
   */
  ordersHandled: number
  outlet: { locationIds: string[]; orders: number; revenue: number }
}

// ---------------------------------------------------------------------------
// Formatting helpers (same ₱ convention as the discount/budget dialogs)
// ---------------------------------------------------------------------------

function money(n: number | undefined): string {
  return `₱${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback
}

/** YYYY-MM-DD for `new Date()` today, in UTC (matches the backend's UTC ranges). */
function todayISODate(): string {
  return new Date().toISOString().slice(0, 10)
}

/** YYYY-MM-01 of the current UTC month — the default range start. */
function monthStartISODate(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

// ---------------------------------------------------------------------------
// A small labelled stat tile.
// ---------------------------------------------------------------------------

function Stat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Activity
  label: string
  value: string | number
  hint?: string
}) {
  return (
    <div className="rounded-lg border border-border bg-zinc-900/40 p-3">
      <div className="flex items-center gap-1.5 text-xs text-zinc-500">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="mt-1 text-xl font-semibold tabular-nums text-zinc-100">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-zinc-600">{hint}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Performance dialog
// ---------------------------------------------------------------------------

export default function UserPerformanceDialog({
  target,
  outlets,
  onOpenChange,
}: {
  target: PerfTargetUser | null
  outlets: OutletSummary[]
  onOpenChange: (open: boolean) => void
}) {
  const [from, setFrom] = useState<string>(monthStartISODate())
  const [to, setTo] = useState<string>(todayISODate())

  // Inclusive whole-day bounds (backend parses full ISO). from → 00:00:00,
  // to → 23:59:59.999 so same-day orders/audit rows are counted.
  const fromIso = `${from}T00:00:00.000Z`
  const toIso = `${to}T23:59:59.999Z`
  const rangeValid = from <= to

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'users', target?.id, 'performance', fromIso, toIso],
    queryFn: async () => {
      const params = new URLSearchParams({ from: fromIso, to: toIso })
      return (await get<PerformanceReport>(`/admin/users/${target!.id}/performance?${params.toString()}`)).data
    },
    enabled: target != null && rangeValid,
  })

  const outletNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const o of outlets) m.set(o.id, o.name)
    return m
  }, [outlets])

  const topActions = data?.activity.byAction.slice(0, 8) ?? []

  return (
    <Dialog open={target != null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>Performance{target ? ` — ${target.name}` : ''}</span>
            {target && (
              <Badge variant="outline" className="border-zinc-500/30 bg-zinc-500/15 text-zinc-300">
                {target.role}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Date range */}
        <div className="flex flex-wrap items-end gap-3 pt-1">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-zinc-500">From</label>
            <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-8 w-40" />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-zinc-500">To</label>
            <Input type="date" value={to} min={from} max={todayISODate()} onChange={(e) => setTo(e.target.value)} className="h-8 w-40" />
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto pt-1">
          {!rangeValid ? (
            <p className="p-4 text-sm text-red-400">"From" must be on or before "To".</p>
          ) : isLoading ? (
            <p className="p-4 text-sm text-zinc-500">Loading…</p>
          ) : error ? (
            <p className="p-4 text-sm text-red-400">{errMsg(error, 'Failed to load performance.')}</p>
          ) : !data ? null : (
            <div className="space-y-5">
              {/* KPI tiles */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat icon={Activity} label="Activity" value={data.activity.total} hint="audited actions" />
                <Stat
                  icon={ListChecks}
                  label="Orders handled"
                  value={data.ordersHandled}
                  hint="stages advanced"
                />
                <Stat icon={Store} label="Outlet orders" value={data.outlet.orders} hint="excl. cancelled" />
                <Stat icon={Wallet} label="Outlet revenue" value={money(data.outlet.revenue)} hint="excl. cancelled" />
              </div>

              {/* Outlet comparison context */}
              <div className="rounded-lg border border-border bg-zinc-900/30 p-3">
                <p className="text-xs font-medium text-zinc-400">Compared against outlet performance</p>
                {data.outlet.locationIds.length === 0 ? (
                  <p className="mt-1 text-xs text-zinc-600">
                    This user has no assigned outlets — nothing to compare against. Outlet totals show 0.
                  </p>
                ) : (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {data.outlet.locationIds.map((id) => (
                      <Badge
                        key={id}
                        variant="outline"
                        className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                      >
                        {outletNameById.get(id) ?? id}
                      </Badge>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-[11px] text-zinc-600">
                  {data.outlet.orders} order{data.outlet.orders === 1 ? '' : 's'} · {money(data.outlet.revenue)} across
                  the user's outlet{data.outlet.locationIds.length === 1 ? '' : 's'} in this period (cancelled
                  excluded).
                </p>
              </div>

              {/* Top actions */}
              <div>
                <p className="mb-1.5 text-xs font-medium text-zinc-400">Top actions</p>
                {topActions.length === 0 ? (
                  <EmptyState
                    icon={History}
                    title="No activity in range"
                    description="This user performed no audited actions in the selected period."
                  />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border hover:bg-transparent">
                        <TableHead>Action</TableHead>
                        <TableHead className="text-right">Count</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topActions.map((a) => (
                        <TableRow key={a.action} className="border-border">
                          <TableCell>
                            <span className="inline-block rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-emerald-400">
                              {a.action}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-zinc-300">{a.count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
