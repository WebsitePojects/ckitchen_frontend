/**
 * PurchaseOrderDialog — "New PO" (Purchasing page, PO tab), also opened
 * prefilled from an APPROVED purchase request ("Create PO" row action —
 * the backend links the PR via `pr_id` and requires it to be APPROVED).
 *
 * Backend contract (ckitchen_backend/src/modules/purchasing/routes.ts
 * poCreateSchema — matched exactly):
 *   POST /purchase-orders {
 *     supplier_id: uuid,
 *     pr_id?: uuid (must reference an APPROVED PR),
 *     notes?: string,
 *     lines: [{ ingredient_id: uuid, quantity: number>0, unit_cost?: number>=0 }] (min 1)
 *   } → 201 PO row (status DRAFT)
 *
 * Supplier is selected FIRST; the ingredient picker then surfaces that
 * supplier's AFFILIATED items first (emerald "supplier item" badge, derived
 * from GET /ingredients `suppliers[]`), with everything else below a divider.
 * Unit-cost prefill on pick: GET /ingredients/:id/suppliers → that supplier's
 * lastUnitCost when present (> 0 — the backend stores "0" for "not recorded"),
 * else the ingredient's master unitCost.
 */
import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FileText, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { get, post } from '../../lib/api'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import IngredientPicker from './IngredientPicker'
import {
  num,
  peso,
  type Ingredient,
  type IngredientSupplier,
  type PurchaseOrder,
  type SupplierParty,
} from './types'
import { UnitSelect } from '../units/UnitSelect'
import { rescaleTyped } from '../../lib/units'

interface LineDraft {
  key: number
  ingredientId: string
  qty: string
  cost: string
  /** Unit the quantity (and price) is typed in; undefined = stock unit (D57). */
  unit?: string
}

let nextKey = 1
function blankLine(): LineDraft {
  return { key: nextKey++, ingredientId: '', qty: '', cost: '' }
}

/** Prefill passed when creating a PO from an APPROVED purchase request. */
export interface PoPrefill {
  prId: string
  prNo: string
  lines: { ingredientId: string; quantity: number; estUnitCost: number }[]
}

interface PurchaseOrderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Active suppliers (GET /suppliers?active=true). */
  suppliers: SupplierParty[]
  ingredients: Ingredient[]
  /** Non-null when raising a PO from an approved PR. */
  prefill: PoPrefill | null
}

const INPUT_CLS =
  'bg-background border-border text-foreground placeholder:text-muted-foreground h-9'

export default function PurchaseOrderDialog({
  open,
  onOpenChange,
  suppliers,
  ingredients,
  prefill,
}: PurchaseOrderDialogProps) {
  const queryClient = useQueryClient()

  const [supplierId, setSupplierId] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([blankLine()])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setSupplierId('')
    setNotes('')
    setLines(
      prefill && prefill.lines.length > 0
        ? prefill.lines.map((l) => ({
            key: nextKey++,
            ingredientId: l.ingredientId,
            qty: String(l.quantity),
            cost: String(l.estUnitCost),
          }))
        : [blankLine()],
    )
    setSaving(false)
  }, [open, prefill])

  const ingredientById = useMemo(
    () => new Map(ingredients.map((i) => [i.id, i])),
    [ingredients],
  )

  // The selected supplier's affiliated ingredient ids — surfaced first in the
  // picker with the emerald "supplier item" badge.
  const affiliatedIds = useMemo(() => {
    if (!supplierId) return undefined
    return new Set(
      ingredients
        .filter((i) => i.suppliers.some((s) => s.supplierId === supplierId))
        .map((i) => i.id),
    )
  }, [ingredients, supplierId])

  function updateLine(key: number, patch: Partial<LineDraft>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  async function pickIngredient(key: number, id: string) {
    const ing = ingredientById.get(id)
    let cost = ing ? Number(ing.unitCost) : NaN
    // Prefer the selected supplier's last purchase cost when recorded.
    if (supplierId) {
      try {
        const rows = await queryClient.fetchQuery({
          queryKey: ['ingredient-suppliers', id],
          queryFn: async () =>
            (await get<IngredientSupplier[]>(`/ingredients/${id}/suppliers`)).data,
          staleTime: 60_000,
        })
        const match = rows.find((r) => r.supplierId === supplierId)
        const last = num(match?.lastUnitCost)
        if (match && last > 0) cost = last
      } catch {
        // Affiliation lookup is best-effort — fall back to the master cost.
      }
    }
    updateLine(key, { ingredientId: id, unit: undefined, cost: Number.isFinite(cost) ? String(cost) : '' })
  }

  function removeLine(key: number) {
    setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls))
  }

  const total = lines.reduce((sum, l) => {
    const q = Number(l.qty)
    const c = Number(l.cost)
    if (!Number.isFinite(q) || q <= 0 || !Number.isFinite(c) || c < 0) return sum
    return sum + q * c
  }, 0)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    if (!supplierId) {
      toast.error('Select a supplier first.')
      return
    }
    const filled = lines.filter((l) => l.ingredientId || l.qty || l.cost)
    if (filled.length === 0) {
      toast.error('Add at least one line item.')
      return
    }
    for (const l of filled) {
      if (!l.ingredientId) {
        toast.error('Every line needs an ingredient.')
        return
      }
      const q = Number(l.qty)
      if (l.qty === '' || !Number.isFinite(q) || q <= 0) {
        toast.error('Every line needs a quantity greater than 0.')
        return
      }
      const c = Number(l.cost)
      if (l.cost !== '' && (!Number.isFinite(c) || c < 0)) {
        toast.error('Unit cost must be a number ≥ 0.')
        return
      }
    }
    setSaving(true)
    try {
      const res = await post<PurchaseOrder>('/purchase-orders', {
        supplier_id: supplierId,
        pr_id: prefill?.prId ?? undefined,
        notes: notes.trim() || undefined,
        lines: filled.map((l) => ({
          ingredient_id: l.ingredientId,
          quantity: Number(l.qty),
          ...(l.unit ? { unit: l.unit } : {}),
          unit_cost: l.cost !== '' ? Number(l.cost) : undefined,
        })),
      })
      toast.success(`${res.data.poNo} created as DRAFT — send it to the supplier when ready.`)
      void queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
      void queryClient.invalidateQueries({ queryKey: ['po-detail'] })
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create purchase order.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o) }}>
      <DialogContent className="bg-card border-border text-foreground max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-foreground">New purchase order</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Pick the supplier first — its affiliated items are surfaced at the
            top of the ingredient picker.
          </DialogDescription>
        </DialogHeader>

        {prefill && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-ink-accent">
            <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Raising this PO from approved request{' '}
            <span className="font-mono font-semibold">{prefill.prNo}</span>
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Supplier *</label>
            <Select value={supplierId || '_none'} onValueChange={(v) => setSupplierId(v === '_none' ? '' : v)}>
              <SelectTrigger className="bg-background border-border text-foreground text-sm h-9">
                <SelectValue placeholder="Select supplier…" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="_none" className="text-muted-foreground">Select supplier…</SelectItem>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id} className="text-foreground">
                    {s.code} — {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {suppliers.length === 0 && (
              <p className="mt-1 text-[11px] text-warn-text">
                No active suppliers — add one in Master Data → Suppliers first.
              </p>
            )}
          </div>

          {/* Line items */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="block text-xs font-medium text-muted-foreground">Line items *</label>
              <span className="text-[11px] text-muted-foreground">total {peso(total)}</span>
            </div>
            <div className="space-y-2">
              {lines.map((l) => {
                const ing = ingredientById.get(l.ingredientId)
                return (
                  <div key={l.key} className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <IngredientPicker
                        ingredients={ingredients}
                        value={l.ingredientId}
                        onChange={(id) => void pickIngredient(l.key, id)}
                        affiliatedIds={affiliatedIds}
                        placeholder={supplierId ? 'Search ingredient…' : 'Pick supplier first…'}
                        disabled={!supplierId}
                      />
                    </div>
                    <div className="w-24">
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        value={l.qty}
                        onChange={(e) => updateLine(l.key, { qty: e.target.value })}
                        placeholder="qty"
                        aria-label="Quantity"
                        className={INPUT_CLS}
                      />
                    </div>
                    <UnitSelect
                      ingredientId={l.ingredientId || undefined}
                      stockUnit={ing?.unit}
                      value={l.unit}
                      onChange={(unit, ratio) =>
                        updateLine(l.key, { unit, qty: rescaleTyped(l.qty, 1 / ratio), cost: rescaleTyped(l.cost, ratio) })
                      }
                      disabled={!ing}
                    />
                    <div className="w-28">
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        value={l.cost}
                        onChange={(e) => updateLine(l.key, { cost: e.target.value })}
                        placeholder={`₱/${l.unit ?? ing?.unit ?? 'unit'}`}
                        aria-label="Unit cost"
                        className={INPUT_CLS}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeLine(l.key)}
                      disabled={lines.length === 1}
                      aria-label="Remove line"
                      className="h-9 w-9 flex-none text-muted-foreground hover:text-danger-text hover:bg-red-500/10 disabled:opacity-40"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )
              })}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setLines((ls) => [...ls, blankLine()])}
              className="mt-2 h-8 text-ink-accent hover:text-ink-accent hover:bg-emerald-500/10"
            >
              <Plus className="h-3.5 w-3.5" />
              Add line
            </Button>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Notes</label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={240}
              placeholder="Optional — delivery window, terms…"
              className={INPUT_CLS}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving || suppliers.length === 0}
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold disabled:opacity-60"
            >
              {saving ? 'Creating…' : 'Create PO'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
