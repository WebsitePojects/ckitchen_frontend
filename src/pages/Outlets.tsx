import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Building2,
  CheckCircle2,
  ChevronRight,
  Home,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Warehouse,
} from 'lucide-react'
import { toast } from 'sonner'
import { CKApiError, get, patch, post } from '../lib/api'
import { useSubmitGuard } from '../hooks/useSubmitGuard'
import PageContainer from '../components/layout/PageContainer'
import PageHeader from '../components/common/PageHeader'
import KpiCard from '../components/common/KpiCard'
import KpiRibbon from '../components/common/KpiRibbon'
import EmptyState from '../components/common/EmptyState'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog'
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

interface OutletWarehouse {
  id: string
  type: 'MAIN' | 'KITCHEN'
}

interface Outlet {
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

interface OutletForm {
  code: string
  name: string
  address: string
  timezone: string
  contactName: string
  contactPhone: string
}

interface EditOutletForm extends OutletForm {
  status: 'ACTIVE' | 'INACTIVE'
}

const EMPTY_FORM: OutletForm = {
  code: '',
  name: '',
  address: '',
  timezone: 'Asia/Manila',
  contactName: '',
  contactPhone: '',
}

function errMsg(e: unknown, fallback: string): string {
  if (e instanceof CKApiError) return e.message || fallback
  return e instanceof Error ? e.message : fallback
}

function toEditForm(outlet: Outlet): EditOutletForm {
  return {
    code: outlet.code,
    name: outlet.name,
    address: outlet.address ?? '',
    timezone: outlet.timezone,
    contactName: outlet.contactName ?? '',
    contactPhone: outlet.contactPhone ?? '',
    status: outlet.status,
  }
}

function hasWarehouse(outlet: Outlet, type: OutletWarehouse['type']) {
  return outlet.warehouses.some((warehouse) => warehouse.type === type)
}

function warehousePill(label: string, ready: boolean) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${
        ready
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
          : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
      }`}
    >
      {label}
    </span>
  )
}

export default function Outlets() {
  const navigate = useNavigate()
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<OutletForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  // ── Edit outlet dialog ────────────────────────────────────────────────────
  const [editTarget, setEditTarget] = useState<Outlet | null>(null)
  const [editForm, setEditForm] = useState<EditOutletForm>({ ...EMPTY_FORM, status: 'ACTIVE' })
  const [editError, setEditError] = useState<string | null>(null)
  const editGuard = useSubmitGuard()

  function openEdit(outlet: Outlet) {
    setEditForm(toEditForm(outlet))
    setEditError(null)
    setEditTarget(outlet)
  }

  const handleEditSubmit = editGuard.guard(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editTarget) return
    setEditError(null)
    try {
      await patch<Outlet>(`/outlets/${editTarget.id}`, {
        code: editForm.code,
        name: editForm.name,
        address: editForm.address || null,
        status: editForm.status,
        timezone: editForm.timezone || 'Asia/Manila',
        contact_name: editForm.contactName || null,
        contact_phone: editForm.contactPhone || null,
      })
      await loadOutlets()
      toast.success('Outlet updated.')
      setEditTarget(null)
    } catch (e) {
      setEditError(errMsg(e, 'Failed to update outlet'))
    }
  })

  // ── Quick status toggle (confirm-gated — one click must never silently
  // deactivate an outlet, per idempotency-concurrency.md) ──────────────────
  const [statusTarget, setStatusTarget] = useState<Outlet | null>(null)
  const statusGuard = useSubmitGuard()

  const confirmStatusToggle = statusGuard.guard(async () => {
    if (!statusTarget) return
    const nextStatus = statusTarget.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
    try {
      await patch<Outlet>(`/outlets/${statusTarget.id}`, { status: nextStatus })
      await loadOutlets()
      toast.success(nextStatus === 'ACTIVE' ? 'Outlet activated.' : 'Outlet deactivated.')
      setStatusTarget(null)
    } catch (e) {
      toast.error('Failed to update status', { description: errMsg(e, 'Please try again.') })
    }
  })

  const loadOutlets = useCallback(async () => {
    setError(null)
    const { data } = await get<Outlet[]>('/outlets')
    setOutlets(data)
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { data } = await get<Outlet[]>('/outlets')
        if (alive) setOutlets(data)
      } catch (e) {
        if (alive) setError((e as { message?: string })?.message ?? 'Failed to load outlets')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const stats = useMemo(() => {
    const active = outlets.filter((outlet) => outlet.status === 'ACTIVE').length
    const readyWarehousePairs = outlets.filter(
      (outlet) => hasWarehouse(outlet, 'MAIN') && hasWarehouse(outlet, 'KITCHEN'),
    ).length
    return { active, inactive: outlets.length - active, readyWarehousePairs }
  }, [outlets])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError(null)

    try {
      await post<Outlet>('/outlets', {
        code: form.code,
        name: form.name,
        address: form.address || undefined,
        timezone: form.timezone || 'Asia/Manila',
        contact_name: form.contactName || undefined,
        contact_phone: form.contactPhone || undefined,
      })
      await loadOutlets()
      setForm(EMPTY_FORM)
      setDialogOpen(false)
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Failed to create outlet')
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Outlets"
        subtitle="Physical operating sites with their own warehouse and in-house inventory"
        actions={
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-emerald-600 text-white hover:bg-emerald-500">
                <Plus className="h-4 w-4" />
                Add Outlet
              </Button>
            </DialogTrigger>
            <DialogContent className="border-border bg-card text-zinc-50">
              <form onSubmit={handleSubmit} className="space-y-4">
                <DialogHeader>
                  <DialogTitle>Add physical outlet</DialogTitle>
                  <DialogDescription>
                    Creates the outlet and initializes its MAIN warehouse plus KITCHEN in-house
                    inventory.
                  </DialogDescription>
                </DialogHeader>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1.5 text-sm">
                    <span className="text-zinc-300">Outlet code</span>
                    <Input
                      value={form.code}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, code: event.target.value }))
                      }
                      placeholder="QC2"
                      required
                    />
                  </label>
                  <label className="space-y-1.5 text-sm">
                    <span className="text-zinc-300">Outlet name</span>
                    <Input
                      value={form.name}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, name: event.target.value }))
                      }
                      placeholder="Quezon City Outlet"
                      required
                    />
                  </label>
                  <label className="space-y-1.5 text-sm sm:col-span-2">
                    <span className="text-zinc-300">Address</span>
                    <Input
                      value={form.address}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, address: event.target.value }))
                      }
                      placeholder="Street, city"
                    />
                  </label>
                  <label className="space-y-1.5 text-sm">
                    <span className="text-zinc-300">Timezone</span>
                    <Input
                      value={form.timezone}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, timezone: event.target.value }))
                      }
                      placeholder="Asia/Manila"
                    />
                  </label>
                  <label className="space-y-1.5 text-sm">
                    <span className="text-zinc-300">Contact phone</span>
                    <Input
                      value={form.contactPhone}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, contactPhone: event.target.value }))
                      }
                      placeholder="+63 ..."
                    />
                  </label>
                  <label className="space-y-1.5 text-sm sm:col-span-2">
                    <span className="text-zinc-300">Contact person</span>
                    <Input
                      value={form.contactName}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, contactName: event.target.value }))
                      }
                      placeholder="Outlet manager"
                    />
                  </label>
                </div>

                {error && <p className="text-sm text-red-400">{error}</p>}

                <DialogFooter>
                  <Button type="submit" disabled={saving}>
                    {saving ? 'Creating…' : 'Create outlet'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      <KpiRibbon>
        <KpiCard icon={Building2} label="Total Outlets" value={outlets.length} />
        <KpiCard icon={CheckCircle2} label="Active" value={stats.active} />
        <KpiCard icon={Warehouse} label="Warehouse Pairs" value={stats.readyWarehousePairs} />
        <KpiCard icon={Home} label="Inactive" value={stats.inactive} />
      </KpiRibbon>

      <Card className="border-border bg-card">
        {loading ? (
          <p className="p-6 text-sm text-zinc-500">Loading physical outlets…</p>
        ) : error && outlets.length === 0 ? (
          <p className="p-6 text-sm text-red-400">{error}</p>
        ) : outlets.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No physical outlets"
            description="Create the first outlet to attach warehouses, stations, printers, and staff."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead>Code</TableHead>
                <TableHead>Outlet</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead>In-house Inventory</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Manage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {outlets.map((outlet) => (
                <TableRow
                  key={outlet.id}
                  className="cursor-pointer border-border transition-colors hover:bg-zinc-800/40"
                  onClick={() => navigate(`/outlets/${outlet.id}`)}
                >
                  <TableCell className="font-mono text-xs text-emerald-300">{outlet.code}</TableCell>
                  <TableCell>
                    <div>
                      <p className="font-medium text-zinc-100">{outlet.name}</p>
                      <p className="text-xs text-zinc-500">{outlet.address || 'No address set'}</p>
                    </div>
                  </TableCell>
                  <TableCell>{warehousePill('MAIN', hasWarehouse(outlet, 'MAIN'))}</TableCell>
                  <TableCell>{warehousePill('KITCHEN', hasWarehouse(outlet, 'KITCHEN'))}</TableCell>
                  <TableCell>
                    <div className="text-sm">
                      <p className="text-zinc-300">{outlet.contactName || '—'}</p>
                      <p className="text-xs text-zinc-500">{outlet.contactPhone || outlet.timezone}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      className="flex items-center gap-1.5 text-xs transition-opacity hover:opacity-80"
                      onClick={(event) => {
                        event.stopPropagation()
                        setStatusTarget(outlet)
                      }}
                      title={outlet.status === 'ACTIVE' ? 'Deactivate outlet' : 'Activate outlet'}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          outlet.status === 'ACTIVE' ? 'bg-emerald-400' : 'bg-zinc-600'
                        }`}
                      />
                      <span
                        className={
                          outlet.status === 'ACTIVE' ? 'text-emerald-400' : 'text-zinc-500'
                        }
                      >
                        {outlet.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                      </span>
                      {outlet.status === 'ACTIVE' ? (
                        <PowerOff className="h-3 w-3 text-zinc-600" />
                      ) : (
                        <Power className="h-3 w-3 text-zinc-600" />
                      )}
                    </button>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation()
                          openEdit(outlet)
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation()
                          navigate(`/outlets/${outlet.id}`)
                        }}
                      >
                        Manage outlet
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* ── Edit outlet dialog ───────────────────────────────────────────── */}
      <Dialog
        open={editTarget != null}
        onOpenChange={(open) => !open && !editGuard.pending && setEditTarget(null)}
      >
        <DialogContent className="border-border bg-card text-zinc-50">
          <form onSubmit={handleEditSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Edit outlet</DialogTitle>
              <DialogDescription>
                Update {editTarget?.name ?? 'this outlet'}&apos;s details and status.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm">
                <span className="text-zinc-300">Outlet code</span>
                <Input
                  value={editForm.code}
                  onChange={(event) =>
                    setEditForm((current) => ({ ...current, code: event.target.value }))
                  }
                  required
                />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="text-zinc-300">Outlet name</span>
                <Input
                  value={editForm.name}
                  onChange={(event) =>
                    setEditForm((current) => ({ ...current, name: event.target.value }))
                  }
                  required
                />
              </label>
              <label className="space-y-1.5 text-sm sm:col-span-2">
                <span className="text-zinc-300">Address</span>
                <Input
                  value={editForm.address}
                  onChange={(event) =>
                    setEditForm((current) => ({ ...current, address: event.target.value }))
                  }
                  placeholder="Street, city"
                />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="text-zinc-300">Timezone</span>
                <Input
                  value={editForm.timezone}
                  onChange={(event) =>
                    setEditForm((current) => ({ ...current, timezone: event.target.value }))
                  }
                  placeholder="Asia/Manila"
                />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="text-zinc-300">Status</span>
                <Select
                  value={editForm.status}
                  onValueChange={(value) =>
                    setEditForm((current) => ({
                      ...current,
                      status: value as 'ACTIVE' | 'INACTIVE',
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Active</SelectItem>
                    <SelectItem value="INACTIVE">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="text-zinc-300">Contact phone</span>
                <Input
                  value={editForm.contactPhone}
                  onChange={(event) =>
                    setEditForm((current) => ({ ...current, contactPhone: event.target.value }))
                  }
                  placeholder="+63 ..."
                />
              </label>
              <label className="space-y-1.5 text-sm sm:col-span-2">
                <span className="text-zinc-300">Contact person</span>
                <Input
                  value={editForm.contactName}
                  onChange={(event) =>
                    setEditForm((current) => ({ ...current, contactName: event.target.value }))
                  }
                  placeholder="Outlet manager"
                />
              </label>
            </div>

            {editError && <p className="text-sm text-red-400">{editError}</p>}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditTarget(null)}
                disabled={editGuard.pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={editGuard.pending}>
                {editGuard.pending ? 'Saving…' : 'Save changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Status toggle confirm ────────────────────────────────────────── */}
      <Dialog
        open={statusTarget != null}
        onOpenChange={(open) => !open && !statusGuard.pending && setStatusTarget(null)}
      >
        <DialogContent className="border-border bg-card text-zinc-50 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {statusTarget?.status === 'ACTIVE' ? 'Deactivate outlet?' : 'Activate outlet?'}
            </DialogTitle>
            <DialogDescription>
              {statusTarget?.status === 'ACTIVE' ? (
                <>
                  <span className="font-medium text-zinc-200">{statusTarget?.name}</span> will be
                  marked inactive. Staff, stations, and inventory records stay intact and this can
                  be reversed at any time.
                </>
              ) : (
                <>
                  <span className="font-medium text-zinc-200">{statusTarget?.name}</span> will be
                  marked active again.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setStatusTarget(null)}
              disabled={statusGuard.pending}
            >
              Cancel
            </Button>
            <Button
              className={
                statusTarget?.status === 'ACTIVE'
                  ? 'bg-red-600 text-white hover:bg-red-500'
                  : 'bg-emerald-600 text-white hover:bg-emerald-500'
              }
              disabled={statusGuard.pending}
              onClick={() => confirmStatusToggle()}
            >
              {statusGuard.pending
                ? 'Saving…'
                : statusTarget?.status === 'ACTIVE'
                  ? 'Deactivate'
                  : 'Activate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
