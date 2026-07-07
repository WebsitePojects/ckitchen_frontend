/**
 * Menu & Availability — Module 3
 *
 * Implements:
 *   FR-MN-01  Per-brand menu list with availability status
 *   FR-MN-02  Availability cycle: AVAILABLE → PAUSED → SOLD_OUT (PATCH + optimistic)
 *   FR-MN-03  Add new menu item dialog (SUPER_ADMIN | BRAND_MANAGER)
 *   FR-MN-04  Channel visibility toggles (local-only; backend has no per-channel field)
 *   FR-MN-05  Stock alerts side panel (low-threshold inventory items)
 *
 * RBAC: Writes (availability PATCH, add item) = OWNER (+ legacy SUPER_ADMIN) | BRAND_MANAGER.
 * Channel visibility (foodpanda / GrabFood / Direct) is presentational — local state only.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  MoreVertical,
  Pencil,
  PauseCircle,
  Plus,
  UtensilsCrossed,
  XCircle,
} from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { toast } from 'sonner'
import { get, patch, post } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { useOutlet } from '../context/OutletContext'
import { hasRole } from '../auth/access'
import { cn } from '../lib/utils'
import { Button } from '../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu'
import { Input } from '../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import { Switch } from '../components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import PageHeader from '../components/common/PageHeader'
import KpiCard from '../components/common/KpiCard'
import KpiRibbon from '../components/common/KpiRibbon'
import DataTable from '../components/common/DataTable'
import EmptyState from '../components/common/EmptyState'

// ─── Types ────────────────────────────────────────────────────────────────────

type Availability = 'AVAILABLE' | 'PAUSED' | 'SOLD_OUT'

interface Brand {
  id: string
  name: string
  color: string
}

interface MenuItem {
  id: string
  brandId: string
  name: string
  price: string
  prepTimeMin: number
  stationId: string
  availability: Availability
  // MOTM 2026-07-01
  itemNo?: string | null
  remarks?: string | null
  imageUrl?: string | null
  // Local-only channel visibility (not persisted to backend)
  _channels?: { foodpanda: boolean; grabfood: boolean; direct: boolean }
}

/** Inserts Cloudinary transforms into a delivery URL for a small, fast thumbnail. */
function thumb(url: string): string {
  return url.replace('/upload/', '/upload/w_80,h_80,c_fill,f_auto,q_auto/')
}

interface Station {
  id: string
  name: string
  locationId: string
  defaultPrinterId: string | null
}

/**
 * GET /inventory?warehouse=KITCHEN row shape — matches Inventory.tsx's
 * `StockLine` (ckitchen_backend src/modules/inventory/routes.ts nests
 * ingredient fields under `ingredient`, not flat `name`/`qty`/`threshold`
 * as this interface previously assumed). Same shape/query key as
 * Inventory.tsx's KITCHEN tier so the two pages share one cache entry.
 */
interface StockLine {
  id: string
  ingredientId: string
  quantity: string
  ingredient: { id: string; name: string; unit: string; unitCost: string; lowStockThreshold: string }
  below_threshold: boolean
}

// ─── Availability cycle helpers ───────────────────────────────────────────────

const AVAIL_CYCLE: Record<Availability, Availability> = {
  AVAILABLE: 'PAUSED',
  PAUSED: 'SOLD_OUT',
  SOLD_OUT: 'AVAILABLE',
}

const AVAIL_LABEL: Record<Availability, string> = {
  AVAILABLE: 'Available',
  PAUSED: 'Paused',
  SOLD_OUT: 'Sold Out',
}

function availBadgeClass(av: Availability): string {
  switch (av) {
    case 'AVAILABLE':
      return 'bg-emerald-500/15 text-emerald-400 ring-1 ring-inset ring-emerald-500/30 hover:bg-emerald-500/25'
    case 'PAUSED':
      return 'bg-amber-500/15 text-amber-400 ring-1 ring-inset ring-amber-500/30 hover:bg-amber-500/25'
    case 'SOLD_OUT':
      return 'bg-red-500/15 text-red-400 ring-1 ring-inset ring-red-500/30 hover:bg-red-500/25'
  }
}

// ─── Channel visibility (presentational) ─────────────────────────────────────

const DEFAULT_CHANNELS = { foodpanda: true, grabfood: true, direct: true }

// ─── Menu page ────────────────────────────────────────────────────────────────

export default function Menu() {
  const { user } = useAuth()
  const canWrite = hasRole(user?.role, ['BRAND_MANAGER'])
  const { selectedOutletId } = useOutlet()
  const queryClient = useQueryClient()

  // Data state (brand selector)
  const [selectedBrandId, setSelectedBrandId] = useState<string>('')

  // ── Cache-first reads (perf) ────────────────────────────────────────────
  // Same query keys as Brands.tsx / Inventory.tsx so navigating between
  // those pages and Menu reuses one cache entry instead of refetching.
  const {
    data: brands = [],
    isLoading: loadingBrands,
    error: brandsQueryError,
  } = useQuery({
    queryKey: ['brands', selectedOutletId],
    queryFn: async () => (await get<Brand[]>('/brands')).data,
  })
  const errorBrands = brandsQueryError
    ? brandsQueryError instanceof Error ? brandsQueryError.message : 'Failed to load brands.'
    : null

  const { data: stations = [] } = useQuery({
    queryKey: ['stations', selectedOutletId],
    queryFn: async () => (await get<Station[]>('/stations')).data,
  })

  const { data: kitchenStock = [] } = useQuery({
    queryKey: ['inventory', 'KITCHEN', selectedOutletId],
    queryFn: async () => (await get<StockLine[]>('/inventory?warehouse=KITCHEN')).data,
  })
  const lowStockItems = useMemo(() => kitchenStock.filter(i => i.below_threshold), [kitchenStock])

  // Default to the first brand once the brand list loads.
  useEffect(() => {
    if (!selectedBrandId && brands.length > 0) {
      setSelectedBrandId(brands[0].id)
    }
  }, [brands, selectedBrandId])

  const menuQueryKey = useMemo(
    () => ['menu', selectedOutletId, selectedBrandId] as const,
    [selectedOutletId, selectedBrandId],
  )

  const {
    data: menuItems = [],
    isLoading: loadingMenu,
    error: menuQueryError,
  } = useQuery({
    queryKey: menuQueryKey,
    queryFn: async () => {
      const res = await get<MenuItem[]>(`/brands/${selectedBrandId}/menu`)
      // Attach default channel visibility (local only, not persisted)
      return (res.data ?? []).map(item => ({ ...item, _channels: { ...DEFAULT_CHANNELS } }))
    },
    enabled: !!selectedBrandId,
  })
  const errorMenu = menuQueryError
    ? menuQueryError instanceof Error ? menuQueryError.message : 'Failed to load menu.'
    : null

  /** Imperative cache update for optimistic add/toggle/cycle — mirrors the
   *  old `setMenuItems(prev => ...)` local-state pattern, but writes through
   *  the query cache so the change survives a re-navigation. */
  const setMenuItems = useCallback(
    (updater: (prev: MenuItem[]) => MenuItem[]) => {
      queryClient.setQueryData<MenuItem[]>(menuQueryKey, prev => updater(prev ?? []))
    },
    [queryClient, menuQueryKey],
  )

  // Add item dialog state
  const [addOpen, setAddOpen] = useState(false)
  const [addName, setAddName] = useState('')
  const [addPrice, setAddPrice] = useState('')
  const [addPrep, setAddPrep] = useState('')
  const [addStation, setAddStation] = useState('')
  const [addAvailability, setAddAvailability] = useState<Availability>('AVAILABLE')
  const [addSubmitting, setAddSubmitting] = useState(false)
  // MOTM 2026-07-01: item number, remarks, photo
  const [addItemNo, setAddItemNo] = useState('')
  const [addRemarks, setAddRemarks] = useState('')
  const [addImageUrl, setAddImageUrl] = useState('')
  const [addUploading, setAddUploading] = useState(false)

  // Edit item dialog state — parallel to the Add form above, pre-filled from
  // the row being edited. `editOriginal` is kept alongside the editable
  // fields so the submit handler can PATCH only what actually changed.
  const [editOpen, setEditOpen] = useState(false)
  const [editOriginal, setEditOriginal] = useState<MenuItem | null>(null)
  const [editName, setEditName] = useState('')
  const [editPrice, setEditPrice] = useState('')
  const [editPrep, setEditPrep] = useState('')
  const [editStation, setEditStation] = useState('')
  const [editAvailability, setEditAvailability] = useState<Availability>('AVAILABLE')
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [editItemNo, setEditItemNo] = useState('')
  const [editRemarks, setEditRemarks] = useState('')
  const [editImageUrl, setEditImageUrl] = useState('')
  const [editUploading, setEditUploading] = useState(false)

  // Station lookup map
  const stationMap = useMemo(
    () => new Map(stations.map((s) => [s.id, s.name])),
    [stations],
  )

  // ── KPI counts ────────────────────────────────────────────────────────────
  const kpi = useMemo(
    () => ({
      total: menuItems.length,
      available: menuItems.filter((i) => i.availability === 'AVAILABLE').length,
      paused: menuItems.filter((i) => i.availability === 'PAUSED').length,
      soldOut: menuItems.filter((i) => i.availability === 'SOLD_OUT').length,
    }),
    [menuItems],
  )

  // ── Availability toggle (optimistic + PATCH) ──────────────────────────────
  const cycleAvailability = useCallback(
    async (item: MenuItem) => {
      if (!canWrite) {
        toast.error('Permission denied', { description: 'You need BRAND_MANAGER or SUPER_ADMIN role.' })
        return
      }
      const next = AVAIL_CYCLE[item.availability]

      // Optimistic update
      setMenuItems((prev) =>
        prev.map((m) => (m.id === item.id ? { ...m, availability: next } : m)),
      )

      try {
        await patch(`/menu/${item.id}`, { availability: next })
        toast.success(`"${item.name}" marked as ${AVAIL_LABEL[next]}`)
      } catch (e) {
        // Rollback on error
        setMenuItems((prev) =>
          prev.map((m) => (m.id === item.id ? { ...m, availability: item.availability } : m)),
        )
        const msg = e instanceof Error ? e.message : 'Failed to update availability.'
        toast.error('Update failed', { description: msg })
      }
    },
    [canWrite],
  )

  // ── Channel toggle (local only) ───────────────────────────────────────────
  const toggleChannel = useCallback(
    (itemId: string, channel: keyof typeof DEFAULT_CHANNELS) => {
      setMenuItems((prev) =>
        prev.map((m) =>
          m.id === itemId
            ? { ...m, _channels: { ...m._channels!, [channel]: !m._channels![channel] } }
            : m,
        ),
      )
    },
    [],
  )

  // ── Add item submit ────────────────────────────────────────────────────────
  async function handleAddItem(e: FormEvent) {
    e.preventDefault()
    if (!selectedBrandId) return
    setAddSubmitting(true)

    try {
      const res = await post<MenuItem>(`/brands/${selectedBrandId}/menu`, {
        name: addName.trim(),
        price: addPrice.trim(),
        prep_time_min: Number(addPrep) || 0,
        station_id: addStation || null,
        availability: addAvailability,
        item_no: addItemNo.trim() || undefined,
        remarks: addRemarks.trim() || undefined,
        image_url: addImageUrl || undefined,
      })
      const newItem: MenuItem = { ...res.data, _channels: { ...DEFAULT_CHANNELS } }
      setMenuItems((prev) => [newItem, ...prev])
      toast.success(`"${newItem.name}" added to the menu`)
      setAddOpen(false)
      resetAddForm()
    } catch (e) {
      // Surface a duplicate product number clearly.
      const msg = e instanceof Error ? e.message : 'Failed to add item.'
      toast.error('Add failed', { description: msg })
    } finally {
      setAddSubmitting(false)
    }
  }

  /** Reads a chosen image file, uploads it to Cloudinary via the backend, stores the URL. */
  async function handlePhotoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file) return
    setAddUploading(true)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error('Could not read the file.'))
        reader.readAsDataURL(file)
      })
      const res = await post<{ url: string }>('/menu/upload-photo', { data_url: dataUrl })
      setAddImageUrl(res.data.url)
      toast.success('Photo uploaded')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed.'
      toast.error('Photo upload failed', { description: msg })
    } finally {
      setAddUploading(false)
    }
  }

  function resetAddForm() {
    setAddName('')
    setAddPrice('')
    setAddPrep('')
    setAddStation('')
    setAddAvailability('AVAILABLE')
    setAddItemNo('')
    setAddRemarks('')
    setAddImageUrl('')
  }

  // ── Edit item ──────────────────────────────────────────────────────────────

  /** Opens the Edit dialog pre-filled with the row's current values. */
  const openEditDialog = useCallback((item: MenuItem) => {
    setEditOriginal(item)
    setEditName(item.name)
    setEditPrice(item.price)
    setEditPrep(item.prepTimeMin != null ? String(item.prepTimeMin) : '')
    setEditStation(item.stationId || '')
    setEditAvailability(item.availability)
    setEditItemNo(item.itemNo ?? '')
    setEditRemarks(item.remarks ?? '')
    setEditImageUrl(item.imageUrl ?? '')
    setEditOpen(true)
  }, [])

  function resetEditForm() {
    setEditOriginal(null)
    setEditName('')
    setEditPrice('')
    setEditPrep('')
    setEditStation('')
    setEditAvailability('AVAILABLE')
    setEditItemNo('')
    setEditRemarks('')
    setEditImageUrl('')
  }

  /** Same Cloudinary upload flow as Add, targeting the Edit form's photo field. */
  async function handleEditPhotoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setEditUploading(true)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error('Could not read the file.'))
        reader.readAsDataURL(file)
      })
      const res = await post<{ url: string }>('/menu/upload-photo', { data_url: dataUrl })
      setEditImageUrl(res.data.url)
      toast.success('Photo uploaded')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed.'
      toast.error('Photo upload failed', { description: msg })
    } finally {
      setEditUploading(false)
    }
  }

  /**
   * PATCH /menu/:id with only the fields that actually changed. `station_id`
   * on the backend's update schema is `.optional()` but NOT `.nullable()` —
   * unlike item_no/remarks/image_url it can't be explicitly cleared via this
   * endpoint, so an empty/"_none" selection is simply omitted rather than
   * sent as null (which the backend would reject as a validation error).
   */
  async function handleEditItem(e: FormEvent) {
    e.preventDefault()
    if (!editOriginal) return
    setEditSubmitting(true)

    const payload: Record<string, unknown> = {}

    const trimmedName = editName.trim()
    if (trimmedName !== editOriginal.name) payload.name = trimmedName

    const trimmedPrice = editPrice.trim()
    if (trimmedPrice !== editOriginal.price) payload.price = trimmedPrice

    const prep = Number(editPrep) || 0
    if (prep !== (editOriginal.prepTimeMin ?? 0)) payload.prep_time_min = prep

    const stationVal = editStation && editStation !== '_none' ? editStation : ''
    if (stationVal && stationVal !== (editOriginal.stationId ?? '')) {
      payload.station_id = stationVal
    }

    if (editAvailability !== editOriginal.availability) payload.availability = editAvailability

    const trimmedItemNo = editItemNo.trim()
    if (trimmedItemNo !== (editOriginal.itemNo ?? '')) payload.item_no = trimmedItemNo || null

    const trimmedRemarks = editRemarks.trim()
    if (trimmedRemarks !== (editOriginal.remarks ?? '')) payload.remarks = trimmedRemarks || null

    if (editImageUrl !== (editOriginal.imageUrl ?? '')) payload.image_url = editImageUrl || null

    if (Object.keys(payload).length === 0) {
      setEditSubmitting(false)
      setEditOpen(false)
      return
    }

    try {
      const res = await patch<MenuItem>(`/menu/${editOriginal.id}`, payload)
      const updated: MenuItem = { ...res.data, _channels: editOriginal._channels ?? { ...DEFAULT_CHANNELS } }
      setMenuItems((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
      toast.success(`"${updated.name}" updated`)
      setEditOpen(false)
      resetEditForm()
    } catch (err) {
      // Surfaces the backend's descriptive 409 (duplicate product no.) or other errors as-is.
      const msg = err instanceof Error ? err.message : 'Failed to update item.'
      toast.error('Update failed', { description: msg })
    } finally {
      setEditSubmitting(false)
    }
  }

  // ── Duplicate item ─────────────────────────────────────────────────────────

  /**
   * POST /brands/{id}/menu with a copy of the row. `item_no` is intentionally
   * NOT copied — it's unique per brand, so the duplicate starts without a
   * product number until the user assigns one via Edit.
   */
  const handleDuplicate = useCallback(
    async (item: MenuItem) => {
      if (!canWrite) {
        toast.error('Permission denied', { description: 'You need BRAND_MANAGER or SUPER_ADMIN role.' })
        return
      }
      if (!selectedBrandId) return
      try {
        const res = await post<MenuItem>(`/brands/${selectedBrandId}/menu`, {
          name: `${item.name} (copy)`,
          price: item.price,
          prep_time_min: item.prepTimeMin || undefined,
          station_id: item.stationId || undefined,
          availability: item.availability,
          remarks: item.remarks ?? undefined,
          image_url: item.imageUrl ?? undefined,
        })
        const newItem: MenuItem = { ...res.data, _channels: { ...DEFAULT_CHANNELS } }
        setMenuItems((prev) => [newItem, ...prev])
        toast.success(`"${newItem.name}" duplicated`)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to duplicate item.'
        toast.error('Duplicate failed', { description: msg })
      }
    },
    [canWrite, selectedBrandId],
  )

  // ── Table columns ─────────────────────────────────────────────────────────
  const columns = useMemo<ColumnDef<MenuItem, unknown>[]>(
    () => [
      {
        id: 'photo',
        header: '',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.imageUrl ? (
            <img
              src={thumb(row.original.imageUrl)}
              alt={row.original.name}
              loading="lazy"
              className="h-9 w-9 rounded-md object-cover ring-1 ring-border"
            />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-zinc-800 text-zinc-600">
              <UtensilsCrossed className="h-4 w-4" />
            </div>
          ),
      },
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }) => (
          <div className="min-w-0">
            <span className="font-medium text-zinc-100">{row.original.name}</span>
            {row.original.remarks && (
              <span className="block truncate text-[11px] text-zinc-500" title={row.original.remarks}>
                {row.original.remarks}
              </span>
            )}
          </div>
        ),
      },
      {
        id: 'itemNo',
        header: 'Product No.',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="font-mono text-xs text-zinc-400">{row.original.itemNo ?? '—'}</span>
        ),
      },
      {
        id: 'station',
        header: 'Station',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-sm text-zinc-400">
            {stationMap.get(row.original.stationId) ?? '—'}
          </span>
        ),
      },
      {
        accessorKey: 'prepTimeMin',
        header: 'Prep (min)',
        cell: ({ row }) => (
          <span className="tabular-nums text-sm text-zinc-400">
            {row.original.prepTimeMin ?? '—'}
          </span>
        ),
      },
      {
        accessorKey: 'price',
        header: 'Price',
        cell: ({ row }) => (
          <span className="tabular-nums text-sm font-medium text-zinc-200">
            ₱{Number(row.original.price).toFixed(2)}
          </span>
        ),
      },
      {
        id: 'availability',
        header: 'Availability',
        enableSorting: false,
        cell: ({ row }) => {
          const av = row.original.availability as Availability
          return (
            <button
              type="button"
              onClick={() => void cycleAvailability(row.original)}
              title={canWrite ? `Click to cycle: currently ${AVAIL_LABEL[av]}` : AVAIL_LABEL[av]}
              className={cn(
                'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide transition-colors duration-200',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50',
                availBadgeClass(av),
                !canWrite && 'cursor-default',
              )}
            >
              {AVAIL_LABEL[av]}
            </button>
          )
        },
      },
      {
        id: 'channels',
        header: 'Channel Visibility',
        enableSorting: false,
        cell: ({ row }) => {
          const ch = row.original._channels ?? DEFAULT_CHANNELS
          return (
            <div className="flex items-center gap-3">
              <label className="flex flex-col items-center gap-0.5" title="Show this item on foodpanda">
                <Switch
                  checked={ch.foodpanda}
                  onCheckedChange={() => toggleChannel(row.original.id, 'foodpanda')}
                  className="data-[state=checked]:bg-[#E2136E]"
                />
                <span className="text-[10px] text-zinc-400">foodpanda</span>
              </label>
              <label className="flex flex-col items-center gap-0.5" title="Show this item on GrabFood">
                <Switch
                  checked={ch.grabfood}
                  onCheckedChange={() => toggleChannel(row.original.id, 'grabfood')}
                  className="data-[state=checked]:bg-[#00B14F]"
                />
                <span className="text-[10px] text-zinc-400">GrabFood</span>
              </label>
              <label
                className="flex flex-col items-center gap-0.5"
                title="Direct orders — your own ordering channel, not via an aggregator"
              >
                <Switch
                  checked={ch.direct}
                  onCheckedChange={() => toggleChannel(row.original.id, 'direct')}
                  className="data-[state=checked]:bg-emerald-600"
                />
                <span className="text-[10px] text-zinc-400">Direct</span>
              </label>
            </div>
          )
        },
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-zinc-500 hover:text-zinc-200"
                aria-label="Row actions"
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              <DropdownMenuItem
                className="gap-2 text-xs"
                disabled={!canWrite}
                onSelect={() => openEditDialog(row.original)}
              >
                <Pencil className="h-3 w-3" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2 text-xs"
                disabled={!canWrite}
                onSelect={() => void handleDuplicate(row.original)}
              >
                <Plus className="h-3 w-3" />
                Duplicate
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [stationMap, cycleAvailability, toggleChannel, canWrite, openEditDialog, handleDuplicate],
  )

  // ── Add Item Dialog ───────────────────────────────────────────────────────
  const addItemDialog = (
    <Dialog
      open={addOpen}
      onOpenChange={(open) => {
        setAddOpen(open)
        if (!open) resetAddForm()
      }}
    >
      <DialogTrigger asChild>
        <Button
          size="sm"
          disabled={!canWrite || !selectedBrandId}
          className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-500"
        >
          <Plus className="h-3.5 w-3.5" />
          Add New Item
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Menu Item</DialogTitle>
          <DialogDescription>
            Add a new item to{' '}
            <span className="font-semibold text-zinc-200">
              {brands.find((b) => b.id === selectedBrandId)?.name ?? 'the selected brand'}
            </span>
            .
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void handleAddItem(e)} className="space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Name</label>
            <Input
              required
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder="e.g. Chicken Inasal"
            />
          </div>

          {/* Price */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Price (₱)</label>
            <Input
              required
              type="number"
              min="0"
              step="0.01"
              value={addPrice}
              onChange={(e) => setAddPrice(e.target.value)}
              placeholder="e.g. 150.00"
            />
          </div>

          {/* Prep time */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Prep Time (min)</label>
            <Input
              type="number"
              min="0"
              value={addPrep}
              onChange={(e) => setAddPrep(e.target.value)}
              placeholder="e.g. 15"
            />
          </div>

          {/* Station */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Kitchen Station</label>
            <Select value={addStation} onValueChange={setAddStation}>
              <SelectTrigger>
                <SelectValue placeholder="Select station…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">— None —</SelectItem>
                {stations.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Availability */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Initial Availability</label>
            <Select
              value={addAvailability}
              onValueChange={(v) => setAddAvailability(v as Availability)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AVAILABLE">Available</SelectItem>
                <SelectItem value="PAUSED">Paused</SelectItem>
                <SelectItem value="SOLD_OUT">Sold Out</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Product number (MOTM) */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Product No. (optional)</label>
            <Input
              value={addItemNo}
              maxLength={32}
              onChange={(e) => setAddItemNo(e.target.value)}
              placeholder="e.g. SKU-001 (unique per brand)"
            />
          </div>

          {/* Remarks (MOTM) */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Remarks (optional)</label>
            <textarea
              value={addRemarks}
              maxLength={500}
              rows={2}
              onChange={(e) => setAddRemarks(e.target.value)}
              placeholder="Notes about this item…"
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            />
          </div>

          {/* Photo (MOTM) */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Photo (optional)</label>
            <div className="flex items-center gap-3">
              {addImageUrl ? (
                <img
                  src={thumb(addImageUrl)}
                  alt="menu item preview"
                  className="h-14 w-14 rounded-lg object-cover ring-1 ring-border"
                />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-zinc-800 text-zinc-600">
                  <UtensilsCrossed className="h-5 w-5" />
                </div>
              )}
              <label className="cursor-pointer rounded-lg border border-border px-3 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800/60">
                {addUploading ? 'Uploading…' : addImageUrl ? 'Replace photo' : 'Upload photo'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={addUploading}
                  onChange={(e) => void handlePhotoChange(e)}
                />
              </label>
              {addImageUrl && (
                <button
                  type="button"
                  onClick={() => setAddImageUrl('')}
                  className="rounded text-xs text-zinc-500 transition-colors duration-200 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                >
                  Remove
                </button>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAddOpen(false)}
              disabled={addSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={addSubmitting || addUploading}
              className="bg-emerald-600 text-white hover:bg-emerald-500"
            >
              {addSubmitting ? 'Adding…' : 'Add Item'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )

  // ── Edit Item Dialog ──────────────────────────────────────────────────────
  // Parallel to addItemDialog above (same field markup/order) — no
  // DialogTrigger of its own; opened imperatively via openEditDialog() from
  // the row actions dropdown, same pattern as Kitchen.tsx's cancel-reason
  // dialog.
  const editItemDialog = (
    <Dialog
      open={editOpen}
      onOpenChange={(open) => {
        setEditOpen(open)
        if (!open) resetEditForm()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Menu Item</DialogTitle>
          <DialogDescription>
            Update{' '}
            <span className="font-semibold text-zinc-200">{editOriginal?.name ?? 'this item'}</span>.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void handleEditItem(e)} className="space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Name</label>
            <Input
              required
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="e.g. Chicken Inasal"
            />
          </div>

          {/* Price */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Price (₱)</label>
            <Input
              required
              type="number"
              min="0"
              step="0.01"
              value={editPrice}
              onChange={(e) => setEditPrice(e.target.value)}
              placeholder="e.g. 150.00"
            />
          </div>

          {/* Prep time */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Prep Time (min)</label>
            <Input
              type="number"
              min="0"
              value={editPrep}
              onChange={(e) => setEditPrep(e.target.value)}
              placeholder="e.g. 15"
            />
          </div>

          {/* Station */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Kitchen Station</label>
            <Select value={editStation} onValueChange={setEditStation}>
              <SelectTrigger>
                <SelectValue placeholder="Select station…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">— None —</SelectItem>
                {stations.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Availability */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Availability</label>
            <Select
              value={editAvailability}
              onValueChange={(v) => setEditAvailability(v as Availability)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AVAILABLE">Available</SelectItem>
                <SelectItem value="PAUSED">Paused</SelectItem>
                <SelectItem value="SOLD_OUT">Sold Out</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Product number (MOTM) */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Product No. (optional)</label>
            <Input
              value={editItemNo}
              maxLength={32}
              onChange={(e) => setEditItemNo(e.target.value)}
              placeholder="e.g. SKU-001 (unique per brand)"
            />
          </div>

          {/* Remarks (MOTM) */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Remarks (optional)</label>
            <textarea
              value={editRemarks}
              maxLength={500}
              rows={2}
              onChange={(e) => setEditRemarks(e.target.value)}
              placeholder="Notes about this item…"
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            />
          </div>

          {/* Photo (MOTM) */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Photo (optional)</label>
            <div className="flex items-center gap-3">
              {editImageUrl ? (
                <img
                  src={thumb(editImageUrl)}
                  alt="menu item preview"
                  className="h-14 w-14 rounded-lg object-cover ring-1 ring-border"
                />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-zinc-800 text-zinc-600">
                  <UtensilsCrossed className="h-5 w-5" />
                </div>
              )}
              <label className="cursor-pointer rounded-lg border border-border px-3 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800/60">
                {editUploading ? 'Uploading…' : editImageUrl ? 'Replace photo' : 'Upload photo'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={editUploading}
                  onChange={(e) => void handleEditPhotoChange(e)}
                />
              </label>
              {editImageUrl && (
                <button
                  type="button"
                  onClick={() => setEditImageUrl('')}
                  className="rounded text-xs text-zinc-500 transition-colors duration-200 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                >
                  Remove
                </button>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEditOpen(false)}
              disabled={editSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={editSubmitting || editUploading}
              className="bg-emerald-600 text-white hover:bg-emerald-500"
            >
              {editSubmitting ? 'Saving…' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )

  // ── Render: brand load error ───────────────────────────────────────────────
  if (errorBrands) {
    return (
      <div className="flex min-h-full flex-col gap-6 px-4 py-6 sm:px-6">
        <PageHeader
          title="Menu & Availability"
          subtitle="Items, availability and channel visibility"
        />
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center">
          <p className="text-sm font-medium text-red-400">{errorBrands}</p>
          <p className="mt-1 text-xs text-red-500/70">
            Make sure the backend is running on :4000
          </p>
        </div>
      </div>
    )
  }

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-full flex-col gap-6 px-4 py-6 sm:px-6">

      {/* ── Page header ────────────────────────────────────────────────────── */}
      <PageHeader
        title="Menu & Availability"
        subtitle="Items, availability and channel visibility"
        actions={addItemDialog}
      />

      {/* ── Brand selector ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium text-zinc-500">Brand</span>
        <Select
          value={selectedBrandId}
          onValueChange={setSelectedBrandId}
          disabled={loadingBrands || brands.length === 0}
        >
          <SelectTrigger className="h-8 w-52 text-sm">
            <SelectValue placeholder={loadingBrands ? 'Loading…' : 'Select brand…'} />
          </SelectTrigger>
          <SelectContent>
            {brands.map((b) => (
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

      {/* ── KPI ribbon ─────────────────────────────────────────────────────── */}
      <KpiRibbon>
        <KpiCard icon={UtensilsCrossed} label="Total Items" value={kpi.total} />
        <KpiCard icon={CheckCircle2} label="Available" value={kpi.available} />
        <KpiCard icon={PauseCircle} label="Paused" value={kpi.paused} />
        <KpiCard icon={XCircle} label="Sold Out" value={kpi.soldOut} />
      </KpiRibbon>

      {/* ── Main content: table + stock alerts ─────────────────────────────── */}
      <div className="flex min-w-0 flex-col gap-4 lg:flex-row">

        {/* ── Menu table ─────────────────────────────────────────────────── */}
        <section className="flex min-w-0 flex-1 flex-col gap-3">
          {errorMenu ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
              {errorMenu}
            </div>
          ) : (
            <DataTable<MenuItem>
              columns={columns}
              data={menuItems}
              loading={loadingMenu}
              searchPlaceholder="Search items…"
              emptyTitle={selectedBrandId ? 'No items yet' : 'Select a brand above'}
              emptyDescription={
                selectedBrandId
                  ? 'Add your first menu item with the button above.'
                  : 'Choose a brand to see its menu.'
              }
              pageSize={15}
            />
          )}

          {/* Channel visibility note */}
          <p className="text-[11px] text-zinc-600">
            Channel visibility toggles (FP / GF / Direct) are presentational — stored locally only.
            Backend has no per-channel availability field.
          </p>
        </section>

        {/* ── Stock Alerts panel ──────────────────────────────────────────── */}
        <aside className="w-full shrink-0 lg:w-72">
          <Card className="border-border bg-card">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-zinc-300">
                <AlertTriangle className="h-4 w-4 text-amber-400" aria-hidden />
                Stock Alerts
                {lowStockItems.length > 0 && (
                  <span className="ml-auto rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold tabular-nums text-amber-400 ring-1 ring-inset ring-amber-500/30">
                    {lowStockItems.length}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {lowStockItems.length === 0 ? (
                <EmptyState
                  icon={AlertTriangle}
                  title="No stock alerts"
                  description="All kitchen ingredients are above threshold."
                  className="border-none bg-transparent py-6"
                />
              ) : (
                <ul className="space-y-2">
                  {lowStockItems.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5"
                    >
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-zinc-200">{item.ingredient.name}</p>
                        <p className="mt-0.5 tabular-nums text-[11px] text-zinc-500">
                          {item.quantity} {item.ingredient.unit} (threshold: {item.ingredient.lowStockThreshold} {item.ingredient.unit})
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>

      {/* Edit dialog — no DialogTrigger; opened via openEditDialog() from row actions */}
      {editItemDialog}
    </div>
  )
}
