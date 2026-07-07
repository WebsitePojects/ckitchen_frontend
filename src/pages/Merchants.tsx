/**
 * Merchants — M2 Merchant & Food Brand Management
 *
 * Implements:
 *   - KPI ribbon: Total Merchants / Brands / Channel Listings / Active Listings / Orders Today
 *   - Search toolbar + Add Merchant dialog (SUPER_ADMIN / BRAND_MANAGER only)
 *   - DataTable with per-brand row: avatar, channel listings, status, categories, stations,
 *     printers, today's performance (orders / revenue / avg-time placeholder)
 *
 * Data notes:
 *   - Total Merchants = Total Brands = brand count (API only exposes /brands)
 *   - Channel Listings = aggregator accounts per brand (GET /brands/{id}/accounts)
 *   - Categories = distinct `category` fields from GET /brands/{id}/menu; "—" if none
 *   - Kitchen Stations = shared global resource (GET /stations) — same for every brand
 *   - Printers = shared global resource (GET /printers) — same for every brand
 *   - Avg Time = placeholder "—" (analytics endpoint returns no per-brand prep time)
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Building2,
  CalendarDays,
  CheckCircle2,
  MoreVertical,
  Pencil,
  Plus,
  PowerOff,
  ReceiptText,
  Search,
  SlidersHorizontal,
  Store,
  Tags,
} from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { toast } from 'sonner'
import { get, post } from '../lib/api'
import { cn } from '../lib/utils'
import { useAuth } from '../auth/AuthContext'
import { Button } from '../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu'
import { Input } from '../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import PageContainer from '../components/layout/PageContainer'
import PageHeader from '../components/common/PageHeader'
import KpiCard from '../components/common/KpiCard'
import KpiRibbon from '../components/common/KpiRibbon'
import DataTable from '../components/common/DataTable'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Brand {
  id: string
  name: string
  color: string
  isActive: boolean
}

interface Account {
  id: string
  brandId?: string
  aggregator?: 'FOODPANDA' | 'GRABFOOD' | 'OTHER'
  isActive: boolean
  name?: string
}

interface MenuItem {
  id: string
  name: string
  category?: string | null
}

interface Station {
  id: string
  name: string
}

interface Printer {
  id: string
  name: string
}

interface BrandAnalytic {
  /** API returns snake_case `brand_id` (not camelCase). */
  brand_id: string
  name: string
  revenue: number
  order_count: number
  avg_order_value: number
  is_weakest?: boolean
}

/** Merged per-brand table row */
interface MerchantRow {
  id: string
  name: string
  color: string
  isActive: boolean
  accounts: Account[]
  categories: string[]
  analytics: BrandAnalytic | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(value: number): string {
  return `₱${value.toLocaleString('en-PH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`
}

/** Inline merchant active/inactive badge (maps isActive boolean, not order status). */
function MerchantStatus({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
        active
          ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-inset ring-emerald-500/30'
          : 'bg-zinc-500/15 text-zinc-400 ring-1 ring-inset ring-zinc-500/30',
      )}
    >
      {active ? 'Active' : 'Inactive'}
    </span>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Merchants() {
  const { user } = useAuth()
  const canAddMerchant =
    user?.role === 'SUPER_ADMIN' || user?.role === 'BRAND_MANAGER'

  // ── Data state ────────────────────────────────────────────────────────────

  const [rows, setRows] = useState<MerchantRow[]>([])
  const [stations, setStations] = useState<Station[]>([])
  const [printers, setPrinters] = useState<Printer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ── Filter / search state ─────────────────────────────────────────────────

  const [search, setSearch] = useState('')
  const [merchantFilter, setMerchantFilter] = useState('_all')

  /** Increment to trigger a fresh data load (e.g. after adding a merchant). */
  const [refreshKey, setRefreshKey] = useState(0)

  // ── Dialog state (Add Merchant) ───────────────────────────────────────────

  const [dialogOpen, setDialogOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#10B981')
  const [submitting, setSubmitting] = useState(false)

  // ── Data loading ──────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      try {
        // Top-level parallel fetches — stations/printers/analytics are optional
        const [brandsRes, stationsRes, printersRes, analyticsRes] = await Promise.all([
          get<Brand[]>('/brands'),
          get<Station[]>('/stations').catch(() => ({ data: [] as Station[] })),
          get<Printer[]>('/printers').catch(() => ({ data: [] as Printer[] })),
          get<BrandAnalytic[]>('/analytics/brands').catch(() => ({ data: [] as BrandAnalytic[] })),
        ])

        if (cancelled) return

        const brands = brandsRes.data
        if (!cancelled) {
          setStations(stationsRes.data)
          setPrinters(printersRes.data)
        }

        // Analytics lookup by brand_id (API returns snake_case)
        const analyticsMap = new Map<string, BrandAnalytic>()
        for (const a of analyticsRes.data) {
          analyticsMap.set(a.brand_id, a)
        }

        // Per-brand parallel: accounts + menu (avoids sequential N+1 calls)
        const merged = await Promise.all(
          brands.map(async (brand) => {
            const [accountsRes, menuRes] = await Promise.all([
              get<Account[]>(`/brands/${brand.id}/accounts`).catch(() => ({
                data: [] as Account[],
              })),
              get<MenuItem[]>(`/brands/${brand.id}/menu`).catch(() => ({
                data: [] as MenuItem[],
              })),
            ])

            // Distinct menu categories
            const categorySet = new Set<string>()
            for (const item of menuRes.data) {
              if (item.category) categorySet.add(item.category)
            }

            return {
              id: brand.id,
              name: brand.name,
              color: brand.color,
              isActive: brand.isActive,
              accounts: accountsRes.data,
              categories: [...categorySet],
              analytics: analyticsMap.get(brand.id) ?? null,
            } satisfies MerchantRow
          }),
        )

        if (!cancelled) setRows(merged)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load merchants.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  // ── Derived KPIs ──────────────────────────────────────────────────────────

  const totalListings = useMemo(
    () => rows.reduce((s, r) => s + r.accounts.length, 0),
    [rows],
  )
  const activeListings = useMemo(
    () => rows.reduce((s, r) => s + r.accounts.filter((a) => a.isActive).length, 0),
    [rows],
  )
  const totalOrdersToday = useMemo(
    () => rows.reduce((s, r) => s + (r.analytics?.order_count ?? 0), 0),
    [rows],
  )

  // ── Filtered rows ─────────────────────────────────────────────────────────

  const filteredRows = useMemo(() => {
    let result = rows

    // Select filter (header dropdown)
    if (merchantFilter !== '_all') {
      result = result.filter((r) => r.id === merchantFilter)
    }

    // Search filter
    const q = search.trim().toLowerCase()
    if (q) {
      result = result.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.categories.some((c) => c.toLowerCase().includes(q)) ||
          r.accounts.some((a) => a.name?.toLowerCase().includes(q)),
      )
    }

    return result
  }, [rows, merchantFilter, search])

  // ── Add Merchant ──────────────────────────────────────────────────────────

  async function handleAddMerchant(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!newName.trim()) return
    setSubmitting(true)
    try {
      await post('/brands', { name: newName.trim(), color: newColor })
      toast.success('Merchant added', {
        description: `"${newName.trim()}" has been created.`,
      })
      setDialogOpen(false)
      setNewName('')
      setNewColor('#10B981')
      setRefreshKey((k) => k + 1)
    } catch (err) {
      toast.error('Error', {
        description: err instanceof Error ? err.message : 'Failed to add merchant.',
      })
    } finally {
      setSubmitting(false)
    }
  }

  // ── Table columns ─────────────────────────────────────────────────────────

  const columns = useMemo<ColumnDef<MerchantRow, unknown>[]>(
    () => [
      // ── Merchant / Brand ────────────────────────────────────────────────
      {
        id: 'merchant',
        header: 'Merchant / Brand',
        accessorKey: 'name',
        cell: ({ row }) => {
          const r = row.original
          return (
            <div className="flex min-w-[180px] items-center gap-2.5">
              {/* Colored avatar — first letter of brand name */}
              <div
                aria-hidden
                className="flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full text-xs font-bold text-white"
                style={{ backgroundColor: r.color || '#71717A' }}
              >
                {r.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-medium leading-tight text-zinc-100">{r.name}</p>
                <p className="mt-0.5 text-[11px] leading-tight tabular-nums text-zinc-500">
                  1 Brand · {r.accounts.length} Listing
                  {r.accounts.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
          )
        },
      },

      // ── Channel Listings ────────────────────────────────────────────────
      {
        id: 'listings',
        header: 'Channel Listings',
        accessorFn: (r) => r.accounts.length,
        cell: ({ row }) => (
          <span className="tabular-nums text-sm text-zinc-300">
            {row.original.accounts.length}
          </span>
        ),
      },

      // ── Status ──────────────────────────────────────────────────────────
      {
        id: 'status',
        header: 'Status',
        accessorKey: 'isActive',
        cell: ({ row }) => <MerchantStatus active={row.original.isActive} />,
      },

      // ── Categories ──────────────────────────────────────────────────────
      {
        id: 'categories',
        header: 'Categories',
        enableSorting: false,
        cell: ({ row }) => {
          const cats = row.original.categories
          if (!cats.length) return <span className="text-xs text-zinc-600">—</span>
          return (
            <div className="flex max-w-[200px] flex-wrap gap-1">
              {cats.slice(0, 3).map((c) => (
                <span
                  key={c}
                  className="inline-flex items-center rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-300 ring-1 ring-inset ring-zinc-700"
                >
                  {c}
                </span>
              ))}
              {cats.length > 3 && (
                <span className="inline-flex items-center rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-500 ring-1 ring-inset ring-zinc-700">
                  +{cats.length - 3}
                </span>
              )}
            </div>
          )
        },
      },

      // ── Kitchen Stations ─────────────────────────────────────────────────
      // Shared global resource — same list for every brand row
      {
        id: 'stations',
        header: 'Kitchen Stations',
        enableSorting: false,
        cell: () => (
          <div className="flex max-w-[160px] flex-wrap gap-1">
            {stations.length === 0 ? (
              <span className="text-xs text-zinc-600">—</span>
            ) : (
              <>
                {stations.slice(0, 2).map((s) => (
                  <span
                    key={s.id}
                    className="inline-flex items-center rounded-md bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400 ring-1 ring-inset ring-amber-500/20"
                  >
                    {s.name}
                  </span>
                ))}
                {stations.length > 2 && (
                  <span className="inline-flex items-center rounded-md bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-500 ring-1 ring-inset ring-zinc-700">
                    +{stations.length - 2}
                  </span>
                )}
              </>
            )}
          </div>
        ),
      },

      // ── Printers ─────────────────────────────────────────────────────────
      // Shared global resource — same list for every brand row
      {
        id: 'printers',
        header: 'Printers',
        enableSorting: false,
        cell: () => (
          <div className="flex flex-col gap-0.5">
            {printers.length === 0 ? (
              <span className="text-xs text-zinc-600">—</span>
            ) : (
              <>
                {printers.slice(0, 2).map((p) => (
                  <span key={p.id} className="text-[11px] text-zinc-400">
                    {p.name}
                  </span>
                ))}
                {printers.length > 2 && (
                  <span className="text-[11px] text-zinc-600">
                    +{printers.length - 2} more
                  </span>
                )}
              </>
            )}
          </div>
        ),
      },

      // ── Today's Performance ───────────────────────────────────────────────
      {
        id: 'performance',
        header: "Today's Performance",
        enableSorting: false,
        cell: ({ row }) => {
          const a = row.original.analytics
          return (
            <div className="flex min-w-[200px] items-center gap-3">
              <div className="flex flex-col">
                <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                  Orders
                </span>
                <span className="tabular-nums text-sm font-semibold text-zinc-200">
                  {a?.order_count ?? 0}
                </span>
              </div>
              <div className="h-6 w-px bg-zinc-800" />
              <div className="flex flex-col">
                <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                  Revenue
                </span>
                <span className="tabular-nums text-sm font-semibold text-emerald-400">
                  {formatCurrency(a?.revenue ?? 0)}
                </span>
              </div>
              <div className="h-6 w-px bg-zinc-800" />
              <div className="flex flex-col">
                {/* placeholder — no per-brand prep time in analytics response */}
                <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                  Avg Time
                </span>
                <span className="text-sm font-semibold text-zinc-400">—</span>
              </div>
            </div>
          )
        },
      },

      // ── Row actions ──────────────────────────────────────────────────────
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: () => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-zinc-500 hover:text-zinc-200"
              >
                <MoreVertical className="h-4 w-4" />
                <span className="sr-only">Row actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              <DropdownMenuItem className="gap-2 text-sm">
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="gap-2 text-sm text-red-400 focus:text-red-300">
                <PowerOff className="h-3.5 w-3.5" />
                Deactivate
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    // Columns that reference global station/printer state need to re-derive when they change
    [stations, printers],
  )

  // ── Date chip ─────────────────────────────────────────────────────────────

  const today = new Date().toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  // ── Error state ───────────────────────────────────────────────────────────

  if (error) {
    return (
      <PageContainer>
        <PageHeader
          title="Merchant & Food Brand Management"
          subtitle="Manage all merchants, brands, channel listings, kitchen stations and printer mappings"
        />
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center">
          <p className="text-sm font-medium text-red-400">{error}</p>
          <p className="mt-1 text-xs text-red-500/70">
            Make sure the backend is running on :4000
          </p>
        </div>
      </PageContainer>
    )
  }

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <PageContainer>

      {/* ── Page header ────────────────────────────────────────────────────── */}
      <PageHeader
        title="Merchant & Food Brand Management"
        subtitle="Manage all merchants, brands, channel listings, kitchen stations and printer mappings"
        actions={
          <>
            {/* Merchant selector — also filters the table */}
            <Select
              value={merchantFilter}
              onValueChange={setMerchantFilter}
              disabled={loading}
            >
              <SelectTrigger className="h-8 w-40 text-xs">
                <SelectValue placeholder="All Merchants" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All Merchants</SelectItem>
                {rows.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Date chip (presentational) */}
            <span className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-1.5 text-xs text-zinc-400">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden />
              {today}
            </span>

            {/* Filters (presentational) */}
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 border-zinc-700 text-xs text-zinc-400 hover:text-zinc-200"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
              Filters
            </Button>
          </>
        }
      />

      {/* ── KPI ribbon ─────────────────────────────────────────────────────── */}
      <KpiRibbon>
        <KpiCard
          icon={Store}
          label="Total Merchants"
          value={loading ? '—' : rows.length}
        />
        <KpiCard
          icon={Tags}
          label="Total Brands"
          value={loading ? '—' : rows.length}
        />
        <KpiCard
          icon={Building2}
          label="Total Listings"
          value={loading ? '—' : totalListings}
        />
        <KpiCard
          icon={CheckCircle2}
          label="Active Listings"
          value={loading ? '—' : activeListings}
        />
        <KpiCard
          icon={ReceiptText}
          label="Total Orders (Today)"
          value={loading ? '—' : totalOrdersToday}
        />
      </KpiRibbon>

      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative min-w-[240px] max-w-sm flex-1">
          <Search
            className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search merchants, brands or listings"
            className="h-9 pl-8 text-sm"
          />
        </div>

        {/* Add Merchant — SUPER_ADMIN / BRAND_MANAGER only */}
        <div className="ml-auto">
          {canAddMerchant ? (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  size="sm"
                  className="h-9 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-500"
                >
                  <Plus className="h-4 w-4" />
                  Add Merchant
                </Button>
              </DialogTrigger>

              <DialogContent className="sm:max-w-[420px]">
                <form
                  onSubmit={(e) => {
                    void handleAddMerchant(e)
                  }}
                >
                  <DialogHeader>
                    <DialogTitle>Add Merchant</DialogTitle>
                    <DialogDescription>
                      Create a new merchant / food brand in the system.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="flex flex-col gap-4 py-4">
                    {/* Name */}
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor="merchant-name"
                        className="text-sm font-medium text-zinc-300"
                      >
                        Name <span className="text-red-400" aria-hidden>*</span>
                      </label>
                      <Input
                        id="merchant-name"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="e.g. Jollibee, McDonald's"
                        required
                        autoFocus
                      />
                    </div>

                    {/* Color */}
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor="merchant-color-text"
                        className="text-sm font-medium text-zinc-300"
                      >
                        Brand color
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={newColor}
                          onChange={(e) => setNewColor(e.target.value)}
                          className="h-9 w-12 cursor-pointer rounded-md border border-zinc-700 bg-transparent p-0.5"
                          aria-label="Pick brand color"
                        />
                        <Input
                          id="merchant-color-text"
                          value={newColor}
                          onChange={(e) => setNewColor(e.target.value)}
                          placeholder="#10B981"
                          className="font-mono text-sm"
                        />
                      </div>
                      {/* Color preview */}
                      <div className="mt-1 flex items-center gap-2">
                        <div
                          className="h-5 w-5 rounded-full border border-zinc-700"
                          style={{ backgroundColor: newColor || '#10B981' }}
                        />
                        <span className="text-xs text-zinc-500">Preview</span>
                      </div>
                    </div>
                  </div>

                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setDialogOpen(false)}
                      disabled={submitting}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      className="bg-emerald-600 text-white hover:bg-emerald-500"
                      disabled={submitting || !newName.trim()}
                    >
                      {submitting ? 'Creating…' : 'Create Merchant'}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          ) : (
            /* Disabled for non-privileged roles — visible but non-interactive */
            <Button
              size="sm"
              className="h-9 cursor-not-allowed gap-1.5 bg-emerald-600/40 text-white/50"
              disabled
              title="Requires SUPER_ADMIN or BRAND_MANAGER role"
            >
              <Plus className="h-4 w-4" />
              Add Merchant
            </Button>
          )}
        </div>
      </div>

      {/* ── DataTable ──────────────────────────────────────────────────────── */}
      <DataTable<MerchantRow>
        columns={columns}
        data={filteredRows}
        loading={loading}
        emptyTitle={
          search || merchantFilter !== '_all'
            ? 'No matching merchants'
            : 'No merchants yet'
        }
        emptyDescription={
          search || merchantFilter !== '_all'
            ? 'Try a different search term or filter.'
            : 'Add your first merchant using the button above.'
        }
        pageSize={10}
      />
    </PageContainer>
  )
}
