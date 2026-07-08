/**
 * Inventory — Two-Tier Stock View + ITO Management + Low-Stock Alerts
 * Implements FR-IV-01..08 (CK1-SRS-001 §3.7)
 *
 * Features:
 *   FR-IV-01/02  Two-tier view: MAIN + KITCHEN warehouse stock tables
 *   FR-IV-03/04  ITO request (KITCHEN_CREW|OWNER) + confirm (WAREHOUSE_MAIN|WAREHOUSE_OUTLET|OWNER)
 *   FR-IV-05     End-of-day consumption log (future: stub button shown)
 *   FR-IV-06/07  Below-threshold rows highlighted red; lowstock.alert toast
 *   FR-IV-08     Receive into MAIN (WAREHOUSE_MAIN|WAREHOUSE_OUTLET|OWNER)
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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowLeftRight,
  Boxes,
  Check,
  CheckCircle2,
  ClipboardList,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
  Wallet,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { get, post, CKApiError } from '../lib/api'
import {
  getSocket,
  initSocket,
  joinLocation,
  joinLocations,
  onSocketEvent,
  onSocketReconnect,
} from '../lib/socket'
import type { LowStockAlert, StockPayload } from '../lib/socket'
import { useAuth } from '../auth/AuthContext'
import type { UserRole } from '../auth/AuthContext'
import { hasRole } from '../auth/access'
import { useOutlet } from '../context/OutletContext'
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
import AdjustmentDialog from '../components/AdjustmentDialog'
import IngredientDialog from '../components/IngredientDialog'
import type { EditableIngredient } from '../components/IngredientDialog'
import PageHeader from '../components/common/PageHeader'
import KpiCard from '../components/common/KpiCard'
import KpiRibbon from '../components/common/KpiRibbon'
import EmptyState from '../components/common/EmptyState'

// ─── Role helpers ──────────────────────────────────────────────────────────────

/**
 * Roles that can receive stock into MAIN warehouse (FR-IV-08).
 * Matches backend INVENTORY_ROLES as of 2026-07-05 (ckitchen_backend
 * src/modules/inventory/routes.ts: `const INVENTORY_ROLES = ["OWNER", "WAREHOUSE_OUTLET"]`)
 * — WAREHOUSE_MAIN is deliberately withheld server-side pending the D31 matrix
 * sign-off; do NOT re-add it here until the backend grants it. Widen when D31
 * matrix lands server-side.
 */
const CAN_RECEIVE: UserRole[] = ['WAREHOUSE_OUTLET']
/** Roles that can request an ITO (FR-IV-04). KITCHEN_STAFF -> KITCHEN_CREW. */
const CAN_REQUEST_ITO: UserRole[] = ['KITCHEN_CREW']
/**
 * Roles that can confirm an ITO (FR-IV-04).
 * Matches backend INVENTORY_ROLES as of 2026-07-05 (same allow-list as
 * CAN_RECEIVE above) — WAREHOUSE_MAIN removed until backend grants it; widen
 * when D31 matrix lands server-side.
 */
const CAN_CONFIRM_ITO: UserRole[] = ['WAREHOUSE_OUTLET']

/**
 * Roles that may create/decide stock adjustments (MoM: expiry + negligence
 * write-offs). Matches the fixed backend contract's allow-list (OWNER,
 * OUTLET_MANAGER, WAREHOUSE_MAIN, WAREHOUSE_OUTLET) minus OWNER, which passes
 * via `hasRole`'s short-circuit. The server enforces this AND the self-approval
 * rule; the UI mirrors it and handles the 403/409 responses gracefully.
 */
const CAN_ADJUST: UserRole[] = ['OUTLET_MANAGER', 'WAREHOUSE_MAIN', 'WAREHOUSE_OUTLET']

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
  /**
   * Stock-reservation fields (optional — absent on pre-reservation deploys).
   * `reserved` = qty held by not-yet-preparing orders; `available` = quantity −
   * reserved. Numeric per the contract, but coerced defensively (the rest of
   * this payload arrives as strings). Fall back: reserved 0 / available = qty.
   */
  reserved?: number | string
  available?: number | string
  /**
   * Depletion projection (optional — absent on old deploys; treat absent as
   * null). `daily_consumption_7d` = average PREPARING deduction per day over
   * the last 7 days; `days_remaining` = projected days until zero at that
   * rate, null when there was no recent consumption. Coerced defensively —
   * the rest of this payload arrives as strings.
   */
  daily_consumption_7d?: number | string
  days_remaining?: number | string | null
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

type AdjustmentStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

/**
 * GET /adjustments row (fixed backend contract — MoM expiry/negligence
 * write-offs). camelCase like the other GET endpoints, with two snake_case
 * denormalized name fields. Every optional field is read defensively — an early
 * backend deploy may omit some.
 */
interface Adjustment {
  id: string
  warehouseId: string
  ingredientId: string
  direction: 'IN' | 'OUT'
  quantity: number | string
  reason: string
  note?: string | null
  status: AdjustmentStatus
  requestedBy?: string | null
  decidedBy?: string | null
  decisionNote?: string | null
  decidedAt?: string | null
  createdAt: string
  ingredient?: { id: string; name: string; unit: string }
  warehouse?: { id: string; type: string; locationId: string }
  requested_by_name?: string | null
  decided_by_name?: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatQty(qty: number | string, unit: string): string {
  const n = typeof qty === 'string' ? Number(qty) : qty
  return `${n % 1 === 0 ? n : n.toFixed(2)} ${unit}`
}

function toNum(v: number | string | null | undefined): number | undefined {
  if (v === undefined || v === null) return undefined
  const n = typeof v === 'string' ? Number(v) : v
  return Number.isFinite(n) ? n : undefined
}

/** Compact number for the depletion column: integers plain, else 1 decimal. */
function fmtDays(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(1)
}

/**
 * Depletion view for a stock row (days-left projection contract). `daysLeft`
 * null = no consumption in the last 7 days OR an old deploy that doesn't send
 * the fields — both render as "—".
 */
function depletionView(row: StockLine): { daysLeft: number | null; dailyConsumption: number } {
  return {
    daysLeft: toNum(row.days_remaining) ?? null,
    dailyConsumption: toNum(row.daily_consumption_7d) ?? 0,
  }
}

/**
 * Derive the reservation view for a stock row from the optional `reserved` /
 * `available` fields (stock-reservation contract). Graceful fallback for old
 * deploys that don't send them: reserved 0, available = on-hand quantity.
 * `atRisk` = available has dropped to/below the low-stock threshold even though
 * the on-hand quantity is still above it (reservations, not consumption, are
 * eating the buffer) — a warning the plain `below_threshold` flag can't show.
 */
function reservationView(row: StockLine): {
  reserved: number
  available: number
  atRisk: boolean
} {
  const quantity = toNum(row.quantity) ?? 0
  const reserved = toNum(row.reserved) ?? 0
  const available = toNum(row.available) ?? quantity - reserved
  const threshold = toNum(row.ingredient?.lowStockThreshold) ?? 0
  const atRisk = !row.below_threshold && reserved > 0 && available <= threshold
  return { reserved, available, atRisk }
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
  /** When true, render the per-row "Adjust" action (gated to CAN_ADJUST roles). */
  canAdjust: boolean
  /** Opens the AdjustmentDialog for a specific stock row. */
  onAdjust: (row: StockLine) => void
  /** When true, render the per-row "Edit ingredient" action (OWNER-level, mirrors POST /ingredients). */
  canEditIngredient: boolean
  /** Opens the IngredientDialog for a specific stock row's ingredient. */
  onEditIngredient: (row: StockLine) => void
}

function StockTable({
  title,
  tier,
  rows,
  loading,
  error,
  alertedIds,
  canAdjust,
  onAdjust,
  canEditIngredient,
  onEditIngredient,
}: StockTableProps) {
  const showActions = canAdjust || canEditIngredient
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
                  On&nbsp;Hand
                </TableHead>
                <TableHead className="h-8 px-4 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Available
                </TableHead>
                <TableHead className="h-8 px-4 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Threshold
                </TableHead>
                <TableHead className="h-8 px-4 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Days&nbsp;Left
                </TableHead>
                <TableHead className="h-8 px-4 text-center text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Status
                </TableHead>
                {showActions && (
                  <TableHead className="h-8 px-4 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(row => {
                const isAlert = row.below_threshold || alertedIds.has(row.ingredientId)
                const { reserved, available, atRisk } = reservationView(row)
                const { daysLeft, dailyConsumption } = depletionView(row)
                // Amber "at-risk" styling only when the row isn't already the
                // stronger red "below threshold" alert.
                const showRisk = atRisk && !isAlert
                return (
                  <TableRow
                    key={row.ingredientId}
                    className={[
                      'transition-colors duration-300 border-[#1F2A24]',
                      isAlert
                        ? 'bg-red-500/5 hover:bg-red-500/10'
                        : showRisk
                          ? 'bg-amber-500/5 hover:bg-amber-500/10'
                          : 'hover:bg-zinc-800/30',
                    ].join(' ')}
                  >
                    <TableCell className="px-4 py-2.5">
                      <span
                        className={`font-medium text-sm ${isAlert ? 'text-red-300' : showRisk ? 'text-amber-200' : 'text-zinc-100'}`}
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
                      {reserved > 0 && (
                        <span className="mt-0.5 block font-mono tabular-nums text-[10px] text-amber-400/80">
                          {formatQty(reserved, row.ingredient.unit)} reserved
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-right">
                      <span
                        className={`font-mono tabular-nums text-sm font-semibold ${isAlert ? 'text-red-400' : showRisk ? 'text-amber-400' : 'text-zinc-300'}`}
                      >
                        {formatQty(available, row.ingredient.unit)}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-right">
                      <span className="font-mono tabular-nums text-xs text-zinc-500">
                        {row.ingredient.lowStockThreshold} {row.ingredient.unit}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-right">
                      {daysLeft === null ? (
                        <span
                          className="font-mono text-sm text-zinc-600"
                          title="No consumption in the last 7 days"
                        >
                          —
                        </span>
                      ) : (
                        <span
                          className={[
                            'font-mono tabular-nums text-sm font-semibold',
                            daysLeft <= 1
                              ? 'text-red-400'
                              : daysLeft <= 3
                                ? 'text-amber-400'
                                : 'text-zinc-300',
                          ].join(' ')}
                        >
                          {fmtDays(daysLeft)}d
                        </span>
                      )}
                      {dailyConsumption > 0 && (
                        <span className="mt-0.5 block font-mono tabular-nums text-[10px] text-zinc-500">
                          ≈{fmtDays(dailyConsumption)} {row.ingredient.unit}/day
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-center">
                      {isAlert ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400 ring-1 ring-inset ring-red-500/30">
                          <AlertTriangle className="h-3 w-3" aria-hidden />
                          Low
                        </span>
                      ) : showRisk ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400 ring-1 ring-inset ring-amber-500/30">
                          <AlertTriangle className="h-3 w-3" aria-hidden />
                          At risk
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 ring-1 ring-inset ring-emerald-500/30">
                          <CheckCircle2 className="h-3 w-3" aria-hidden />
                          OK
                        </span>
                      )}
                    </TableCell>
                    {showActions && (
                      <TableCell className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {canEditIngredient && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => onEditIngredient(row)}
                              aria-label={`Edit ingredient ${row.ingredient.name}`}
                              title="Edit ingredient (name, unit, cost, threshold, suppliers)"
                              className="h-7 w-7 text-zinc-500 hover:text-emerald-400 hover:bg-emerald-500/10"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {canAdjust && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => onAdjust(row)}
                              aria-label={`Adjust stock for ${row.ingredient.name}`}
                              title="Adjust stock (write-off / add)"
                              className="h-7 w-7 text-zinc-500 hover:text-emerald-400 hover:bg-emerald-500/10"
                            >
                              <SlidersHorizontal className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
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
  outletId?: string
  onSuccess: () => void
  onClose: () => void
}

function ReceiveForm({ ingredients, outletId, onSuccess, onClose }: ReceiveFormProps) {
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
    // A row is "bad" if only one of ingredientId/quantity is filled in, or quantity
    // is filled but not a finite number > 0. A fully blank row (extra "Add row" click)
    // is fine to silently ignore.
    const hasBadRow = items.some(it => {
      const hasIngredient = !!it.ingredientId
      const qtyNum = Number(it.quantity)
      const hasValidQty = it.quantity !== '' && Number.isFinite(qtyNum) && qtyNum > 0
      if (!hasIngredient && !it.quantity) return false
      return hasIngredient !== hasValidQty
    })
    if (hasBadRow) {
      toast.error(
        'Fix or remove incomplete rows before submitting — each row needs both an ingredient and a quantity greater than 0.',
      )
      return
    }
    const valid = items.filter(it => it.ingredientId && Number(it.quantity) > 0)
    if (valid.length === 0) {
      toast.error('Add at least one ingredient with a quantity > 0.')
      return
    }
    setSubmitting(true)
    try {
      await post('/inventory/receive', {
        outlet_id: outletId,
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
  outletId?: string
  onSuccess: () => void
  onClose: () => void
}

function ItoRequestForm({ ingredients, outletId, onSuccess, onClose }: ItoRequestFormProps) {
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
    // A row is "bad" if only one of ingredientId/quantity is filled in, or quantity
    // is filled but not a finite number > 0. A fully blank row (extra "Add row" click)
    // is fine to silently ignore.
    const hasBadRow = items.some(it => {
      const hasIngredient = !!it.ingredientId
      const qtyNum = Number(it.quantity)
      const hasValidQty = it.quantity !== '' && Number.isFinite(qtyNum) && qtyNum > 0
      if (!hasIngredient && !it.quantity) return false
      return hasIngredient !== hasValidQty
    })
    if (hasBadRow) {
      toast.error(
        'Fix or remove incomplete rows before requesting the transfer — each row needs both an ingredient and a quantity greater than 0.',
      )
      return
    }
    const valid = items.filter(it => it.ingredientId && Number(it.quantity) > 0)
    if (valid.length === 0) {
      toast.error('Add at least one ingredient with a quantity > 0.')
      return
    }
    setSubmitting(true)
    try {
      await post('/itos', {
        outlet_id: outletId,
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

// ─── Adjustments panel ──────────────────────────────────────────────────────

const ADJ_STATUS_CLASSES: Record<AdjustmentStatus, string> = {
  PENDING: 'bg-amber-500/15 text-amber-400 ring-1 ring-inset ring-amber-500/30',
  APPROVED: 'bg-emerald-500/15 text-emerald-400 ring-1 ring-inset ring-emerald-500/30',
  REJECTED: 'bg-red-500/15 text-red-400 ring-1 ring-inset ring-red-500/30',
}

function AdjStatusBadge({ status }: { status: AdjustmentStatus }) {
  const cls = ADJ_STATUS_CLASSES[status] ?? ADJ_STATUS_CLASSES.PENDING
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {status}
    </span>
  )
}

/** Title-case a reason enum (EXPIRY → Expiry) for display. */
function formatReason(reason: string): string {
  if (!reason) return '—'
  return reason.charAt(0) + reason.slice(1).toLowerCase()
}

interface AdjustmentsPanelProps {
  adjustments: Adjustment[]
  loading: boolean
  error: string | null
  canDecide: boolean
  deciding: Set<string>
  onDecide: (id: string, action: 'approve' | 'reject', note?: string) => void
  /** Fallback name/unit lookup when a row omits the joined ingredient object. */
  ingredientsById: Map<string, Ingredient>
}

function AdjustmentsPanel({
  adjustments,
  loading,
  error,
  canDecide,
  deciding,
  onDecide,
  ingredientsById,
}: AdjustmentsPanelProps) {
  // Decision dialog: capture an optional note before approving/rejecting.
  const [decision, setDecision] = useState<{ id: string; action: 'approve' | 'reject' } | null>(
    null,
  )
  const [decisionNote, setDecisionNote] = useState('')

  function openDecision(id: string, action: 'approve' | 'reject') {
    setDecision({ id, action })
    setDecisionNote('')
  }

  function confirmDecision() {
    if (!decision) return
    onDecide(decision.id, decision.action, decisionNote.trim() || undefined)
    setDecision(null)
    setDecisionNote('')
  }

  const pendingCount = adjustments.filter(a => a.status === 'PENDING').length

  return (
    <Card className="border-[#1F2A24] bg-[#121A17] overflow-hidden">
      <CardHeader className="px-4 py-3 border-b border-[#1F2A24] flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-emerald-500" aria-hidden />
          Stock Adjustments
        </CardTitle>
        {pendingCount > 0 && (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-400 ring-1 ring-inset ring-amber-500/30 tabular-nums">
            {pendingCount} pending
          </span>
        )}
      </CardHeader>

      <CardContent className="p-0">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-10">
            <div className="mb-3 h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" />
            <p className="text-xs text-zinc-500">Loading adjustments…</p>
          </div>
        ) : error ? (
          <div className="p-6 text-center">
            <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-red-400" aria-hidden />
            <p className="text-sm font-medium text-red-400">{error}</p>
          </div>
        ) : adjustments.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No adjustments"
            description="Write-offs (expiry, spoilage, negligence) and corrections appear here."
            className="border-0 rounded-none bg-transparent"
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-[#1F2A24] hover:bg-transparent">
                  <TableHead className="h-8 px-4 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    Item
                  </TableHead>
                  <TableHead className="h-8 px-4 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    Change
                  </TableHead>
                  <TableHead className="h-8 px-4 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    Reason
                  </TableHead>
                  <TableHead className="h-8 px-4 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    Requested by
                  </TableHead>
                  <TableHead className="h-8 px-4 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    Date
                  </TableHead>
                  <TableHead className="h-8 px-4 text-center text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    Status
                  </TableHead>
                  <TableHead className="h-8 px-4 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    <span className="sr-only">Decision</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {adjustments.map(adj => {
                  const ing = adj.ingredient ?? ingredientsById.get(adj.ingredientId)
                  const unit = adj.ingredient?.unit ?? ing?.unit ?? ''
                  const name = adj.ingredient?.name ?? ing?.name ?? adj.ingredientId
                  const qtyNum = Number(adj.quantity)
                  const qtyLabel = Number.isFinite(qtyNum)
                    ? `${qtyNum % 1 === 0 ? qtyNum : qtyNum.toFixed(2)}`
                    : String(adj.quantity)
                  const isOut = adj.direction === 'OUT'
                  const requester = adj.requested_by_name ?? adj.requestedBy ?? '—'
                  const isDeciding = deciding.has(adj.id)
                  return (
                    <TableRow key={adj.id} className="border-[#1F2A24] hover:bg-zinc-800/30">
                      <TableCell className="px-4 py-2.5">
                        <span className="font-medium text-sm text-zinc-100">{name}</span>
                        {adj.note && (
                          <span className="mt-0.5 block text-[11px] italic text-zinc-500 truncate max-w-[16rem]">
                            {adj.note}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="px-4 py-2.5 text-right">
                        <span
                          className={`font-mono tabular-nums text-sm font-semibold ${isOut ? 'text-red-400' : 'text-emerald-400'}`}
                        >
                          {isOut ? '−' : '+'}
                          {qtyLabel} {unit}
                        </span>
                        <span className="mt-0.5 block text-[10px] uppercase tracking-wide text-zinc-600">
                          {isOut ? 'Write-off' : 'Add'}
                        </span>
                      </TableCell>
                      <TableCell className="px-4 py-2.5 text-sm text-zinc-300">
                        {formatReason(adj.reason)}
                      </TableCell>
                      <TableCell className="px-4 py-2.5 text-sm text-zinc-400 truncate max-w-[10rem]">
                        {requester}
                      </TableCell>
                      <TableCell className="px-4 py-2.5 text-xs text-zinc-500 whitespace-nowrap">
                        {formatTime(adj.createdAt)}
                      </TableCell>
                      <TableCell className="px-4 py-2.5 text-center">
                        <AdjStatusBadge status={adj.status} />
                      </TableCell>
                      <TableCell className="px-4 py-2.5 text-right">
                        {adj.status === 'PENDING' && canDecide ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              onClick={() => openDecision(adj.id, 'approve')}
                              disabled={isDeciding}
                              className="h-7 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-2.5 disabled:opacity-60"
                            >
                              <Check className="h-3.5 w-3.5 mr-1" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openDecision(adj.id, 'reject')}
                              disabled={isDeciding}
                              className="h-7 border-red-500/40 text-red-300 hover:text-red-200 hover:bg-red-500/10 px-2.5 disabled:opacity-60"
                            >
                              <X className="h-3.5 w-3.5 mr-1" />
                              Reject
                            </Button>
                          </div>
                        ) : adj.status !== 'PENDING' && (adj.decided_by_name || adj.decidedBy) ? (
                          <span className="text-[11px] text-zinc-500">
                            by {adj.decided_by_name ?? adj.decidedBy}
                          </span>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* Decision dialog — optional note before approve/reject */}
      <Dialog open={decision !== null} onOpenChange={o => { if (!o) setDecision(null) }}>
        <DialogContent className="bg-[#121A17] border-[#1F2A24] text-zinc-50 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-zinc-50">
              {decision?.action === 'approve' ? 'Approve adjustment' : 'Reject adjustment'}
            </DialogTitle>
            <DialogDescription className="text-zinc-500">
              {decision?.action === 'approve'
                ? 'Approving posts the stock movement. Add an optional note for the audit log.'
                : 'Rejecting discards the request. Add an optional reason for the audit log.'}
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={decisionNote}
            onChange={e => setDecisionNote(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="Optional note…"
            className="w-full rounded-lg border border-[#1F2A24] bg-[#0A0F0D] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          />
          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDecision(null)}
              className="border-[#1F2A24] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={confirmDecision}
              className={
                decision?.action === 'approve'
                  ? 'ml-auto bg-emerald-600 hover:bg-emerald-700 text-white font-semibold'
                  : 'ml-auto bg-red-600 hover:bg-red-500 text-white font-semibold'
              }
            >
              {decision?.action === 'approve' ? 'Approve' : 'Reject'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

// ─── Inventory ────────────────────────────────────────────────────────────────

export default function Inventory() {
  const { user } = useAuth()
  const role = user?.role
  const { selectedOutletId, outlets } = useOutlet()
  const queryClient = useQueryClient()

  // ── Cache-first reads (perf) ─────────────────────────────────────────────
  // Query keys include selectedOutletId — GET /inventory and GET /itos are
  // outlet-scoped server-side (X-Outlet-Id / resolveOutletContext), so a
  // stale outlet's stock must never be shown after switching outlets; keying
  // by outlet gives each outlet its own cache entry instead of one shared
  // (and potentially wrong) entry. Same 'inventory'/'KITCHEN' key as
  // Menu.tsx's stock-alerts panel, so the two pages share one cache entry.

  const {
    data: mainStock = [],
    isLoading: mainLoading,
    error: mainQueryError,
  } = useQuery({
    queryKey: ['inventory', 'MAIN', selectedOutletId],
    queryFn: async () => (await get<StockLine[]>('/inventory?warehouse=MAIN')).data,
  })
  const mainError = mainQueryError
    ? mainQueryError instanceof Error ? mainQueryError.message : 'Failed to load MAIN stock.'
    : null

  const {
    data: kitchenStock = [],
    isLoading: kitchenLoading,
    error: kitchenQueryError,
  } = useQuery({
    queryKey: ['inventory', 'KITCHEN', selectedOutletId],
    queryFn: async () => (await get<StockLine[]>('/inventory?warehouse=KITCHEN')).data,
  })
  const kitchenError = kitchenQueryError
    ? kitchenQueryError instanceof Error ? kitchenQueryError.message : 'Failed to load KITCHEN stock.'
    : null

  const {
    data: itos = [],
    isLoading: itosLoading,
    error: itosQueryError,
  } = useQuery({
    queryKey: ['itos', selectedOutletId],
    queryFn: async () => {
      const { data } = await get<Ito[]>('/itos')
      // Show most recent first (GET /itos has no requestedAt column — use createdAt)
      data.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      return data
    },
  })
  const itosError = itosQueryError
    ? itosQueryError instanceof Error ? itosQueryError.message : 'Failed to load ITOs.'
    : null

  const {
    data: adjustments = [],
    isLoading: adjustmentsLoading,
    error: adjustmentsQueryError,
  } = useQuery({
    queryKey: ['adjustments', selectedOutletId],
    queryFn: async () => {
      const { data } = await get<Adjustment[]>('/adjustments')
      const rows = Array.isArray(data) ? data : []
      // Newest-first (backend already sorts, but stay defensive).
      rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      return rows
    },
  })
  const adjustmentsError = adjustmentsQueryError
    ? adjustmentsQueryError instanceof Error
      ? adjustmentsQueryError.message
      : 'Failed to load adjustments.'
    : null

  // Ingredients are global master data (no outlet scoping server-side) —
  // shared across every page that reads them (Menu.tsx's add-item form etc).
  const { data: ingredients = [] } = useQuery({
    queryKey: ['ingredients'],
    queryFn: async () => (await get<Ingredient[]>('/ingredients')).data,
  })
  // Lookup map for resolving ITO line-item ingredient names (GET /itos has no join)
  const ingredientsById = useMemo(
    () => new Map(ingredients.map(ing => [ing.id, ing])),
    [ingredients],
  )

  const [confirming, setConfirming] = useState<Set<string>>(new Set())

  // — Low-stock alert ingredient IDs (for extra row highlight beyond API flag)
  const [alertedIds, setAlertedIds] = useState<Set<string>>(new Set())

  // — Dialog visibility
  const [showReceive, setShowReceive] = useState(false)
  const [showRequestIto, setShowRequestIto] = useState(false)

  // — Stock adjustment (MoM expiry/negligence write-offs)
  const [adjustTarget, setAdjustTarget] = useState<{
    warehouseId: string
    warehouseLabel: string
    ingredient: { id: string; name: string; unit: string }
  } | null>(null)
  const [deciding, setDeciding] = useState<Set<string>>(new Set())

  // — Edit ingredient (name/unit/cost/threshold + supplier affiliations)
  const [editIngredientTarget, setEditIngredientTarget] = useState<EditableIngredient | null>(null)

  const openEditIngredient = useCallback((row: StockLine) => {
    setEditIngredientTarget({
      id: row.ingredient.id,
      name: row.ingredient.name,
      unit: row.ingredient.unit,
      unitCost: row.ingredient.unitCost,
      lowStockThreshold: row.ingredient.lowStockThreshold,
    })
  }, [])

  const openAdjust = useCallback((row: StockLine, tier: 'MAIN' | 'KITCHEN') => {
    setAdjustTarget({
      warehouseId: row.warehouseId,
      warehouseLabel: tier,
      ingredient: {
        id: row.ingredient.id,
        name: row.ingredient.name,
        unit: row.ingredient.unit,
      },
    })
  }, [])

  // ── Refetch helpers ──────────────────────────────────────────────────────
  // Invalidate + refetch (rather than local setState) so the shared cache
  // entries stay correct for every page/component reading the same key.

  const refetchMainStock = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['inventory', 'MAIN', selectedOutletId] }),
    [queryClient, selectedOutletId],
  )
  const refetchKitchenStock = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['inventory', 'KITCHEN', selectedOutletId] }),
    [queryClient, selectedOutletId],
  )
  const refetchItos = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['itos', selectedOutletId] }),
    [queryClient, selectedOutletId],
  )
  const refetchAdjustments = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['adjustments', selectedOutletId] }),
    [queryClient, selectedOutletId],
  )
  // Ingredients master list is global (no outlet key) — refetched after an
  // ingredient edit so name/unit/cost/threshold + embedded suppliers stay fresh.
  const refetchIngredients = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['ingredients'] }),
    [queryClient],
  )
  // After an ingredient edit, its cost/threshold affect both stock tiers +
  // the ingredients list — refetch all three.
  const refetchAfterIngredientEdit = useCallback(() => {
    void refetchMainStock()
    void refetchKitchenStock()
    void refetchIngredients()
  }, [refetchMainStock, refetchKitchenStock, refetchIngredients])

  // ── Socket connect + room join ───────────────────────────────────────────────
  // WAREHOUSE_MAIN/WAREHOUSE_OUTLET land directly on THIS page (RoleLanding.tsx
  // ROLE_LANDING), so — unlike Printers.tsx, which only ever gets reached via
  // '/' or '/kitchen' (both of which already join the room) — this page can't
  // assume the socket is already connected/joined. Mirrors the M2 pattern in
  // useKitchenOrders.ts / Orders.tsx: a specific outlet joins exactly that
  // outlet's room; 'ALL' (HQ-scope viewers) joins every outlet's room.
  useEffect(() => {
    if (!getSocket()) initSocket()
    if (selectedOutletId === 'ALL') {
      if (outlets.length > 0) joinLocations(outlets.map(o => o.id))
    } else {
      joinLocation(selectedOutletId)
    }
  }, [selectedOutletId, outlets])

  // ── Socket subscriptions ─────────────────────────────────────────────────────

  useEffect(() => {
    // stock.updated — refresh the affected warehouse tier
    const unsubStock = onSocketEvent('stock.updated', (payload: StockPayload) => {
      if (payload.warehouseType === 'MAIN') {
        void refetchMainStock()
      } else if (payload.warehouseType === 'KITCHEN') {
        void refetchKitchenStock()
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
  }, [refetchMainStock, refetchKitchenStock])

  // ── Socket reconnect refetch ─────────────────────────────────────────────────
  // On reconnect, refetch both stock tiers + ITOs (ingredients rarely change and
  // are non-critical — no refetch needed here).
  useEffect(() => {
    const unsubReconnect = onSocketReconnect(() => {
      void Promise.all([
        refetchMainStock(),
        refetchKitchenStock(),
        refetchItos(),
        refetchAdjustments(),
      ])
    })
    return () => {
      unsubReconnect()
    }
  }, [refetchMainStock, refetchKitchenStock, refetchItos, refetchAdjustments])

  // ── ITO confirm handler ──────────────────────────────────────────────────────

  async function handleConfirmIto(itoId: string) {
    setConfirming(prev => new Set(prev).add(itoId))
    try {
      await post(`/itos/${itoId}/confirm`)
      toast.success('ITO confirmed — stock moved MAIN → KITCHEN.')
      // Refresh both tiers + ITO list (atomic move per Business Rule #4)
      await Promise.all([refetchMainStock(), refetchKitchenStock(), refetchItos()])
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

  // ── Adjustment decision handler ──────────────────────────────────────────────
  // Approval emits stock.updated (the socket subscription above refetches the
  // affected tier); we only refetch the adjustments list here. Handles the
  // fixed contract's 409 (already decided) + 403 SELF_APPROVAL responses.

  async function handleDecideAdjustment(
    id: string,
    action: 'approve' | 'reject',
    note?: string,
  ) {
    setDeciding(prev => new Set(prev).add(id))
    try {
      await post(`/adjustments/${id}/${action}`, note ? { note } : undefined)
      toast.success(
        action === 'approve'
          ? 'Adjustment approved — stock updated.'
          : 'Adjustment rejected.',
      )
      await refetchAdjustments()
    } catch (e) {
      if (e instanceof CKApiError) {
        if (e.status === 409) {
          toast.error('This adjustment was already decided.')
          void refetchAdjustments()
          return
        }
        if (
          e.status === 403 &&
          (e.code === 'SELF_APPROVAL' || e.message?.toLowerCase().includes('self'))
        ) {
          toast.error('You cannot approve your own adjustment request.')
          return
        }
      }
      toast.error(e instanceof Error ? e.message : 'Failed to decide adjustment.')
    } finally {
      setDeciding(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  // ── Role flags ───────────────────────────────────────────────────────────────

  const canReceive = hasRole(role, CAN_RECEIVE)
  const canRequestIto = hasRole(role, CAN_REQUEST_ITO)
  const canConfirmIto = hasRole(role, CAN_CONFIRM_ITO)
  const canAdjust = hasRole(role, CAN_ADJUST)
  // Editing an ingredient's master fields + supplier links is OWNER-level,
  // mirroring the backend's POST /ingredients allow-list. hasRole(role, [])
  // passes only for OWNER (+ legacy SUPER_ADMIN via its alias). The server
  // enforces this too; the UI just hides the action for everyone else.
  const canEditIngredient = hasRole(role, [])

  // ── Summary counts ───────────────────────────────────────────────────────────

  const lowMain = mainStock.filter(r => r.below_threshold).length
  const lowKitchen = kitchenStock.filter(r => r.below_threshold).length
  const totalBelowThreshold = lowMain + lowKitchen
  const pendingItos = itos.filter(i => i.status === 'REQUESTED').length
  const totalSkus = mainStock.length + kitchenStock.length
  // On-hand stock value (MOTM 2026-07-01 #1: "in the main inventory there should
  // be the value of the product"). Σ quantity × ingredient.unit_cost across both
  // tiers. Defensive Number() coercion — quantities/costs arrive as strings.
  const stockValue =
    mainStock.reduce((s, r) => s + Number(r.quantity) * Number(r.ingredient?.unitCost ?? 0), 0) +
    kitchenStock.reduce((s, r) => s + Number(r.quantity) * Number(r.ingredient?.unitCost ?? 0), 0)

  // KITCHEN items below threshold or recently alerted (for the alerts panel)
  const kitchenAlerts = kitchenStock.filter(
    r => r.below_threshold || alertedIds.has(r.ingredientId),
  )

  // ── Refresh handler ───────────────────────────────────────────────────────────

  function refreshAll() {
    void Promise.all([
      refetchMainStock(),
      refetchKitchenStock(),
      refetchItos(),
      refetchAdjustments(),
    ])
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
        <KpiCard
          icon={Wallet}
          label="Stock Value"
          value={`₱${stockValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
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
              canAdjust={canAdjust}
              onAdjust={row => openAdjust(row, 'MAIN')}
              canEditIngredient={canEditIngredient}
              onEditIngredient={openEditIngredient}
            />
            <StockTable
              title="KITCHEN Warehouse"
              tier="KITCHEN"
              rows={kitchenStock}
              loading={kitchenLoading}
              error={kitchenError}
              alertedIds={alertedIds}
              canAdjust={canAdjust}
              onAdjust={row => openAdjust(row, 'KITCHEN')}
              canEditIngredient={canEditIngredient}
              onEditIngredient={openEditIngredient}
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

      {/* ── Stock Adjustments (MoM: expiry + negligence write-offs) ── */}
      <AdjustmentsPanel
        adjustments={adjustments}
        loading={adjustmentsLoading}
        error={adjustmentsError}
        canDecide={canAdjust}
        deciding={deciding}
        onDecide={(id, action, note) => void handleDecideAdjustment(id, action, note)}
        ingredientsById={ingredientsById}
      />

      {/* ── Adjust stock dialog (per stock row) ── */}
      <AdjustmentDialog
        open={adjustTarget !== null}
        onOpenChange={open => { if (!open) setAdjustTarget(null) }}
        warehouseId={adjustTarget?.warehouseId ?? ''}
        warehouseLabel={adjustTarget?.warehouseLabel}
        ingredient={adjustTarget?.ingredient ?? null}
        onSuccess={() => void refetchAdjustments()}
      />

      {/* ── Edit ingredient dialog (per stock row) ── */}
      <IngredientDialog
        open={editIngredientTarget !== null}
        onOpenChange={open => { if (!open) setEditIngredientTarget(null) }}
        ingredient={editIngredientTarget}
        onSaved={refetchAfterIngredientEdit}
      />

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
            onSuccess={() => void refetchMainStock()}
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
            onSuccess={() => void refetchItos()}
            onClose={() => setShowRequestIto(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
