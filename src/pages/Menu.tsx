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
 * RBAC: Writes (availability PATCH, add item) = SUPER_ADMIN | BRAND_MANAGER.
 * Channel visibility (foodpanda / GrabFood / Direct) is presentational — local state only.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
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

interface InventoryItem {
  id: string
  name: string
  qty: number
  unit: string
  threshold: number
  below_threshold: boolean
  warehouse: string
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
  const canWrite =
    user?.role === 'SUPER_ADMIN' || user?.role === 'BRAND_MANAGER'

  // Data state
  const [brands, setBrands] = useState<Brand[]>([])
  const [selectedBrandId, setSelectedBrandId] = useState<string>('')
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [stations, setStations] = useState<Station[]>([])
  const [lowStockItems, setLowStockItems] = useState<InventoryItem[]>([])

  // UI state
  const [loadingBrands, setLoadingBrands] = useState(true)
  const [loadingMenu, setLoadingMenu] = useState(false)
  const [errorBrands, setErrorBrands] = useState<string | null>(null)
  const [errorMenu, setErrorMenu] = useState<string | null>(null)

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

  // Station lookup map
  const stationMap = useMemo(
    () => new Map(stations.map((s) => [s.id, s.name])),
    [stations],
  )

  // ── Initial load: brands + stations + inventory alerts ─────────────────────
  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoadingBrands(true)
      setErrorBrands(null)

      try {
        const [brandsRes, stationsRes, invRes] = await Promise.all([
          get<Brand[]>('/brands'),
          get<Station[]>('/stations'),
          get<InventoryItem[]>('/inventory?warehouse=KITCHEN').catch(() => ({ data: [] as InventoryItem[] })),
        ])

        if (cancelled) return

        const loadedBrands = brandsRes.data
        setBrands(loadedBrands)
        setStations(stationsRes.data)

        // Low-stock alerts
        const below = (invRes.data ?? []).filter((i) => i.below_threshold)
        setLowStockItems(below)

        // Default to first brand
        if (loadedBrands.length > 0) {
          setSelectedBrandId(loadedBrands[0].id)
        }
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : 'Failed to load brands.'
          setErrorBrands(msg)
        }
      } finally {
        if (!cancelled) setLoadingBrands(false)
      }
    }

    void load()
    return () => { cancelled = true }
  }, [])

  // ── Load menu when brand changes ──────────────────────────────────────────
  useEffect(() => {
    if (!selectedBrandId) return

    let cancelled = false

    async function loadMenu() {
      setLoadingMenu(true)
      setErrorMenu(null)

      try {
        const res = await get<MenuItem[]>(`/brands/${selectedBrandId}/menu`)
        if (cancelled) return
        // Attach default channel visibility (local only)
        const items = (res.data ?? []).map((item) => ({
          ...item,
          _channels: { ...DEFAULT_CHANNELS },
        }))
        setMenuItems(items)
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : 'Failed to load menu.'
          setErrorMenu(msg)
        }
      } finally {
        if (!cancelled) setLoadingMenu(false)
      }
    }

    void loadMenu()
    return () => { cancelled = true }
  }, [selectedBrandId])

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
                'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide transition-colors',
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
                onSelect={() =>
                  toast.info('Edit coming soon', {
                    description: `Editing "${row.original.name}" is not yet wired to a backend endpoint.`,
                  })
                }
              >
                <Pencil className="h-3 w-3" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2 text-xs"
                onSelect={() =>
                  toast.info('Duplicate coming soon', {
                    description: 'POST /brands/{id}/menu with a copy of this item.',
                  })
                }
              >
                <Plus className="h-3 w-3" />
                Duplicate
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [stationMap, cycleAvailability, toggleChannel, canWrite],
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
                  className="text-xs text-zinc-500 hover:text-red-400"
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
                        <p className="truncate text-xs font-medium text-zinc-200">{item.name}</p>
                        <p className="mt-0.5 tabular-nums text-[11px] text-zinc-500">
                          {item.qty} {item.unit} (threshold: {item.threshold} {item.unit})
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
    </div>
  )
}
