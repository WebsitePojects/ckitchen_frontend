import { useEffect, useMemo, useState } from 'react'
import {
  Users,
  UserCog,
  Building2,
  Search,
  Plus,
  UserCheck,
} from 'lucide-react'
import { get, post } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import PageHeader from '../components/common/PageHeader'
import KpiCard from '../components/common/KpiCard'
import KpiRibbon from '../components/common/KpiRibbon'
import StatusBadge from '../components/common/StatusBadge'
import EmptyState from '../components/common/EmptyState'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
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
// Types (mirror backend schema camelCase as returned by Drizzle)
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

// ---------------------------------------------------------------------------
// Add-employee form state
// ---------------------------------------------------------------------------

interface FormState {
  employee_no: string
  full_name: string
  department: Department | ''
  position: string
}

const EMPTY_FORM: FormState = {
  employee_no: '',
  full_name: '',
  department: '',
  position: '',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Employees() {
  const { user } = useAuth()
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'

  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState<string>('ALL')

  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

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

  // ── Form submit ──────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.full_name.trim() || !form.employee_no.trim() || !form.department) {
      setFormError('Employee #, full name, and department are required.')
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
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Employee #</label>
            <Input
              placeholder="e.g. EMP-001"
              value={form.employee_no}
              onChange={(e) => setForm((f) => ({ ...f, employee_no: e.target.value }))}
              disabled={submitting}
            />
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
    <div className="space-y-5">
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
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((emp) => (
                <TableRow key={emp.id} className="border-border">
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
                    <StatusBadge status={emp.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  )
}
