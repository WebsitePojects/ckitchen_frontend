import { useEffect, useMemo, useState } from 'react'
import { ListOrdered, ArrowDownToLine, ArrowUpFromLine, Layers, Search } from 'lucide-react'
import { toast } from 'sonner'
import PageContainer from '../components/layout/PageContainer'
import PageHeader from '../components/common/PageHeader'
import KpiCard from '../components/common/KpiCard'
import KpiRibbon from '../components/common/KpiRibbon'
import PendingValue from '../components/common/PendingValue'
import EmptyState from '../components/common/EmptyState'
import { Card } from '../components/ui/card'
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
import { useApiQuery } from '../hooks/useApiQuery'

interface LedgerEntry {
  id: string
  sourceModule: string
  sourceDocumentNo: string
  sourceLineNo: string | null
  /**
   * Short human-friendly reference for the movement — an order code like
   * "TOK-FP-7K3QD" for order rows, an RR number for receives, null otherwise.
   * Optional: absent on old deploys (read defensively, fall back to doc no).
   */
  source_ref?: string | null
  ingredientId: string
  warehouseId: string
  movementType: 'IN' | 'OUT'
  quantity: string
  unitCost: string
  postedAt: string
}
interface Ingredient { id: string; name: string; unit?: string }
interface Warehouse { id: string; type: string; locationId?: string }

const MODULES = ['RECEIVE', 'ITO', 'ORDER_DEDUCTION', 'ADJUSTMENT', 'RESTOCK']

const MODULE_CLASS: Record<string, string> = {
  RECEIVE: 'bg-emerald-500/15 text-ink-accent border-emerald-500/30',
  ITO: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30',
  ORDER_DEDUCTION: 'bg-amber-500/15 text-warn-text border-amber-500/30',
  ADJUSTMENT: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30',
  RESTOCK: 'bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30',
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

const NO_ENTRIES: LedgerEntry[] = []

export default function StockLedger() {
  // GET /stock-ledger is outlet-scoped server-side (X-Outlet-Id); useApiQuery keys its
  // cache by the selected outlet, so switching outlets never shows another outlet's rows.
  const [module, setModule] = useState('ALL')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  // Debounce the server-side search term (~300ms). Client-side filtering (below)
  // still uses the immediate `search`, so typing narrows the list instantly even
  // before the request lands — and old deploys that ignore `q=` still filter.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // Name lookups change rarely: cached for 5 minutes and shared with other pages. On
  // failure the table degrades to short ids rather than blocking the ledger.
  const ingredientsQuery = useApiQuery<Ingredient[]>('/ingredients', { fallbackError: '', staleTimeMs: 300_000 })
  const warehousesQuery = useApiQuery<Warehouse[]>('/warehouses', { fallbackError: '', staleTimeMs: 300_000 })
  const ingredients = useMemo(
    () => Object.fromEntries((ingredientsQuery.data ?? []).map((x) => [x.id, x])) as Record<string, Ingredient>,
    [ingredientsQuery.data],
  )
  const warehouses = useMemo(
    () => Object.fromEntries((warehousesQuery.data ?? []).map((x) => [x.id, x])) as Record<string, Warehouse>,
    [warehousesQuery.data],
  )

  // Ledger rows — cached per filter (module + debounced search + outlet). The backend
  // accepts `q=`; older deploys ignore it, so `rows` below ALSO filters client-side.
  const ledgerUrl = useMemo(() => {
    const params = new URLSearchParams()
    if (module !== 'ALL') params.set('source_module', module)
    if (debouncedSearch.trim()) params.set('q', debouncedSearch.trim())
    const qs = params.toString()
    return `/stock-ledger${qs ? `?${qs}` : ''}`
  }, [module, debouncedSearch])
  const ledger = useApiQuery<LedgerEntry[]>(ledgerUrl, { fallbackError: 'Failed to load stock ledger', staleTimeMs: 15_000 })
  const entries = ledger.data ?? NO_ENTRIES
  const loading = ledger.loading
  const error = ledger.error

  async function copyRef(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Copied')
    } catch {
      toast.error('Could not copy to clipboard')
    }
  }

  const stats = useMemo(() => {
    const ins = entries.filter((e) => e.movementType === 'IN').length
    return { total: entries.length, ins, outs: entries.length - ins }
  }, [entries])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return entries.filter((e) => {
      if (!q) return true
      const ing = ingredients[e.ingredientId]?.name ?? ''
      return (
        e.sourceDocumentNo.toLowerCase().includes(q) ||
        (e.source_ref?.toLowerCase().includes(q) ?? false) ||
        ing.toLowerCase().includes(q) ||
        e.sourceModule.toLowerCase().includes(q)
      )
    })
  }, [entries, ingredients, search])

  return (
    <PageContainer>
      <PageHeader title="Stock Ledger" subtitle="Every inventory movement — the single source of truth" />

      <KpiRibbon loading={loading}>
        <KpiCard icon={ListOrdered} label="Total Movements" value={stats.total} />
        <KpiCard icon={ArrowDownToLine} label="IN" value={stats.ins} />
        <KpiCard icon={ArrowUpFromLine} label="OUT" value={stats.outs} />
        <KpiCard icon={Layers} label="Modules" value={new Set(entries.map((e) => e.sourceModule)).size} />
      </KpiRibbon>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search ref, doc #, ingredient, module…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-72 pl-8"
          />
        </div>
        <Select value={module} onValueChange={setModule}>
          <SelectTrigger className="w-52"><SelectValue placeholder="All modules" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All modules</SelectItem>
            {MODULES.map((m) => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground"><PendingValue loading={loading}>{rows.length} shown</PendingValue></span>
      </div>

      <Card className="border-border bg-card">
        {loading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading ledger…</p>
        ) : error ? (
          <p className="p-6 text-sm text-danger-text">{error}</p>
        ) : rows.length === 0 ? (
          <EmptyState icon={ListOrdered} title="No movements" description="Receive stock, confirm an ITO, or advance an order to post ledger entries." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead>Time</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Document</TableHead>
                <TableHead>Ref</TableHead>
                <TableHead>Ingredient</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead>Move</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit ₱</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => (
                <TableRow key={e.id} className="border-border">
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{fmtTime(e.postedAt)}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${MODULE_CLASS[e.sourceModule] ?? 'border-input text-muted-foreground'}`}>
                      {e.sourceModule}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {e.sourceDocumentNo.slice(0, 12)}{e.sourceLineNo ? `·${e.sourceLineNo.slice(0, 6)}` : ''}
                  </TableCell>
                  <TableCell>
                    {e.source_ref ? (
                      <button
                        type="button"
                        onClick={() => void copyRef(e.source_ref!)}
                        title="Click to copy"
                        className="font-mono text-xs text-ink-accent transition-colors hover:text-emerald-200 hover:underline"
                      >
                        {e.source_ref}
                      </button>
                    ) : (
                      <span
                        className="font-mono text-xs text-muted-foreground"
                        title={e.sourceDocumentNo}
                      >
                        {e.sourceDocumentNo.slice(0, 8)}…
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-foreground">{ingredients[e.ingredientId]?.name ?? e.ingredientId.slice(0, 8)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{warehouses[e.warehouseId]?.type ?? e.warehouseId.slice(0, 8)}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${e.movementType === 'IN' ? 'bg-emerald-500/15 text-ink-accent' : 'bg-amber-500/15 text-warn-text'}`}>
                      {e.movementType}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums text-foreground">
                    {Number(e.quantity ?? 0).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    ₱{Number(e.unitCost ?? 0).toLocaleString()}
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
