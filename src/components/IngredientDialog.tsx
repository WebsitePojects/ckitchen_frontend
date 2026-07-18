/**
 * IngredientDialog — edit a raw ingredient's master fields + manage which
 * suppliers it is purchased from. Opened from an "Edit ingredient" (pencil) row
 * action on the Inventory page (src/pages/Inventory.tsx), beside "Adjust".
 *
 * Backend contract (coded against defensively — a parallel agent ships it):
 *   PATCH  /ingredients/:id            { name?, unit?, unit_cost?, low_stock_threshold? } → 200 row
 *   GET    /ingredients/:id/suppliers  → [{ id, supplierId, supplierSku, lastUnitCost,
 *                                          supplier: { id, code, name, isActive } }]
 *   PUT    /ingredients/:id/suppliers  { supplier_id, supplier_sku?, last_unit_cost? } (upsert) → 200
 *   DELETE /ingredients/:id/suppliers/:supplierId → 204
 *   GET    /suppliers?active=true      → [{ id, code, name, isActive, ... }]  (master data)
 *
 * Field edits save on the main "Save changes" button (one PATCH). Supplier
 * affiliations are a sub-resource: add (PUT) / remove (DELETE) apply
 * immediately and refetch the affiliation list. Every mutation calls onSaved()
 * so the host page can refetch inventory + the ingredients master list (GET
 * /ingredients now embeds `suppliers`).
 */
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { del, get, patch, put } from '../lib/api'
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

// ─── Types ──────────────────────────────────────────────────────────────────

export interface EditableIngredient {
  id: string
  name: string
  unit: string
  unitCost: string
  lowStockThreshold: string
}

/** GET /ingredients/:id/suppliers row (camelCase like the other GET endpoints). */
interface IngredientSupplier {
  id: string
  supplierId: string
  supplierSku: string | null
  lastUnitCost: string | number | null
  supplier: { id: string; code: string; name: string; isActive: boolean }
}

/** GET /suppliers?active=true row (master data — mirrors MasterData.tsx `Party`). */
interface SupplierParty {
  id: string
  code: string
  name: string
  isActive: boolean
}

interface IngredientDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  ingredient: EditableIngredient | null
  /** Called after any successful mutation so the caller refetches inventory + ingredients. */
  onSaved: () => void
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatCost(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—'
  const n = typeof v === 'string' ? Number(v) : v
  if (!Number.isFinite(n)) return '—'
  return `₱${n.toFixed(2)}`
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function IngredientDialog({
  open,
  onOpenChange,
  ingredient,
  onSaved,
}: IngredientDialogProps) {
  const queryClient = useQueryClient()

  // ── Ingredient field state (prefilled on open) ──────────────────────────
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [lowStockThreshold, setLowStockThreshold] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open && ingredient) {
      setName(ingredient.name ?? '')
      setUnit(ingredient.unit ?? '')
      setUnitCost(ingredient.unitCost ?? '')
      setLowStockThreshold(ingredient.lowStockThreshold ?? '')
      setSaving(false)
      // Reset the add-supplier sub-form too.
      setAddSupplierId('')
      setAddSku('')
      setAddCost('')
    }
  }, [open, ingredient?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Supplier affiliations ────────────────────────────────────────────────
  const affiliationsKey = ['ingredient-suppliers', ingredient?.id] as const
  const {
    data: affiliations = [],
    isLoading: affiliationsLoading,
    error: affiliationsError,
  } = useQuery({
    queryKey: affiliationsKey,
    queryFn: async () =>
      (await get<IngredientSupplier[]>(`/ingredients/${ingredient!.id}/suppliers`)).data,
    // Only fetch while the dialog is open for a concrete ingredient. Old
    // deploys without the endpoint fail the query — surfaced as a hint below.
    enabled: open && !!ingredient?.id,
  })

  // Active suppliers (master data) — for the "add supplier" select.
  const { data: activeSuppliers = [] } = useQuery({
    queryKey: ['suppliers', 'active'],
    queryFn: async () => (await get<SupplierParty[]>('/suppliers?active=true')).data,
    enabled: open,
  })

  // Suppliers already linked (excluded from the add-select).
  const linkedIds = new Set(affiliations.map(a => a.supplierId))
  const availableSuppliers = activeSuppliers.filter(s => !linkedIds.has(s.id))

  const [addSupplierId, setAddSupplierId] = useState('')
  const [addSku, setAddSku] = useState('')
  const [addCost, setAddCost] = useState('')
  const [addingSupplier, setAddingSupplier] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)

  function refetchAffiliations() {
    return queryClient.invalidateQueries({ queryKey: affiliationsKey })
  }

  // ── Save ingredient fields (PATCH) ───────────────────────────────────────
  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    if (!ingredient) return
    if (!name.trim()) {
      toast.error('Name is required.')
      return
    }
    if (!unit.trim()) {
      toast.error('Unit is required (e.g. kg, g, L, pcs).')
      return
    }
    const costNum = Number(unitCost)
    if (unitCost === '' || !Number.isFinite(costNum) || costNum < 0) {
      toast.error('Unit cost must be a number ≥ 0.')
      return
    }
    const thresholdNum = Number(lowStockThreshold)
    if (lowStockThreshold === '' || !Number.isFinite(thresholdNum) || thresholdNum < 0) {
      toast.error('Low-stock threshold must be a number ≥ 0.')
      return
    }
    setSaving(true)
    try {
      await patch(`/ingredients/${ingredient.id}`, {
        name: name.trim(),
        unit: unit.trim(),
        unit_cost: costNum,
        low_stock_threshold: thresholdNum,
      })
      toast.success(`"${name.trim()}" updated.`)
      onSaved()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update ingredient.')
    } finally {
      setSaving(false)
    }
  }

  // ── Add supplier affiliation (PUT upsert) ────────────────────────────────
  async function handleAddSupplier() {
    if (addingSupplier) return
    if (!ingredient || !addSupplierId) {
      toast.error('Select a supplier to link.')
      return
    }
    const costNum = Number(addCost)
    if (addCost !== '' && (!Number.isFinite(costNum) || costNum < 0)) {
      toast.error('Last cost must be a number ≥ 0.')
      return
    }
    setAddingSupplier(true)
    try {
      await put(`/ingredients/${ingredient.id}/suppliers`, {
        supplier_id: addSupplierId,
        supplier_sku: addSku.trim() || undefined,
        last_unit_cost: addCost !== '' ? costNum : undefined,
      })
      toast.success('Supplier linked.')
      setAddSupplierId('')
      setAddSku('')
      setAddCost('')
      await refetchAffiliations()
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to link supplier.')
    } finally {
      setAddingSupplier(false)
    }
  }

  // ── Remove supplier affiliation (DELETE) ─────────────────────────────────
  async function handleRemoveSupplier(supplierId: string) {
    if (removingId !== null) return
    if (!ingredient) return
    setRemovingId(supplierId)
    try {
      await del(`/ingredients/${ingredient.id}/suppliers/${supplierId}`)
      toast.success('Supplier unlinked.')
      await refetchAffiliations()
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to unlink supplier.')
    } finally {
      setRemovingId(null)
    }
  }

  const noSuppliersExist = activeSuppliers.length === 0

  return (
    <Dialog open={open} onOpenChange={o => { if (!saving) onOpenChange(o) }}>
      <DialogContent className="bg-[#121A17] border-[#1F2A24] text-zinc-50 max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-zinc-50">
            Edit ingredient — {ingredient?.name ?? ''}
          </DialogTitle>
          <DialogDescription className="text-zinc-500">
            Update master fields and manage which suppliers this ingredient is purchased from.
          </DialogDescription>
        </DialogHeader>

        {/* ── Ingredient fields ── */}
        <form onSubmit={e => void handleSave(e)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">Name</label>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                required
                placeholder="e.g. Chicken thigh"
                className="bg-[#0A0F0D] border-[#1F2A24] text-zinc-200 placeholder:text-zinc-600 h-9"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">Unit</label>
              <Input
                value={unit}
                onChange={e => setUnit(e.target.value)}
                required
                placeholder="kg, g, L, pcs"
                className="bg-[#0A0F0D] border-[#1F2A24] text-zinc-200 placeholder:text-zinc-600 h-9"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">Unit cost (₱)</label>
              <Input
                type="number"
                min="0"
                step="any"
                value={unitCost}
                onChange={e => setUnitCost(e.target.value)}
                required
                placeholder="0.00"
                className="bg-[#0A0F0D] border-[#1F2A24] text-zinc-200 placeholder:text-zinc-600 h-9"
              />
            </div>
            <div className="col-span-2">
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                Low-stock threshold ({unit || 'unit'})
              </label>
              <Input
                type="number"
                min="0"
                step="any"
                value={lowStockThreshold}
                onChange={e => setLowStockThreshold(e.target.value)}
                required
                placeholder="0"
                className="bg-[#0A0F0D] border-[#1F2A24] text-zinc-200 placeholder:text-zinc-600 h-9"
              />
              <p className="mt-1 text-[11px] text-zinc-600">
                Below this level, the ingredient raises a low-stock alert (repurchase / ITO).
              </p>
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={saving}
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>

        {/* ── Suppliers section ── */}
        <div className="mt-1 border-t border-[#1F2A24] pt-4">
          <div className="mb-2 flex items-center gap-2">
            <Building2 className="h-4 w-4 text-emerald-500" aria-hidden />
            <h3 className="text-sm font-semibold text-zinc-100">Suppliers</h3>
          </div>

          {/* Current affiliations */}
          {affiliationsLoading ? (
            <div className="flex items-center gap-2 py-3 text-xs text-zinc-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Loading suppliers…
            </div>
          ) : affiliationsError ? (
            <p className="py-2 text-xs text-amber-400">
              Could not load supplier links (the endpoint may not be deployed yet).
            </p>
          ) : affiliations.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[#1F2A24] bg-[#0A0F0D] px-3 py-2.5 text-xs text-zinc-500">
              No supplier linked — link where this ingredient is purchased from.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {affiliations.map(aff => (
                <li
                  key={aff.id}
                  className="flex items-center gap-2 rounded-lg border border-[#1F2A24] bg-[#0A0F0D] px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-200">
                      <span className="font-mono text-[11px] text-zinc-500">{aff.supplier?.code}</span>
                      {aff.supplier?.code ? ' — ' : ''}
                      {aff.supplier?.name ?? aff.supplierId}
                    </p>
                    <p className="mt-0.5 text-[11px] text-zinc-500">
                      {aff.supplierSku
                        ? `Supplier item code ${aff.supplierSku}`
                        : 'No supplier item code'}
                      {' · last '}
                      {formatCost(aff.lastUnitCost)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => void handleRemoveSupplier(aff.supplierId)}
                    disabled={removingId === aff.supplierId}
                    aria-label={`Unlink ${aff.supplier?.name ?? 'supplier'}`}
                    title="Unlink supplier"
                    className="h-8 w-8 flex-none text-zinc-500 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                  >
                    {removingId === aff.supplierId ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {/* Add supplier row */}
          {noSuppliersExist ? (
            <p className="mt-3 rounded-lg border border-dashed border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-300/90">
              No suppliers exist yet. Add them in{' '}
              <span className="font-semibold">Master Data → Suppliers</span> first, then link them here.
            </p>
          ) : (
            <div className="mt-3 space-y-2 rounded-lg border border-[#1F2A24] bg-[#0A0F0D]/60 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                Link a supplier
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[10rem] flex-1">
                  <label className="mb-1 block text-[11px] text-zinc-500">Supplier</label>
                  <Select
                    value={addSupplierId || '_none'}
                    onValueChange={v => setAddSupplierId(v === '_none' ? '' : v)}
                  >
                    <SelectTrigger className="bg-[#0A0F0D] border-[#1F2A24] text-zinc-200 text-sm h-9">
                      <SelectValue placeholder="Select supplier…" />
                    </SelectTrigger>
                    <SelectContent className="bg-[#121A17] border-[#1F2A24]">
                      <SelectItem value="_none" className="text-zinc-400">Select supplier…</SelectItem>
                      {availableSuppliers.map(s => (
                        <SelectItem key={s.id} value={s.id} className="text-zinc-200">
                          {s.code} — {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-32">
                  <label className="mb-1 block text-[11px] text-zinc-500">
                    Supplier item code
                  </label>
                  <Input
                    value={addSku}
                    onChange={e => setAddSku(e.target.value)}
                    placeholder="optional"
                    className="bg-[#0A0F0D] border-[#1F2A24] text-zinc-200 placeholder:text-zinc-600 h-9"
                  />
                </div>
                <div className="w-24">
                  <label className="mb-1 block text-[11px] text-zinc-500">Last ₱</label>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={addCost}
                    onChange={e => setAddCost(e.target.value)}
                    placeholder="opt."
                    className="bg-[#0A0F0D] border-[#1F2A24] text-zinc-200 placeholder:text-zinc-600 h-9"
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleAddSupplier()}
                  disabled={addingSupplier || !addSupplierId}
                  className="h-9 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-60"
                >
                  {addingSupplier ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  Link
                </Button>
              </div>
              <p className="text-[11px] text-zinc-600">
                Supplier item code — the code this supplier uses for the item on their invoices
                (optional).
              </p>
              {availableSuppliers.length === 0 && (
                <p className="text-[11px] text-zinc-600">
                  Every active supplier is already linked to this ingredient.
                </p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
