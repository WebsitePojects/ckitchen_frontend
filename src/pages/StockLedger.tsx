import { useEffect, useMemo, useState } from 'react'
import { ListOrdered, ArrowDownToLine, ArrowUpFromLine, Layers, Search } from 'lucide-react'
import { get } from '../lib/api'
import PageContainer from '../components/layout/PageContainer'
import PageHeader from '../components/common/PageHeader'
import KpiCard from '../components/common/KpiCard'
import KpiRibbon from '../components/common/KpiRibbon'
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

interface LedgerEntry {
  id: string
  sourceModule: string
  sourceDocumentNo: string
  sourceLineNo: string | null
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
  RECEIVE: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  ITO: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  ORDER_DEDUCTION: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  ADJUSTMENT: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  RESTOCK: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default function StockLedger() {
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [ingredients, setIngredients] = useState<Record<string, Ingredient>>({})
  const [warehouses, setWarehouses] = useState<Record<string, Warehouse>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [module, setModule] = useState('ALL')
  const [search, setSearch] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    const q = module === 'ALL' ? '' : `?source_module=${module}`
    Promise.all([
      get<LedgerEntry[]>(`/stock-ledger${q}`),
      get<Ingredient[]>('/ingredients'),
      get<Warehouse[]>('/warehouses'),
    ])
      .then(([l, ing, wh]) => {
        if (!alive) return
        setEntries(l.data)
        setIngredients(Object.fromEntries(ing.data.map((x) => [x.id, x])))
        setWarehouses(Object.fromEntries(wh.data.map((x) => [x.id, x])))
        setError(null)
      })
      .catch((e) => alive && setError(e?.message ?? 'Failed to load stock ledger'))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [module])

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
        ing.toLowerCase().includes(q) ||
        e.sourceModule.toLowerCase().includes(q)
      )
    })
  }, [entries, ingredients, search])

  return (
    <PageContainer>
      <PageHeader title="Stock Ledger" subtitle="Every inventory movement — the single source of truth" />

      <KpiRibbon>
        <KpiCard icon={ListOrdered} label="Total Movements" value={stats.total} />
        <KpiCard icon={ArrowDownToLine} label="IN" value={stats.ins} />
        <KpiCard icon={ArrowUpFromLine} label="OUT" value={stats.outs} />
        <KpiCard icon={Layers} label="Modules" value={new Set(entries.map((e) => e.sourceModule)).size} />
      </KpiRibbon>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-500" />
          <Input
            placeholder="Search doc #, ingredient, module…"
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
        <span className="text-sm text-zinc-500">{rows.length} shown</span>
      </div>

      <Card className="border-border bg-card">
        {loading ? (
          <p className="p-6 text-sm text-zinc-500">Loading ledger…</p>
        ) : error ? (
          <p className="p-6 text-sm text-red-400">{error}</p>
        ) : rows.length === 0 ? (
          <EmptyState icon={ListOrdered} title="No movements" description="Receive stock, confirm an ITO, or advance an order to post ledger entries." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead>Time</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Document</TableHead>
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
                  <TableCell className="whitespace-nowrap text-sm text-zinc-400">{fmtTime(e.postedAt)}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${MODULE_CLASS[e.sourceModule] ?? 'border-zinc-600 text-zinc-400'}`}>
                      {e.sourceModule}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-zinc-400">
                    {e.sourceDocumentNo.slice(0, 12)}{e.sourceLineNo ? `·${e.sourceLineNo.slice(0, 6)}` : ''}
                  </TableCell>
                  <TableCell className="text-sm text-zinc-200">{ingredients[e.ingredientId]?.name ?? e.ingredientId.slice(0, 8)}</TableCell>
                  <TableCell className="text-sm text-zinc-400">{warehouses[e.warehouseId]?.type ?? e.warehouseId.slice(0, 8)}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${e.movementType === 'IN' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
                      {e.movementType}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums text-zinc-100">
                    {Number(e.quantity ?? 0).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-zinc-400">
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
