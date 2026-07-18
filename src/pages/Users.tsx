import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Users as UsersIcon,
  ShieldCheck,
  ShieldOff,
  KeyRound,
  UserCog,
  Check,
  Ban,
  Unlock,
  Lock,
  Timer,
  Globe,
  CalendarClock,
  BellRing,
  MoreVertical,
  Pencil,
  MapPin,
  History,
  BarChart3,
  Plus,
} from 'lucide-react'
import { get, post, patch, put } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { hasRole } from '../auth/access'
import { useOutlet } from '../context/OutletContext'
import type { OutletSummary } from '../context/OutletContext'
import { NAV_GROUPS } from '../components/layout/nav-items'
import UserPerformanceDialog from '../components/UserPerformanceDialog'
import PageContainer from '../components/layout/PageContainer'
import PageHeader from '../components/common/PageHeader'
import KpiCard from '../components/common/KpiCard'
import KpiRibbon from '../components/common/KpiRibbon'
import EmptyState from '../components/common/EmptyState'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Badge } from '../components/ui/badge'
import { Switch } from '../components/ui/switch'
import { Button } from '../components/ui/button'
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
import { Avatar, AvatarFallback } from '../components/ui/avatar'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu'
import { cn } from '../lib/utils'

// ---------------------------------------------------------------------------
// Types (mirror backend admin API — ckitchen_backend src/modules/admin/routes.ts)
// ---------------------------------------------------------------------------

interface AdminUser {
  id: string
  name: string
  email: string
  role: string
  status: 'ACTIVE' | 'BLOCKED'
  createdAt: string
  lastLoginAt: string | null
  outletIds: string[]
  brandIds: string[]
}

interface ActivityRow {
  id: string
  action: string
  description: string | null
  entityType: string | null
  entityId: string | null
  createdAt: string
}

interface RbacEntry {
  role: string
  pageKey: string
  allowed: boolean
}

interface RbacResponse {
  roles: string[]
  pages: string[]
  entries: RbacEntry[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Canonical v2 roles only (D24/D29) — matches the backend's V2_ROLES enum that
// createUserSchema/patchUserSchema/rbacPutSchema all validate against. Legacy
// v1 tokens (SUPER_ADMIN etc.) can still be *displayed* via ROLE_LABEL/ROLE_CLASS
// below (a stray pre-migration account), but are never offered as a choice here.
const ROLES_V2: readonly string[] = [
  'OWNER',
  'OUTLET_MANAGER',
  'BRAND_MANAGER',
  'KITCHEN_CREW',
  'WAREHOUSE_MAIN',
  'WAREHOUSE_OUTLET',
  'PURCHASING',
  'HR',
  'ACCOUNTING',
]

// v1 (legacy) labels/colors, plus v2 (D24/D29) entries so a v2 role token
// never renders an undefined badge.
const ROLE_LABEL: Record<string, string> = {
  // v1
  SUPER_ADMIN: 'Super Admin',
  BRAND_MANAGER: 'Brand Manager',
  KITCHEN_STAFF: 'Kitchen Staff',
  WAREHOUSE: 'Warehouse',
  SUPPLIER_COORDINATOR: 'Supplier Coord.',
  ACCOUNTANT: 'Accountant',
  RIDER: 'Rider',
  // v2
  OWNER: 'Owner',
  OUTLET_MANAGER: 'Outlet Manager',
  KITCHEN_CREW: 'Kitchen Crew',
  WAREHOUSE_MAIN: 'Warehouse (Main)',
  WAREHOUSE_OUTLET: 'Warehouse (Outlet)',
  PURCHASING: 'Purchasing',
  HR: 'HR',
  ACCOUNTING: 'Accounting',
}

const ROLE_CLASS: Record<string, string> = {
  // v1
  SUPER_ADMIN: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  BRAND_MANAGER: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  KITCHEN_STAFF: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  WAREHOUSE: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  SUPPLIER_COORDINATOR: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  ACCOUNTANT: 'bg-teal-500/15 text-teal-400 border-teal-500/30',
  RIDER: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  // v2
  OWNER: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  OUTLET_MANAGER: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
  KITCHEN_CREW: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  WAREHOUSE_MAIN: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  WAREHOUSE_OUTLET: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  PURCHASING: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  HR: 'bg-pink-500/15 text-pink-400 border-pink-500/30',
  ACCOUNTING: 'bg-teal-500/15 text-teal-400 border-teal-500/30',
}

const SECURITY_CONTROLS = [
  { id: '2fa', icon: ShieldCheck, label: 'Two-Factor Authentication (2FA)', desc: 'Require a second factor at login.', on: false },
  { id: 'timeout', icon: Timer, label: 'Session Timeout', desc: 'Auto sign-out after inactivity.', on: true },
  { id: 'ip', icon: Globe, label: 'Restrict IP Access', desc: 'Allow sign-in only from approved networks.', on: false },
  { id: 'expiry', icon: CalendarClock, label: 'Password Expiry', desc: 'Force a password reset every 90 days.', on: false },
  { id: 'alerts', icon: BellRing, label: 'Login Alerts', desc: 'Notify on sign-in from a new device.', on: true },
]

// Pages OWNER must always retain access to — mirrors the backend's fail-closed
// guard (ckitchen_backend src/modules/admin/rbac-defaults.ts OWNER_PROTECTED_PAGES).
// Rendered locked-on in the matrix regardless of what the (possibly empty,
// not-yet-seeded) entries array says.
const OWNER_PROTECTED_PAGES: readonly string[] = ['/users', '/settings']

// Readable page labels — reuse the sidebar's nav labels where a page has one;
// fall back to a title-cased path segment for matrix-only pages (e.g. '/tv',
// which is deliberately not in the nav — see nav-items.ts).
const NAV_LABELS: Record<string, string> = Object.fromEntries(
  NAV_GROUPS.flatMap((g) => g.items.map((i) => [i.to, i.label] as const)),
)
const EXTRA_PAGE_LABELS: Record<string, string> = { '/tv': 'TV Display Board' }

function pageLabel(pageKey: string): string {
  if (pageKey === '/') return 'Dashboard'
  return (
    NAV_LABELS[pageKey] ??
    EXTRA_PAGE_LABELS[pageKey] ??
    pageKey
      .replace(/^\//, '')
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
  )
}

function initials(name: string) {
  return name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
}

function fmtLastLogin(iso: string | null): string {
  if (!iso) return 'Never'
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtActivityTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback
}

// ---------------------------------------------------------------------------
// Outlet multi-select (dropdown checklist) — used inside the Create User form
// ---------------------------------------------------------------------------

function OutletMultiSelect({
  outlets,
  selected,
  onChange,
  disabled,
}: {
  outlets: OutletSummary[]
  selected: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
}) {
  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])
  }

  const label =
    outlets.length === 0
      ? 'No outlets configured'
      : selected.length === 0
        ? 'No outlet access'
        : selected.length === outlets.length
          ? 'All outlets'
          : `${selected.length} outlet${selected.length === 1 ? '' : 's'}`

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start font-normal"
          disabled={disabled || outlets.length === 0}
        >
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64" align="start">
        <DropdownMenuLabel>Outlet access</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {outlets.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.id}
            checked={selected.includes(o.id)}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => toggle(o.id)}
          >
            {o.name} <span className="ml-1 text-xs text-zinc-500">({o.code})</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ---------------------------------------------------------------------------
// New User dialog
// ---------------------------------------------------------------------------

function CreateUserDialog({ outlets, onCreated }: { outlets: OutletSummary[]; onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<string>('OUTLET_MANAGER')
  const [password, setPassword] = useState('')
  const [outletIds, setOutletIds] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  function reset() {
    setName('')
    setEmail('')
    setRole('OUTLET_MANAGER')
    setPassword('')
    setOutletIds([])
    setFormError(null)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (submitting) return
    if (!name.trim() || !email.trim() || !role || password.length < 8) {
      setFormError('Name, email, role, and an 8+ character password are required.')
      return
    }
    setFormError(null)
    setSubmitting(true)
    try {
      await post('/admin/users', {
        name: name.trim(),
        email: email.trim(),
        role,
        password,
        outlet_ids: outletIds,
      })
      toast.success(`${name.trim()} created`)
      setOpen(false)
      reset()
      onCreated()
    } catch (err) {
      setFormError(errMsg(err, 'Failed to create user.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          New User
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New User</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={submitting} placeholder="e.g. Juan dela Cruz" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Email</label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={submitting} placeholder="name@company.com" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Role</label>
            <Select value={role} onValueChange={setRole} disabled={submitting}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES_V2.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABEL[r] ?? r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Password</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              placeholder="Min. 8 characters"
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Outlet access</label>
            <OutletMultiSelect outlets={outlets} selected={outletIds} onChange={setOutletIds} disabled={submitting} />
          </div>
          {formError && <p className="text-xs text-red-400">{formError}</p>}
          <DialogFooter>
            <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
              {submitting ? 'Creating…' : 'Create User'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Edit User dialog (name / email / role)
// ---------------------------------------------------------------------------

function EditUserDialog({
  target,
  onOpenChange,
  onSaved,
}: {
  target: AdminUser | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (target) {
      setName(target.name)
      setEmail(target.email)
      setRole(target.role)
      setFormError(null)
    }
  }, [target])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (submitting) return
    if (!target) return
    if (!name.trim() || !email.trim() || !role) {
      setFormError('Name, email, and role are required.')
      return
    }
    setSubmitting(true)
    setFormError(null)
    try {
      await patch(`/admin/users/${target.id}`, { name: name.trim(), email: email.trim(), role })
      toast.success(`${name.trim()} updated`)
      onOpenChange(false)
      onSaved()
    } catch (err) {
      setFormError(errMsg(err, 'Failed to update user.'))
    } finally {
      setSubmitting(false)
    }
  }

  // A stray legacy (v1) role on the target user won't be in ROLES_V2 — surface
  // it anyway so the select shows the user's actual current role.
  const roleOptions = target && !ROLES_V2.includes(target.role) ? [target.role, ...ROLES_V2] : ROLES_V2

  return (
    <Dialog open={target != null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
        </DialogHeader>
        {target && (
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-400">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} disabled={submitting} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-400">Email</label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={submitting} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-400">Role</label>
              <Select value={role} onValueChange={setRole} disabled={submitting}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roleOptions.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABEL[r] ?? r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {formError && <p className="text-xs text-red-400">{formError}</p>}
            <DialogFooter>
              <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
                {submitting ? 'Saving…' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Reset Password dialog
// ---------------------------------------------------------------------------

function ResetPasswordDialog({
  target,
  onOpenChange,
}: {
  target: AdminUser | null
  onOpenChange: (open: boolean) => void
}) {
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (target) {
      setPassword('')
      setFormError(null)
    }
  }, [target])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (submitting) return
    if (!target) return
    if (password.length < 8) {
      setFormError('Password must be at least 8 characters.')
      return
    }
    setSubmitting(true)
    setFormError(null)
    try {
      await post(`/admin/users/${target.id}/reset-password`, { password })
      toast.success(`Password reset for ${target.name}`, { description: 'They have been signed out of every active session.' })
      setPassword('')
      onOpenChange(false)
    } catch (err) {
      setFormError(errMsg(err, 'Failed to reset password.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={target != null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Reset Password</DialogTitle>
        </DialogHeader>
        {target && (
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <p className="text-xs text-zinc-500">
              Setting a new password for <span className="text-zinc-300">{target.email}</span> immediately signs
              them out of all active sessions.
            </p>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-400">New password</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                placeholder="Min. 8 characters"
                autoComplete="new-password"
              />
            </div>
            {formError && <p className="text-xs text-red-400">{formError}</p>}
            <DialogFooter>
              <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
                {submitting ? 'Resetting…' : 'Reset Password'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Outlet Access dialog
// ---------------------------------------------------------------------------

function OutletAccessDialog({
  target,
  outlets,
  onOpenChange,
  onSaved,
}: {
  target: AdminUser | null
  outlets: OutletSummary[]
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (target) {
      setSelected(target.outletIds)
      setFormError(null)
    }
  }, [target])

  async function handleSave() {
    if (submitting) return
    if (!target) return
    setSubmitting(true)
    setFormError(null)
    try {
      await put(`/admin/users/${target.id}/outlets`, { outlet_ids: selected })
      toast.success(`Outlet access updated for ${target.name}`)
      onOpenChange(false)
      onSaved()
    } catch (err) {
      setFormError(errMsg(err, 'Failed to update outlet access.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={target != null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Outlet Access</DialogTitle>
        </DialogHeader>
        {target && (
          <div className="space-y-4 pt-2">
            <p className="text-xs text-zinc-500">
              Outlets <span className="text-zinc-300">{target.name}</span> may act in.
            </p>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {outlets.length === 0 && <p className="px-1 py-2 text-xs text-zinc-500">No outlets configured.</p>}
              {outlets.map((o) => {
                const checked = selected.includes(o.id)
                return (
                  <label
                    key={o.id}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded px-2 py-1.5 hover:bg-zinc-900/40"
                  >
                    <span className="text-sm text-zinc-200">
                      {o.name} <span className="text-xs text-zinc-500">({o.code})</span>
                    </span>
                    <Switch
                      checked={checked}
                      disabled={submitting}
                      onCheckedChange={(v) =>
                        setSelected((prev) => (v ? [...prev, o.id] : prev.filter((id) => id !== o.id)))
                      }
                    />
                  </label>
                )
              })}
            </div>
            {formError && <p className="text-xs text-red-400">{formError}</p>}
            <DialogFooter>
              <Button onClick={handleSave} disabled={submitting} className="w-full sm:w-auto">
                {submitting ? 'Saving…' : 'Save Access'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Activity dialog
// ---------------------------------------------------------------------------

function ActivityDialog({
  target,
  onOpenChange,
}: {
  target: AdminUser | null
  onOpenChange: (open: boolean) => void
}) {
  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: ['admin', 'users', target?.id, 'activity'],
    queryFn: async () => (await get<ActivityRow[]>(`/admin/users/${target!.id}/activity`)).data,
    enabled: target != null,
  })

  return (
    <Dialog open={target != null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Activity{target ? ` — ${target.name}` : ''}</DialogTitle>
        </DialogHeader>
        <div className="max-h-96 overflow-y-auto">
          {isLoading ? (
            <p className="p-4 text-sm text-zinc-500">Loading…</p>
          ) : error ? (
            <p className="p-4 text-sm text-red-400">{errMsg(error, 'Failed to load activity.')}</p>
          ) : rows.length === 0 ? (
            <EmptyState icon={History} title="No activity yet" description="This user hasn't performed any audited actions." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="whitespace-nowrap">Time</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} className="border-border align-top">
                    <TableCell className="whitespace-nowrap text-xs tabular-nums text-zinc-500">
                      {fmtActivityTime(r.createdAt)}
                    </TableCell>
                    <TableCell>
                      <span className="inline-block rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-emerald-400">
                        {r.action}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-zinc-400">{r.description ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Permissions Matrix tab (Task 2 — real RBAC editor)
// ---------------------------------------------------------------------------

function PermissionsMatrix() {
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'rbac'],
    queryFn: async () => (await get<RbacResponse>('/admin/rbac')).data,
  })

  const allowedMap = useMemo(() => {
    const m = new Map<string, boolean>()
    for (const e of data?.entries ?? []) m.set(`${e.role}|${e.pageKey}`, e.allowed)
    return m
  }, [data])

  // Per-cell in-flight guard — each Switch had no pending state at all, so a
  // rapid double-toggle on one cell could fire two overlapping PUTs and race
  // the optimistic-update/rollback below. Set<string> keyed by "role|pageKey".
  const [pendingCells, setPendingCells] = useState<Set<string>>(new Set())

  async function toggle(role: string, pageKey: string, next: boolean) {
    const cellKey = `${role}|${pageKey}`
    let alreadyPending = false
    setPendingCells(prev => {
      if (prev.has(cellKey)) {
        alreadyPending = true
        return prev
      }
      return new Set(prev).add(cellKey)
    })
    if (alreadyPending) return

    const previous = queryClient.getQueryData<RbacResponse>(['admin', 'rbac'])

    // Optimistic update
    queryClient.setQueryData<RbacResponse>(['admin', 'rbac'], (old) => {
      if (!old) return old
      const exists = old.entries.some((e) => e.role === role && e.pageKey === pageKey)
      const entries = exists
        ? old.entries.map((e) => (e.role === role && e.pageKey === pageKey ? { ...e, allowed: next } : e))
        : [...old.entries, { role, pageKey, allowed: next }]
      return { ...old, entries }
    })

    try {
      // NOTE: the live backend (ckitchen_backend src/modules/admin/routes.ts
      // rbacPutSchema) validates the request body as a bare array of entries,
      // NOT `{ entries: [...] }` — matched here against the actual route, not
      // the (differently-shaped) spec draft.
      const res = await put<RbacResponse>('/admin/rbac', [{ role, pageKey, allowed: next }])
      queryClient.setQueryData(['admin', 'rbac'], res.data)
    } catch (err) {
      queryClient.setQueryData(['admin', 'rbac'], previous)
      toast.error(errMsg(err, 'Failed to update permission.'))
    } finally {
      setPendingCells(prev => {
        const nextSet = new Set(prev)
        nextSet.delete(cellKey)
        return nextSet
      })
    }
  }

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-base text-zinc-100">Permissions Matrix</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto px-0">
        {isLoading ? (
          <p className="p-6 text-sm text-zinc-500">Loading permissions…</p>
        ) : error ? (
          <p className="p-6 text-sm text-red-400">{errMsg(error, 'Failed to load the permissions matrix.')}</p>
        ) : !data ? null : (
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="min-w-[10rem]">Page</TableHead>
                {data.roles.map((r) => (
                  <TableHead key={r} className="text-center text-xs">
                    {ROLE_LABEL[r] ?? r}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.pages.map((p) => (
                <TableRow key={p} className="border-border">
                  <TableCell className="font-medium text-zinc-200">
                    {pageLabel(p)}
                    <span className="block font-mono text-[10px] text-zinc-600">{p}</span>
                  </TableCell>
                  {data.roles.map((r) => {
                    const locked = r === 'OWNER' && OWNER_PROTECTED_PAGES.includes(p)
                    const checked = locked ? true : allowedMap.get(`${r}|${p}`) ?? false
                    const cellPending = pendingCells.has(`${r}|${p}`)
                    return (
                      <TableCell key={r} className="text-center">
                        <Switch
                          checked={checked}
                          disabled={locked || cellPending}
                          onCheckedChange={(v) => toggle(r, p, v)}
                          aria-label={`${ROLE_LABEL[r] ?? r} — ${pageLabel(p)}`}
                        />
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {data && data.entries.length === 0 && (
        <p className="px-6 pb-4 text-xs text-zinc-600">
          No permissions have been saved yet — every switch below defaults to off (except OWNER's locked admin
          pages) until you toggle and save one.
        </p>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Users page
// ---------------------------------------------------------------------------

export default function Users() {
  const { user } = useAuth()
  const isOwner = hasRole(user?.role, ['OWNER'])
  const { outlets } = useOutlet()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()

  const {
    data: users = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: async () => (await get<AdminUser[]>('/admin/users')).data,
    enabled: isOwner,
  })

  const [editTarget, setEditTarget] = useState<AdminUser | null>(null)
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null)
  const [outletTarget, setOutletTarget] = useState<AdminUser | null>(null)
  const [activityTarget, setActivityTarget] = useState<AdminUser | null>(null)
  const [perfTarget, setPerfTarget] = useState<AdminUser | null>(null)

  const [security, setSecurity] = useState(() =>
    Object.fromEntries(SECURITY_CONTROLS.map((c) => [c.id, c.on])) as Record<string, boolean>,
  )

  function invalidateUsers() {
    queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
  }

  // Ref-based in-flight guard — the dropdown menu item fires this from
  // onClick, not a persistently-disabled button, so a ref (immediate, no
  // re-render needed) is what actually stops a second click landing before
  // the menu unmounts from double-blocking/unblocking the same account.
  const blockingIdsRef = useRef<Set<string>>(new Set())

  async function handleToggleBlock(u: AdminUser) {
    if (blockingIdsRef.current.has(u.id)) return
    blockingIdsRef.current.add(u.id)
    const blocking = u.status === 'ACTIVE'
    try {
      await post(`/admin/users/${u.id}/${blocking ? 'block' : 'unblock'}`)
      toast.success(`${u.name} ${blocking ? 'blocked' : 'unblocked'}`)
      invalidateUsers()
    } catch (err) {
      toast.error(errMsg(err, `Failed to ${blocking ? 'block' : 'unblock'} user.`))
    } finally {
      blockingIdsRef.current.delete(u.id)
    }
  }

  const kpi = useMemo(
    () => ({
      total: users.length,
      active: users.filter((u) => u.status === 'ACTIVE').length,
      blocked: users.filter((u) => u.status === 'BLOCKED').length,
      roles: new Set(users.map((u) => u.role)).size,
    }),
    [users],
  )

  // Non-OWNER: denied state, mirrors AuditTrail.tsx's !canView pattern. The
  // backend gates every /admin/* route to OWNER anyway (403), so there is
  // nothing useful to fetch/render for anyone else.
  if (!isOwner) {
    return (
      <PageContainer>
        <PageHeader title="Users & Roles" subtitle="Accounts, permissions and security controls" />
        <EmptyState
          icon={ShieldOff}
          title="OWNER access required"
          description="Only OWNER accounts can manage users, roles, and permissions."
        />
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Users & Roles"
        subtitle="Accounts, permissions and security controls"
        actions={<CreateUserDialog outlets={outlets} onCreated={invalidateUsers} />}
      />

      <KpiRibbon>
        <KpiCard icon={UsersIcon} label="Total Users" value={kpi.total} />
        <KpiCard icon={Check} label="Active" value={kpi.active} />
        <KpiCard icon={Ban} label="Blocked" value={kpi.blocked} />
        <KpiCard icon={UserCog} label="Roles" value={kpi.roles} />
      </KpiRibbon>

      <Tabs defaultValue={searchParams.get('tab') === 'matrix' ? 'matrix' : 'users'} className="w-full">
        <TabsList className="bg-card">
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="matrix">Permissions Matrix</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>

        {/* Users */}
        <TabsContent value="users" className="mt-4">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base text-zinc-100">Team</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              {isLoading ? (
                <p className="p-6 text-sm text-zinc-500">Loading users…</p>
              ) : error ? (
                <p className="p-6 text-sm text-red-400">{errMsg(error, 'Failed to load users.')}</p>
              ) : users.length === 0 ? (
                <EmptyState icon={UsersIcon} title="No users yet" description="Create the first account with New User." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-border hover:bg-transparent">
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last login</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((u) => {
                      const isYou = user?.id === u.id
                      const active = u.status === 'ACTIVE'
                      return (
                        <TableRow key={u.id} className="border-border">
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <Avatar className="h-8 w-8">
                                <AvatarFallback className="bg-emerald-500/15 text-xs font-semibold text-emerald-400">
                                  {initials(u.name)}
                                </AvatarFallback>
                              </Avatar>
                              <span className="font-medium text-zinc-100">
                                {u.name}
                                {isYou && <span className="ml-2 text-xs text-emerald-400">(you)</span>}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-zinc-400">{u.email}</TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={ROLE_CLASS[u.role] ?? 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30'}
                            >
                              {ROLE_LABEL[u.role] ?? u.role}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <span className={cn('inline-flex items-center gap-1.5 text-sm', active ? 'text-emerald-400' : 'text-red-400')}>
                              <span className={cn('h-1.5 w-1.5 rounded-full', active ? 'bg-emerald-400' : 'bg-red-400')} />
                              {active ? 'Active' : 'Blocked'}
                            </span>
                          </TableCell>
                          <TableCell className="text-zinc-500">{fmtLastLogin(u.lastLoginAt)}</TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => setEditTarget(u)}>
                                  <Pencil className="h-3.5 w-3.5" /> Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setResetTarget(u)}>
                                  <KeyRound className="h-3.5 w-3.5" /> Reset password
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setOutletTarget(u)}>
                                  <MapPin className="h-3.5 w-3.5" /> Outlet access
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setActivityTarget(u)}>
                                  <History className="h-3.5 w-3.5" /> Activity
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setPerfTarget(u)}>
                                  <BarChart3 className="h-3.5 w-3.5" /> Performance
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => handleToggleBlock(u)}
                                  className={active ? 'text-red-400 focus:text-red-400' : 'text-emerald-400 focus:text-emerald-400'}
                                >
                                  {active ? (
                                    <>
                                      <Ban className="h-3.5 w-3.5" /> Block
                                    </>
                                  ) : (
                                    <>
                                      <Unlock className="h-3.5 w-3.5" /> Unblock
                                    </>
                                  )}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Permissions matrix */}
        <TabsContent value="matrix" className="mt-4">
          <PermissionsMatrix />
        </TabsContent>

        {/* Security */}
        <TabsContent value="security" className="mt-4">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-zinc-100">
                <Lock className="h-4 w-4 text-emerald-500" /> Security Controls
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {SECURITY_CONTROLS.map((c) => {
                const Icon = c.icon
                return (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-4 rounded-lg border border-transparent px-2 py-3 hover:border-border hover:bg-zinc-900/40"
                  >
                    <div className="flex items-start gap-3">
                      <Icon className="mt-0.5 h-5 w-5 text-zinc-400" />
                      <div>
                        <p className="text-sm font-medium text-zinc-100">{c.label}</p>
                        <p className="text-xs text-zinc-500">{c.desc}</p>
                      </div>
                    </div>
                    <Switch
                      checked={security[c.id]}
                      onCheckedChange={(v) => setSecurity((s) => ({ ...s, [c.id]: v }))}
                    />
                  </div>
                )
              })}
              <p className="px-2 pt-2 text-xs text-zinc-600">
                Security controls are presentational in the prototype.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <EditUserDialog target={editTarget} onOpenChange={(o) => !o && setEditTarget(null)} onSaved={invalidateUsers} />
      <ResetPasswordDialog target={resetTarget} onOpenChange={(o) => !o && setResetTarget(null)} />
      <OutletAccessDialog
        target={outletTarget}
        outlets={outlets}
        onOpenChange={(o) => !o && setOutletTarget(null)}
        onSaved={invalidateUsers}
      />
      <ActivityDialog target={activityTarget} onOpenChange={(o) => !o && setActivityTarget(null)} />
      <UserPerformanceDialog
        target={perfTarget}
        outlets={outlets}
        onOpenChange={(o) => !o && setPerfTarget(null)}
      />
    </PageContainer>
  )
}
