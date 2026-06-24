/**
 * Inventory — Two-Tier Stock View + ITO Management + Low-Stock Alerts
 * Implements FR-IV-01..08 (CK1-SRS-001 §3.7)
 *
 * Features:
 *   FR-IV-01/02  Two-tier view: MAIN + KITCHEN warehouse stock tables
 *   FR-IV-03/04  ITO request (KITCHEN_STAFF|SUPER_ADMIN) + confirm (WAREHOUSE|SUPER_ADMIN)
 *   FR-IV-05     End-of-day consumption log (future: stub button shown)
 *   FR-IV-06/07  Below-threshold rows highlighted red; lowstock.alert toast
 *   FR-IV-08     Receive into MAIN (WAREHOUSE|SUPER_ADMIN)
 *   NFR-02       Real-time: stock.updated refreshes tiers; lowstock.alert toasts
 *
 * Business Rules:
 *   #4  ITO stock moves are atomic — backend enforces; UI shows both tiers post-confirm
 *   #8  Low-stock alerts are non-negotiable — prominent red toast, 10 s TTL
 *   #10 RBAC enforced server-side; UI hides/disables unreachable actions
 *
 * Reskin: dark theme, design tokens from ui-reskin-plan.md
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  AlertTriangle,
  ArrowLeftRight,
  Boxes,
  CheckCircle2,
  Package,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { get, post } from '../lib/api'
import { onSocketEvent } from '../lib/socket'
import type { LowStockAlert, StockPayload } from '../lib/socket'
import { useAuth } from '../auth/AuthContext'
import type { UserRole } from '../auth/AuthContext'
import { Button } from '../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import { Input } from '../components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table'
import PageHeader from '../components/common/PageHeader'
import KpiCard from '../components/common/KpiCard'
import KpiRibbon from '../components/common/KpiRibbon'
import EmptyState from '../components/common/EmptyState'

// ─── Role helpers ──────────────────────────────────────────────────────────────

/** Roles that can receive stock into MAIN warehouse (FR-IV-08) */
const CAN_RECEIVE: UserRole[] = ['SUPER_ADMIN', 'WAREHOUSE']
/** Roles that can request an ITO (FR-IV-04) */
const CAN_REQUEST_ITO: UserRole[] = ['SUPER_ADMIN', 'KITCHEN_STAFF']
/** Roles that can confirm an ITO (FR-IV-04) */
const CAN_CONFIRM_ITO: UserRole[] = ['SUPER_ADMIN', 'WAREHOUSE']

function hasRole(role: UserRole | undefined, allowed: UserRole[]): boolean {
  return !!role && allowed.includes(role)
}

// ─── API types ────────────────────────────────────────────────────────────────

interface Ingredient {
  id: string
  name: string
  unit: string
  unitCost: string
  lowStockThreshold: string
}

/** GET /inventory?warehouse=MAIN|KITCHEN row shape (CK1-API-003) */
interface StockLine {
  id: string
  warehouseId: string
  ingredientId: string
  quantity: string
  ingredient: Ingredient
  /** NOTE: API returns this one field snake_case — kept as-is. */
  below_threshold: boolean
}

type ItoStatus = 'REQUESTED' | 'CONFIRMED' | 'CANCELLED'

interface ItoItem {
  id: string
  itoId: string
  ingredientId: string
  quantity: string
}

/**
 * GET /itos row shape (verified against ckitchen_backend src/db/schema.ts +
 * src/modules/inventory/routes.ts — it's a bare `ito` table row, no joined
 * items/ingredient names and no `from`/`to` string literals; only warehouse
 * UUIDs and `createdAt` — there is no separate `requestedAt` column).
 * `POST /itos` (create) is the only call that returns `items` inline.
 */
interface Ito {
  id: string
  fromWarehouseId: string
  toWarehouseId: string
  status: ItoStatus
  requestedBy: string | null
  confirmedBy: string | null
  createdAt: string
  confirmedAt: string | null
  /** Only present on the POST /itos response; absent from GET /itos list rows. */
  items?: ItoItem[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatQty(qty: number | string, unit: string): string {
  const n = typeof qty === 'string' ? Number(qty) : qty
  return `${n % 1 === 0 ? n : n.toFixed(2)} ${unit}`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ─── ITO status badge ─────────────────────────────────────────────────────────

const ITO_STATUS_CLASSES: Record<ItoStatus, string> = {
  REQUESTED: 'bg-amber-500/15 text-amber-400 ring-1 ring-inset ring-amber-500/30',
  CONFIRMED: 'bg-emerald-500/15 text-emerald-400 ring-1 ring-inset ring-emerald-500/30',
  CANCELLED: 'bg-zinc-500/15 text-zinc-400 ring-1 ring-inset ring-zinc-500/30',
}

function ItoStatusBadge({ status }: { status: ItoStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${ITO_STATUS_CLASSES[status]}`}
    >
      {status}
    </span>
  )
}

// ─── Stock table ──────────────────────────────────────────────────────────────

interface StockTableProps {
  title: string
  tier: 'MAIN' | 'KITCHEN'
  rows: StockLine[]
  loading: boolean
  error: string | null
  /** IDs of ingredients that just got a lowstock.alert via socket (for extra highlight) */
  alertedIds: Set<string>
}

function StockTable({ title, tier, rows, loading, error, alertedIds }: StockTableProps) {
  const lowCount = rows.filter(r => r.below_threshold || alertedIds.has(r.ingredientId)).length

  return (
    <Card className="border-[#1F2A24] bg-[#121A17] overflow-hidden">
      <CardHeader className="px-4 py-3 border-b border-[#1F2A24] flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
          <Boxes className="h-4 w-4 text-emerald-500" aria-hidden />
          {title}
        </CardTitle>
        <div className="flex items-center gap-2">
          {lowCount > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-400 ring-1 ring-inset ring-red-500/30 tabular-nums">
              <AlertTriangle className="h-3 w-3" aria-hidden />
              {lowCount} low
            </span>
          )}
          {!loading && (
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-400 tabular-nums">
              {rows.length} items
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="mb-3 h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" />
            <p className="text-xs text-zinc-500">Loading stock…</p>
          </div>
        ) : error ? (
          <div className="p-6 text-center">
            <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-red-400" aria-hidden />
            <p className="text-sm font-medium text-red-400">{error}</p>
            <p className="mt-1 text-xs text-zinc-500">Check backend connection.</p>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No stock recorded"
            description={
              tier === 'MAIN'
                ? 'Receive a delivery to add items.'
                : 'Request a transfer to stock the kitchen.'
            }
            className="border-0 rounded-none bg-transparent"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-[#1F2A24] hover:bg-transparent">
                <TableHead className="h-8 px-4 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Ingredient
                </TableHead>
                <TableHead className="h-8 px-4 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Qty
                </TableHead>
                <TableHead className="h-8 px-4 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Threshold
                </TableHead>
                <TableHead className="h-8 px-4 text-center text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Status
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(row => {
                const isAlert = row.below_threshold || alertedIds.has(row.ingredientId)
                return (
                  <TableRow
                    key={row.ingredientId}
                    className={[
                      'transition-colors duration-300 border-[#1F2A24]',
                      isAlert
                        ? 'bg-red-500/5 hover:bg-red-500/10'
                        : 'hover:bg-zinc-800/30',
                    ].join(' ')}
                  >
                    <TableCell className="px-4 py-2.5">
                      <span
                        className={`font-medium text-sm ${isAlert ? 'text-red-300' : 'text-zinc-100'}`}
                      >
                        {row.ingredient.name}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-right">
                      <span
                        className={`font-mono tabular-nums text-sm font-semibold ${isAlert ? 'text-red-400' : 'text-zinc-200'}`}
                      >
                        {formatQty(row.quantity, row.ingredient.unit)}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-right">
                      <span className="font-mono tabular-nums text-xs text-zinc-500">
                        {row.ingredient.lowStockThreshold} {row.ingredient.unit}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-center">
                      {isAlert ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400 ring-1 ring-inset ring-red-500/30">
                          <AlertTriangle className="h-3 w-3" aria-hidden />
                          Low
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 ring-1 ring-inset ring-emerald-500/30">
                          <CheckCircle2 className="h-3 w-3" aria-hidden />
                          OK
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Receive into MAIN form ────────────────────────────────────────────────────

interface ReceiveItem {
  ingredientId: string
  quantity: string
}

interface ReceiveFormProps {
  ingredients: Ingredient[]
  onSuccess: () => void
  onClose: () => void
}

function ReceiveForm({ ingredients, onSuccess, onClose }: ReceiveFormProps) {
  const [items, setItems] = useState<ReceiveItem[]>([{ ingredientId: '', quantity: '' }])
  const [submitting, setSubmitting] = useState(false)

  function addRow() {
    setItems(prev => [...prev, { ingredientId: '', quantity: '' }])
  }

  function removeRow(idx: number) {
    setItems(prev => prev.filter((_, i) => i !== idx))
  }

  function setField(idx: number, field: keyof ReceiveItem, value: string) {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const valid = items.filter(it => it.ingredientId && Number(it.quantity) > 0)
    if (valid.length === 0) {
      toast.error('Add at least one ingredient with a quantity > 0.')
      return
    }
    setSubmitting(true)
    try {
      await post('/inventory/receive', {
        // Backend Zod schema expects snake_case `ingredient_id` in the request body
        // (verified against ckitchen_backend/src/modules/inventory/routes.ts).
        items: valid.map(it => ({
          ingredient_id: it.ingredientId,
          quantity: Number(it.quantity),
        })),
      })
      toast.success(`Received ${valid.length} ingredient(s) into MAIN warehouse.`)
      setItems([{ ingredientId: '', quantity: '' }])
      onSuccess()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to receive stock.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={e => void handleSubmit(e)} className="space-y-4">
      <div className="space-y-3">
        {items.map((item, idx) => (
          <div key={idx} className="flex gap-2 items-end">
            <div className="flex-1 min-w-0">
              {idx === 0 && (
                <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                  Ingredient
                </label>
              )}
              <Select
                value={item.ingredientId || '_none'}
                onValueChange={v => setField(idx, 'ingredientId', v === '_none' ? '' : v)}
              >
                <SelectTrigger className="bg-[#0A0F0D] border-[#1F2A24] text-zinc-200 text-sm h-9">
                  <SelectValue placeholder="Select ingredient…" />
                </SelectTrigger>
                <SelectContent className="bg-[#121A17] border-[#1F2A24]">
                  <SelectItem value="_none" className="text-zinc-400">
                    Select ingredient…
                  </SelectItem>
                  {ingredients.map(ing => (
                    <SelectItem key={ing.id} value={ing.id} className="text-zinc-200">
                      {ing.name} ({ing.unit})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-28">
              {idx === 0 && (
                <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                  Quantity
                </label>
              )}
              <Input
                type="number"
                min="0.01"
                step="any"
                value={item.quantity}
                onChange={e => setField(idx, 'quantity', e.target.value)}
                required
                placeholder="0"
                className="bg-[#0A0F0D] border-[#1F2A24] text-zinc-200 placeholder:text-zinc-600 h-9"
              />
            </div>
            {items.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeRow(idx)}
                aria-label="Remove row"
                className="h-9 w-9 flex-none text-zinc-500 hover:text-red-400 hover:bg-red-500/10"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addRow}
          className="border-[#1F2A24] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add row
        </Button>
        <Button
          type="submit"
          disabled={submitting}
          size="sm"
          className="ml-auto bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-60"
        >
          {submitting ? 'Receiving…' : 'Receive into MAIN'}
        </Button>
      </div>
    </form>
  )
}

// ─── ITO Request form ─────────────────────────────────────────────────────────

interface ItoRequestItem {
  ingredientId: string
  quantity: string
}

interface ItoRequestFormProps {
  ingredients: Ingredient[]
  onSuccess: () => void
  onClose: () => void
}

function ItoRequestForm({ ingredients, onSuccess, onClose }: ItoRequestFormProps) {
  const [items, setItems] = useState<ItoRequestItem[]>([{ ingredientId: '', quantity: '' }])
  const [submitting, setSubmitting] = useState(false)

  function addRow() {
    setItems(prev => [...prev, { ingredientId: '', quantity: '' }])
  }

  function removeRow(idx: number) {
    setItems(prev => prev.filter((_, i) => i !== idx))
  }

  function setField(idx: number, field: keyof ItoRequestItem, value: string) {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const valid = items.filter(it => it.ingredientId && Number(it.quantity) > 0)
    if (valid.length === 0) {
      toast.error('Add at least one ingredient with a quantity > 0.')
      return
    }
    setSubmitting(true)
    try {
      await post('/itos', {
        from: 'MAIN',
        to: 'KITCHEN',
        // Backend Zod schema expects snake_case `ingredient_id` in the request body
        // (verified against ckitchen_backend/src/modules/inventory/routes.ts).
        items: valid.map(it => ({
          ingredient_id: it.ingredientId,
          quantity: Number(it.quantity),
        })),
      })
      toast.success(
        `ITO requested for ${valid.length} ingredient(s). Awaiting warehouse confirmation.`,
      )
      setItems([{ ingredientId: '', quantity: '' }])
      onSuccess()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to request ITO.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={e => void handleSubmit(e)} className="space-y-4">
      <div className="space-y-3">
        {items.map((item, idx) => (
          <div key={idx} className="flex gap-2 items-end">
            <div className="flex-1 min-w-0">
              {idx === 0 && (
                <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                  Ingredient
                </label>
              )}
              <Select
                value={item.ingredientId || '_none'}
                onValueChange={v => setField(idx, 'ingredientId', v === '_none' ? '' : v)}
              >
                <SelectTrigger className="bg-[#0A0F0D] border-[#1F2A24] text-zinc-200 text-sm h-9">
                  <SelectValue placeholder="Select ingredient…" />
                </SelectTrigger>
                <SelectContent className="bg-[#121A17] border-[#1F2A24]">
                  <SelectItem value="_none" className="text-zinc-400">
                    Select ingredient…
                  </SelectItem>
                  {ingredients.map(ing => (
                    <SelectItem key={ing.id} value={ing.id} className="text-zinc-200">
                      {ing.name} ({ing.unit})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-28">
              {idx === 0 && (
                <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                  Quantity
                </label>
              )}
              <Input
                type="number"
                min="0.01"
                step="any"
                value={item.quantity}
                onChange={e => setField(idx, 'quantity', e.target.value)}
                required
                placeholder="0"
                className="bg-[#0A0F0D] border-[#1F2A24] text-zinc-200 placeholder:text-zinc-600 h-9"
              />
            </div>
            {items.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeRow(idx)}
                aria-label="Remove row"
                className="h-9 w-9 flex-none text-zinc-500 hover:text-red-400 hover:bg-red-500/10"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addRow}
          className="border-[#1F2A24] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add row
        </Button>
        <Button
          type="submit"
          disabled={submitting}
          size="sm"
          className="ml-auto bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-60"
        >
          {submitting ? 'Requesting…' : 'Request Transfer'}
        </Button>
      </div>
    </form>
  )
}

// ─── ITO List ─────────────────────────────────────────────────────────────────

interface ItoListProps {
  itos: Ito[]
  loading: boolean
  error: string | null
  canConfirm: boolean
  confirming: Set<string>
  onConfirm: (id: string) => void
  /** Used to resolve ingredient names/units for ITO line items — GET /itos doesn't join them. */
  ingredientsById: Map<string, Ingredient>
}

function ItoList({
  itos,
  loading,
  error,
  canConfirm,
  confirming,
  onConfirm,
  ingredientsById,
}: ItoListProps) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-10">
        <div className="mb-3 h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" />
        <p className="text-xs text-zinc-500">Loading ITOs…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-center">
        <p className="text-sm font-medium text-red-400">{error}</p>
      </div>
    )
  }

  if (itos.length === 0) {
    return (
      <EmptyState
        icon={ArrowLeftRight}
        title="No transfer orders"
        description="Request a transfer to move stock MAIN → KITCHEN."
        className="border-dashed border-[#1F2A24] bg-transparent"
      />
    )
  }

  return (
    <div className="space-y-2">
      {itos.map(ito => {
        const isConfirming = confirming.has(ito.id)
        return (
          <div
            key={ito.id}
            className={[
              'rounded-xl border p-3 transition-colors',
              ito.status === 'REQUESTED'
                ? 'border-amber-500/30 bg-amber-500/5'
                : ito.status === 'CONFIRMED'
                  ? 'border-emerald-500/30 bg-emerald-500/5'
                  : 'border-[#1F2A24] bg-zinc-800/30',
            ].join(' ')}
          >
            {/* ITO header */}
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="font-mono text-[10px] text-zinc-500">{ito.id.slice(0, 8)}…</span>
              <ItoStatusBadge status={ito.status} />
              <span className="ml-auto text-[11px] text-zinc-500">
                {formatTime(ito.createdAt)}
              </span>
            </div>

            {/* Items — GET /itos doesn't join line items; resolve names via ingredientsById */}
            {ito.items && ito.items.length > 0 ? (
              <ul className="mb-2 space-y-0.5">
                {ito.items.map(it => {
                  const ing = ingredientsById.get(it.ingredientId)
                  return (
                    <li key={it.id} className="flex items-center gap-2 text-sm text-zinc-300">
                      <span className="font-medium">{ing?.name ?? it.ingredientId}</span>
                      <span className="ml-auto font-mono tabular-nums text-xs text-zinc-500">
                        {formatQty(it.quantity, ing?.unit ?? '')}
                      </span>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="mb-2 text-[11px] italic text-zinc-600">
                Item detail unavailable from the list view.
              </p>
            )}

            {/* Confirm button — only for REQUESTED ITOs and allowed roles */}
            {ito.status === 'REQUESTED' && canConfirm && (
              <Button
                size="sm"
                onClick={() => onConfirm(ito.id)}
                disabled={isConfirming}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-60"
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                {isConfirming ? 'Confirming…' : 'Confirm Transfer'}
              </Button>
            )}

            {ito.status === 'CONFIRMED' && ito.confirmedAt && (
              <p className="text-[11px] text-emerald-400 mt-1">
                Confirmed {formatTime(ito.confirmedAt)}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Inventory ────────────────────────────────────────────────────────────────

export default function Inventory() {
  const { user } = useAuth()
  const role = user?.role

  // — Stock tiers
  const [mainStock, setMainStock] = useState<StockLine[]>([])
  const [kitchenStock, setKitchenStock] = useState<StockLine[]>([])
  const [mainLoading, setMainLoading] = useState(true)
  const [kitchenLoading, setKitchenLoading] = useState(true)
  const [mainError, setMainError] = useState<string | null>(null)
  const [kitchenError, setKitchenError] = useState<string | null>(null)

  // — Ingredients list (for receive + ITO forms)
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  // Lookup map for resolving ITO line-item ingredient names (GET /itos has no join)
  const ingredientsById = useMemo(
    () => new Map(ingredients.map(ing => [ing.id, ing])),
    [ingredients],
  )

  // — ITOs
  const [itos, setItos] = useState<Ito[]>([])
  const [itosLoading, setItosLoading] = useState(true)
  const [itosError, setItosError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<Set<string>>(new Set())

  // — Low-stock alert ingredient IDs (for extra row highlight beyond API flag)
  const [alertedIds, setAlertedIds] = useState<Set<string>>(new Set())

  // — Dialog visibility
  const [showReceive, setShowReceive] = useState(false)
  const [showRequestIto, setShowRequestIto] = useState(false)

  // ── Fetch helpers ───────────────────────────────────────────────────────────

  const fetchMainStock = useCallback(async () => {
    setMainLoading(true)
    setMainError(null)
    try {
      const { data } = await get<StockLine[]>('/inventory?warehouse=MAIN')
      setMainStock(data)
    } catch (e) {
      setMainError(e instanceof Error ? e.message : 'Failed to load MAIN stock.')
    } finally {
      setMainLoading(false)
    }
  }, [])

  const fetchKitchenStock = useCallback(async () => {
    setKitchenLoading(true)
    setKitchenError(null)
    try {
      const { data } = await get<StockLine[]>('/inventory?warehouse=KITCHEN')
      setKitchenStock(data)
    } catch (e) {
      setKitchenError(e instanceof Error ? e.message : 'Failed to load KITCHEN stock.')
    } finally {
      setKitchenLoading(false)
    }
  }, [])

  const fetchItos = useCallback(async () => {
    setItosLoading(true)
    setItosError(null)
    try {
      const { data } = await get<Ito[]>('/itos')
      // Show most recent first (GET /itos has no requestedAt column — use createdAt)
      data.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      setItos(data)
    } catch (e) {
      setItosError(e instanceof Error ? e.message : 'Failed to load ITOs.')
    } finally {
      setItosLoading(false)
    }
  }, [])

  const fetchIngredients = useCallback(async () => {
    try {
      const { data } = await get<Ingredient[]>('/ingredients')
      setIngredients(data)
    } catch {
      // Non-critical; forms will show empty dropdowns
    }
  }, [])

  // ── Initial load ─────────────────────────────────────────────────────────────

  useEffect(() => {
    void Promise.all([
      fetchMainStock(),
      fetchKitchenStock(),
      fetchItos(),
      fetchIngredients(),
    ])
  }, [fetchMainStock, fetchKitchenStock, fetchItos, fetchIngredients])

  // ── Socket subscriptions ─────────────────────────────────────────────────────

  useEffect(() => {
    // stock.updated — refresh the affected warehouse tier
    const unsubStock = onSocketEvent('stock.updated', (payload: StockPayload) => {
      if (payload.warehouseType === 'MAIN') {
        void fetchMainStock()
      } else if (payload.warehouseType === 'KITCHEN') {
        void fetchKitchenStock()
      }
    })

    // lowstock.alert — Business Rule #8 — non-negotiable alert, 10 s TTL
    const unsubLowstock = onSocketEvent('lowstock.alert', (alert: LowStockAlert) => {
      toast.error(
        `LOW STOCK: ${alert.ingredientName} — ${alert.quantity} remaining (threshold: ${alert.threshold})`,
        { duration: 10_000 },
      )
      // Also highlight the row on the table
      setAlertedIds(prev => new Set(prev).add(alert.ingredientId))
    })

    return () => {
      unsubStock()
      unsubLowstock()
    }
  }, [fetchMainStock, fetchKitchenStock])

  // ── ITO confirm handler ──────────────────────────────────────────────────────

  async function handleConfirmIto(itoId: string) {
    setConfirming(prev => new Set(prev).add(itoId))
    try {
      await post(`/itos/${itoId}/confirm`)
      toast.success('ITO confirmed — stock moved MAIN → KITCHEN.')
      // Refresh both tiers + ITO list (atomic move per Business Rule #4)
      await Promise.all([fetchMainStock(), fetchKitchenStock(), fetchItos()])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to confirm ITO.')
    } finally {
      setConfirming(prev => {
        const next = new Set(prev)
        next.delete(itoId)
        return next
      })
    }
  }

  // ── Role flags ───────────────────────────────────────────────────────────────

  const canReceive = hasRole(role, CAN_RECEIVE)
  const canRequestIto = hasRole(role, CAN_REQUEST_ITO)
  const canConfirmIto = hasRole(role, CAN_CONFIRM_ITO)

  // ── Summary counts ───────────────────────────────────────────────────────────

  const lowMain = mainStock.filter(r => r.below_threshold).length
  const lowKitchen = kitchenStock.filter(r => r.below_threshold).length
  const totalBelowThreshold = lowMain + lowKitchen
  const pendingItos = itos.filter(i => i.status === 'REQUESTED').length
  const totalSkus = mainStock.length + kitchenStock.length

  // KITCHEN items below threshold or recently alerted (for the alerts panel)
  const kitchenAlerts = kitchenStock.filter(
    r => r.below_threshold || alertedIds.has(r.ingredientId),
  )

  // ── Refresh handler ───────────────────────────────────────────────────────────

  function refreshAll() {
    void Promise.all([fetchMainStock(), fetchKitchenStock(), fetchItos()])
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-full flex-col gap-6 px-4 py-6 sm:px-6">

      {/* ── Page header ── */}
      <PageHeader
        title="Inventory"
        subtitle="Two-tier warehouse · transfers · low-stock"
        actions={
          <div className="flex items-center gap-2">
            {canRequestIto && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowRequestIto(true)}
                className="border-amber-500/40 text-amber-400 hover:border-amber-500/70 hover:text-amber-300 hover:bg-amber-500/10"
              >
                <ArrowLeftRight className="h-3.5 w-3.5 mr-1.5" />
                Request Transfer
              </Button>
            )}
            {canReceive && (
              <Button
                size="sm"
                onClick={() => setShowReceive(true)}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
              >
                <Package className="h-3.5 w-3.5 mr-1.5" />
                Receive into MAIN
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={refreshAll}
              title="Refresh all"
              className="h-8 w-8 text-zinc-500 hover:text-zinc-200"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span className="sr-only">Refresh</span>
            </Button>
          </div>
        }
      />

      {/* ── KPI ribbon ── */}
      <KpiRibbon>
        <KpiCard
          icon={Package}
          label="Ingredients"
          value={ingredients.length}
        />
        <KpiCard
          icon={AlertTriangle}
          label="Below Threshold"
          value={totalBelowThreshold}
          className={totalBelowThreshold > 0 ? 'border-red-500/30 bg-red-500/5' : undefined}
        />
        <KpiCard
          icon={ArrowLeftRight}
          label="Pending ITOs"
          value={pendingItos}
        />
        <KpiCard
          icon={Boxes}
          label="Total SKUs"
          value={totalSkus}
        />
      </KpiRibbon>

      {/* ── Main content ── */}
      <div className="flex min-w-0 flex-col gap-4 xl:flex-row">

        {/* ── Left: two-tier stock tables ── */}
        <section className="flex min-w-0 flex-1 flex-col gap-4">

          {/* Two-tier tables: side-by-side on lg+, stacked on smaller */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <StockTable
              title="MAIN Warehouse"
              tier="MAIN"
              rows={mainStock}
              loading={mainLoading}
              error={mainError}
              alertedIds={alertedIds}
            />
            <StockTable
              title="KITCHEN Warehouse"
              tier="KITCHEN"
              rows={kitchenStock}
              loading={kitchenLoading}
              error={kitchenError}
              alertedIds={alertedIds}
            />
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-500">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-red-500/15 border border-red-500/30" />
              Below threshold — repurchase or ITO required
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-emerald-500/15 border border-emerald-500/30" />
              Stock OK
            </span>
            <span className="ml-auto text-[11px] italic text-zinc-600">
              Real-time via stock.updated
            </span>
          </div>
        </section>

        {/* ── Right: alerts + ITO panel ── */}
        <aside className="w-full shrink-0 xl:w-80 flex flex-col gap-4">

          {/* Stock Alerts panel — KITCHEN items below threshold */}
          {kitchenAlerts.length > 0 && (
            <Card className="border-red-500/30 bg-red-500/5">
              <CardHeader className="px-4 py-3 border-b border-red-500/20 flex-row items-center gap-2 space-y-0">
                <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" aria-hidden />
                <CardTitle className="text-sm font-semibold text-red-400">
                  Kitchen Stock Alerts
                </CardTitle>
                <span className="ml-auto rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-400 tabular-nums">
                  {kitchenAlerts.length}
                </span>
              </CardHeader>
              <CardContent className="p-3 space-y-2">
                {kitchenAlerts.map(row => (
                  <div
                    key={row.ingredientId}
                    className="flex items-center justify-between rounded-lg bg-red-500/10 px-3 py-2 border border-red-500/20"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-red-300 truncate">
                        {row.ingredient.name}
                      </p>
                      <p className="text-[11px] text-red-400/70 tabular-nums">
                        {formatQty(row.quantity, row.ingredient.unit)} / threshold:{' '}
                        {row.ingredient.lowStockThreshold}
                      </p>
                    </div>
                    <AlertTriangle className="ml-2 h-4 w-4 shrink-0 text-red-400" aria-hidden />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* ITO panel */}
          <Card className="border-[#1F2A24] bg-[#121A17]">
            <CardHeader className="px-4 py-3 border-b border-[#1F2A24] flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <ArrowLeftRight className="h-4 w-4 text-emerald-500" aria-hidden />
                Transfer Orders (ITO)
              </CardTitle>
              {pendingItos > 0 && (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-400 ring-1 ring-inset ring-amber-500/30 tabular-nums">
                  {pendingItos} pending
                </span>
              )}
            </CardHeader>
            <CardContent className="p-3">
              {/* Role hint */}
              {!canConfirmIto && !canRequestIto && (
                <p className="mb-3 text-xs text-zinc-500 italic">
                  View only — your role cannot request or confirm ITOs.
                </p>
              )}
              {canRequestIto && !canConfirmIto && (
                <p className="mb-3 text-xs text-zinc-500 italic">
                  You can request ITOs. Warehouse personnel confirm them.
                </p>
              )}
              {canConfirmIto && (
                <p className="mb-3 text-xs text-zinc-500 italic">
                  Confirming an ITO atomically moves stock MAIN → KITCHEN.
                </p>
              )}

              <ItoList
                itos={itos}
                loading={itosLoading}
                error={itosError}
                canConfirm={canConfirmIto}
                confirming={confirming}
                onConfirm={id => void handleConfirmIto(id)}
                ingredientsById={ingredientsById}
              />
            </CardContent>
          </Card>
        </aside>
      </div>

      {/* ── Receive into MAIN dialog ── */}
      <Dialog open={showReceive} onOpenChange={setShowReceive}>
        <DialogContent className="bg-[#121A17] border-[#1F2A24] text-zinc-50 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-zinc-50">
              Receive into MAIN Warehouse
            </DialogTitle>
            <DialogDescription className="text-zinc-500">
              Log a supplier delivery into the MAIN warehouse (FR-IV-08).
            </DialogDescription>
          </DialogHeader>
          <ReceiveForm
            ingredients={ingredients}
            onSuccess={() => void fetchMainStock()}
            onClose={() => setShowReceive(false)}
          />
        </DialogContent>
      </Dialog>

      {/* ── Request Transfer (ITO) dialog ── */}
      <Dialog open={showRequestIto} onOpenChange={setShowRequestIto}>
        <DialogContent className="bg-[#121A17] border-[#1F2A24] text-zinc-50 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-zinc-50">
              Request Transfer — MAIN to KITCHEN
            </DialogTitle>
            <DialogDescription className="text-zinc-500">
              Create an Internal Transfer Order (FR-IV-03). Warehouse staff will confirm.
            </DialogDescription>
          </DialogHeader>
          <ItoRequestForm
            ingredients={ingredients}
            onSuccess={() => void fetchItos()}
            onClose={() => setShowRequestIto(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
