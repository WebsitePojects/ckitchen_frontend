/**
 * ReceiveDialog — receive goods against a SENT/PARTIAL purchase order
 * (Purchasing page, PO tab row action). Posts a Receiving Report; the backend
 * atomically bumps MAIN-warehouse stock + writes RECEIVE IN ledger rows.
 *
 * Backend contract (ckitchen_backend/src/modules/purchasing/routes.ts
 * receiveSchema — matched exactly):
 *   GET  /purchase-orders/:id → { ...po, lines: [{ id, ingredientId, quantity,
 *                                 unitCost, qtyReceived }] }
 *   POST /purchase-orders/:id/receive {
 *     notes?: string,
 *     lines: [{ po_line_id: uuid, qty_received: number>0 }] (min 1)
 *   } → 201 RR row  (409 if a line over-receives beyond its outstanding qty)
 *
 * Received-qty inputs default to each line's OUTSTANDING quantity
 * (ordered − already received); fully-received lines are shown but locked.
 */
import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, PackageCheck } from 'lucide-react'
import { toast } from 'sonner'
import { get, post } from '../../lib/api'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import {
  num,
  peso,
  type Ingredient,
  type PurchaseOrder,
  type PurchaseOrderDetail,
  type ReceivingReport,
} from './types'

interface ReceiveDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The SENT/PARTIAL purchase order being received. */
  po: PurchaseOrder | null
  ingredients: Ingredient[]
}

const INPUT_CLS =
  'bg-[#0A0F0D] border-[#1F2A24] text-zinc-200 placeholder:text-zinc-600 h-9'

export default function ReceiveDialog({ open, onOpenChange, po, ingredients }: ReceiveDialogProps) {
  const queryClient = useQueryClient()

  const { data: detail, isLoading } = useQuery({
    queryKey: ['po-detail', po?.id],
    queryFn: async () => (await get<PurchaseOrderDetail>(`/purchase-orders/${po!.id}`)).data,
    enabled: open && !!po?.id,
  })

  const ingredientById = useMemo(
    () => new Map(ingredients.map((i) => [i.id, i])),
    [ingredients],
  )

  // Received-qty inputs keyed by PO line id, defaulted to outstanding.
  const [qtyByLine, setQtyByLine] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setNotes('')
    setSaving(false)
  }, [open])

  useEffect(() => {
    if (!open || !detail) return
    const defaults: Record<string, string> = {}
    for (const l of detail.lines) {
      const outstanding = Math.max(0, num(l.quantity) - num(l.qtyReceived))
      defaults[l.id] = outstanding > 0 ? String(outstanding) : '0'
    }
    setQtyByLine(defaults)
  }, [open, detail])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    if (!po || !detail) return
    const payloadLines: { po_line_id: string; qty_received: number }[] = []
    for (const l of detail.lines) {
      const raw = qtyByLine[l.id] ?? '0'
      const v = Number(raw)
      const outstanding = Math.max(0, num(l.quantity) - num(l.qtyReceived))
      if (raw !== '' && (!Number.isFinite(v) || v < 0)) {
        toast.error('Received quantities must be numbers ≥ 0.')
        return
      }
      if (v > outstanding + 1e-9) {
        const name = ingredientById.get(l.ingredientId)?.name ?? 'a line'
        toast.error(`Cannot receive ${v} for ${name} — only ${outstanding} outstanding.`)
        return
      }
      if (v > 0) payloadLines.push({ po_line_id: l.id, qty_received: v })
    }
    if (payloadLines.length === 0) {
      toast.error('Enter a received quantity on at least one line.')
      return
    }
    setSaving(true)
    try {
      const res = await post<ReceivingReport>(`/purchase-orders/${po.id}/receive`, {
        notes: notes.trim() || undefined,
        lines: payloadLines,
      })
      toast.success(
        `${res.data.rrNo} posted — stock received into the MAIN warehouse.`,
      )
      void queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
      void queryClient.invalidateQueries({ queryKey: ['po-detail'] })
      void queryClient.invalidateQueries({ queryKey: ['receiving-reports'] })
      void queryClient.invalidateQueries({ queryKey: ['rr-detail'] })
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to post receiving report.')
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
            Receive — {po?.poNo ?? ''}
          </DialogTitle>
          <DialogDescription className="text-zinc-500">
            Confirm what arrived. Quantities default to what’s still outstanding;
            posting credits the MAIN warehouse and writes the stock ledger.
          </DialogDescription>
        </DialogHeader>

        {isLoading || !detail ? (
          <div className="flex items-center gap-2 py-6 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading order lines…
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div className="overflow-hidden rounded-lg border border-[#1F2A24]">
              <div className="grid grid-cols-[1fr_5rem_5rem_6rem] gap-2 border-b border-[#1F2A24] bg-[#0A0F0D] px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                <span>Item</span>
                <span className="text-right">Ordered</span>
                <span className="text-right">Received</span>
                <span className="text-right">Receive now</span>
              </div>
              <div className="max-h-64 space-y-0 overflow-y-auto">
                {detail.lines.map((l) => {
                  const ing = ingredientById.get(l.ingredientId)
                  const outstanding = Math.max(0, num(l.quantity) - num(l.qtyReceived))
                  const done = outstanding <= 0
                  return (
                    <div
                      key={l.id}
                      className="grid grid-cols-[1fr_5rem_5rem_6rem] items-center gap-2 border-b border-[#1F2A24]/60 px-3 py-2 last:border-b-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm text-zinc-200">
                          {ing?.name ?? l.ingredientId.slice(0, 8)}
                        </p>
                        <p className="text-[11px] text-zinc-500">
                          {ing?.unit ?? ''} · {peso(l.unitCost)}/unit
                        </p>
                      </div>
                      <span className="text-right text-sm tabular-nums text-zinc-300">
                        {num(l.quantity)}
                      </span>
                      <span className="text-right text-sm tabular-nums text-zinc-400">
                        {num(l.qtyReceived)}
                      </span>
                      {done ? (
                        <span className="text-right text-[11px] font-semibold text-emerald-400">
                          COMPLETE
                        </span>
                      ) : (
                        <Input
                          type="number"
                          min="0"
                          max={outstanding}
                          step="any"
                          value={qtyByLine[l.id] ?? ''}
                          onChange={(e) =>
                            setQtyByLine((m) => ({ ...m, [l.id]: e.target.value }))
                          }
                          aria-label={`Quantity received for ${ing?.name ?? 'line'}`}
                          className={`${INPUT_CLS} text-right`}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">Notes</label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={240}
                placeholder="Optional — delivery reference, damages…"
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
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-60"
              >
                {saving ? 'Posting…' : 'Post receiving report'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
