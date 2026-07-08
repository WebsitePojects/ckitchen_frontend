import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Boxes,
  Building2,
  CalendarDays,
  ChevronRight as Crumb,
  Home,
  Link2,
  MapPin,
  Phone,
  Radio,
  Store,
  Trash2,
  User as UserIcon,
  UserMinus,
  Users,
  Warehouse,
} from 'lucide-react'
import { CKApiError, del, get, patch, post } from '../lib/api'
import { cn } from '../lib/utils'
import { useAuth } from '../auth/AuthContext'
import { hasRole, normalizeRole, ROLE_LANDING } from '../auth/access'
import { usePermissions } from '../context/PermissionsContext'
import { DAY_LABEL, WORK_DAYS, sanitizeWorkDays } from '../lib/workdays'
import PageContainer from '../components/layout/PageContainer'
import EmptyState from '../components/common/EmptyState'
import SearchableDropdown, { type SearchableOption } from '../components/SearchableDropdown'
import { Card } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'

// ---------------------------------------------------------------------------
// Types — mirror the backend contracts (Drizzle camelCase). Read defensively:
// the /outlets/:id/brands endpoint and the employee.locationId column are NEW
// (parallel agents); an old deploy may lack either, so both degrade gracefully.
// ---------------------------------------------------------------------------

interface OutletWarehouse {
  id: string
  type: 'MAIN' | 'KITCHEN'
}

interface OutletDetail {
  id: string
  code: string
  name: string
  address?: string | null
  status: 'ACTIVE' | 'INACTIVE'
  timezone: string
  contactName?: string | null
  contactPhone?: string | null
  warehouses: OutletWarehouse[]
}

/** GET /outlets/:id/brands row. `home` = brand's home outlet (not removable). */
interface OutletBrand {
  brandId: string
  name: string
  color: string | null
  home: boolean
  isActive: boolean | null
  deployedAt: string | null
}

interface Brand {
  id: string
  name: string
  color: string | null
  isActive?: boolean
}

interface Employee {
  id: string
  employeeNo: string
  fullName: string
  department: string
  position: string | null
  photoUrl: string | null
  status: string
  workDays?: string[] | null
  locationId?: string | null
}

interface OutletSummary {
  id: string
  code: string
  name: string
}

interface Station {
  id: string
  name: string
  locationId: string | null
  defaultPrinter?: { name?: string | null } | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEPT_CLASS: Record<string, string> = {
  KITCHEN: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  WAREHOUSE: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  PURCHASING: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  SALES: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  PRODUCTION: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  QA: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  ACCOUNTING: 'bg-teal-500/15 text-teal-400 border-teal-500/30',
  ADMIN: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function fmtDate(dateish: string | null | undefined): string {
  if (!dateish) return '—'
  return new Date(dateish).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback
}

/** True when a failed mutation was an outlet-scope 403 (D22 membership check). */
function isScope403(e: unknown): boolean {
  return e instanceof CKApiError && e.status === 403
}

function DeptBadge({ department }: { department: string }) {
  const cls = DEPT_CLASS[department] ?? 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30'
  return (
    <Badge variant="outline" className={cn('font-medium', cls)}>
      {department.charAt(0) + department.slice(1).toLowerCase()}
    </Badge>
  )
}

/** All 7 day chips, working days lit — same visual as EmployeeProfile's header. */
function ScheduleChips({ days }: { days?: string[] | null }) {
  const workDays = sanitizeWorkDays(days)
  if (workDays.length === 0) return <span className="text-xs text-zinc-600">—</span>
  return (
    <div className="flex gap-1">
      {WORK_DAYS.map((d) => (
        <span
          key={d}
          className={cn(
            'rounded px-1 py-0.5 text-[9px] font-semibold uppercase',
            workDays.includes(d) ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-800/60 text-zinc-600',
          )}
        >
          {DAY_LABEL[d]}
        </span>
      ))}
    </div>
  )
}

function CountTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users
  label: string
  value: number | string
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-background/40 px-4 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-400">
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <p className="text-lg font-bold tabular-nums text-zinc-100 leading-none">{value}</p>
        <p className="mt-1 text-[11px] uppercase tracking-wide text-zinc-500">{label}</p>
      </div>
    </div>
  )
}

function SectionHeader({
  icon: Icon,
  title,
  count,
  action,
}: {
  icon: typeof Users
  title: string
  count?: number
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-4">
      <Icon className="h-4 w-4 text-zinc-400" />
      <h3 className="text-sm font-semibold text-zinc-200">{title}</h3>
      {count != null && <span className="text-xs text-zinc-500">({count})</span>}
      {action && <div className="ml-auto w-64 max-w-full">{action}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function OutletProfile() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { canAccessPage } = usePermissions()
  const navigate = useNavigate()
  const qc = useQueryClient()

  // Access gate — mirrors EmployeeProfile.tsx: this route sits OUTSIDE
  // <RequireAccess> (that guard matches the raw '/outlets/<uuid>' pathname
  // against page keys the RBAC matrix never stores), so the page self-gates by
  // inheriting the '/outlets' page permission (matrix-aware, fail-open).
  const isOwner = hasRole(user?.role, [])
  const canManageEmployees = hasRole(user?.role, ['OUTLET_MANAGER'])
  const canClearEmployeeAssignments = isOwner
  const allowed = !!user && canAccessPage('/outlets')

  // Outlet-scope gate (D22): a non-OWNER ASSIGNED-scope user may only open an
  // outlet in their own `outlet_ids` claim. ALL-scope (HQ) opens any; a legacy
  // token (claim undefined) is let through and relies on the backend 403 as the
  // backstop (same compromise as OutletContext). The backend 403s regardless.
  const scope = user?.outlet_scope
  const inScope =
    isOwner ||
    scope === 'ALL' ||
    scope === undefined ||
    (scope === 'ASSIGNED' && !!id && (user?.outlet_ids ?? []).includes(id))

  const enabled = allowed && inScope && !!id
  const [removeTarget, setRemoveTarget] = useState<OutletBrand | null>(null)

  // ── Queries ────────────────────────────────────────────────────────────────
  const outletQuery = useQuery({
    queryKey: ['outlets', id],
    queryFn: async () => (await get<OutletDetail>(`/outlets/${id}`)).data,
    enabled,
    retry: (count, err) =>
      count < 2 && !(err instanceof CKApiError && err.status != null && err.status < 500),
  })

  const brandsQuery = useQuery({
    queryKey: ['outlets', id, 'brands'],
    queryFn: async () => (await get<OutletBrand[]>(`/outlets/${id}/brands`)).data,
    enabled,
    // Don't burn retries on a 4xx (endpoint missing on an old deploy / 403).
    retry: (count, err) =>
      count < 2 && !(err instanceof CKApiError && err.status != null && err.status < 500),
  })

  const allBrandsQuery = useQuery({
    queryKey: ['brands', 'all'],
    queryFn: async () => (await get<Brand[]>('/brands')).data,
    enabled,
  })

  const assignedEmployeesQuery = useQuery({
    queryKey: ['employees', 'by-location', id],
    queryFn: async () => (await get<Employee[]>(`/employees?location_id=${id}`)).data,
    enabled,
    retry: (count, err) =>
      count < 2 && !(err instanceof CKApiError && err.status != null && err.status < 500),
  })

  const allEmployeesQuery = useQuery({
    queryKey: ['employees', 'all'],
    queryFn: async () => (await get<Employee[]>('/employees')).data,
    enabled: enabled && canManageEmployees,
  })

  const allOutletsQuery = useQuery({
    queryKey: ['outlets', 'summary'],
    queryFn: async () => (await get<OutletSummary[]>('/outlets')).data,
    enabled,
  })

  const stationsQuery = useQuery({
    queryKey: ['stations', 'all'],
    queryFn: async () => (await get<Station[]>('/stations')).data,
    enabled,
  })

  // ── Mutations ────────────────────────────────────────────────────────────
  function onScopeError(e: unknown, fallback: string) {
    if (isScope403(e)) toast.error('Outside your outlet scope.')
    else toast.error(errMsg(e, fallback))
  }

  const deployBrand = useMutation({
    mutationFn: async (brandId: string) =>
      (await post(`/brands/${brandId}/outlets`, { location_id: id })).data,
    onSuccess: () => {
      toast.success('Brand deployed to this outlet.')
      qc.invalidateQueries({ queryKey: ['outlets', id, 'brands'] })
    },
    onError: (e) => onScopeError(e, 'Failed to deploy brand.'),
  })

  const removeBrand = useMutation({
    mutationFn: async (brandId: string) => (await del(`/brands/${brandId}/outlets/${id}`)).data,
    onSuccess: () => {
      toast.success('Brand removed from this outlet.')
      qc.invalidateQueries({ queryKey: ['outlets', id, 'brands'] })
    },
    onError: (e) => onScopeError(e, 'Failed to remove brand.'),
    onSettled: () => setRemoveTarget(null),
  })

  const assignEmployee = useMutation({
    mutationFn: async (employeeId: string) => {
      if (!id) throw new Error('Outlet is not loaded.')
      const employee = (await patch<Employee>(`/employees/${employeeId}`, { location_id: id })).data
      if (employee.locationId !== id) {
        throw new Error('Server did not apply outlet assignment. Deploy the backend update first.')
      }
      return employee
    },
    onSuccess: () => {
      toast.success('Employee assigned to this outlet.')
      qc.invalidateQueries({ queryKey: ['employees', 'by-location', id] })
      qc.invalidateQueries({ queryKey: ['employees', 'all'] })
    },
    onError: (e) => onScopeError(e, 'Failed to assign employee.'),
  })

  const unassignEmployee = useMutation({
    mutationFn: async (employeeId: string) => {
      const employee = (await patch<Employee>(`/employees/${employeeId}`, { location_id: null })).data
      if (employee.locationId !== null) {
        throw new Error('Server did not apply outlet assignment. Deploy the backend update first.')
      }
      return employee
    },
    onSuccess: () => {
      toast.success('Employee unassigned.')
      qc.invalidateQueries({ queryKey: ['employees', 'by-location', id] })
      qc.invalidateQueries({ queryKey: ['employees', 'all'] })
    },
    onError: (e) => onScopeError(e, 'Failed to unassign employee.'),
  })

  // Out-of-scope bounce toast (fire once, then <Navigate> below unmounts us).
  const bouncedRef = useRef(false)
  useEffect(() => {
    if (allowed && !inScope && !bouncedRef.current) {
      bouncedRef.current = true
      toast.error('That outlet is outside your access scope.')
    }
  }, [allowed, inScope])

  // ── Derived ──────────────────────────────────────────────────────────────
  const outlet = outletQuery.data
  const outletBrands = brandsQuery.data ?? []
  const assignedEmployees = assignedEmployeesQuery.data ?? []
  const stations = useMemo(
    () => (stationsQuery.data ?? []).filter((s) => s.locationId === id),
    [stationsQuery.data, id],
  )

  const outletNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const o of allOutletsQuery.data ?? []) map.set(o.id, o.name)
    return map
  }, [allOutletsQuery.data])

  // Brands available to deploy = all brands not already present here (home or deployed).
  const brandOptions: SearchableOption[] = useMemo(() => {
    const present = new Set(outletBrands.map((b) => b.brandId))
    return (allBrandsQuery.data ?? [])
      .filter((b) => !present.has(b.id))
      .map((b) => ({ id: b.id, label: b.name, color: b.color }))
  }, [allBrandsQuery.data, outletBrands])

  // Employees available to assign = everyone not already assigned to THIS outlet.
  const employeeOptions: SearchableOption[] = useMemo(() => {
    return (allEmployeesQuery.data ?? [])
      .filter((e) => e.locationId !== id)
      .map((e) => {
        const where = e.locationId ? outletNameById.get(e.locationId) ?? 'Another outlet' : 'Unassigned'
        return {
          id: e.id,
          label: `${e.fullName} · ${e.employeeNo}`,
          hint: `currently: ${where}`,
        }
      })
  }, [allEmployeesQuery.data, id, outletNameById])

  // ── Guards (after all hooks) ──────────────────────────────────────────────
  if (!user) return null
  if (!allowed) {
    const landing = ROLE_LANDING[normalizeRole(user.role)] ?? '/'
    return <Navigate to={landing} replace />
  }
  if (!inScope) return <Navigate to="/outlets" replace />

  const outletMissing =
    outletQuery.isError && outletQuery.error instanceof CKApiError && outletQuery.error.status === 404

  if (outletQuery.isPending) {
    return (
      <PageContainer>
        <Breadcrumb name="Loading…" />
        <p className="text-sm text-zinc-500">Loading outlet…</p>
      </PageContainer>
    )
  }

  if (outletMissing || !outlet) {
    return (
      <PageContainer>
        <Breadcrumb name="Not found" />
        <EmptyState
          icon={Building2}
          title="Outlet not found"
          description="This outlet may have been removed, or the link is stale."
          action={
            <Button asChild variant="outline" size="sm">
              <Link to="/outlets">Back to Outlets</Link>
            </Button>
          }
        />
      </PageContainer>
    )
  }

  const hasMain = outlet.warehouses.some((w) => w.type === 'MAIN')
  const hasKitchen = outlet.warehouses.some((w) => w.type === 'KITCHEN')

  return (
    <PageContainer>
      <Breadcrumb name={outlet.name} />

      {/* ── Header card ──────────────────────────────────────────────────── */}
      <Card className="border-border bg-card p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300 ring-2 ring-emerald-500/30">
            <Building2 className="h-7 w-7" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight text-zinc-50">{outlet.name}</h2>
              <span className="font-mono text-xs text-emerald-300">{outlet.code}</span>
              <OutletStatusPill status={outlet.status} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1.5 text-sm text-zinc-400">
              <span className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-zinc-500" />
                {outlet.address || 'No address set'}
              </span>
              <span className="flex items-center gap-1.5">
                <UserIcon className="h-3.5 w-3.5 text-zinc-500" />
                {outlet.contactName || '—'}
              </span>
              <span className="flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5 text-zinc-500" />
                {outlet.contactPhone || '—'}
              </span>
              <span className="flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5 text-zinc-500" />
                {outlet.timezone}
              </span>
            </div>
          </div>
        </div>

        {/* Counts */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <CountTile icon={Store} label="Brands" value={outletBrands.length} />
          <CountTile icon={Users} label="Employees" value={assignedEmployees.length} />
          <CountTile icon={Radio} label="Stations" value={stations.length} />
          <CountTile
            icon={Warehouse}
            label="Warehouses"
            value={`${(hasMain ? 1 : 0) + (hasKitchen ? 1 : 0)}/2`}
          />
        </div>
      </Card>

      {/* ── Brands / Merchants ───────────────────────────────────────────── */}
      <Card className="border-border bg-card">
        <SectionHeader
          icon={Store}
          title="Brands / Merchants"
          count={outletBrands.length}
          action={
            isOwner ? (
              <SearchableDropdown
                options={brandOptions}
                onSelect={(brandId) => deployBrand.mutate(brandId)}
                placeholder="Deploy a brand…"
                searchPlaceholder="Search brands…"
                emptyText={
                  allBrandsQuery.isPending ? 'Loading brands…' : 'All brands already here.'
                }
                busy={deployBrand.isPending}
                disabled={allBrandsQuery.isPending}
              />
            ) : undefined
          }
        />
        {brandsQuery.isPending ? (
          <p className="p-6 text-sm text-zinc-500">Loading brands…</p>
        ) : brandsQuery.isError ? (
          <div className="p-5">
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-300">
              Brand deployments aren't available yet —{' '}
              {errMsg(brandsQuery.error, 'the server may not support this endpoint on this deploy.')}
            </p>
          </div>
        ) : outletBrands.length === 0 ? (
          <EmptyState
            icon={Store}
            title="No brands here yet"
            description={
              isOwner
                ? 'Deploy a brand to this outlet using the picker above.'
                : 'No brands are deployed to this outlet.'
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead>Brand</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Deployed</TableHead>
                {isOwner && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {outletBrands.map((b) => (
                <TableRow key={b.brandId} className="border-border">
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/20"
                        style={{ backgroundColor: b.color ?? '#71717A' }}
                      />
                      <span className="font-medium text-zinc-100">{b.name}</span>
                    </span>
                  </TableCell>
                  <TableCell>
                    {b.home ? (
                      <Badge
                        variant="outline"
                        className="gap-1 border-zinc-500/30 bg-zinc-500/10 text-zinc-300"
                      >
                        <Home className="h-3 w-3" /> Home
                      </Badge>
                    ) : (
                      <span className="text-xs text-zinc-500">Deployed</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {b.home ? (
                      <span className="text-xs text-zinc-500">—</span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-xs">
                        <span
                          className={cn(
                            'h-1.5 w-1.5 rounded-full',
                            b.isActive ? 'bg-emerald-400' : 'bg-zinc-600',
                          )}
                        />
                        <span className={b.isActive ? 'text-emerald-400' : 'text-zinc-500'}>
                          {b.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-zinc-400">
                    {b.home ? '—' : fmtDate(b.deployedAt)}
                  </TableCell>
                  {isOwner && (
                    <TableCell className="text-right">
                      {b.home ? (
                        <span className="text-[11px] text-zinc-600">Home outlet</span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                          onClick={() => setRemoveTarget(b)}
                          disabled={removeBrand.isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Remove
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* ── Employees ────────────────────────────────────────────────────── */}
      <Card className="border-border bg-card">
        <SectionHeader
          icon={Users}
          title="Employees"
          count={assignedEmployees.length}
          action={
            canManageEmployees && !assignedEmployeesQuery.isError ? (
            <SearchableDropdown
              options={employeeOptions}
              onSelect={(empId) => assignEmployee.mutate(empId)}
              placeholder="Assign employee…"
              searchPlaceholder="Search employees…"
              emptyText={
                allEmployeesQuery.isPending ? 'Loading employees…' : 'Everyone is already assigned here.'
              }
              busy={assignEmployee.isPending}
              disabled={allEmployeesQuery.isPending}
            />
            ) : undefined
          }
        />
        {assignedEmployeesQuery.isPending ? (
          <p className="p-6 text-sm text-zinc-500">Loading employees…</p>
        ) : assignedEmployeesQuery.isError ? (
          <div className="p-5">
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-300">
              Assigned employees aren't available yet —{' '}
              {errMsg(
                assignedEmployeesQuery.error,
                'the server may not support outlet-scoped employees on this deploy.',
              )}
            </p>
          </div>
        ) : assignedEmployees.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No employees assigned"
            description={
              canManageEmployees
                ? 'Assign staff to this outlet using the picker above.'
                : 'No staff are currently assigned to this outlet.'
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead>Employee</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Schedule</TableHead>
                {canClearEmployeeAssignments && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignedEmployees.map((e) => (
                <TableRow
                  key={e.id}
                  className="cursor-pointer border-border transition-colors hover:bg-zinc-800/40"
                  onClick={() => navigate(`/employees/${e.id}`)}
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {e.photoUrl ? (
                        <img
                          src={e.photoUrl}
                          alt=""
                          className="h-9 w-9 rounded-full object-cover ring-1 ring-emerald-500/30"
                        />
                      ) : (
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/15 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
                          {initials(e.fullName)}
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="truncate font-medium text-zinc-100">{e.fullName}</p>
                        <p className="font-mono text-[11px] text-zinc-500">{e.employeeNo}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <DeptBadge department={e.department} />
                  </TableCell>
                  <TableCell>
                    <ScheduleChips days={e.workDays} />
                  </TableCell>
                  {canClearEmployeeAssignments && (
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-zinc-400 hover:bg-zinc-700/40 hover:text-zinc-200"
                        disabled={unassignEmployee.isPending}
                        onClick={(ev) => {
                          ev.stopPropagation()
                          unassignEmployee.mutate(e.id)
                        }}
                      >
                        <UserMinus className="h-3.5 w-3.5" />
                        Unassign
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* ── Infrastructure (read-only) ──────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Stations */}
        <Card className="border-border bg-card">
          <SectionHeader icon={Radio} title="Stations" count={stations.length} />
          {stationsQuery.isPending ? (
            <p className="p-5 text-sm text-zinc-500">Loading…</p>
          ) : stations.length === 0 ? (
            <p className="p-5 text-sm text-zinc-500">No kitchen stations at this outlet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {stations.map((s) => (
                <li key={s.id} className="flex items-center justify-between px-5 py-3">
                  <span className="text-sm text-zinc-200">{s.name}</span>
                  <span className="text-[11px] text-zinc-500">
                    {s.defaultPrinter?.name ?? 'No printer'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Warehouses */}
        <Card className="border-border bg-card">
          <SectionHeader icon={Warehouse} title="Warehouses" />
          <div className="flex flex-wrap gap-2 p-5">
            <WarehousePill label="MAIN" ready={hasMain} />
            <WarehousePill label="KITCHEN" ready={hasKitchen} />
          </div>
          <p className="px-5 pb-5 text-[11px] text-zinc-600">
            Two-tier inventory — Main Warehouse and in-house Kitchen. Stock and ITO transfers are
            managed in Inventory.
          </p>
        </Card>

        {/* Channel Listings — brand-level, not outlet-scoped; link out (cardinal rule 1). */}
        <Card className="border-border bg-card">
          <SectionHeader icon={Link2} title="Channel Listings" />
          <div className="p-5">
            <p className="text-sm text-zinc-400">
              Foodpanda / GrabFood listings belong to a brand, not a physical outlet.
            </p>
            <Button asChild variant="outline" size="sm" className="mt-3">
              <Link to="/channel-listings">
                <Boxes className="h-3.5 w-3.5" />
                Managed in Channel Listings
              </Link>
            </Button>
          </div>
        </Card>
      </div>

      {/* ── Remove-brand confirm ─────────────────────────────────────────── */}
      <Dialog open={removeTarget != null} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <DialogContent className="border-border bg-card text-zinc-50 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove brand from this outlet?</DialogTitle>
            <DialogDescription>
              {removeTarget ? (
                <>
                  <span className="font-medium text-zinc-200">{removeTarget.name}</span> will be
                  deactivated at <span className="font-medium text-zinc-200">{outlet.name}</span>.
                  Its deployment history is kept and it can be re-deployed later.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button
              className="bg-red-600 text-white hover:bg-red-500"
              disabled={removeBrand.isPending}
              onClick={() => removeTarget && removeBrand.mutate(removeTarget.brandId)}
            >
              {removeBrand.isPending ? 'Removing…' : 'Remove brand'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}

// ---------------------------------------------------------------------------
// Bits
// ---------------------------------------------------------------------------

function Breadcrumb({ name }: { name: string }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
      <Link to="/outlets" className="text-zinc-400 transition-colors hover:text-zinc-200">
        Outlets
      </Link>
      <Crumb className="h-3.5 w-3.5 text-zinc-600" />
      <span className="font-medium text-zinc-100">{name}</span>
    </nav>
  )
}

function OutletStatusPill({ status }: { status: 'ACTIVE' | 'INACTIVE' }) {
  const active = status === 'ACTIVE'
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span className={cn('h-1.5 w-1.5 rounded-full', active ? 'bg-emerald-400' : 'bg-zinc-600')} />
      <span className={active ? 'text-emerald-400' : 'text-zinc-500'}>
        {active ? 'Active' : 'Inactive'}
      </span>
    </span>
  )
}

function WarehousePill({ label, ready }: { label: string; ready: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium',
        ready
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
          : 'border-amber-500/30 bg-amber-500/10 text-amber-300',
      )}
    >
      {label}
    </span>
  )
}
