import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Users,
  UserCog,
  Building2,
  Search,
  Plus,
  UserCheck,
  Eye,
  EyeOff,
  Pencil,
  KeyRound,
} from 'lucide-react'
import { get, post, patch, CKApiError } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { hasRole } from '../auth/access'
import {
  ACCOUNT_ROLES,
  ACCOUNT_ROLE_LABEL,
  DEPARTMENT_ACCOUNT_ROLE,
  isValidAccountEmail,
  isValidAccountPassword,
} from '../lib/accountRoles'
import {
  DEFAULT_WORK_DAYS,
  DAY_LABEL,
  WORK_DAYS,
  formatWorkDays,
  sanitizeWorkDays,
  type WorkDay,
} from '../lib/workdays'
import PageHeader from '../components/common/PageHeader'
import KpiCard from '../components/common/KpiCard'
import KpiRibbon from '../components/common/KpiRibbon'
import StatusBadge from '../components/common/StatusBadge'
import EmptyState from '../components/common/EmptyState'
import PageContainer from '../components/layout/PageContainer'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Switch } from '../components/ui/switch'
import { cn } from '../lib/utils'
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog'

// ---------------------------------------------------------------------------
// Types (mirror backend schema camelCase as returned by Drizzle).
// workDays/hiredAt are the Employee-360 additions — optional so rows from an
// old deploy (without the columns) still typecheck and render.
// ---------------------------------------------------------------------------

interface Employee {
  id: string
  userId: string | null
  employeeNo: string
  fullName: string
  department: string
  position: string | null
  photoUrl: string | null
  status: string
  workDays?: string[] | null
  hiredAt?: string | null
  // Outlet assignment (T1) — absent entirely on an old deploy, null = HQ/unassigned.
  locationId?: string | null
  // Employee-login link (client flaw fix, 2026-07-22) — absent entirely on an
  // old deploy; treat as "no login" rather than crashing.
  hasLogin?: boolean
  userEmail?: string | null
  createdAt: string
  updatedAt: string
}

/** POST /employees response — same Employee shape, plus the created login when `account` was sent. */
interface CreateEmployeeResponse extends Employee {
  user?: { id: string; email: string; role: string }
}

/** Minimal shape consumed from GET /outlets (see pages/Outlets.tsx for the full row). */
interface OutletOption {
  id: string
  name: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEPARTMENTS = [
  'KITCHEN',
  'WAREHOUSE',
  'PURCHASING',
  'SALES',
  'PRODUCTION',
  'QA',
  'ACCOUNTING',
  'ADMIN',
] as const

type Department = typeof DEPARTMENTS[number]

const DEPT_CLASS: Record<string, string> = {
  KITCHEN:    'bg-amber-500/15 text-amber-400 border-amber-500/30',
  WAREHOUSE:  'bg-violet-500/15 text-violet-400 border-violet-500/30',
  PURCHASING: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  SALES:      'bg-blue-500/15 text-blue-400 border-blue-500/30',
  PRODUCTION: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  QA:         'bg-rose-500/15 text-rose-400 border-rose-500/30',
  ACCOUNTING: 'bg-teal-500/15 text-teal-400 border-teal-500/30',
  ADMIN:      'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
}

const STATUSES = ['ACTIVE', 'INACTIVE'] as const // backend employee_status enum

// Radix Select disallows an empty-string item value, so the "no outlet"
// option uses this sentinel; it's translated to `location_id: null` at
// submit time.
const UNASSIGNED_OUTLET = '__unassigned__'

// ---------------------------------------------------------------------------
// Form state (shared by Add + Edit dialogs)
// ---------------------------------------------------------------------------

interface FormState {
  employee_no: string
  full_name: string
  department: Department | ''
  position: string
  work_days: WorkDay[]
  hired_at: string // 'YYYY-MM-DD' or '' (unset)
  status: (typeof STATUSES)[number]
  // location_id displays the current/default selection (UNASSIGNED_OUTLET or
  // a real outlet id); location_touched tracks whether the user actually
  // interacted with the Select this dialog session. Only touched selections
  // are sent — see handleSubmit/handleEditSubmit ("deploy-order safe").
  location_id: string
  location_touched: boolean
}

const EMPTY_FORM: FormState = {
  employee_no: '',
  full_name: '',
  department: '',
  position: '',
  work_days: DEFAULT_WORK_DAYS,
  hired_at: '',
  status: 'ACTIVE',
  location_id: UNASSIGNED_OUTLET,
  location_touched: false,
}

// ---------------------------------------------------------------------------
// Login-account sub-form (Add Employee dialog only — client flaw fix,
// 2026-07-22: adding an employee didn't create a login, forcing the owner to
// register a person twice). `role` starts blank so the department-derived
// default (DEPARTMENT_ACCOUNT_ROLE) keeps following the Department select
// until the admin actually picks a role themselves.
// ---------------------------------------------------------------------------

interface AccountFormState {
  enabled: boolean
  email: string
  password: string
  role: string
}

const EMPTY_ACCOUNT: AccountFormState = {
  enabled: false,
  email: '',
  password: '',
  role: '',
}

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback
}

// ---------------------------------------------------------------------------
// Working-days picker — 7 toggle chips, Mon..Sun, min 1 enforced (the last
// selected day can't be turned off; the hint below says why).
// ---------------------------------------------------------------------------

function WorkDaysPicker({
  value,
  onChange,
  disabled,
}: {
  value: WorkDay[]
  onChange: (days: WorkDay[]) => void
  disabled?: boolean
}) {
  function toggle(day: WorkDay) {
    if (value.includes(day)) {
      if (value.length === 1) return // min 1 working day
      onChange(value.filter((d) => d !== day))
    } else {
      onChange(sanitizeWorkDays([...value, day]))
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {WORK_DAYS.map((d) => {
          const on = value.includes(d)
          return (
            <button
              key={d}
              type="button"
              disabled={disabled}
              onClick={() => toggle(d)}
              aria-pressed={on}
              className={cn(
                'rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500',
                on
                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                  : 'border-border bg-background/40 text-zinc-500 hover:text-zinc-300',
                disabled && 'opacity-50',
              )}
            >
              {DAY_LABEL[d]}
            </button>
          )
        })}
      </div>
      <p className="mt-1.5 text-[11px] text-zinc-600">
        {formatWorkDays(value)} — at least one working day is required.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared dialog form body (Add + Edit render the same fields)
// ---------------------------------------------------------------------------

function EmployeeFormFields({
  form,
  setForm,
  submitting,
  mode,
  outlets,
  outletsLoading,
}: {
  form: FormState
  setForm: React.Dispatch<React.SetStateAction<FormState>>
  submitting: boolean
  mode: 'add' | 'edit'
  outlets: OutletOption[]
  outletsLoading: boolean
}) {
  return (
    <>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">Employee #</label>
        {mode === 'add' ? (
          <Input
            placeholder="e.g. EMP-001"
            value={form.employee_no}
            onChange={(e) => setForm((f) => ({ ...f, employee_no: e.target.value }))}
            disabled={submitting}
          />
        ) : (
          // Employee # is the payroll identity — deliberately not editable.
          <p className="rounded-md border border-border bg-background/40 px-3 py-2 font-mono text-sm text-zinc-400">
            {form.employee_no}
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">Full Name</label>
        <Input
          placeholder="e.g. Juan dela Cruz"
          value={form.full_name}
          onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
          disabled={submitting}
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">Department</label>
        <Select
          value={form.department}
          onValueChange={(v) => setForm((f) => ({ ...f, department: v as Department }))}
          disabled={submitting}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select department" />
          </SelectTrigger>
          <SelectContent>
            {DEPARTMENTS.map((d) => (
              <SelectItem key={d} value={d}>
                {d.charAt(0) + d.slice(1).toLowerCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">Position (optional)</label>
        <Input
          placeholder="e.g. Line Cook"
          value={form.position}
          onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
          disabled={submitting}
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">Outlet</label>
        <Select
          value={form.location_id}
          onValueChange={(v) =>
            setForm((f) => ({ ...f, location_id: v, location_touched: true }))
          }
          disabled={submitting || outletsLoading}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select outlet" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNASSIGNED_OUTLET}>Unassigned / HQ</SelectItem>
            {outlets.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">Working days</label>
        <WorkDaysPicker
          value={form.work_days}
          onChange={(days) => setForm((f) => ({ ...f, work_days: days }))}
          disabled={submitting}
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">Hired on (optional)</label>
        <Input
          type="date"
          value={form.hired_at}
          onChange={(e) => setForm((f) => ({ ...f, hired_at: e.target.value }))}
          disabled={submitting}
        />
      </div>
      {mode === 'edit' && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-zinc-400">Status</label>
          <Select
            value={form.status}
            onValueChange={(v) => setForm((f) => ({ ...f, status: v as FormState['status'] }))}
            disabled={submitting}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Login-account section — Add Employee dialog only (client flaw fix,
// 2026-07-22). `effectiveRole` is the department-derived default until the
// admin picks a role explicitly; see AccountFormState above.
// ---------------------------------------------------------------------------

function AccountFields({
  account,
  setAccount,
  effectiveRole,
  submitting,
  emailError,
  clearEmailError,
  showPassword,
  setShowPassword,
}: {
  account: AccountFormState
  setAccount: React.Dispatch<React.SetStateAction<AccountFormState>>
  effectiveRole: string
  submitting: boolean
  emailError: string | null
  clearEmailError: () => void
  showPassword: boolean
  setShowPassword: React.Dispatch<React.SetStateAction<boolean>>
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-background/40 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-zinc-200">Login account</p>
          <p className="text-xs text-zinc-500">This person will log in to ORION.</p>
        </div>
        <Switch
          checked={account.enabled}
          onCheckedChange={(v) => {
            setAccount((a) => ({ ...a, enabled: v }))
            clearEmailError()
          }}
          disabled={submitting}
          aria-label="Enable login account"
        />
      </div>
      {account.enabled && (
        <div className="space-y-3 pt-1">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Email</label>
            <Input
              type="email"
              placeholder="name@company.com"
              value={account.email}
              onChange={(e) => {
                setAccount((a) => ({ ...a, email: e.target.value }))
                clearEmailError()
              }}
              disabled={submitting}
              autoComplete="off"
            />
            {emailError && <p className="text-xs text-red-400">{emailError}</p>}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Password</label>
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                placeholder="Min. 8 characters"
                value={account.password}
                onChange={(e) => setAccount((a) => ({ ...a, password: e.target.value }))}
                disabled={submitting}
                autoComplete="new-password"
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Role</label>
            <Select
              value={effectiveRole}
              onValueChange={(v) => setAccount((a) => ({ ...a, role: v }))}
              disabled={submitting}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
              <SelectContent>
                {ACCOUNT_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ACCOUNT_ROLE_LABEL[r] ?? r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Employees() {
  const { user } = useAuth()
  const navigate = useNavigate()
  // OWNER-only (+ legacy SUPER_ADMIN, via hasRole's alias normalization).
  const isSuperAdmin = hasRole(user?.role, [])

  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState<string>('ALL')

  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Login-account sub-form (Add dialog only) — client flaw fix, 2026-07-22.
  const [accountForm, setAccountForm] = useState<AccountFormState>(EMPTY_ACCOUNT)
  const [accountEmailError, setAccountEmailError] = useState<string | null>(null)
  const [showAccountPassword, setShowAccountPassword] = useState(false)
  // Department-derived default role, live until the admin picks one explicitly.
  const effectiveAccountRole =
    accountForm.role || (form.department ? DEPARTMENT_ACCOUNT_ROLE[form.department] ?? '' : '')

  // Edit dialog
  const [editTarget, setEditTarget] = useState<Employee | null>(null)
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM)
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // ── Fetch ────────────────────────────────────────────────────────────────

  function fetchEmployees() {
    setLoading(true)
    setError(null)
    get<Employee[]>('/employees')
      .then((r) => setEmployees(r.data))
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : 'Failed to load employees'
        setError(msg)
      })
      .finally(() => setLoading(false))
  }

  useEffect(fetchEmployees, [])

  // ── Outlets (T1 — Outlet select options + list-column name lookup) ─────
  // Cached TanStack Query so the Add/Edit dialogs and the table's Outlet
  // column share one fetch; queryKey matches EmployeeProfile.tsx's so a
  // visit to either page warms the other's cache too.
  const outletsQuery = useQuery({
    queryKey: ['outlets', 'options'],
    queryFn: async () => (await get<OutletOption[]>('/outlets')).data,
  })
  const outlets = outletsQuery.data ?? []
  const outletNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const o of outlets) map.set(o.id, o.name)
    return map
  }, [outlets])

  // ── Derived counts for KPI ribbon ─────────────────────────────────────

  const totalCount = employees.length
  const activeCount = employees.filter((e) => e.status === 'ACTIVE').length
  const deptCount = useMemo(() => {
    const set = new Set(employees.map((e) => e.department))
    return set.size
  }, [employees])

  // ── Filtered rows ────────────────────────────────────────────────────

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return employees.filter((e) => {
      const matchesDept = deptFilter === 'ALL' || e.department === deptFilter
      if (!matchesDept) return false
      if (!q) return true
      return (
        (e.fullName ?? '').toLowerCase().includes(q) ||
        (e.employeeNo ?? '').toLowerCase().includes(q) ||
        (e.position ?? '').toLowerCase().includes(q)
      )
    })
  }, [employees, search, deptFilter])

  // ── Create ───────────────────────────────────────────────────────────

  function resetAddDialogState() {
    setForm(EMPTY_FORM)
    setFormError(null)
    setAccountForm(EMPTY_ACCOUNT)
    setAccountEmailError(null)
    setShowAccountPassword(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    if (!form.full_name.trim() || !form.employee_no.trim() || !form.department) {
      setFormError('Employee #, full name, and department are required.')
      return
    }
    if (form.work_days.length === 0) {
      setFormError('Pick at least one working day.')
      return
    }
    if (accountForm.enabled) {
      if (!isValidAccountEmail(accountForm.email)) {
        setFormError('Enter a valid email for the login account.')
        return
      }
      if (!isValidAccountPassword(accountForm.password)) {
        setFormError('Login password must be at least 8 characters.')
        return
      }
      if (!effectiveAccountRole) {
        setFormError('Select a role for the login account.')
        return
      }
    }
    setFormError(null)
    setAccountEmailError(null)
    setSubmitting(true)
    try {
      const res = await post<CreateEmployeeResponse>('/employees', {
        employee_no: form.employee_no.trim(),
        full_name: form.full_name.trim(),
        department: form.department,
        position: form.position.trim() || undefined,
        work_days: form.work_days,
        ...(form.hired_at ? { hired_at: form.hired_at } : {}),
        ...(form.location_touched
          ? { location_id: form.location_id === UNASSIGNED_OUTLET ? null : form.location_id }
          : {}),
        ...(accountForm.enabled
          ? {
              account: {
                email: accountForm.email.trim(),
                password: accountForm.password,
                role: effectiveAccountRole,
              },
            }
          : {}),
      })
      const createdUser = res.data?.user
      if (createdUser) {
        toast.success(`${form.full_name.trim()} created`, {
          description: `Login account created for ${createdUser.email}`,
        })
      } else {
        toast.success(`${form.full_name.trim()} created`)
      }
      setDialogOpen(false)
      resetAddDialogState()
      fetchEmployees()
    } catch (err: unknown) {
      if (err instanceof CKApiError && err.code === 'EMAIL_TAKEN') {
        setAccountEmailError('This email is already registered.')
      } else {
        setFormError(errMsg(err, 'Failed to create employee'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  // ── Edit ─────────────────────────────────────────────────────────────

  function openEdit(emp: Employee) {
    const days = sanitizeWorkDays(emp.workDays)
    setEditForm({
      employee_no: emp.employeeNo,
      full_name: emp.fullName,
      department: (DEPARTMENTS as readonly string[]).includes(emp.department)
        ? (emp.department as Department)
        : '',
      position: emp.position ?? '',
      // Old-deploy row without work_days → sensible Mon–Fri default in the form.
      work_days: days.length > 0 ? days : DEFAULT_WORK_DAYS,
      hired_at: emp.hiredAt ? emp.hiredAt.slice(0, 10) : '',
      status: emp.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
      // Reflects the employee's current assignment, but starts untouched —
      // submit omits location_id unless the admin actually changes this.
      location_id: emp.locationId ?? UNASSIGNED_OUTLET,
      location_touched: false,
    })
    setEditError(null)
    setEditTarget(emp)
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (editSubmitting) return
    if (!editTarget) return
    if (!editForm.full_name.trim() || !editForm.department) {
      setEditError('Full name and department are required.')
      return
    }
    if (editForm.work_days.length === 0) {
      setEditError('Pick at least one working day.')
      return
    }
    setEditError(null)
    setEditSubmitting(true)
    try {
      await patch(`/employees/${editTarget.id}`, {
        full_name: editForm.full_name.trim(),
        department: editForm.department,
        position: editForm.position.trim() || undefined,
        status: editForm.status,
        work_days: editForm.work_days,
        ...(editForm.hired_at ? { hired_at: editForm.hired_at } : {}),
        ...(editForm.location_touched
          ? {
              location_id:
                editForm.location_id === UNASSIGNED_OUTLET ? null : editForm.location_id,
            }
          : {}),
      })
      setEditTarget(null)
      fetchEmployees()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update employee'
      setEditError(msg)
    } finally {
      setEditSubmitting(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────

  const addButton = isSuperAdmin ? (
    <Dialog
      open={dialogOpen}
      onOpenChange={(open) => {
        setDialogOpen(open)
        if (!open) {
          resetAddDialogState()
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          Add Employee
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Employee</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <EmployeeFormFields
            form={form}
            setForm={setForm}
            submitting={submitting}
            mode="add"
            outlets={outlets}
            outletsLoading={outletsQuery.isLoading}
          />
          <AccountFields
            account={accountForm}
            setAccount={setAccountForm}
            effectiveRole={effectiveAccountRole}
            submitting={submitting}
            emailError={accountEmailError}
            clearEmailError={() => setAccountEmailError(null)}
            showPassword={showAccountPassword}
            setShowPassword={setShowAccountPassword}
          />
          {formError && (
            <p className="text-xs text-red-400">{formError}</p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
              {submitting ? 'Saving…' : 'Create Employee'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  ) : null

  return (
    <PageContainer>
      <PageHeader
        title="Employees"
        subtitle="Manage staff records across all departments"
        actions={addButton}
      />

      <KpiRibbon>
        <KpiCard icon={Users} label="Total" value={totalCount} />
        <KpiCard icon={UserCheck} label="Active" value={activeCount} />
        <KpiCard icon={Building2} label="Departments" value={deptCount} />
      </KpiRibbon>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-500" />
          <Input
            placeholder="Search name, employee #, position…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-72 pl-8"
          />
        </div>
        <Select value={deptFilter} onValueChange={setDeptFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All departments" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All departments</SelectItem>
            {DEPARTMENTS.map((d) => (
              <SelectItem key={d} value={d}>
                {d.charAt(0) + d.slice(1).toLowerCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-zinc-500">{rows.length} shown</span>
      </div>

      {/* Table */}
      <Card className="border-border bg-card">
        {loading ? (
          <p className="p-6 text-sm text-zinc-500">Loading employees…</p>
        ) : error ? (
          <p className="p-6 text-sm text-red-400">{error}</p>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={UserCog}
            title="No employees found"
            description={search || deptFilter !== 'ALL' ? 'Try adjusting your filters.' : 'Add an employee to get started.'}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead>Employee #</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Outlet</TableHead>
                <TableHead>Position</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Login</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((emp) => (
                <TableRow
                  key={emp.id}
                  className="cursor-pointer border-border"
                  onClick={() => navigate(`/employees/${emp.id}`)}
                >
                  <TableCell className="font-mono text-xs tabular-nums text-zinc-300">
                    {emp.employeeNo ?? '—'}
                  </TableCell>
                  <TableCell className="font-medium text-zinc-100">
                    {emp.fullName ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={DEPT_CLASS[emp.department] ?? 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30'}
                    >
                      {(emp.department ?? '—').charAt(0) + (emp.department ?? '').slice(1).toLowerCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-zinc-400">
                    {emp.locationId ? outletNameById.get(emp.locationId) ?? '—' : '—'}
                  </TableCell>
                  <TableCell className="text-sm text-zinc-400">
                    {emp.position ?? '—'}
                  </TableCell>
                  <TableCell>
                    {sanitizeWorkDays(emp.workDays).length > 0 ? (
                      <Badge variant="outline" className="border-zinc-500/30 bg-zinc-500/10 text-zinc-300">
                        {formatWorkDays(emp.workDays)}
                      </Badge>
                    ) : (
                      <span className="text-sm text-zinc-600">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={emp.status} />
                  </TableCell>
                  <TableCell>
                    {emp.hasLogin ? (
                      <div className="flex flex-col gap-0.5" title={emp.userEmail ?? undefined}>
                        <Badge
                          variant="outline"
                          className="w-fit gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                        >
                          <KeyRound className="h-3 w-3" /> Has login
                        </Badge>
                        {emp.userEmail && (
                          <span className="max-w-[10rem] truncate text-[10px] text-zinc-500">
                            {emp.userEmail}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-600">No login</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={`View ${emp.fullName}'s profile`}
                        onClick={(e) => {
                          e.stopPropagation()
                          navigate(`/employees/${emp.id}`)
                        }}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      {isSuperAdmin && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={`Edit ${emp.fullName}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            openEdit(emp)
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Edit dialog */}
      <Dialog
        open={editTarget != null}
        onOpenChange={(open) => {
          if (!open) {
            setEditTarget(null)
            setEditError(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Employee</DialogTitle>
          </DialogHeader>
          {editTarget && (
            <form onSubmit={handleEditSubmit} className="space-y-4 pt-2">
              <EmployeeFormFields
                form={editForm}
                setForm={setEditForm}
                submitting={editSubmitting}
                mode="edit"
                outlets={outlets}
                outletsLoading={outletsQuery.isLoading}
              />
              {editError && <p className="text-xs text-red-400">{editError}</p>}
              <DialogFooter>
                <Button type="submit" disabled={editSubmitting} className="w-full sm:w-auto">
                  {editSubmitting ? 'Saving…' : 'Save Changes'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
