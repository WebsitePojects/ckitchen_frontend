import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Users2, Search, Plus, CircleAlert, CheckCircle2 } from 'lucide-react'
import { get, post } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { hasRole } from '../auth/access'
import PageContainer from '../components/layout/PageContainer'
import PageHeader from '../components/common/PageHeader'
import KpiCard from '../components/common/KpiCard'
import KpiRibbon from '../components/common/KpiRibbon'
import EmptyState from '../components/common/EmptyState'
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

interface Party {
  id: string
  code: string
  name: string
  contactName: string | null
  contactPhone: string | null
  email: string | null
  paymentTermDays: number
  isActive: boolean
}

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

  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ code: '', name: '', contact_phone: '', payment_term_days: '' })
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const queryClient = useQueryClient()

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
    setAdding(false)
    setMsg(null)
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

  async function submit() {
    setMsg(null)
    if (!form.code.trim() || !form.name.trim()) {
      setMsg({ err: 'Code and name are required.' })
      return
    }
    if (form.payment_term_days) {
      const days = Number(form.payment_term_days)
      if (Number.isNaN(days) || days < 0) {
        setMsg({ err: 'Payment terms must be a non-negative number of days.' })
        return
      }
    }
    setSaving(true)
    try {
      await post(`/${kind}`, {
        code: form.code.trim(),
        name: form.name.trim(),
        contact_phone: form.contact_phone.trim() || undefined,
        payment_term_days: form.payment_term_days ? Number(form.payment_term_days) : undefined,
      })
      setMsg({ ok: `${kind === 'suppliers' ? 'Supplier' : 'Customer'} ${form.code.toUpperCase()} added.` })
      setForm({ code: '', name: '', contact_phone: '', payment_term_days: '' })
      setAdding(false)
      void queryClient.invalidateQueries({ queryKey: ['masterdata', kind] })
    } catch (e) {
      setMsg({ err: e instanceof Error ? e.message : 'Save failed.' })
    } finally {
      setSaving(false)
    }
  }

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
          <Button onClick={() => setAdding((v) => !v)} variant="outline">
            <Plus className="mr-2 h-4 w-4" />
            Add {singular}
          </Button>
        )}
        <span className="text-sm text-zinc-500">{filtered.length} shown</span>
      </div>

      {adding && canWrite && (
        <Card className="border-border bg-card p-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Input placeholder="Code *" maxLength={32} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            <Input placeholder="Name *" maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input placeholder="Contact phone" maxLength={32} value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} />
            <Input placeholder="Payment terms (days)" type="number" min="0" value={form.payment_term_days} onChange={(e) => setForm({ ...form, payment_term_days: e.target.value })} />
          </div>
          <div className="mt-3 flex items-center gap-3">
            <Button onClick={submit} disabled={saving}>{saving ? 'Saving…' : `Save ${singular}`}</Button>
            <Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      {msg?.ok && <p className="flex items-center gap-2 text-sm text-emerald-400"><CheckCircle2 className="h-4 w-4" /> {msg.ok}</p>}
      {msg?.err && <p className="flex items-center gap-2 text-sm text-red-400"><CircleAlert className="h-4 w-4" /> {msg.err}</p>}

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
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.id} className="border-border">
                  <TableCell className="font-mono text-xs text-zinc-300">{r.code}</TableCell>
                  <TableCell className="text-sm text-zinc-100">{r.name}</TableCell>
                  <TableCell className="text-sm text-zinc-400">{r.contactPhone ?? r.contactName ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums text-zinc-400">{r.paymentTermDays ? `${r.paymentTermDays}d` : '—'}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${r.isActive ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-700 text-white'}`}>
                      {r.isActive ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </PageContainer>
  )
}
