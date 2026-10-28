import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ScrollText, Search, Store } from 'lucide-react'
import { get } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { hasRole } from '../auth/access'
import { useOutlet } from '../context/OutletContext'
import { useBrandPerformance } from '../lib/brandPerformance'
import PageContainer from '../components/layout/PageContainer'
import PageHeader from '../components/common/PageHeader'
import EmptyState from '../components/common/EmptyState'
import PendingValue from '../components/common/PendingValue'
import BrandActivityPanel, { currentMonthKey, isMonthKey } from '../components/BrandActivityPanel'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
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
// Page
// ---------------------------------------------------------------------------

type ActivityTab = 'all' | 'brands'

/**
 * Activity Log. "All activity" is the workspace audit trail (GET /audit: OWNER + BRAND_MANAGER);
 * "Brands" is one brand's month of orders and Active / Inactive switches, filtered by brand
 * (what the Brands page used to open in a popup). Tab, brand and month live in the URL so the
 * brand page links straight to its own log and the back button works.
 */
export default function AuditTrail() {
  const { user } = useAuth()
  const { selectedOutletId } = useOutlet()
  const [params, setParams] = useSearchParams()

  // Mirrors requireRole on GET /audit; an outlet manager reaches this page for the Brands tab only.
  const canSeeAll = hasRole(user?.role, ['BRAND_MANAGER'])
  const tab: ActivityTab = !canSeeAll || params.get('tab') === 'brands' ? 'brands' : 'all'
  const requestedMonth = params.get('month')
  const month = isMonthKey(requestedMonth) && requestedMonth <= currentMonthKey() ? requestedMonth : currentMonthKey()

  // Same scoped, cached report as the Brands page cards: a brand manager only gets their brands.
  const portfolio = useBrandPerformance({ months: 6, outletId: selectedOutletId, enabled: tab === 'brands' })
  const brandOptions = useMemo(
    () => (portfolio.data?.brands ?? []).map((b) => b.brand).sort((a, b) => a.name.localeCompare(b.name)),
    [portfolio.data],
  )
  const requestedBrand = params.get('brand')
  const brandId = brandOptions.some((b) => b.id === requestedBrand) ? requestedBrand : (brandOptions[0]?.id ?? null)

  function update(next: Partial<Record<'tab' | 'brand' | 'month', string | null>>) {
    setParams(
      (prev) => {
        const merged = new URLSearchParams(prev)
        for (const [key, value] of Object.entries(next)) {
          if (value) merged.set(key, value)
          else merged.delete(key)
        }
        return merged
      },
      { replace: true },
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Activity Log"
        subtitle={canSeeAll ? "Who changed what, and each brand's day-by-day activity" : "Each brand's day-by-day activity"}
      />

      <Tabs value={tab} onValueChange={(v) => update({ tab: v === 'brands' ? 'brands' : null })} className="flex flex-col gap-4">
        {canSeeAll && (
          <TabsList className="grid w-full grid-cols-2 sm:inline-flex sm:w-auto sm:self-start">
            <TabsTrigger value="all" className="gap-1.5">
              <ScrollText className="h-3.5 w-3.5" aria-hidden /> All activity
            </TabsTrigger>
            <TabsTrigger value="brands" className="gap-1.5">
              <Store className="h-3.5 w-3.5" aria-hidden /> Brands
            </TabsTrigger>
          </TabsList>
        )}

        {canSeeAll && (
          <TabsContent value="all" className="mt-0 flex flex-col gap-4">
            <AllActivity />
          </TabsContent>
        )}

        <TabsContent value="brands" className="mt-0 flex flex-col gap-4">
          {portfolio.isPending ? (
            <div className="h-10 w-full animate-pulse rounded-md bg-secondary/60 sm:w-72" aria-busy="true" aria-label="Loading brands" />
          ) : portfolio.isError ? (
            <p className="text-sm text-danger-text">
              {portfolio.error instanceof Error ? portfolio.error.message : 'Could not load brands.'}
            </p>
          ) : !brandId ? (
            <EmptyState icon={Store} title="No brands here" description="None of your brands operate at this outlet yet." />
          ) : (
            <>
              <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                <span id="activity-brand-label" className="text-xs font-medium text-muted-foreground">
                  Brand
                </span>
                <Select value={brandId} onValueChange={(id) => update({ brand: id })}>
                  <SelectTrigger className="w-full sm:w-72" aria-labelledby="activity-brand-label">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {brandOptions.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        <span className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: b.color }} aria-hidden />
                          {b.name}
                          {!b.isActive && <span className="text-muted-foreground">(inactive)</span>}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <BrandActivityPanel
                brandId={brandId}
                outletId={selectedOutletId}
                month={month}
                onMonthChange={(m) => update({ month: m === currentMonthKey() ? null : m })}
              />
            </>
          )}
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}

// ---------------------------------------------------------------------------
// All activity (workspace audit trail)
// ---------------------------------------------------------------------------

function AllActivity() {
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
  }, [entityTypeFilter, fromDate, toDate])

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

  return (
    <>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
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
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <label className="sr-only" htmlFor="audit-to">To</label>
          <input
            id="audit-to"
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          {rangeError && <span className="text-xs text-danger-text">{rangeError}</span>}
        </div>

        <span className="text-sm text-muted-foreground"><PendingValue loading={loading}>{rows.length} shown</PendingValue></span>
      </div>

      {/* Table */}
      <Card className="border-border bg-card">
        {loading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading audit log…</p>
        ) : error ? (
          <p className="p-6 text-sm text-danger-text">{error}</p>
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
                    <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                      {fmtTime(log.createdAt)}
                    </TableCell>

                    {/* Actor */}
                    <TableCell className="text-sm text-foreground">
                      {log.actorName ?? <span className="text-muted-foreground">system</span>}
                    </TableCell>

                    {/* Action — monospace pill */}
                    <TableCell>
                      <span className="inline-block rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-ink-accent">
                        {log.action ?? '—'}
                      </span>
                    </TableCell>

                    {/* Description */}
                    <TableCell className="max-w-xs text-sm text-muted-foreground">
                      {log.description ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>

                    {/* Entity — entityType + entityId; never raw metadata */}
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {log.entityType != null ? (
                        <span>
                          <span className="text-foreground">{log.entityType}</span>
                          {log.entityId != null && (
                            <span className="ml-1 font-mono tabular-nums text-muted-foreground">
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
    </>
  )
}
