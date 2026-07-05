/**
 * Printers — Auto Printing & Ticket Management (M6)
 *
 * Business Rule #6: The web app NEVER prints directly.
 *   - This page ONLY displays print-job status and offers reprint.
 *   - Physical printing is handled exclusively by the desktop Print Agent
 *     which pulls PENDING jobs and drives physical printers via ESC/POS.
 *   - Reprint = POST /print-jobs/{id}/reprint → new PENDING job for the Agent.
 *
 * Business Rule #7: Every PrintJob ends in PRINTED or FAILED and is reprintable.
 *
 * Realtime:
 *   - print.status   → updates a job row in the queue table
 *   - printer.status → updates printer health panel
 *
 * RBAC: SUPER_ADMIN | KITCHEN_STAFF may reprint (server-enforced; UI also gated).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Clock,
  Printer,
  RefreshCw,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { toast } from 'sonner'
import type { ColumnDef } from '@tanstack/react-table'
import { get, post } from '../lib/api'
import { onSocketEvent, onSocketReconnect } from '../lib/socket'
import type { PrintStatusPayload, PrinterStatusPayload } from '../lib/socket'
import { useAuth } from '../auth/AuthContext'
import type { UserRole } from '../auth/AuthContext'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Switch } from '../components/ui/switch'
import PageHeader from '../components/common/PageHeader'
import KpiCard from '../components/common/KpiCard'
import KpiRibbon from '../components/common/KpiRibbon'
import DataTable from '../components/common/DataTable'
import EmptyState from '../components/common/EmptyState'
import { PLATFORM_NAME } from '../lib/branding'

// ─── Domain types ──────────────────────────────────────────────────────────────

type PrintJobStatus = 'PENDING' | 'PRINTED' | 'FAILED'
type PrinterStatus  = 'ONLINE' | 'OFFLINE' | 'ERROR'
type PrinterConn    = 'USB' | 'NETWORK' | 'SERIAL'

interface KotItem {
  qty:    number
  name:   string
  notes?: string | null
}

interface PrintJobPayload {
  brand?:     string
  aggregator?: string
  order_ref?: string
  station?:   string
  items?:     KotItem[]
  [key: string]: unknown
}

interface PrintJob {
  id:         string
  orderId:    string
  stationId:  string
  printerId:  string
  status:     PrintJobStatus
  error:      string | null
  createdAt:  string
  printedAt:  string | null
  payload:    PrintJobPayload | null
}

interface PrinterDevice {
  id:         string
  name:       string
  connection: PrinterConn
  address:    string
  status:     PrinterStatus
  lastSeen:   string | null
}

interface Station {
  id:   string
  name: string
}

// ─── RBAC ──────────────────────────────────────────────────────────────────────

const CAN_REPRINT: UserRole[] = ['SUPER_ADMIN', 'KITCHEN_STAFF']

function hasRole(role: UserRole | undefined, allowed: UserRole[]): boolean {
  return !!role && allowed.includes(role)
}

// ─── Print-job status badge classes ───────────────────────────────────────────

function printJobBadgeClass(status: PrintJobStatus): string {
  switch (status) {
    case 'PENDING': return 'bg-amber-500/15 text-amber-400 ring-1 ring-inset ring-amber-500/30'
    case 'PRINTED': return 'bg-emerald-500/15 text-emerald-400 ring-1 ring-inset ring-emerald-500/30'
    case 'FAILED':  return 'bg-red-500/15 text-red-400 ring-1 ring-inset ring-red-500/30'
  }
}

// ─── Printer-device status badge + icon ────────────────────────────────────────

function printerBadgeClass(status: PrinterStatus): string {
  switch (status) {
    case 'ONLINE':  return 'bg-emerald-500/15 text-emerald-400 ring-1 ring-inset ring-emerald-500/30'
    case 'OFFLINE': return 'bg-zinc-500/15 text-zinc-400 ring-1 ring-inset ring-zinc-500/30'
    case 'ERROR':   return 'bg-red-500/15 text-red-400 ring-1 ring-inset ring-red-500/30'
  }
}

function ConnIcon({ status }: { status: PrinterStatus }) {
  if (status === 'ONLINE') {
    return <Wifi className="h-4 w-4 text-emerald-400" aria-hidden />
  }
  return <WifiOff className="h-4 w-4 text-zinc-500" aria-hidden />
}

// ─── Time helpers ──────────────────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
  if (!iso) return '—'
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60)  return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60)  return `${mins}m ago`
  const hrs  = Math.floor(mins / 60)
  if (hrs  < 24)  return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function shortTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
}

// ─── Thermal receipt preview ───────────────────────────────────────────────────

function ThermalPreview({ job }: { job: PrintJob | null }) {
  if (!job || !job.payload) {
    return (
      <EmptyState
        icon={Printer}
        title="No ticket selected"
        description='Click "Preview" on any job in the queue to see its KOT here.'
        className="border-dashed"
      />
    )
  }

  const { brand, aggregator, order_ref, station, items = [] } = job.payload

  return (
    <div
      className="rounded-lg border border-zinc-700 bg-zinc-950 p-4 font-mono text-[11px] leading-relaxed text-zinc-200"
      role="region"
      aria-label="KOT ticket preview (read-only)"
    >
      {/* Brand / header */}
      <div className="mb-1 text-center text-[13px] font-bold uppercase tracking-widest text-zinc-50">
        {brand ?? 'Kitchen'}
      </div>
      {aggregator && (
        <div className="mb-0.5 text-center text-zinc-400">[{aggregator}]</div>
      )}
      <div className="mb-3 text-center text-zinc-300">
        Order:{' '}
        <span className="font-bold tabular-nums text-zinc-50">{order_ref ?? '—'}</span>
      </div>

      {/* Divider */}
      <div className="mb-2 border-t border-dashed border-zinc-700" />

      {/* Station */}
      {station && (
        <div className="mb-2 text-zinc-400">Station: {station}</div>
      )}

      {/* Items */}
      {items.length > 0 ? (
        <table className="w-full">
          <thead>
            <tr className="border-b border-dashed border-zinc-700">
              <th className="pb-1 text-left text-[10px] font-normal uppercase tracking-wide text-zinc-500">
                Qty
              </th>
              <th className="pb-1 text-left text-[10px] font-normal uppercase tracking-wide text-zinc-500">
                Item
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <tr key={i}>
                <td className="py-0.5 pr-3 tabular-nums text-zinc-300">{item.qty}x</td>
                <td className="py-0.5 text-zinc-200">
                  {item.name}
                  {item.notes && (
                    <div className="text-[10px] text-zinc-500">* {item.notes}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="text-zinc-500">No items in payload</div>
      )}

      {/* Footer */}
      <div className="mt-3 border-t border-dashed border-zinc-700 pt-2 text-center text-zinc-500">
        -- KOT --&nbsp;
        {new Date(job.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </div>
      <div className="mt-1 text-center text-[9px] uppercase tracking-widest text-zinc-600">
        Printed by {PLATFORM_NAME} Print Agent
      </div>
    </div>
  )
}

// ─── Presentational print-rule toggles ────────────────────────────────────────

const PRINT_RULES = [
  { id: 'route_category',  label: 'Route by Item Category',  defaultOn: true  },
  { id: 'route_order',     label: 'Route by Order Type',     defaultOn: false },
  { id: 'consolidated',    label: 'Consolidated Printing',   defaultOn: false },
  { id: 'auto_reprint',    label: 'Auto Reprint on Failure', defaultOn: true  },
] as const

type RuleId = typeof PRINT_RULES[number]['id']

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function Printers() {
  const { user } = useAuth()
  const canReprint = hasRole(user?.role, CAN_REPRINT)

  const [printers,     setPrinters]     = useState<PrinterDevice[]>([])
  const [jobs,         setJobs]         = useState<PrintJob[]>([])
  const [stations,     setStations]     = useState<Station[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string | null>(null)
  const [selectedJob,  setSelectedJob]  = useState<PrintJob | null>(null)
  const [reprintingId, setReprintingId] = useState<string | null>(null)
  const [printRules,   setPrintRules]   = useState<Record<RuleId, boolean>>(
    () => Object.fromEntries(PRINT_RULES.map(r => [r.id, r.defaultOn])) as Record<RuleId, boolean>,
  )

  // Lookup maps for resolving IDs → names in table cells
  const stationMap = useMemo(
    () => new Map(stations.map(s => [s.id, s.name])),
    [stations],
  )
  const printerMap = useMemo(
    () => new Map(printers.map(p => [p.id, p.name])),
    [printers],
  )

  // ── Initial data load ──────────────────────────────────────────────────────
  // Wrapped in useCallback (stable identity, no external deps — it fetches
  // printers/stations/print-jobs fresh from the API every call) so it can
  // also be re-invoked on socket reconnect to catch up on any missed
  // print.status / printer.status events (Business Rule #9).
  const load = useCallback(async (cancelledRef?: { current: boolean }) => {
    setLoading(true)
    setError(null)

    try {
      const [printersRes, stationsRes, pendingRes, printedRes, failedRes] = await Promise.all([
        get<PrinterDevice[]>('/printers'),
        get<Station[]>('/stations'),
        get<PrintJob[]>('/print-jobs?status=PENDING'),
        get<PrintJob[]>('/print-jobs?status=PRINTED'),
        get<PrintJob[]>('/print-jobs?status=FAILED'),
      ])
      if (cancelledRef?.current) return

      setPrinters(printersRes.data)
      setStations(stationsRes.data)

      // Merge all statuses, sort newest-first
      const allJobs = [
        ...failedRes.data,
        ...pendingRes.data,
        ...printedRes.data,
      ]
      allJobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      setJobs(allJobs)
    } catch (e) {
      if (!cancelledRef?.current) {
        setError(e instanceof Error ? e.message : 'Failed to load printer data.')
      }
    } finally {
      if (!cancelledRef?.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const cancelledRef = { current: false }
    void load(cancelledRef)
    return () => { cancelledRef.current = true }
  }, [load])

  // ── Reconnect recovery ─────────────────────────────────────────────────────
  // Printers doesn't own room-join responsibility (Dashboard/Kitchen already
  // join the shared location room) — just refetch on reconnect to catch up
  // on any print.status / printer.status events missed while offline.
  useEffect(() => {
    return onSocketReconnect(() => { void load() })
  }, [load])

  // ── Realtime socket subscriptions ─────────────────────────────────────────
  useEffect(() => {
    // print.status → update job row
    const unsubPrint = onSocketEvent('print.status', (payload: PrintStatusPayload) => {
      setJobs(prev =>
        prev.map(j =>
          j.id === payload.print_job_id
            ? {
                ...j,
                status:    payload.status,
                error:     payload.error ?? j.error,
                printedAt: payload.printed_at ?? j.printedAt,
              }
            : j,
        ),
      )
      // Keep the preview in sync if this job is selected
      setSelectedJob(sel =>
        sel?.id === payload.print_job_id
          ? {
              ...sel,
              status:    payload.status,
              error:     payload.error ?? sel.error,
              printedAt: payload.printed_at ?? sel.printedAt,
            }
          : sel,
      )
    })

    // printer.status → update health panel
    const unsubPrinter = onSocketEvent('printer.status', (payload: PrinterStatusPayload) => {
      setPrinters(prev =>
        prev.map(p =>
          p.id === payload.printer_id
            ? { ...p, status: payload.status, lastSeen: payload.last_seen }
            : p,
        ),
      )
    })

    return () => {
      unsubPrint()
      unsubPrinter()
    }
  }, [])

  // ── Reprint (Business Rule #7) ─────────────────────────────────────────────
  const handleReprint = useCallback(
    async (jobId: string) => {
      if (!canReprint || reprintingId) return
      setReprintingId(jobId)
      try {
        await post(`/print-jobs/${jobId}/reprint`)
        toast.success('Reprint queued', {
          description: 'A new PENDING job has been sent to the Print Agent.',
        })
      } catch (e) {
        toast.error('Reprint failed', {
          description: e instanceof Error ? e.message : 'Could not queue the reprint.',
        })
      } finally {
        setReprintingId(null)
      }
    },
    [canReprint, reprintingId],
  )

  // ── KPI counts ─────────────────────────────────────────────────────────────
  const kpi = useMemo(() => ({
    totalPrinters: printers.length,
    online:  printers.filter(p => p.status === 'ONLINE').length,
    pending: jobs.filter(j => j.status === 'PENDING').length,
    failed:  jobs.filter(j => j.status === 'FAILED').length,
  }), [printers, jobs])

  // ── Table columns ──────────────────────────────────────────────────────────
  const columns = useMemo<ColumnDef<PrintJob, unknown>[]>(
    () => [
      {
        id: 'order_ref',
        header: 'Order Ref',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="font-mono text-xs tabular-nums text-zinc-200">
            {row.original.payload?.order_ref ?? row.original.orderId.slice(0, 8)}
          </span>
        ),
      },
      {
        id: 'station',
        header: 'Station',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-sm text-zinc-300">
            {stationMap.get(row.original.stationId) ?? '—'}
          </span>
        ),
      },
      {
        id: 'printer',
        header: 'Printer',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-sm text-zinc-300">
            {printerMap.get(row.original.printerId) ?? '—'}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <span
            className={[
              'inline-flex items-center rounded-full px-2.5 py-0.5',
              'text-[11px] font-semibold uppercase tracking-wide',
              printJobBadgeClass(row.original.status),
            ].join(' ')}
          >
            {row.original.status}
          </span>
        ),
      },
      {
        id: 'time',
        header: 'Time',
        enableSorting: false,
        cell: ({ row }) => {
          const ts =
            row.original.status === 'PRINTED'
              ? row.original.printedAt
              : row.original.createdAt
          return (
            <span className="tabular-nums text-xs text-zinc-400">
              {shortTime(ts)}
            </span>
          )
        },
      },
      {
        id: 'error',
        header: 'Error',
        enableSorting: false,
        cell: ({ row }) => {
          const { status, error } = row.original
          if (status !== 'FAILED' || !error) {
            return <span className="text-xs text-zinc-600">—</span>
          }
          return (
            <span
              className="max-w-[160px] truncate text-xs text-red-400"
              title={error}
            >
              {error}
            </span>
          )
        },
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) => {
          const job = row.original
          const isReprinting = reprintingId === job.id
          return (
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-zinc-400 hover:text-zinc-200"
                onClick={() => setSelectedJob(job)}
              >
                Preview
              </Button>
              {job.status === 'FAILED' && canReprint && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 border-amber-500/30 px-2 text-xs text-amber-400 hover:border-amber-500/60 hover:text-amber-300"
                  onClick={() => void handleReprint(job.id)}
                  disabled={!!reprintingId}
                  aria-label={`Reprint job ${job.payload?.order_ref ?? job.id}`}
                >
                  <RefreshCw
                    className={['h-3 w-3', isReprinting ? 'animate-spin' : ''].join(' ')}
                    aria-hidden
                  />
                  {isReprinting ? 'Queuing…' : 'Reprint'}
                </Button>
              )}
            </div>
          )
        },
      },
    ],
    [stationMap, printerMap, canReprint, reprintingId, handleReprint],
  )

  // ── Error state ────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex min-h-full flex-col gap-6 px-4 py-6 sm:px-6">
        <PageHeader
          title="Printing & Tickets"
          subtitle="Print queue, printer health, reprints"
        />
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center">
          <p className="text-sm font-medium text-red-400">{error}</p>
          <p className="mt-1 text-xs text-red-500/70">
            Make sure the backend is running on :4000
          </p>
        </div>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-full flex-col gap-6 px-4 py-6 sm:px-6">

      {/* Page header */}
      <PageHeader
        title="Printing & Tickets"
        subtitle="Print queue, printer health, reprints"
      />

      {/* Print-separation notice — Business Rule #6 */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-400">
        <Printer className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          The web app queues print jobs only — it does not print directly.
          The desktop{' '}
          <span className="font-semibold text-amber-300">Print Agent</span>
          {' '}polls this queue and drives physical printers via ESC/POS.
          Use <span className="font-semibold text-amber-300">Reprint</span> to re-enqueue a failed job for the Agent.
        </span>
      </div>

      {/* KPI ribbon */}
      <KpiRibbon className="xl:grid-cols-4">
        <KpiCard
          icon={Printer}
          label="Printers"
          value={kpi.totalPrinters}
        />
        <KpiCard
          icon={Wifi}
          label="Online"
          value={kpi.online}
        />
        <KpiCard
          icon={Clock}
          label="Pending Jobs"
          value={kpi.pending}
        />
        <KpiCard
          icon={AlertTriangle}
          label="Failed Jobs"
          value={kpi.failed}
        />
      </KpiRibbon>

      {/* Two-column layout */}
      <div className="flex min-w-0 flex-col gap-6 lg:flex-row">

        {/* ── Left: queue + printer health ─────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col gap-6">

          {/* Live Print Queue */}
          <Card className="border-border bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-zinc-300">
                <Clock className="h-4 w-4 text-emerald-500" aria-hidden />
                Live Print Queue
                <span className="ml-auto text-xs font-normal tabular-nums text-zinc-500">
                  {jobs.length} job{jobs.length !== 1 ? 's' : ''}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <DataTable<PrintJob>
                columns={columns}
                data={jobs}
                loading={loading}
                searchPlaceholder="Search by order ref…"
                emptyTitle="No print jobs"
                emptyDescription="Start the simulator to generate orders and print jobs."
                pageSize={10}
              />
            </CardContent>
          </Card>

          {/* Printer Health */}
          <Card className="border-border bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-zinc-300">
                <Printer className="h-4 w-4 text-emerald-500" aria-hidden />
                Printer Health
                <span className="ml-auto text-xs font-normal tabular-nums text-zinc-500">
                  {kpi.online}/{kpi.totalPrinters} online
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {loading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => (
                    <div
                      key={i}
                      className="h-14 animate-pulse rounded-lg bg-zinc-800/60"
                    />
                  ))}
                </div>
              ) : printers.length === 0 ? (
                <EmptyState
                  icon={Printer}
                  title="No printers configured"
                  description="Add printers in the system settings or seed the database."
                />
              ) : (
                <div className="divide-y divide-border">
                  {printers.map(printer => (
                    <div
                      key={printer.id}
                      className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                    >
                      <ConnIcon status={printer.status} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-zinc-200">
                            {printer.name}
                          </span>
                          <span
                            className={[
                              'inline-flex items-center rounded-full px-2 py-0.5',
                              'text-[10px] font-semibold uppercase tracking-wide',
                              printerBadgeClass(printer.status),
                            ].join(' ')}
                          >
                            {printer.status}
                          </span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-500">
                          <span>{printer.connection}</span>
                          {printer.address && (
                            <>
                              <span aria-hidden>·</span>
                              <span className="font-mono">{printer.address}</span>
                            </>
                          )}
                          {printer.lastSeen && (
                            <>
                              <span aria-hidden>·</span>
                              <span>Last seen {relativeTime(printer.lastSeen)}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Right: ticket preview + print rules ──────────────────────────── */}
        <div className="flex w-full shrink-0 flex-col gap-6 lg:w-80">

          {/* Station-wise Ticket Preview */}
          <Card className="border-border bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-zinc-300">
                <Printer className="h-4 w-4 text-emerald-500" aria-hidden />
                Ticket Preview
              </CardTitle>
              <p className="text-[11px] leading-snug text-zinc-500">
                Read-only KOT from the print-job payload.
                Click{' '}
                <span className="font-medium text-zinc-400">Preview</span>
                {' '}on any queue row.
              </p>
            </CardHeader>
            <CardContent className="pt-0">
              <ThermalPreview job={selectedJob} />
            </CardContent>
          </Card>

          {/* Smart Print Rules (presentational) */}
          <Card className="border-border bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-zinc-300">
                Smart Print Rules
              </CardTitle>
              <p className="text-[11px] leading-snug text-zinc-500">
                Presentational only — configure routing in the Print Agent settings
                for production use.
              </p>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
              {PRINT_RULES.map(rule => (
                <div
                  key={rule.id}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="text-sm text-zinc-300">{rule.label}</span>
                  <Switch
                    checked={printRules[rule.id] ?? rule.defaultOn}
                    onCheckedChange={val =>
                      setPrintRules(prev => ({ ...prev, [rule.id]: val }))
                    }
                    aria-label={rule.label}
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
