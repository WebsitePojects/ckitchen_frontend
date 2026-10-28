/**
 * PurchaseRequestDialog — "New Request" (Purchasing page, PR tab).
 *
 * Backend contract (ckitchen_backend/src/modules/purchasing/routes.ts
 * prCreateSchema — matched exactly):
 *   POST /purchase-requests {
 *     department: enum KITCHEN|WAREHOUSE|PURCHASING|SALES|PRODUCTION|QA|ACCOUNTING|ADMIN,
 *     notes?: string,
 *     lines: [{ ingredient_id: uuid, quantity: number>0, est_unit_cost?: number>=0 }] (min 1)
 *   } → 201 PR row (status DRAFT)
 *
 * Est. unit cost prefills from the ingredient's master unitCost on pick;
 * the requester can adjust it. The PR lands as DRAFT — submitting for
 * approval (and the budget warning) happens from the table row action.
 */
import { useEffect, useMemo, useState, useRef } from 'react'
import type { FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { post } from '../../lib/api'
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
import { DEPARTMENTS, deptLabel, peso, type Ingredient, type PurchaseRequest } from './types'
import { UnitSelect } from '../units/UnitSelect'
import { rescaleTyped } from '../../lib/units'

interface LineDraft {
  key: number
  ingredientId: string
  qty: string
  estCost: string
  /** Unit the quantity (and price) is typed in; undefined = stock unit (D57). */
  unit?: string
}

let nextKey = 1
function blankLine(): LineDraft {
  return { key: nextKey++, ingredientId: '', qty: '', estCost: '' }
}

interface PurchaseRequestDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  ingredients: Ingredient[]
}

const INPUT_CLS =
  'bg-background border-border text-foreground placeholder:text-muted-foreground h-9'

export default function PurchaseRequestDialog({
  open,
  onOpenChange,
  ingredients,
}: PurchaseRequestDialogProps) {
  const queryClient = useQueryClient()

  const [department, setDepartment] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([blankLine()])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setDepartment('')
    setNotes('')
    setLines([blankLine()])
    setSaving(false)
  }, [open])

  const ingredientById = useMemo(
    () => new Map(ingredients.map((i) => [i.id, i])),
    [ingredients],
  )

  function updateLine(key: number, patch: Partial<LineDraft>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function pickIngredient(key: number, id: string) {
    const ing = ingredientById.get(id)
    // Prefill est. cost from the ingredient master unit cost (editable).
    updateLine(key, { ingredientId: id, unit: undefined, estCost: ing ? String(Number(ing.unitCost)) : '' })
  }

  function removeLine(key: number) {
    setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls))
  }

  const total = lines.reduce((sum, l) => {
    const q = Number(l.qty)
    const c = Number(l.estCost)
    if (!Number.isFinite(q) || q <= 0 || !Number.isFinite(c) || c < 0) return sum
    return sum + q * c
  }, 0)

  // One key per intent (rule: duplicate-safe creates). Kept across a failed or timed-out try,
  // so pressing Save again replays the same document instead of creating a second one;
  // cleared only once a save is confirmed.
  const requestIdRef = useRef<string | null>(null)
  const savingRef = useRef(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (saving || savingRef.current) return
    if (!department) {
      toast.error('Select a department.')
      return
    }
    const filled = lines.filter((l) => l.ingredientId || l.qty || l.estCost)
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
      const c = Number(l.estCost)
      if (l.estCost !== '' && (!Number.isFinite(c) || c < 0)) {
        toast.error('Est. unit cost must be a number ≥ 0.')
        return
      }
    }
    requestIdRef.current ??= crypto.randomUUID()
    savingRef.current = true
    setSaving(true)
    try {
      const res = await post<PurchaseRequest>('/purchase-requests', {
        client_request_id: requestIdRef.current,
        department,
        notes: notes.trim() || undefined,
        lines: filled.map((l) => ({
          ingredient_id: l.ingredientId,
          quantity: Number(l.qty),
          ...(l.unit ? { unit: l.unit } : {}),
          est_unit_cost: l.estCost !== '' ? Number(l.estCost) : undefined,
        })),
      })
      toast.success(`${res.data.prNo} created as DRAFT — submit it for approval when ready.`)
      void queryClient.invalidateQueries({ queryKey: ['purchase-requests'] })
      void queryClient.invalidateQueries({ queryKey: ['pr-detail'] })
      requestIdRef.current = null
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create purchase request.')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o) }}>
      <DialogContent className="bg-card border-border text-foreground max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-foreground">New purchase request</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Request items for a department. The request starts as DRAFT and is
            checked against the department’s monthly budget on submit.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Department *</label>
            <Select value={department || '_none'} onValueChange={(v) => setDepartment(v === '_none' ? '' : v)}>
              <SelectTrigger className="bg-background border-border text-foreground text-sm h-9">
                <SelectValue placeholder="Select department…" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="_none" className="text-muted-foreground">Select department…</SelectItem>
                {DEPARTMENTS.map((d) => (
                  <SelectItem key={d} value={d} className="text-foreground">
                    {deptLabel(d)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Line items */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="block text-xs font-medium text-muted-foreground">Line items *</label>
              <span className="text-[11px] text-muted-foreground">est. total {peso(total)}</span>
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
                        onChange={(id) => pickIngredient(l.key, id)}
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
                        updateLine(l.key, { unit, qty: rescaleTyped(l.qty, 1 / ratio), estCost: rescaleTyped(l.estCost, ratio) })
                      }
                      disabled={!ing}
                    />
                    <div className="w-28">
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        value={l.estCost}
                        onChange={(e) => updateLine(l.key, { estCost: e.target.value })}
                        placeholder={`est. ₱/${l.unit ?? ing?.unit ?? 'unit'}`}
                        aria-label="Estimated unit cost"
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
              placeholder="Optional — context for the approver"
              className={INPUT_CLS}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold disabled:opacity-60"
            >
              {saving ? 'Creating…' : 'Create request'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
