/**
 * AdjustmentDialog — single-ingredient stock adjustment (MoM: ingredient expiry
 * + negligence write-offs). Opened from an "Adjust" row action on the Inventory
 * page (src/pages/Inventory.tsx).
 *
 * Contract (fixed — coded against even if the backend copy lags):
 *   POST /adjustments
 *     { warehouse_id, ingredient_id, direction: 'IN'|'OUT', quantity: number>0,
 *       reason: 'EXPIRY'|'SPOILAGE'|'NEGLIGENCE'|'CORRECTION'|'OTHER', note? }
 *     → 201 row (status PENDING). Roles: OWNER, OUTLET_MANAGER, WAREHOUSE_MAIN,
 *       WAREHOUSE_OUTLET (server-enforced; the row action is gated to match).
 *
 * A submitted adjustment is a REQUEST — it does not move stock until approved.
 * Approval (elsewhere on the page) emits `stock.updated`, which the Inventory
 * page already refetches on.
 */
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowDownCircle, ArrowUpCircle } from 'lucide-react'
import { toast } from 'sonner'
import { post } from '../lib/api'
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
import { UnitSelect } from './units/UnitSelect'

// ─── Types ──────────────────────────────────────────────────────────────────

export type AdjustmentDirection = 'IN' | 'OUT'
export type AdjustmentReason =
  | 'EXPIRY'
  | 'SPOILAGE'
  | 'NEGLIGENCE'
  | 'CORRECTION'
  | 'OTHER'

interface AdjustIngredient {
  id: string
  name: string
  unit: string
}

interface AdjustmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  warehouseId: string
  /** Warehouse tier label for the dialog subtitle (MAIN / KITCHEN). */
  warehouseLabel?: string
  ingredient: AdjustIngredient | null
  /** Called after a successful 201 so the caller can invalidate the adjustments query. */
  onSuccess: () => void
}

const REASONS: { value: AdjustmentReason; label: string }[] = [
  { value: 'EXPIRY', label: 'Expiry' },
  { value: 'SPOILAGE', label: 'Spoilage' },
  { value: 'NEGLIGENCE', label: 'Negligence' },
  { value: 'CORRECTION', label: 'Correction' },
  { value: 'OTHER', label: 'Other' },
]

// ─── Component ──────────────────────────────────────────────────────────────

export default function AdjustmentDialog({
  open,
  onOpenChange,
  warehouseId,
  warehouseLabel,
  ingredient,
  onSuccess,
}: AdjustmentDialogProps) {
  const [direction, setDirection] = useState<AdjustmentDirection>('OUT')
  const [quantity, setQuantity] = useState('')
  /** Unit the amount is typed in; undefined = the ingredient's stock unit (D57). */
  const [unit, setUnit] = useState<string | undefined>(undefined)
  const [reason, setReason] = useState<AdjustmentReason>('EXPIRY')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Reset the form each time the dialog opens for a (possibly different) ingredient.
  useEffect(() => {
    if (open) {
      setDirection('OUT')
      setQuantity('')
      setUnit(undefined)
      setReason('EXPIRY')
      setNote('')
      setSubmitting(false)
    }
  }, [open, ingredient?.id])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (submitting) return
    if (!ingredient) return
    const qtyNum = Number(quantity)
    if (!(quantity !== '' && Number.isFinite(qtyNum) && qtyNum > 0)) {
      toast.error('Enter a quantity greater than 0.')
      return
    }
    setSubmitting(true)
    try {
      await post('/adjustments', {
        warehouse_id: warehouseId,
        ingredient_id: ingredient.id,
        direction,
        quantity: qtyNum,
        ...(unit ? { unit } : {}),
        reason,
        note: note.trim() || undefined,
      })
      toast.success('Adjustment submitted for approval')
      onSuccess()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit adjustment.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!submitting) onOpenChange(o) }}>
      <DialogContent className="bg-card border-border text-foreground max-w-md">
        <DialogHeader>
          <DialogTitle className="text-foreground">
            Adjust stock — {ingredient?.name ?? ''}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {warehouseLabel ? `${warehouseLabel} warehouse · ` : ''}
            Write-offs (expiry, spoilage, negligence) and corrections. Submitted
            for approval — stock moves only once approved.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={e => void handleSubmit(e)} className="space-y-4">
          {/* Direction toggle */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Direction
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDirection('OUT')}
                aria-pressed={direction === 'OUT'}
                className={[
                  'flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors',
                  direction === 'OUT'
                    ? 'border-red-500/50 bg-red-500/15 text-danger-text'
                    : 'border-border bg-background text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                <ArrowDownCircle className="h-4 w-4" aria-hidden />
                Write-off
              </button>
              <button
                type="button"
                onClick={() => setDirection('IN')}
                aria-pressed={direction === 'IN'}
                className={[
                  'flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors',
                  direction === 'IN'
                    ? 'border-emerald-500/50 bg-emerald-500/15 text-ink-accent'
                    : 'border-border bg-background text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                <ArrowUpCircle className="h-4 w-4" aria-hidden />
                Add
              </button>
            </div>
          </div>

          {/* Quantity */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Quantity
            </label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                required
                autoFocus
                placeholder="0"
                className="bg-background border-border text-foreground placeholder:text-muted-foreground h-9"
              />
              <UnitSelect
                ingredientId={ingredient?.id}
                stockUnit={ingredient?.unit}
                value={unit}
                onChange={next => setUnit(next)}
              />
            </div>
          </div>

          {/* Reason */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Reason
            </label>
            <Select value={reason} onValueChange={v => setReason(v as AdjustmentReason)}>
              <SelectTrigger className="bg-background border-border text-foreground text-sm h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {REASONS.map(r => (
                  <SelectItem key={r.value} value={r.value} className="text-foreground">
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Note */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Note <span className="text-muted-foreground">(optional)</span>
            </label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="e.g. batch expired 07/07, dropped tray…"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
              className="border-border text-muted-foreground hover:text-foreground hover:bg-secondary/50"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting}
              size="sm"
              className="ml-auto bg-primary hover:bg-primary/90 text-primary-foreground font-semibold disabled:opacity-60"
            >
              {submitting ? 'Submitting…' : 'Submit for approval'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
