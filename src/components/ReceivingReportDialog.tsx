/**
 * ReceivingReportDialog — a proper Receiving Report (RR) form for logging a
 * supplier delivery straight into the MAIN warehouse. Replaces the old bare
 * "Receive into MAIN" two-field dialog on the Inventory page (client review
 * 2026-07-08 called the old fields "so incomplete"), used by src/pages/Inventory.tsx.
 *
 * Header captures who delivered (supplier, strongly encouraged), the supplier's
 * own delivery/invoice reference, and free-text notes. Line items pair an
 * ingredient with a quantity and a unit cost (₱) — the cost is prefilled from
 * the supplier's recorded last cost for that item when available, else the
 * ingredient's master cost — with a running total.
 *
 * Backend contract (parallel agent shipping — coded defensively):
 *   GET  /suppliers?active=true     → [{ id, code, name, isActive }]
 *   GET  /ingredients               → rows embed `suppliers: [{ supplierId, ... }]`
 *   GET  /ingredients/:id/suppliers → [{ supplierId, lastUnitCost, ... }]
 *   POST /inventory/receive {
 *     supplier_id?: uuid,          // omitted for a "No supplier / internal" receipt
 *     reference?: string,          // supplier's DR / invoice no
 *     notes?: string,
 *     items: [{ ingredient_id: uuid, quantity: number>0, unit_cost?: number>=0 }]
 *   } → { ...existing fields, rr: { id, rrNo } }
 *
 * Old deploys that ignore the new body fields still receive the `items` — the
 * dialog degrades gracefully (falls back to a generic success message when the
 * response omits `rr`).
 */
import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PackageCheck, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { get, post } from '../lib/api'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'
import { Input } from './ui/input'
import { Button } from './ui/button'
import IngredientPicker from './purchasing/IngredientPicker'
import {
  num,
  peso,
  type Ingredient,
  type IngredientSupplier,
  type SupplierParty,
} from './purchasing/types'

// ─── Types ──────────────────────────────────────────────────────────────────

interface ReceivingReportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a successful receipt so the host can refresh its own views. */
  onReceived?: () => void
}

/** POST /inventory/receive response — only `rr` is read here (defensively). */
interface ReceiveResponse {
  rr?: { id: string; rrNo: string } | null
}

interface LineDraft {
  key: number
  ingredientId: string
  qty: string
  cost: string
}

// Sentinel select values — a real supplier id is anything else.
const CHOOSE = '_choose'
const INTERNAL = '_internal'

const INPUT_CLS =
  'bg-[#0A0F0D] border-[#1F2A24] text-zinc-200 placeholder:text-zinc-600 h-9'

let nextKey = 1
function blankLine(): LineDraft {
  return { key: nextKey++, ingredientId: '', qty: '', cost: '' }
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function ReceivingReportDialog({
  open,
  onOpenChange,
  onReceived,
}: ReceivingReportDialogProps) {
  const queryClient = useQueryClient()

  // Shared cache keys — reuse whatever the host page already fetched.
  const { data: ingredients = [] } = useQuery({
    queryKey: ['ingredients'],
    queryFn: async () => (await get<Ingredient[]>('/ingredients')).data,
    enabled: open,
  })
  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers', 'active'],
    queryFn: async () => (await get<SupplierParty[]>('/suppliers?active=true')).data,
    enabled: open,
  })

  const ingredientById = useMemo(
    () => new Map(ingredients.map((i) => [i.id, i])),
    [ingredients],
  )

  // '' (placeholder) | INTERNAL | a real supplier id.
  const [supplierId, setSupplierId] = useState('')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([blankLine()])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setSupplierId('')
    setReference('')
    setNotes('')
    setLines([blankLine()])
    setSaving(false)
  }, [open])

  // Only a REAL supplier (not the internal / placeholder sentinels) has links.
  const realSupplierId =
    supplierId && supplierId !== INTERNAL ? supplierId : undefined

  // The chosen supplier's affiliated items — surfaced first in the picker.
  const affiliatedIds = useMemo(() => {
    if (!realSupplierId) return undefined
    return new Set(
      ingredients
        .filter((i) => i.suppliers?.some((s) => s.supplierId === realSupplierId))
        .map((i) => i.id),
    )
  }, [ingredients, realSupplierId])

  function updateLine(key: number, patch: Partial<LineDraft>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function removeLine(key: number) {
    setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls))
  }

  // Pick an ingredient + prefill its unit cost (supplier's last cost, else master).
  async function pickIngredient(key: number, id: string) {
    const ing = ingredientById.get(id)
    let cost = ing ? Number(ing.unitCost) : NaN
    if (realSupplierId) {
      try {
        const rows = await queryClient.fetchQuery({
          queryKey: ['ingredient-suppliers', id],
          queryFn: async () =>
            (await get<IngredientSupplier[]>(`/ingredients/${id}/suppliers`)).data,
          staleTime: 60_000,
        })
        const match = rows.find((r) => r.supplierId === realSupplierId)
        const last = num(match?.lastUnitCost)
        if (match && last > 0) cost = last
      } catch {
        // Best-effort — fall back to the ingredient's master cost.
      }
    }
    updateLine(key, { ingredientId: id, cost: Number.isFinite(cost) ? String(cost) : '' })
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
    if (supplierId === '') {
      toast.error("Choose who delivered this stock — or pick 'No supplier / internal'.")
      return
    }
    const filled = lines.filter((l) => l.ingredientId || l.qty || l.cost)
    if (filled.length === 0) {
      toast.error('Add at least one item with a quantity greater than 0.')
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
      const res = await post<ReceiveResponse>('/inventory/receive', {
        supplier_id: realSupplierId,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        items: filled.map((l) => ({
          ingredient_id: l.ingredientId,
          quantity: Number(l.qty),
          unit_cost: l.cost !== '' ? Number(l.cost) : undefined,
        })),
      })
      const rrNo = res.data.rr?.rrNo
      toast.success(
        rrNo
          ? `Received — RR ${rrNo} posted to MAIN`
          : `Received ${filled.length} item(s) into the MAIN warehouse.`,
      )
      // Broad invalidation — stock tiers are keyed by outlet, so match on the
      // ['inventory', ...] prefix rather than an exact key.
      void queryClient.invalidateQueries({ queryKey: ['inventory'] })
      void queryClient.invalidateQueries({ queryKey: ['receiving-reports'] })
      void queryClient.invalidateQueries({ queryKey: ['rr-detail'] })
      void queryClient.invalidateQueries({ queryKey: ['stock-ledger'] })
      onReceived?.()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to receive stock.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o) }}>
      <DialogContent className="bg-[#121A17] border-[#1F2A24] text-zinc-50 max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-zinc-50">
            <PackageCheck className="h-4 w-4 text-emerald-500" aria-hidden />
            Receive into MAIN Warehouse
          </DialogTitle>
          <DialogDescription className="text-zinc-500">
            Log a supplier delivery. Posting credits the MAIN warehouse and writes
            the stock ledger.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          {/* Header fields */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                Supplier
              </label>
              <Select
                value={supplierId === '' ? CHOOSE : supplierId}
                onValueChange={(v) => setSupplierId(v === CHOOSE ? '' : v)}
              >
                <SelectTrigger className="bg-[#0A0F0D] border-[#1F2A24] text-zinc-200 text-sm h-9">
                  <SelectValue placeholder="Who delivered this stock?" />
                </SelectTrigger>
                <SelectContent className="bg-[#121A17] border-[#1F2A24]">
                  <SelectItem value={CHOOSE} className="text-zinc-400">
                    Who delivered this stock?
                  </SelectItem>
                  <SelectItem value={INTERNAL} className="text-zinc-300">
                    No supplier / internal
                  </SelectItem>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id} className="text-zinc-200">
                      {s.code} — {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-[11px] text-zinc-600">
                Recording the supplier keeps this delivery's cost history — pick
                “No supplier / internal” for stock that didn't come from one.
              </p>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                Delivery reference
              </label>
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                maxLength={64}
                placeholder="Supplier's DR / invoice no."
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                Notes
              </label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={240}
                placeholder="Optional — damages, remarks…"
                className={INPUT_CLS}
              />
            </div>
          </div>

          {/* Line items */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="block text-xs font-medium text-zinc-400">Items received *</label>
              <span className="text-[11px] text-zinc-500">total {peso(total)}</span>
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
                        placeholder="Search ingredient…"
                      />
                    </div>
                    <div className="w-24">
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        value={l.qty}
                        onChange={(e) => updateLine(l.key, { qty: e.target.value })}
                        placeholder={ing ? `qty (${ing.unit})` : 'qty'}
                        aria-label="Quantity"
                        className={INPUT_CLS}
                      />
                    </div>
                    <div className="w-28">
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        value={l.cost}
                        onChange={(e) => updateLine(l.key, { cost: e.target.value })}
                        placeholder="₱/unit"
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
                      className="h-9 w-9 flex-none text-zinc-500 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-40"
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
              className="mt-2 h-8 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
            >
              <Plus className="h-3.5 w-3.5" />
              Add item
            </Button>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-60"
            >
              {saving ? 'Receiving…' : 'Receive into MAIN'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
