import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users,
  UserCog,
  Building2,
  Search,
  Plus,
  UserCheck,
  Eye,
  Pencil,
} from 'lucide-react'
import { get, post, patch } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { hasRole } from '../auth/access'
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
  createdAt: string
  updatedAt: string
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
}

const EMPTY_FORM: FormState = {
  employee_no: '',
  full_name: '',
  department: '',
  position: '',
  work_days: DEFAULT_WORK_DAYS,
  hired_at: '',
  status: 'ACTIVE',
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
}: {
  form: FormState
  setForm: React.Dispatch<React.SetStateAction<FormState>>
  submitting: boolean
  mode: 'add' | 'edit'
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.full_name.trim() || !form.employee_no.trim() || !form.department) {
      setFormError('Employee #, full name, and department are required.')
      return
    }
    if (form.work_days.length === 0) {
      setFormError('Pick at least one working day.')
      return
    }
    setFormError(null)
    setSubmitting(true)
    try {
      await post('/employees', {
        employee_no: form.employee_no.trim(),
        full_name: form.full_name.trim(),
        department: form.department,
        position: form.position.trim() || undefined,
        work_days: form.work_days,
        ...(form.hired_at ? { hired_at: form.hired_at } : {}),
      })
      setDialogOpen(false)
      setForm(EMPTY_FORM)
      fetchEmployees()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create employee'
      setFormError(msg)
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
    })
    setEditError(null)
    setEditTarget(emp)
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault()
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
          setForm(EMPTY_FORM)
          setFormError(null)
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
          <EmployeeFormFields form={form} setForm={setForm} submitting={submitting} mode="add" />
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
                <TableHead>Position</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Status</TableHead>
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
