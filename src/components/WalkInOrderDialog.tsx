/**
 * WalkInOrderDialog — manual walk-in / direct counter order entry
 * (MOTM 2026-06-24: "Walk-in manual. Input — this will have another
 * interface"; "Direct is an online platform").
 *
 * A walk-in order is NOT a separate pipeline — it POSTs to the SAME
 * `/ingest/order` endpoint aggregator webhooks use, with `aggregator:
 * 'OTHER'` and a locally-generated unique `external_ref` (business-rules.md
 * #5 idempotency key is (aggregator, external_ref), so this must be unique
 * per submission). Once created it appears live on Dashboard/Orders/KDS and
 * prints a KOT exactly like a FoodPanda/GrabFood order — Orders.tsx's
 * existing socket-driven refetch picks it up via `order.created`, so this
 * component does NOT touch that list itself; it only fires the POST and
 * reports success/failure.
 *
 * Controlled component: the parent (Orders.tsx) owns `open` state and the
 * trigger button (incl. the role gate) — this dialog has no DialogTrigger of
 * its own, matching the Menu.tsx edit-item dialog pattern.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, ShoppingCart, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { get, post } from '../lib/api'
import { useOutlet } from '../context/OutletContext'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'

// ─── Types ────────────────────────────────────────────────────────────────

interface Brand {
  id: string
  name: string
  color: string
  isActive: boolean
}

type Availability = 'AVAILABLE' | 'PAUSED' | 'SOLD_OUT'

interface MenuItemRow {
  id: string
  brandId: string
  name: string
  price: string
  availability: Availability
}

interface OrderLine {
  menuItemId: string
  name: string
  price: number
  qty: number
}

interface WalkInOrderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const AVAIL_SUFFIX: Partial<Record<Availability, string>> = {
  PAUSED: ' (Paused)',
  SOLD_OUT: ' (Sold Out)',
}

/** `(aggregator, external_ref)` must be unique per business-rules.md #5 — timestamp + random suffix is unique per submission. */
function generateExternalRef(): string {
  return `WALKIN-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export default function WalkInOrderDialog({ open, onOpenChange }: WalkInOrderDialogProps) {
  const { selectedOutletId } = useOutlet()

  const [brandId, setBrandId] = useState('')
  const [customerName, setCustomerName] = useState('Walk-in')
  const [lines, setLines] = useState<OrderLine[]>([])
  const [pickedItemId, setPickedItemId] = useState('')
  const [pickedQty, setPickedQty] = useState('1')
  const [submitting, setSubmitting] = useState(false)

  // Only fetch while the dialog is actually open — no point warming this
  // cache on every Orders.tsx mount.
  const {
    data: brands = [],
    isLoading: loadingBrands,
    error: brandsError,
  } = useQuery({
    queryKey: ['brands', selectedOutletId],
    queryFn: async () => (await get<Brand[]>('/brands')).data,
    enabled: open,
  })
  const activeBrands = useMemo(() => brands.filter((b) => b.isActive), [brands])

  // Default to the first active brand once the list loads.
  useEffect(() => {
    if (open && !brandId && activeBrands.length > 0) {
      setBrandId(activeBrands[0].id)
    }
  }, [open, activeBrands, brandId])

  const {
    data: menuItems = [],
    isLoading: loadingMenu,
    error: menuError,
  } = useQuery({
    queryKey: ['menu', selectedOutletId, brandId],
    queryFn: async () => (await get<MenuItemRow[]>(`/brands/${brandId}/menu`)).data,
    enabled: open && !!brandId,
  })

  const total = useMemo(
    () => lines.reduce((sum, l) => sum + l.price * l.qty, 0),
    [lines],
  )

  function resetForm() {
    setBrandId('')
    setCustomerName('Walk-in')
    setLines([])
    setPickedItemId('')
    setPickedQty('1')
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next)
    if (!next) resetForm()
  }

  function handleBrandChange(next: string) {
    setBrandId(next)
    // Line items belong to the previous brand's menu — switching brands
    // clears the cart rather than leaving stale cross-brand lines.
    setLines([])
    setPickedItemId('')
  }

  function addLine() {
    const item = menuItems.find((m) => m.id === pickedItemId)
    if (!item || item.availability !== 'AVAILABLE') return
    const qty = Math.max(1, Math.floor(Number(pickedQty)) || 1)
    setLines((prev) => {
      const existing = prev.find((l) => l.menuItemId === item.id)
      if (existing) {
        return prev.map((l) =>
          l.menuItemId === item.id ? { ...l, qty: l.qty + qty } : l,
        )
      }
      return [...prev, { menuItemId: item.id, name: item.name, price: Number(item.price), qty }]
    })
    setPickedItemId('')
    setPickedQty('1')
  }

  function removeLine(menuItemId: string) {
    setLines((prev) => prev.filter((l) => l.menuItemId !== menuItemId))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!brandId || lines.length === 0) return
    setSubmitting(true)
    try {
      await post('/ingest/order', {
        brand_id: brandId,
        aggregator: 'OTHER',
        external_ref: generateExternalRef(),
        customer_name: customerName.trim() || 'Walk-in',
        items: lines.map((l) => ({ menu_item_id: l.menuItemId, qty: l.qty })),
      })
      toast.success('Walk-in order placed', {
        description: 'Now live on the Orders board, Dashboard, and KDS.',
      })
      handleOpenChange(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to place order.'
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const dataError = brandsError ?? menuError
  const dataErrorMsg = dataError
    ? dataError instanceof Error ? dataError.message : 'Failed to load brand/menu data.'
    : null

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Walk-in Order</DialogTitle>
          <DialogDescription>
            Manually enter a walk-in / direct counter order. It flows through the same kitchen
            pipeline as aggregator orders — live on the board, KOT printed, stock deducted at
            Preparing.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          {dataErrorMsg && (
            <p className="rounded-md border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-400">
              {dataErrorMsg}
            </p>
          )}

          {/* Brand */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Brand</label>
            <Select value={brandId} onValueChange={handleBrandChange} disabled={loadingBrands}>
              <SelectTrigger>
                <SelectValue placeholder={loadingBrands ? 'Loading…' : 'Select brand…'} />
              </SelectTrigger>
              <SelectContent>
                {activeBrands.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: b.color ?? '#10B981' }}
                      />
                      {b.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Customer name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Customer Name (optional)</label>
            <Input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Walk-in"
            />
          </div>

          {/* Item picker */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Add Item</label>
            <div className="flex gap-2">
              <Select
                value={pickedItemId}
                onValueChange={setPickedItemId}
                disabled={!brandId || loadingMenu}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder={loadingMenu ? 'Loading…' : 'Select item…'} />
                </SelectTrigger>
                <SelectContent>
                  {menuItems.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-zinc-500">
                      {loadingMenu ? 'Loading menu…' : 'No menu items for this brand.'}
                    </div>
                  ) : (
                    menuItems.map((item) => (
                      <SelectItem
                        key={item.id}
                        value={item.id}
                        disabled={item.availability !== 'AVAILABLE'}
                      >
                        {item.name} — ₱{Number(item.price).toFixed(2)}
                        {AVAIL_SUFFIX[item.availability] ?? ''}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <Input
                type="number"
                min="1"
                step="1"
                value={pickedQty}
                onChange={(e) => setPickedQty(e.target.value)}
                className="w-16 shrink-0"
                aria-label="Quantity"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={addLine}
                disabled={!pickedItemId}
                aria-label="Add item to order"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Line items */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Order Items</label>
            {lines.length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 rounded-md border border-dashed border-border py-6 text-center">
                <ShoppingCart className="h-4 w-4 text-zinc-600" aria-hidden />
                <p className="text-xs text-zinc-600">No items added yet.</p>
              </div>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {lines.map((l) => (
                  <li
                    key={l.menuItemId}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate text-zinc-200">
                      {l.qty}× {l.name}
                    </span>
                    <span className="shrink-0 tabular-nums text-zinc-400">
                      ₱{(l.price * l.qty).toFixed(2)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeLine(l.menuItemId)}
                      className="shrink-0 rounded text-zinc-500 transition-colors duration-200 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                      aria-label={`Remove ${l.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Total */}
          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-sm font-medium text-zinc-400">Order Total</span>
            <span className="text-lg font-bold tabular-nums text-zinc-50">₱{total.toFixed(2)}</span>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={submitting || !brandId || lines.length === 0}
              className="bg-emerald-600 text-white hover:bg-emerald-500"
            >
              {submitting ? 'Placing…' : 'Place Order'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
