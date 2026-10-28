/**
 * POS — tap-to-order screen for every order the kitchen keys in by hand.
 *
 * Until the GrabFood/foodpanda APIs are live, staff read each order off the
 * aggregator tablet and enter it here; walk-in/counter orders use the same screen.
 * It replaces the form-style Log Order / Walk-in dialogs with photo tiles: pick a
 * brand, pick the channel, tap items, send to kitchen.
 *
 * Every order POSTs to the same `/ingest/order` endpoint aggregator webhooks use, so
 * it flows through the identical pipeline (board, KDS, KOT, stock at PREPARING).
 *
 * Idempotency (business-rules #5, key = (aggregator, external_ref)):
 *  - aggregator orders use the device order number, so re-entering the same tablet
 *    order replays it instead of duplicating;
 *  - walk-ins get a reference generated ONCE per order (when the cart starts) and
 *    reused on retries, so a retry after a slow response cannot create a second order.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Minus, Plus, Search, ShoppingBag, StickyNote, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { CKApiError, get, post } from '../lib/api'
import type { StockShortfall } from '../lib/socket'
import { useOutlet } from '../context/OutletContext'
import { outletScopedPath } from '../lib/outletScope'
import { useAuth } from '../auth/AuthContext'
import { hasRole } from '../auth/access'
import { useSubmitGuard } from '../hooks/useSubmitGuard'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../components/ui/sheet'
import { useInPageTitle } from '../components/layout/PageHeaderContext'

// ─── Types ────────────────────────────────────────────────────────────────

interface Brand {
  id: string
  name: string
  color: string
  isActive: boolean
}

type Aggregator = 'FOODPANDA' | 'GRABFOOD' | 'OTHER'
type Availability = 'AVAILABLE' | 'PAUSED' | 'SOLD_OUT'

interface Account {
  id: string
  aggregator: Aggregator
  externalMerchantId?: string
  external_merchant_id?: string
  isActive?: boolean
  is_active?: boolean
}

interface MenuItem {
  id: string
  name: string
  price: string
  availability: Availability
  imageUrl?: string | null
  category?: string | null
  itemNo?: string | null
}

interface CartLine {
  key: string // menuItemId + notes: same item with different notes is a separate KOT line
  menuItemId: string
  name: string
  price: number
  qty: number
  notes: string
}

interface IngestOrderResponse {
  order_id: string
  order_code?: string
  code?: string
  stock_risk?: StockShortfall[]
}

/** Channel choice: a listing id for aggregator orders, or the walk-in sentinel. */
const WALK_IN = 'walk-in'

const CHANNEL_LABEL: Record<Aggregator, string> = { GRABFOOD: 'GrabFood', FOODPANDA: 'foodpanda', OTHER: 'Walk-in' }

const php = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })

// Per-browser convenience: the tablet a cook works from rarely changes between orders.
const LAST_BRAND_KEY = 'orion.pos.lastBrand'
const LAST_AGGREGATOR_KEY = 'orion.logOrder.lastAggregator'
function readPref(key: string): string | null {
  try { return window.localStorage.getItem(key) } catch { return null }
}
function writePref(key: string, value: string) {
  try { window.localStorage.setItem(key, value) } catch { /* storage unavailable */ }
}

function newWalkInRef(): string {
  const rand = crypto.getRandomValues(new Uint32Array(2))
  return `WALKIN-${Date.now().toString(36)}-${rand[0].toString(36)}${rand[1].toString(36)}`.toUpperCase()
}

/** HH:MM on the device -> ISO for today; a time ahead of now belongs to yesterday. */
function deviceTimeToIso(hhmm: string, now: Date = new Date()): string | undefined {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm)
  if (!m) return undefined
  const placed = new Date(now)
  placed.setHours(Number(m[1]), Number(m[2]), 0, 0)
  if (placed.getTime() - now.getTime() > 60_000) placed.setDate(placed.getDate() - 1)
  return placed.toISOString()
}

/** First + last word initials: "Sweet And Sour Chicken" -> "SC", so look-alike names still differ. */
function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const first = words[0]![0]!
  const last = words.length > 1 ? words[words.length - 1]![0]! : (words[0]![1] ?? '')
  return (first + last).toUpperCase()
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default function Pos() {
  useInPageTitle()
  const { selectedOutletId } = useOutlet()
  const { user } = useAuth()
  // Same rule as the old dialogs: only managers may push a walk-in past a stock shortfall.
  const canOversell = hasRole(user?.role, ['OUTLET_MANAGER', 'BRAND_MANAGER'])

  const [brandId, setBrandId] = useState<string>('')
  const [channel, setChannel] = useState<string>('')
  const [category, setCategory] = useState<string>('All')
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [deviceNo, setDeviceNo] = useState('')
  const [deviceTime, setDeviceTime] = useState('')
  const [customer, setCustomer] = useState('')
  const [walkInRef, setWalkInRef] = useState(newWalkInRef)
  const [noteFor, setNoteFor] = useState<string | null>(null)
  const [shortfalls, setShortfalls] = useState<StockShortfall[] | null>(null)
  const [cartOpen, setCartOpen] = useState(false) // phone/tablet bottom sheet
  // At xl the cart is the right-hand column and the sheet's content is hidden; an open sheet
  // there would still draw its overlay and block the whole page.
  const cartInColumn = useMediaQuery('(min-width: 1280px)')
  const { pending, guard } = useSubmitGuard()
  const deviceInputRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()

  const brandsQuery = useQuery({
    queryKey: ['brands', selectedOutletId],
    queryFn: async () => (await get<Brand[]>(outletScopedPath('/brands', selectedOutletId))).data,
  })
  const brands = useMemo(() => (brandsQuery.data ?? []).filter((b) => b.isActive), [brandsQuery.data])

  // Restore the last brand, else the first; fall back if the remembered one is gone.
  useEffect(() => {
    if (brands.length === 0 || brands.some((b) => b.id === brandId)) return
    const remembered = readPref(LAST_BRAND_KEY)
    setBrandId(brands.find((b) => b.id === remembered)?.id ?? brands[0]!.id)
  }, [brands, brandId])

  const accountsQuery = useQuery({
    queryKey: ['brand-accounts', brandId],
    queryFn: async () => (await get<Account[]>(`/brands/${brandId}/accounts`)).data,
    enabled: !!brandId,
  })
  const listings = useMemo(
    () => (accountsQuery.data ?? []).filter((a) => a.aggregator !== 'OTHER' && (a.isActive ?? a.is_active ?? true)),
    [accountsQuery.data],
  )

  // Default channel: the aggregator last used, else the brand's first listing, else walk-in.
  useEffect(() => {
    if (!brandId || accountsQuery.isLoading) return
    if (channel === WALK_IN || listings.some((l) => l.id === channel)) return
    const last = readPref(LAST_AGGREGATOR_KEY)
    setChannel((listings.find((l) => l.aggregator === last) ?? listings[0])?.id ?? WALK_IN)
  }, [brandId, accountsQuery.isLoading, listings, channel])

  const menuQuery = useQuery({
    queryKey: ['menu', selectedOutletId, brandId],
    queryFn: async () => (await get<MenuItem[]>(`/brands/${brandId}/menu`)).data,
    enabled: !!brandId,
  })
  const menu = useMemo(
    () => [...(menuQuery.data ?? [])].sort((a, b) => (a.itemNo ?? a.name).localeCompare(b.itemNo ?? b.name)),
    [menuQuery.data],
  )
  const categories = useMemo(() => {
    const seen: string[] = []
    for (const m of menu) if (m.category && !seen.includes(m.category)) seen.push(m.category)
    return seen
  }, [menu])

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    return menu.filter(
      (m) => (category === 'All' || m.category === category) && (!q || m.name.toLowerCase().includes(q)),
    )
  }, [menu, category, search])

  const brand = brands.find((b) => b.id === brandId)
  const listing = listings.find((l) => l.id === channel)
  const isWalkIn = channel === WALK_IN
  const qtyByItem = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of cart) m.set(l.menuItemId, (m.get(l.menuItemId) ?? 0) + l.qty)
    return m
  }, [cart])
  const itemCount = cart.reduce((n, l) => n + l.qty, 0)
  const total = cart.reduce((sum, l) => sum + l.price * l.qty, 0)
  const missingDeviceNo = !isWalkIn && deviceNo.trim() === ''
  const canSend = !!brandId && !!channel && cart.length > 0 && !missingDeviceNo && !pending

  function selectBrand(id: string) {
    if (id === brandId) return
    if (cart.length > 0 && !window.confirm('Switching brand clears the current order. Continue?')) return
    setBrandId(id)
    writePref(LAST_BRAND_KEY, id)
    setChannel('')
    setCategory('All')
    setSearch('')
    resetOrder()
  }

  function selectChannel(value: string) {
    setChannel(value)
    setShortfalls(null)
    const agg = listings.find((l) => l.id === value)?.aggregator
    if (agg) writePref(LAST_AGGREGATOR_KEY, agg)
  }

  function addItem(item: MenuItem) {
    if (item.availability !== 'AVAILABLE') return
    setShortfalls(null)
    setCart((prev) => {
      const key = `${item.id}|`
      const existing = prev.find((l) => l.key === key)
      if (existing) return prev.map((l) => (l === existing ? { ...l, qty: l.qty + 1 } : l))
      return [...prev, { key, menuItemId: item.id, name: item.name, price: Number(item.price), qty: 1, notes: '' }]
    })
  }

  function changeQty(key: string, delta: number) {
    setShortfalls(null)
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, qty: l.qty + delta } : l)).filter((l) => l.qty > 0))
  }

  function setNotes(key: string, notes: string) {
    setCart((prev) => {
      const line = prev.find((l) => l.key === key)
      if (!line) return prev
      const newKey = `${line.menuItemId}|${notes.trim()}`
      const twin = prev.find((l) => l.key === newKey && l !== line)
      // Same item + same note => one line (KOT reads "2x ... (no onions)").
      if (twin) return prev.filter((l) => l !== line).map((l) => (l === twin ? { ...l, qty: l.qty + line.qty } : l))
      return prev.map((l) => (l === line ? { ...l, key: newKey, notes: notes.trim() } : l))
    })
  }

  function resetOrder() {
    setCart([])
    setDeviceNo('')
    setDeviceTime('')
    setCustomer('')
    setShortfalls(null)
    setNoteFor(null)
    setWalkInRef(newWalkInRef())
  }

  const sendOrder = guard(async (allowOversell: boolean) => {
    if (!canSendNow()) return
    try {
      const { data } = await post<IngestOrderResponse>('/ingest/order', {
        brand_id: brandId,
        aggregator: listing?.aggregator ?? 'OTHER',
        aggregator_account_id: listing?.id,
        external_ref: isWalkIn ? walkInRef : deviceNo.trim(),
        customer_name: customer.trim() || undefined,
        placed_at: isWalkIn ? undefined : deviceTimeToIso(deviceTime),
        items: cart.map((l) => ({ menu_item_id: l.menuItemId, qty: l.qty, notes: l.notes || undefined })),
        ...(allowOversell ? { allow_oversell: true } : {}),
      })
      const ref = data?.order_code ?? (isWalkIn ? 'walk-in' : `#${deviceNo.trim()}`)
      if (data?.code === 'DUPLICATE_ORDER') {
        toast.info('Already logged', { description: `${ref} was already sent. Nothing was duplicated.` })
      } else {
        toast.success(`Sent to kitchen · ${ref}`, { description: `${brand?.name ?? ''} · ${itemCount} item(s) · ${php.format(total)}` })
        if (data?.stock_risk?.length) {
          toast.warning('Low stock for this order', {
            description: data.stock_risk.map((s) => `${s.ingredient_name}: need ${s.required}, have ${s.available}`).join(' · '),
            duration: 10_000,
          })
        }
      }
      // The order now exists: Live Orders / KDS caches are out of date.
      void queryClient.invalidateQueries({ queryKey: ['orders-board'] })
      resetOrder()
      setCartOpen(false)
      deviceInputRef.current?.focus()
    } catch (err) {
      if (err instanceof CKApiError && err.code === 'INSUFFICIENT_STOCK') {
        setShortfalls(Array.isArray(err.details) ? (err.details as StockShortfall[]) : [])
        setCartOpen(true)
        return
      }
      toast.error(err instanceof Error ? err.message : 'Could not send the order. Nothing was saved; try again.')
    }
  })

  function canSendNow(): boolean {
    if (missingDeviceNo) {
      toast.error('Enter the order number shown on the tablet.')
      deviceInputRef.current?.focus()
      return false
    }
    return cart.length > 0 && !!brandId
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  const cartPanel = (
    <CartPanel
      brand={brand}
      isWalkIn={isWalkIn}
      listing={listing}
      cart={cart}
      total={total}
      itemCount={itemCount}
      deviceNo={deviceNo}
      setDeviceNo={setDeviceNo}
      deviceTime={deviceTime}
      setDeviceTime={setDeviceTime}
      customer={customer}
      setCustomer={setCustomer}
      deviceInputRef={deviceInputRef}
      noteFor={noteFor}
      setNoteFor={setNoteFor}
      changeQty={changeQty}
      setNotes={setNotes}
      clear={() => (cart.length === 0 || window.confirm('Clear this order?')) && resetOrder()}
      shortfalls={shortfalls}
      canOversell={canOversell}
      pending={pending}
      canSend={canSend}
      send={() => void sendOrder(false)}
      sendAnyway={() => void sendOrder(true)}
    />
  )

  return (
    // Board-style page (like Kitchen): fills the viewport instead of using PageContainer,
    // but keeps PageContainer's gutters (16px, 24px from sm) so it lines up with every page.
    <div className="flex h-[calc(100dvh-4rem)] min-h-0 w-full min-w-0 flex-col gap-3 px-4 pt-4 sm:px-6 xl:flex-row xl:pb-4">
      {/* ── Left: brand, channel, catalogue ── */}
      {/* min-w-0: without it the long brand-chip row widens this column and the whole page scrolls sideways. */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3" aria-label="Menu">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">New Order</h1>
            <p className="text-sm text-muted-foreground">Tap items to add. Aggregator orders: copy the number from the tablet.</p>
          </div>
        </div>

        {/* Brand chips */}
        {/* Phones scroll the chips sideways; wider screens wrap so every brand stays visible. */}
        <div role="tablist" aria-label="Brand" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 md:flex-wrap md:overflow-visible">
          {brandsQuery.isLoading && <span className="text-sm text-muted-foreground">Loading brands…</span>}
          {brands.map((b) => {
            const active = b.id === brandId
            return (
              <button
                key={b.id}
                role="tab"
                aria-selected={active}
                onClick={() => selectBrand(b.id)}
                className={[
                  'flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors',
                  active ? 'border-transparent bg-zinc-100 text-zinc-900' : 'border-border text-foreground hover:bg-secondary/60',
                ].join(' ')}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: b.color }} aria-hidden />
                {b.name}
              </button>
            )
          })}
        </div>

        {/* Channel chips */}
        <div role="radiogroup" aria-label="Channel" className="flex flex-wrap gap-2">
          {listings.map((l) => (
            <ChannelChip
              key={l.id}
              active={channel === l.id}
              onClick={() => selectChannel(l.id)}
              label={CHANNEL_LABEL[l.aggregator]}
              sub={l.externalMerchantId ?? l.external_merchant_id}
            />
          ))}
          <ChannelChip active={isWalkIn} onClick={() => selectChannel(WALK_IN)} label="Walk-in / Counter" />
        </div>

        {/* Category tabs + search */}
        <div className="flex flex-col gap-2 2xl:flex-row 2xl:items-center">
          <div role="tablist" aria-label="Category" className="-mx-1 flex flex-1 gap-1 overflow-x-auto px-1">
            {['All', ...categories].map((c) => (
              <button
                key={c}
                role="tab"
                aria-selected={category === c}
                onClick={() => setCategory(c)}
                className={[
                  'min-h-10 shrink-0 rounded-md px-3 text-sm transition-colors',
                  category === c ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                ].join(' ')}
              >
                {c}
              </button>
            ))}
          </div>
          <label className="relative 2xl:w-56">
            <span className="sr-only">Search items</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items" className="h-10 pl-8" />
          </label>
        </div>

        {/* Item tiles */}
        <div className="min-h-0 flex-1 overflow-y-auto pb-24 xl:pb-2">
          {menuQuery.isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Loading menu…</p>
          ) : menu.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-14 text-center">
              <p className="font-medium text-foreground">{brand ? `${brand.name} has no menu items yet` : 'No brand selected'}</p>
              <p className="mt-1 text-sm text-muted-foreground">A manager can add items under Catalog → Menu.</p>
            </div>
          ) : visibleItems.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No items match “{search}”.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {visibleItems.map((item) => (
                <li key={item.id}>
                  <ItemTile item={item} color={brand?.color ?? '#3F3F46'} qty={qtyByItem.get(item.id) ?? 0} onAdd={() => addItem(item)} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ── Right: cart (wide screens). Below 1280px (kitchen tablets) the menu gets the full
          width and the cart lives in the bottom bar + sheet instead. ── */}
      <aside className="hidden w-[380px] shrink-0 xl:flex" aria-label="Current order">
        <CartPanelSlot>{cartPanel}</CartPanelSlot>
      </aside>

      {/* ── Bottom bar + sheet (phone/tablet) ── */}
      {/* lg:left-64 = AppShell's sidebar width, so the bar never covers the sidebar footer. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 p-3 backdrop-blur lg:left-64 xl:hidden">
        <Button className="h-12 w-full justify-between text-base" onClick={() => setCartOpen(true)} disabled={cart.length === 0}>
          <span className="flex items-center gap-2"><ShoppingBag className="h-5 w-5" /> {itemCount} item(s)</span>
          <span className="tabular-nums">{php.format(total)}</span>
        </Button>
      </div>
      <Sheet open={cartOpen && !cartInColumn} onOpenChange={setCartOpen}>
        <SheetContent side="bottom" className="flex h-[88dvh] flex-col p-0 xl:hidden">
          <SheetHeader className="sr-only"><SheetTitle>Current order</SheetTitle></SheetHeader>
          <CartPanelSlot inSheet>{cartPanel}</CartPanelSlot>
        </SheetContent>
      </Sheet>
    </div>
  )
}

// ─── Pieces ───────────────────────────────────────────────────────────────

/**
 * Hosts the cart in either the desktop column or the phone/tablet sheet. In the sheet it
 * fills the height and reserves the top-right corner for the sheet's own close button.
 */
function CartPanelSlot({ inSheet = false, children }: { inSheet?: boolean; children: React.ReactNode }) {
  return <div className={['flex min-h-0 w-full flex-1 flex-col', inSheet ? 'pt-10' : ''].join(' ')}>{children}</div>
}

function ChannelChip({ active, onClick, label, sub }: { active: boolean; onClick: () => void; label: string; sub?: string }) {
  return (
    <button
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={[
        'flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm transition-colors',
        active ? 'border-emerald-500 bg-emerald-500/10 text-ink-accent' : 'border-border text-foreground hover:bg-secondary/60',
      ].join(' ')}
    >
      <span className="font-medium">{label}</span>
      {sub && <span className="font-mono text-xs text-muted-foreground">{sub}</span>}
    </button>
  )
}

function ItemTile({ item, color, qty, onAdd }: { item: MenuItem; color: string; qty: number; onAdd: () => void }) {
  const available = item.availability === 'AVAILABLE'
  const price = php.format(Number(item.price))
  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={!available}
      aria-label={available ? `Add ${item.name}, ${price}${qty ? `, ${qty} in order` : ''}` : `${item.name}, unavailable`}
      className={[
        'group relative flex w-full flex-col overflow-hidden rounded-xl border text-left transition',
        available ? 'border-border hover:border-zinc-500 active:scale-[0.98]' : 'cursor-not-allowed border-border opacity-45',
        qty > 0 ? 'ring-2 ring-emerald-500' : '',
      ].join(' ')}
    >
      {/* Photo tiles keep a 4:3 frame; placeholder tiles are shorter so more items fit on a tablet. */}
      <div
        className={['relative w-full overflow-hidden', item.imageUrl ? 'aspect-[4/3]' : 'aspect-[5/2]'].join(' ')}
        style={{ backgroundColor: `${color}26` }}
      >
        {item.imageUrl ? (
          <img src={item.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-2xl font-semibold tracking-wide" style={{ color }}>
            {initials(item.name)}
          </span>
        )}
        {qty > 0 && (
          <span className="absolute right-2 top-2 flex h-7 min-w-7 items-center justify-center rounded-full bg-emerald-500 px-2 text-sm font-bold text-white tabular-nums">
            {qty}
          </span>
        )}
        {!available && (
          <span className="absolute inset-x-0 bottom-0 bg-black/70 py-1 text-center text-xs font-semibold uppercase tracking-wide text-white">
            {item.availability === 'SOLD_OUT' ? 'Sold out' : 'Paused'}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-2.5">
        <span className="line-clamp-2 text-sm font-medium leading-snug text-foreground">{item.name}</span>
        <span className="mt-auto text-sm tabular-nums text-muted-foreground">{price}</span>
      </div>
    </button>
  )
}

interface CartPanelProps {
  brand?: Brand
  isWalkIn: boolean
  listing?: Account
  cart: CartLine[]
  total: number
  itemCount: number
  deviceNo: string
  setDeviceNo: (v: string) => void
  deviceTime: string
  setDeviceTime: (v: string) => void
  customer: string
  setCustomer: (v: string) => void
  deviceInputRef: React.RefObject<HTMLInputElement>
  noteFor: string | null
  setNoteFor: (k: string | null) => void
  changeQty: (key: string, delta: number) => void
  setNotes: (key: string, notes: string) => void
  clear: () => void
  shortfalls: StockShortfall[] | null
  canOversell: boolean
  pending: boolean
  canSend: boolean
  send: () => void
  sendAnyway: () => void
}

function CartPanel(p: CartPanelProps) {
  const channelLabel = p.isWalkIn ? 'Walk-in / Counter' : p.listing ? CHANNEL_LABEL[p.listing.aggregator] : '—'
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-foreground">{p.brand?.name ?? 'No brand'}</p>
          <p className="text-xs text-muted-foreground">{channelLabel}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={p.clear} disabled={p.cart.length === 0 || p.pending}>
          <Trash2 className="h-4 w-4" /> Clear
        </Button>
      </div>

      {/* Order details */}
      <div className="space-y-3 border-b border-border px-4 py-3">
        {!p.isWalkIn && (
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Order # on tablet <span className="text-danger-text">*</span></span>
              <Input
                ref={p.deviceInputRef}
                value={p.deviceNo}
                onChange={(e) => p.setDeviceNo(e.target.value)}
                placeholder="e.g. GF-0412-7781"
                autoComplete="off"
                className="h-11 font-mono"
                aria-required
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Time on tablet</span>
              <Input type="time" value={p.deviceTime} onChange={(e) => p.setDeviceTime(e.target.value)} className="h-11 w-28" />
            </label>
          </div>
        )}
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Customer name (optional)</span>
          <Input value={p.customer} onChange={(e) => p.setCustomer(e.target.value)} className="h-10" />
        </label>
      </div>

      {/* Lines */}
      <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto" aria-label="Items in order">
        {p.cart.length === 0 && <li className="px-4 py-10 text-center text-sm text-muted-foreground">Tap an item to add it.</li>}
        {p.cart.map((l) => (
          <li key={l.key} className="px-4 py-2.5">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{l.name}</p>
                <p className="text-xs tabular-nums text-muted-foreground">{php.format(l.price)} each</p>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => p.changeQty(l.key, -1)} aria-label={`One less ${l.name}`}>
                  <Minus className="h-4 w-4" />
                </Button>
                <span className="w-7 text-center font-semibold tabular-nums">{l.qty}</span>
                <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => p.changeQty(l.key, 1)} aria-label={`One more ${l.name}`}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {p.noteFor === l.key ? (
              <NoteEditor initial={l.notes} onSave={(n) => { p.setNotes(l.key, n); p.setNoteFor(null) }} onCancel={() => p.setNoteFor(null)} />
            ) : (
              <button onClick={() => p.setNoteFor(l.key)} className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <StickyNote className="h-3.5 w-3.5" /> {l.notes ? <span className="italic text-warn-text">{l.notes}</span> : 'Add note'}
              </button>
            )}
          </li>
        ))}
      </ul>

      {/* Shortfall (walk-in only) */}
      {p.shortfalls && (
        <div className="mx-4 mb-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="alert">
          <p className="flex items-center gap-1.5 font-medium text-warn-text"><AlertTriangle className="h-4 w-4" /> Not enough stock</p>
          <ul className="mt-1 space-y-0.5 text-foreground">
            {p.shortfalls.map((s) => (
              <li key={s.ingredient_id ?? s.ingredient_name}>{s.ingredient_name}: need {s.required}, have {s.available}</li>
            ))}
          </ul>
          {p.canOversell ? (
            <Button size="sm" variant="outline" className="mt-2" onClick={p.sendAnyway} disabled={p.pending}>Send anyway</Button>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">Ask a manager to approve, or remove items.</p>
          )}
        </div>
      )}

      {/* Total + send */}
      <div className="border-t border-border p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">{p.itemCount} item(s)</span>
          <span className="text-2xl font-semibold tabular-nums text-foreground">{php.format(p.total)}</span>
        </div>
        <Button className="h-12 w-full text-base" onClick={p.send} disabled={!p.canSend} aria-busy={p.pending}>
          {p.pending ? 'Sending…' : 'Send to kitchen'}
        </Button>
      </div>
    </div>
  )
}

function NoteEditor({ initial, onSave, onCancel }: { initial: string; onSave: (n: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial)
  return (
    <div className="mt-1.5 flex gap-1.5">
      <Input
        autoFocus
        value={value}
        maxLength={140}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSave(value); if (e.key === 'Escape') onCancel() }}
        placeholder="e.g. no onions, extra spicy"
        className="h-9 text-sm"
        aria-label="Note for this item"
      />
      <Button size="sm" className="h-9" onClick={() => onSave(value)}>Save</Button>
      <Button size="icon" variant="ghost" className="h-9 w-9" onClick={onCancel} aria-label="Cancel note"><X className="h-4 w-4" /></Button>
    </div>
  )
}
