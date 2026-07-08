import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Building2, Users2, Search, Plus, CheckCircle2, Pencil } from 'lucide-react'
import { get } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { hasRole } from '../auth/access'
import PageContainer from '../components/layout/PageContainer'
import PageHeader from '../components/common/PageHeader'
import KpiCard from '../components/common/KpiCard'
import KpiRibbon from '../components/common/KpiRibbon'
import EmptyState from '../components/common/EmptyState'
import DepartmentBudgets from '../components/DepartmentBudgets'
import SupplierDialog, { type Party } from '../components/SupplierDialog'
import CustomerDialog from '../components/CustomerDialog'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table'

type Kind = 'suppliers' | 'customers'

const TABS: { key: Kind; label: string; icon: typeof Building2 }[] = [
  { key: 'suppliers', label: 'Suppliers', icon: Building2 },
  { key: 'customers', label: 'Customers', icon: Users2 },
]

export default function MasterData() {
  const { user } = useAuth()
  // OWNER-only (+ legacy SUPER_ADMIN, via hasRole's alias normalization).
  const canWrite = hasRole(user?.role, [])

  const [kind, setKind] = useState<Kind>('suppliers')
  const [search, setSearch] = useState('')

  // Dialog state (client review 2026-07-08: proper dialogs replace the old
  // cramped inline 4-field row form). `editing` null = create mode.
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Party | null>(null)

  // Cache-first (perf): suppliers/customers are global master data, not
  // outlet-scoped (no X-Outlet-Id filtering server-side) — so the key is
  // just the tab kind. Switching tabs shows the other list instantly if it
  // was already fetched this session.
  const {
    data: rows = [],
    isLoading: loading,
    error: queryError,
  } = useQuery({
    queryKey: ['masterdata', kind],
    queryFn: async () => (await get<Party[]>(`/${kind}`)).data,
  })
  const error = queryError ? (queryError instanceof Error ? queryError.message : 'Failed to load') : null

  function switchKind(k: Kind) {
    setKind(k)
    setSearch('')
    setDialogOpen(false)
    setEditing(null)
  }

  function openCreate() {
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(row: Party) {
    setEditing(row)
    setDialogOpen(true)
  }

  const stats = useMemo(
    () => ({ total: rows.length, active: rows.filter((r) => r.isActive).length }),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) => r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q),
    )
  }, [rows, search])

  const singular = kind === 'suppliers' ? 'Supplier' : 'Customer'

  return (
    <PageContainer>
      <PageHeader title="Master Data" subtitle="Suppliers and customers — the parties behind purchasing and sales" />

      {/* Tab toggle */}
      <div className="inline-flex rounded-lg border border-border bg-card p-1">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = kind === t.key
          return (
            <button
              key={t.key}
              onClick={() => switchKind(t.key)}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 ${
                active ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          )
        })}
      </div>

      <KpiRibbon>
        <KpiCard icon={kind === 'suppliers' ? Building2 : Users2} label={`Total ${TABS.find((t) => t.key === kind)!.label}`} value={stats.total} />
        <KpiCard icon={CheckCircle2} label="Active" value={stats.active} />
      </KpiRibbon>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-500" />
          <Input
            placeholder={`Search ${kind} by code or name…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            maxLength={128}
            className="w-72 pl-8"
          />
        </div>
        {canWrite && (
          <Button onClick={openCreate} variant="outline">
            <Plus className="mr-2 h-4 w-4" />
            Add {singular}
          </Button>
        )}
        <span className="text-sm text-zinc-500">{filtered.length} shown</span>
      </div>

      <Card className="border-border bg-card">
        {loading ? (
          <p className="p-6 text-sm text-zinc-500">Loading {kind}…</p>
        ) : error ? (
          <p className="p-6 text-sm text-red-400">{error}</p>
        ) : filtered.length === 0 ? (
          <EmptyState icon={kind === 'suppliers' ? Building2 : Users2} title={`No ${kind}`} description={canWrite ? `Add your first ${singular.toLowerCase()} to get started.` : 'Nothing here yet.'} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead className="text-right">Terms</TableHead>
                <TableHead>Status</TableHead>
                {canWrite && <TableHead className="w-14 text-right">Edit</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.id} className="border-border">
                  <TableCell className="font-mono text-xs text-zinc-300">{r.code}</TableCell>
                  <TableCell className="text-sm text-zinc-100">{r.name}</TableCell>
                  <TableCell className="text-sm text-zinc-400">
                    {r.contactName ?? r.contactPhone ?? '—'}
                    {r.contactName && r.contactPhone ? (
                      <span className="text-zinc-600"> · {r.contactPhone}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-zinc-400">{r.paymentTermDays ? `${r.paymentTermDays}d` : '—'}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${r.isActive ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-700 text-white'}`}>
                      {r.isActive ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </TableCell>
                  {canWrite && (
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(r)}
                        aria-label={`Edit ${r.name}`}
                        title={`Edit ${singular.toLowerCase()}${kind === 'suppliers' ? ' + items supplied' : ''}`}
                        className="h-8 w-8 text-zinc-500 hover:text-emerald-400 hover:bg-emerald-500/10"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <DepartmentBudgets />

      {/* Create/edit dialogs — one per kind so supplier item-links never leak
          into the customer form. */}
      {kind === 'suppliers' ? (
        <SupplierDialog open={dialogOpen} onOpenChange={setDialogOpen} supplier={editing} />
      ) : (
        <CustomerDialog open={dialogOpen} onOpenChange={setDialogOpen} customer={editing} />
      )}
    </PageContainer>
  )
}
