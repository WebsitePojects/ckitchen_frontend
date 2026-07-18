/**
 * MenuItemDiscountsDialog — per-product promo/discount config.
 *
 * MOTM 2026-07-01 items 2b ("per Product an option to place promo/discount")
 * and 7 ("discount per item"). The discount catalog + 3-layer approval
 * backend already ships (see `OrderDiscountDialog.tsx` for the ORDER-scope
 * apply flow on Orders.tsx); this dialog is the missing ITEM-scope config UI,
 * opened from a menu row's actions dropdown on Menu.tsx.
 *
 * Scope: catalog CRUD only (create/toggle-active/soft-delete a `discount`
 * row with `scope: 'ITEM'` pinned to one menu item). Applying a discount to
 * a specific order is a separate, already-shipped flow (OrderDiscountDialog)
 * and is out of scope here.
 *
 * Item-scope discounts are kept to PERCENT/FIXED in the Add form — SENIOR/
 * PWD/VOUCHER are statutory/order-level concepts (see discounts/routes.ts)
 * and don't make sense pinned to a single product.
 *
 * "Delete" hits `DELETE /discounts/:id`, which the backend implements as a
 * soft delete (sets `active: false`, row survives for audit — see D-rule
 * "no data is ever hard-deleted"). Functionally identical to switching the
 * Active toggle off; kept as a separate confirmed action because the verb
 * ("remove this promo") reads differently than "pause this promo", even
 * though both just flip the same column. Inactive rows stay visible (greyed,
 * badged "Inactive") rather than vanishing, since the row isn't actually
 * gone — this also lets a mis-deleted promo be reactivated via the toggle.
 */
import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Tag, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { del, get, patch, post } from '../lib/api'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Badge } from './ui/badge'
import { Switch } from './ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'
import EmptyState from './common/EmptyState'

// ─── Types ────────────────────────────────────────────────────────────────

export type DiscountType = 'PERCENT' | 'FIXED' | 'SENIOR' | 'PWD' | 'VOUCHER'

/**
 * Discount catalog row — `GET/POST/PATCH /discounts`. Exported so Menu.tsx
 * can reuse this shape for the brand-wide "which items have active promos"
 * lookup that drives the row badge, without a second type definition.
 */
export interface ItemDiscount {
  id: string
  scope: 'ITEM' | 'ORDER'
  brandId?: string | null
  menuItemId?: string | null
  name: string
  type: DiscountType
  value: number | string
  code?: string | null
  vatExempt: boolean
  active: boolean
}

/** Minimal menu item shape the dialog needs. */
export interface DiscountMenuItemRef {
  id: string
  brandId: string
  name: string
}

interface MenuItemDiscountsDialogProps {
  item: DiscountMenuItemRef | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Whether the current user may create/toggle/delete (BRAND_MANAGER/OWNER). Read-only otherwise. */
  canWrite: boolean
  /** Fired after any successful mutation — lets Menu.tsx refresh its brand-wide promo-count badges. */
  onChanged?: () => void
}

/** ITEM-scope Add form is deliberately limited to these two — see file header. */
const ADD_TYPES: Extract<DiscountType, 'PERCENT' | 'FIXED'>[] = ['PERCENT', 'FIXED']

const TYPE_LABEL: Record<DiscountType, string> = {
  PERCENT: 'Percent off',
  FIXED: 'Fixed amount off',
  SENIOR: 'Senior Citizen',
  PWD: 'PWD',
  VOUCHER: 'Voucher',
}

const TYPE_BADGE_CLASS: Record<DiscountType, string> = {
  PERCENT: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  FIXED: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  SENIOR: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  PWD: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  VOUCHER: 'border-purple-500/40 bg-purple-500/10 text-purple-300',
}

function money(n: number | string): string {
  return `₱${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatValue(d: ItemDiscount): string {
  const v = Number(d.value)
  return d.type === 'FIXED' || d.type === 'VOUCHER' ? `${money(v)} off` : `${v}% off`
}

export default function MenuItemDiscountsDialog({
  item,
  open,
  onOpenChange,
  canWrite,
  onChanged,
}: MenuItemDiscountsDialogProps) {
  const queryClient = useQueryClient()

  const [addName, setAddName] = useState('')
  const [addType, setAddType] = useState<'PERCENT' | 'FIXED'>('PERCENT')
  const [addValue, setAddValue] = useState('')
  const [addSubmitting, setAddSubmitting] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)

  function resetForm() {
    setAddName('')
    setAddType('PERCENT')
    setAddValue('')
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next)
    if (!next) resetForm()
  }

  const queryKey = ['menu-item-discounts', item?.id] as const

  const {
    data: discounts = [],
    isLoading,
    error,
  } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await get<ItemDiscount[]>(`/discounts?menu_item_id=${item!.id}`)
      return (res.data ?? []).filter((d) => d.scope === 'ITEM')
    },
    enabled: open && !!item,
  })
  const errorMsg = error ? (error instanceof Error ? error.message : 'Failed to load discounts.') : null

  // ── Add promo ──────────────────────────────────────────────────────────
  async function handleAddPromo(e: FormEvent) {
    e.preventDefault()
    if (addSubmitting) return
    if (!item) return

    const trimmedName = addName.trim()
    if (!trimmedName) {
      toast.error('Enter a promo name.')
      return
    }
    const numValue = Number(addValue)
    if (!addValue.trim() || Number.isNaN(numValue) || numValue <= 0) {
      toast.error('Enter a valid discount value.')
      return
    }
    if (addType === 'PERCENT' && numValue > 100) {
      toast.error('Percent discounts must be between 0 and 100.')
      return
    }

    setAddSubmitting(true)
    try {
      const res = await post<ItemDiscount>('/discounts', {
        scope: 'ITEM',
        brand_id: item.brandId,
        menu_item_id: item.id,
        name: trimmedName,
        type: addType,
        value: numValue,
      })
      queryClient.setQueryData<ItemDiscount[]>(queryKey, (prev) => [res.data, ...(prev ?? [])])
      toast.success(`"${res.data.name}" added`)
      resetForm()
      await queryClient.invalidateQueries({ queryKey })
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add discount.')
    } finally {
      setAddSubmitting(false)
    }
  }

  // ── Active toggle (optimistic PATCH) ──────────────────────────────────
  async function toggleActive(d: ItemDiscount) {
    if (pendingId !== null) return
    const next = !d.active
    setPendingId(d.id)
    queryClient.setQueryData<ItemDiscount[]>(queryKey, (prev) =>
      (prev ?? []).map((r) => (r.id === d.id ? { ...r, active: next } : r)),
    )
    try {
      await patch(`/discounts/${d.id}`, { active: next })
      toast.success(`"${d.name}" ${next ? 'enabled' : 'paused'}`)
      onChanged?.()
    } catch (err) {
      queryClient.setQueryData<ItemDiscount[]>(queryKey, (prev) =>
        (prev ?? []).map((r) => (r.id === d.id ? { ...r, active: d.active } : r)),
      )
      toast.error(err instanceof Error ? err.message : 'Failed to update discount.')
    } finally {
      setPendingId(null)
    }
  }

  // ── Delete (soft) ──────────────────────────────────────────────────────
  async function handleDelete(d: ItemDiscount) {
    if (!window.confirm(`Remove "${d.name}" from ${item?.name ?? 'this item'}?`)) return
    if (pendingId !== null) return
    setPendingId(d.id)
    try {
      await del(`/discounts/${d.id}`)
      queryClient.setQueryData<ItemDiscount[]>(queryKey, (prev) =>
        (prev ?? []).map((r) => (r.id === d.id ? { ...r, active: false } : r)),
      )
      toast.success(`"${d.name}" removed`)
      await queryClient.invalidateQueries({ queryKey })
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete discount.')
    } finally {
      setPendingId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Discounts — {item?.name ?? 'Item'}</DialogTitle>
          <DialogDescription>
            Manage promo/discount options for this product. Applying a discount to a specific
            order is done from the Orders page.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {errorMsg && (
            <p className="rounded-md border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-400">
              {errorMsg}
            </p>
          )}

          {/* Existing discounts */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Item Discounts</label>
            {isLoading ? (
              <p className="py-4 text-center text-sm text-zinc-500">Loading…</p>
            ) : discounts.length === 0 ? (
              <EmptyState
                icon={Tag}
                title="No discounts yet"
                description="Add a promo below to attach it to this product."
                className="border-none bg-transparent py-6"
              />
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {discounts.map((d) => (
                  <li
                    key={d.id}
                    className={`flex items-center gap-3 px-3 py-2 text-sm ${!d.active ? 'opacity-50' : ''}`}
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate font-medium text-zinc-200">{d.name}</span>
                        <Badge variant="outline" className={TYPE_BADGE_CLASS[d.type]}>
                          {TYPE_LABEL[d.type]}
                        </Badge>
                        {!d.active && (
                          <Badge variant="outline" className="border-zinc-600/50 bg-zinc-800/60 text-zinc-400">
                            Inactive
                          </Badge>
                        )}
                      </div>
                      <p className="tabular-nums text-xs text-zinc-500">{formatValue(d)}</p>
                    </div>
                    <Switch
                      checked={d.active}
                      disabled={!canWrite || pendingId === d.id}
                      onCheckedChange={() => void toggleActive(d)}
                      aria-label={d.active ? 'Deactivate discount' : 'Activate discount'}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={!canWrite || pendingId === d.id}
                      onClick={() => void handleDelete(d)}
                      className="h-7 w-7 p-0 text-zinc-500 hover:text-red-400"
                      aria-label="Delete discount"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Add promo form — writers only */}
          {canWrite && (
            <form onSubmit={(e) => void handleAddPromo(e)} className="space-y-3 border-t border-border pt-3">
              <label className="text-xs font-medium text-zinc-400">Add Promo</label>

              <div className="space-y-1.5">
                <Input
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder="e.g. Lunch Special"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-400">Type</label>
                  <Select value={addType} onValueChange={(v) => setAddType(v as 'PERCENT' | 'FIXED')}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ADD_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {TYPE_LABEL[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-400">
                    Value {addType === 'PERCENT' ? '(%)' : '(₱)'}
                  </label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={addValue}
                    onChange={(e) => setAddValue(e.target.value)}
                    placeholder="0"
                  />
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" size="sm" onClick={() => handleOpenChange(false)}>
                  Close
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={addSubmitting}
                  className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-500"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {addSubmitting ? 'Adding…' : 'Add Promo'}
                </Button>
              </DialogFooter>
            </form>
          )}

          {!canWrite && (
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => handleOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
