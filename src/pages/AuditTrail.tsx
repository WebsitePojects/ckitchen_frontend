import { useEffect, useMemo, useState } from 'react'
import { ScrollText, Search, ShieldOff } from 'lucide-react'
import { get } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { hasRole } from '../auth/access'
import PageContainer from '../components/layout/PageContainer'
import PageHeader from '../components/common/PageHeader'
import EmptyState from '../components/common/EmptyState'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table'

// ---------------------------------------------------------------------------
// Types (mirror auditLogs schema — camelCase from Drizzle)
// ---------------------------------------------------------------------------

interface AuditLog {
  id: string
  actorUserId: string | null
  actorName: string | null
  sessionId: string | null
  action: string
  description: string | null
  entityType: string | null
  entityId: string | null
  /** metadata jsonb — NOT rendered raw; entityType/entityId are shown instead */
  metadata: unknown
  createdAt: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// All entity types observed in practice + likely ones for filter UX
const ENTITY_TYPES = [
  'order',
  'employee',
  'ingredient',
  'ito',
  'print_job',
  'brand',
  'user',
  'menu_item',
  'aggregator_account',
] as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/** Build query-string from filter params, omitting blank values. */
function buildQuery(params: Record<string, string>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v) q.set(k, v)
  }
  const s = q.toString()
  return s ? `?${s}` : ''
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AuditTrail() {
  const { user } = useAuth()

  // Gate: only OWNER (+ legacy SUPER_ADMIN) and BRAND_MANAGER (mirrors requireRole on the backend)
  const canView = hasRole(user?.role, ['BRAND_MANAGER'])

  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [search, setSearch] = useState('')
  const [entityTypeFilter, setEntityTypeFilter] = useState<string>('ALL')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [rangeError, setRangeError] = useState<string | null>(null)

  // ── Fetch ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!canView) {
      setLoading(false)
      return
    }
    // Inverted date range — block the fetch and surface an inline error instead
    // of silently sending both params to the API (which would just return empty).
    if (fromDate && toDate && fromDate > toDate) {
      setRangeError('From date must be before To date.')
      setLoading(false)
      return
    }
    setRangeError(null)
    setLoading(true)
    setError(null)
    const qs = buildQuery({
      entity_type: entityTypeFilter === 'ALL' ? '' : entityTypeFilter,
      from: fromDate,
      to: toDate,
      limit: '200',
    })
    get<AuditLog[]>(`/audit${qs}`)
      .then((r) => setLogs(r.data))
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : 'Failed to load audit log'
        setError(msg)
      })
      .finally(() => setLoading(false))
  // Re-fetch when server-side filters change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, entityTypeFilter, fromDate, toDate])

  // ── Client-side search filter (actor name / description) ─────────────

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return logs
    return logs.filter((l) => {
      return (
        (l.actorName ?? '').toLowerCase().includes(q) ||
        (l.description ?? '').toLowerCase().includes(q) ||
        (l.action ?? '').toLowerCase().includes(q) ||
        (l.entityType ?? '').toLowerCase().includes(q)
      )
    })
  }, [logs, search])

  // ── Render ───────────────────────────────────────────────────────────

  if (!canView) {
    return (
      <PageContainer>
        <PageHeader
          title="Audit Log"
          subtitle="System-wide action trail"
        />
        <EmptyState
          icon={ShieldOff}
          title="Admins only"
          description="You need SUPER_ADMIN or BRAND_MANAGER access to view the audit log."
        />
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Audit Log"
        subtitle="System-wide action trail — newest first"
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-500" />
          <Input
            placeholder="Search actor, action, description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            maxLength={200}
            className="w-72 pl-8"
          />
        </div>

        <Select value={entityTypeFilter} onValueChange={setEntityTypeFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All entity types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All types</SelectItem>
            {ENTITY_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t.replace('_', ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Date range — native date inputs, unstyled overlay kept minimal */}
        <div className="flex items-center gap-1.5">
          <label className="sr-only" htmlFor="audit-from">From</label>
          <input
            id="audit-from"
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-zinc-300 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <span className="text-xs text-zinc-600">to</span>
          <label className="sr-only" htmlFor="audit-to">To</label>
          <input
            id="audit-to"
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-zinc-300 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          {rangeError && <span className="text-xs text-red-400">{rangeError}</span>}
        </div>

        <span className="text-sm text-zinc-500">{rows.length} shown</span>
      </div>

      {/* Table */}
      <Card className="border-border bg-card">
        {loading ? (
          <p className="p-6 text-sm text-zinc-500">Loading audit log…</p>
        ) : error ? (
          <p className="p-6 text-sm text-red-400">{error}</p>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No audit entries"
            description="No log entries match the current filters."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="whitespace-nowrap">Time</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Entity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((log) => (
                  <TableRow key={log.id} className="border-border align-top">
                    {/* Time */}
                    <TableCell className="whitespace-nowrap text-xs tabular-nums text-zinc-500">
                      {fmtTime(log.createdAt)}
                    </TableCell>

                    {/* Actor */}
                    <TableCell className="text-sm text-zinc-300">
                      {log.actorName ?? <span className="text-zinc-600">system</span>}
                    </TableCell>

                    {/* Action — monospace pill */}
                    <TableCell>
                      <span className="inline-block rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-emerald-400">
                        {log.action ?? '—'}
                      </span>
                    </TableCell>

                    {/* Description */}
                    <TableCell className="max-w-xs text-sm text-zinc-400">
                      {log.description ?? <span className="text-zinc-600">—</span>}
                    </TableCell>

                    {/* Entity — entityType + entityId; never raw metadata */}
                    <TableCell className="whitespace-nowrap text-xs text-zinc-500">
                      {log.entityType != null ? (
                        <span>
                          <span className="text-zinc-300">{log.entityType}</span>
                          {log.entityId != null && (
                            <span className="ml-1 font-mono tabular-nums text-zinc-600">
                              {log.entityId.slice(0, 8)}…
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-zinc-700">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </PageContainer>
  )
}
