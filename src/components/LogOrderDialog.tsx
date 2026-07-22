/**
 * LogOrderDialog — staff "Log order" manual encode (interim operations
 * workflow, 2026-07-22). Distinct from WalkInOrderDialog: that one is for
 * genuine walk-in/counter orders (always aggregator OTHER, a
 * locally-generated external_ref). This one is for staff manually encoding
 * an order that was ALREADY taken on a physical aggregator device/tablet
 * (Foodpanda, GrabFood, or a brand's Direct/Walk-in channel) — the operator
 * types in that device's own order number as the "Device order #", which
 * becomes `external_ref`. Since business-rules.md #5's idempotency key is
 * (aggregator, external_ref), this is REQUIRED and is what makes the same
 * device order un-encodable twice: a duplicate submission for the same
 * (aggregator, device order #) replays the existing order instead of
 * creating a second one (see the DUPLICATE_ORDER handling below).
 *
 * POSTs to the SAME `/ingest/order` endpoint aggregator webhooks and
 * WalkInOrderDialog use (ckitchen_backend/src/modules/orders/routes.ts) —
 * once created it appears live on Dashboard/Orders/KDS via the existing
 * socket-driven refetch; this component only fires the POST and reports
 * success/failure.
 *
 * S4 semantics (orders/routes.ts): aggregator orders (FOODPANDA/GRABFOOD)
 * are ALWAYS accepted even past stock — only an OTHER-aggregator order can
 * 409 INSUFFICIENT_STOCK, and only when `allow_oversell` wasn't sent. The
 * "Allow oversell" retry is therefore only ever reachable when the operator
 * picked "Walk-in / Other" as the channel, and is additionally gated to
 * `canOversell` (managers) by the caller (Orders.tsx) — a KITCHEN_CREW
 * operator who can log orders but not override stock sees the shortfall
 * with no retry action.
 *
 * Controlled component: the parent (Orders.tsx) owns `open` state and the
 * trigger button (incl. the role gate) — matches WalkInOrderDialog's pattern.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Minus, Plus, ShoppingCart, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { CKApiError, get, post } from '../lib/api'
import type { StockShortfall } from '../lib/socket'
import { useOutlet } from '../context/OutletContext'
import { outletScopedPath } from '../lib/outletScope'
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

/** GET /brands/:id/accounts row — a brand's Foodpanda/GrabFood channel listing. */
interface Account {
  id: string
  aggregator: 'FOODPANDA' | 'GRABFOOD' | 'OTHER'
  externalMerchantId?: string
  external_merchant_id?: string
  isActive?: boolean
  is_active?: boolean
}

interface OrderLine {
  menuItemId: string
  name: string
  price: number
  qty: number
  notes: string
}

interface LogOrderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Managers only (Orders.tsx) — gates the 409 "Allow oversell" retry. */
  canOversell: boolean
}

/** POST /ingest/order response fields this dialog cares about. */
interface IngestOrderResponse {
  order_id?: string
  order_code?: string | null
  /** Present only on an idempotent replay of an already-logged device order. */
  code?: 'DUPLICATE_ORDER'
  stock_risk?: StockShortfall[]
}

function formatShortfall(s: StockShortfall): string {
  return `${s.ingredient_name}: need ${s.required}, ${s.available} available`
}

const AVAIL_SUFFIX: Partial<Record<Availability, string>> = {
  PAUSED: ' (Paused)',
  SOLD_OUT: ' (Sold Out)',
}

const AGGREGATOR_CHANNEL_LABEL: Record<Account['aggregator'], string> = {
  FOODPANDA: 'foodpanda',
  GRABFOOD: 'GrabFood',
  OTHER: 'Other',
}

const WALKIN_CHANNEL_VALUE = '_walkin'

export default function LogOrderDialog({ open, onOpenChange, canOversell }: LogOrderDialogProps) {
  const { selectedOutletId } = useOutlet()

  const [brandId, setBrandId] = useState('')
  const [channelValue, setChannelValue] = useState<string>(WALKIN_CHANNEL_VALUE)
  const [deviceOrderNo, setDeviceOrderNo] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [lines, setLines] = useState<OrderLine[]>([])
  const [pickedItemId, setPickedItemId] = useState('')
  const [pickedQty, setPickedQty] = useState('1')
  const [pickedNotes, setPickedNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Populated on a 409 INSUFFICIENT_STOCK (walk-in/OTHER channel only — S4).
  const [shortfalls, setShortfalls] = useState<StockShortfall[] | null>(null)

  // Only fetch while the dialog is actually open.
  const {
    data: brands = [],
    isLoading: loadingBrands,
    error: brandsError,
  } = useQuery({
    queryKey: ['brands', selectedOutletId],
    queryFn: async () => (await get<Brand[]>(outletScopedPath('/brands', selectedOutletId))).data,
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
    data: accounts = [],
    isLoading: loadingAccounts,
    error: accountsError,
  } = useQuery({
    queryKey: ['brand-accounts', brandId],
    queryFn: async () => (await get<Account[]>(`/brands/${brandId}/accounts`)).data,
    enabled: open && !!brandId,
  })
  const activeAccounts = useMemo(
    () => accounts.filter((a) => a.isActive ?? a.is_active ?? true),
    [accounts],
  )

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
    setChannelValue(WALKIN_CHANNEL_VALUE)
    setDeviceOrderNo('')
    setCustomerName('')
    setLines([])
    setPickedItemId('')
    setPickedQty('1')
    setPickedNotes('')
    setShortfalls(null)
  }

  function handleOpenChange(next: boolean) {
    // In-flight guard: the dialog must not be closeable (Escape, overlay
    // click, or a second confirm) while a request is in flight.
    if (!next && submitting) return
    onOpenChange(next)
    if (!next) resetForm()
  }

  function handleBrandChange(next: string) {
    setBrandId(next)
    // Channel + line items belong to the previous brand — switching brands
    // clears both rather than leaving stale cross-brand state.
    setChannelValue(WALKIN_CHANNEL_VALUE)
    setLines([])
    setPickedItemId('')
    setShortfalls(null)
  }

  function addLine() {
    const item = menuItems.find((m) => m.id === pickedItemId)
    if (!item || item.availability !== 'AVAILABLE') return
    const qty = Math.max(1, Math.floor(Number(pickedQty)) || 1)
    const notes = pickedNotes.trim()
    setLines((prev) => {
      // A line with different notes stays a separate line (notes are
      // per-line/per-KOT-instruction, not summable like a bare qty).
      const existing = prev.find((l) => l.menuItemId === item.id && l.notes === notes)
      if (existing) {
        return prev.map((l) =>
          l === existing ? { ...l, qty: l.qty + qty } : l,
        )
      }
      return [...prev, { menuItemId: item.id, name: item.name, price: Number(item.price), qty, notes }]
    })
    setPickedItemId('')
    setPickedQty('1')
    setPickedNotes('')
    setShortfalls(null)
  }

  function adjustLineQty(index: number, delta: number) {
    setLines((prev) => {
      const next = prev
        .map((l, i) => (i === index ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0)
      return next
    })
    setShortfalls(null)
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index))
    setShortfalls(null)
  }

  async function submitOrder(allowOversell: boolean) {
    if (submitting) return
    const deviceOrderNoTrimmed = deviceOrderNo.trim()
    if (!brandId || lines.length === 0 || !deviceOrderNoTrimmed) return
    setSubmitting(true)
    try {
      const selectedAccount =
        channelValue !== WALKIN_CHANNEL_VALUE
          ? activeAccounts.find((a) => a.id === channelValue)
          : undefined
      const { data } = await post<IngestOrderResponse>('/ingest/order', {
        brand_id: brandId,
        aggregator: selectedAccount?.aggregator ?? 'OTHER',
        aggregator_account_id: selectedAccount?.id,
        external_ref: deviceOrderNoTrimmed,
        customer_name: customerName.trim() || undefined,
        items: lines.map((l) => ({
          menu_item_id: l.menuItemId,
          qty: l.qty,
          notes: l.notes || undefined,
        })),
        // Only meaningful (and only accepted server-side) for OTHER-channel
        // orders — sent whenever the operator explicitly chose to proceed
        // past a shortfall.
        ...(allowOversell ? { allow_oversell: true } : {}),
      })

      if (data?.code === 'DUPLICATE_ORDER') {
        // Idempotent replay — the same device order # was already logged.
        // Treat as success, not an error.
        toast.info('Already logged', {
          description: `Device order #${deviceOrderNoTrimmed} was already encoded — showing the existing order.`,
        })
      } else {
        toast.success('Order logged', {
          description: 'Now live on the Orders board, Dashboard, and KDS.',
        })
        const risk = data?.stock_risk
        if (Array.isArray(risk) && risk.length > 0) {
          toast.warning('Order logged with stock shortfall', {
            description: risk.map(formatShortfall).join(' · '),
            duration: 10_000,
          })
        }
      }
      handleOpenChange(false)
    } catch (err) {
      // 409 INSUFFICIENT_STOCK — only reachable for the Walk-in/Other channel
      // (S4). Surface the shortfall and, for managers only, an oversell
      // override; non-managers just see the block.
      if (err instanceof CKApiError && err.code === 'INSUFFICIENT_STOCK') {
        const details = Array.isArray(err.details) ? (err.details as StockShortfall[]) : []
        setShortfalls(details)
        return
      }
      const msg = err instanceof Error ? err.message : 'Failed to log order.'
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    void submitOrder(false)
  }

  const dataError = brandsError ?? accountsError ?? menuError
  const dataErrorMsg = dataError
    ? dataError instanceof Error ? dataError.message : 'Failed to load brand/channel/menu data.'
    : null

  const canSubmit = !!brandId && lines.length > 0 && deviceOrderNo.trim().length > 0

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Log Order</DialogTitle>
          <DialogDescription>
            Manually encode an order already taken on a physical aggregator device or tablet. It
            flows through the same kitchen pipeline as any other order — live on the board, KOT
            printed, stock deducted at Preparing.
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

          {/* Aggregator / channel */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Channel</label>
            <Select
              value={channelValue}
              onValueChange={(v) => { setChannelValue(v); setShortfalls(null) }}
              disabled={!brandId || loadingAccounts}
            >
              <SelectTrigger>
                <SelectValue placeholder={loadingAccounts ? 'Loading…' : 'Select channel…'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={WALKIN_CHANNEL_VALUE}>Walk-in / Other</SelectItem>
                {activeAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {AGGREGATOR_CHANNEL_LABEL[a.aggregator]}
                    {a.externalMerchantId || a.external_merchant_id
                      ? ` — ${a.externalMerchantId ?? a.external_merchant_id}`
                      : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Device order # — REQUIRED, becomes external_ref */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Device order #</label>
            <Input
              required
              value={deviceOrderNo}
              onChange={(e) => setDeviceOrderNo(e.target.value)}
              placeholder="Order number shown on the aggregator device/tablet"
            />
            <p className="text-[11px] text-zinc-600">
              Required — this is the idempotency anchor. Logging the same device order twice
              replays the existing order instead of creating a duplicate.
            </p>
          </div>

          {/* Customer name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Customer Name (optional)</label>
            <Input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Optional"
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
            <Input
              value={pickedNotes}
              onChange={(e) => setPickedNotes(e.target.value)}
              placeholder="Notes for this line (optional) — e.g. no onions"
              className="text-xs"
            />
          </div>

          {/* Line items — qty steppers, remove */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Order Items</label>
            {lines.length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 rounded-md border border-dashed border-border py-6 text-center">
                <ShoppingCart className="h-4 w-4 text-zinc-600" aria-hidden />
                <p className="text-xs text-zinc-600">No items added yet.</p>
              </div>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {lines.map((l, idx) => (
                  <li
                    key={`${l.menuItemId}-${idx}`}
                    className="flex items-center gap-2 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-zinc-200">{l.name}</span>
                      {l.notes && (
                        <span className="block truncate text-[10px] italic text-zinc-500">
                          {l.notes}
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => adjustLineQty(idx, -1)}
                        aria-label={`Decrease quantity for ${l.name}`}
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="w-5 text-center tabular-nums text-zinc-200">{l.qty}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => adjustLineQty(idx, 1)}
                        aria-label={`Increase quantity for ${l.name}`}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                    <span className="w-16 shrink-0 text-right tabular-nums text-zinc-400">
                      ₱{(l.price * l.qty).toFixed(2)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeLine(idx)}
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

          {/* Insufficient-stock block (409 INSUFFICIENT_STOCK, Walk-in/Other
              channel only per S4). Oversell override is manager-only. */}
          {shortfalls && shortfalls.length > 0 && (
            <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Insufficient stock for this order
              </p>
              <ul className="space-y-1">
                {shortfalls.map((s) => (
                  <li
                    key={s.ingredient_id}
                    className="flex items-center justify-between gap-2 text-xs text-amber-200/90"
                  >
                    <span className="min-w-0 flex-1 truncate">{s.ingredient_name}</span>
                    <span className="shrink-0 tabular-nums">
                      need {s.required} · {s.available} available
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-amber-400/70">
                {canOversell
                  ? 'Proceed anyway to log the order and oversell the stock, or edit the cart.'
                  : 'Ask an outlet or brand manager to log this with an oversell override, or edit the cart.'}
              </p>
            </div>
          )}

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
            {shortfalls && shortfalls.length > 0 ? (
              canOversell ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void submitOrder(true)}
                  disabled={submitting || !canSubmit}
                  className="bg-amber-600 text-white hover:bg-amber-500"
                >
                  {submitting ? 'Logging…' : 'Proceed anyway (oversell)'}
                </Button>
              ) : null
            ) : (
              <Button
                type="submit"
                size="sm"
                disabled={submitting || !canSubmit}
                className="bg-emerald-600 text-white hover:bg-emerald-500"
              >
                {submitting ? 'Logging…' : 'Log Order'}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
