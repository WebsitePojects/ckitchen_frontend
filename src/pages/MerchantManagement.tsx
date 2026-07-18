/**
 * Merchant Management — full brand/merchant control surface.
 *
 * One page to add/edit/remove merchants (brands), manage their items, and
 * toggle availability at three scopes: system-wide (every item, the whole
 * brand), per outlet (every item deployed at one physical outlet — may span
 * brands), and per merchant+item (the existing PATCH /menu/:id cycle, plus
 * per-outlet overrides in the Outlets tab matrix).
 *
 * Left rail = brand picker (search + active/inactive filter + Add brand).
 * Selecting a brand shows a header card (identity, active switch, brand-wide
 * availability, delete) and three tabs: Items, Outlets, Listings.
 *
 * Endpoint contract: see the NEW endpoints documented in
 * src/lib/merchant-management-api.ts. Several of those may 404 on a dev
 * environment that hasn't picked up the parallel backend wave yet — every
 * mutation here catches that (`isNotFound`) and surfaces a clear "not
 * available on this deploy yet" message instead of crashing, per the build
 * brief's "handle 404 gracefully" instruction.
 *
 * Guard coverage: every mutating control below either wraps its handler in
 * `useSubmitGuard()` (disabled + pending + early-return) or uses a
 * `useMutation().isPending` check with an explicit early-return before
 * `.mutate()` — the two patterns this codebase already uses interchangeably
 * (see OutletProfile.tsx / Menu.tsx). See the end-of-task report for the
 * per-control guard list.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Building2,
  Copy,
  ExternalLink,
  Link2 as LinkIcon,
  MoreVertical,
  Pencil,
  Plus,
  PowerOff,
  Search,
  Store,
  Trash2,
  UtensilsCrossed,
} from 'lucide-react'
import { toast } from 'sonner'
import { CKApiError, del, get, patch, post } from '../lib/api'
import {
  createAccount,
  deleteBrand,
  fetchBrandOutlets,
  fetchMenuItemOutlets,
  removeMenuItemOutlet,
  setBrandAvailability,
  setOutletMenuAvailability,
  updateAccount,
  upsertMenuItemOutlet,
  type Availability,
  type BrandOutletDeployment,
  type ListingMappingStatus,
  type MenuItemOutletDeployment,
  type MerchantAccount,
  type MerchantBrand,
  type MerchantMenuItem,
  type MerchantOutlet,
  type MerchantStation,
} from '../lib/merchant-management-api'
import { useAuth } from '../auth/AuthContext'
import { hasRole } from '../auth/access'
import { useOutlet } from '../context/OutletContext'
import { useSubmitGuard } from '../hooks/useSubmitGuard'
import { cn } from '../lib/utils'
import PageContainer from '../components/layout/PageContainer'
import PageHeader from '../components/common/PageHeader'
import EmptyState from '../components/common/EmptyState'
import { Button } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table'

// ─── Shared helpers ───────────────────────────────────────────────────────────

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
      return 'bg-emerald-500/15 text-emerald-500 dark:text-emerald-400 ring-1 ring-inset ring-emerald-500/30 hover:bg-emerald-500/25'
    case 'PAUSED':
      return 'bg-amber-500/15 text-amber-500 dark:text-amber-400 ring-1 ring-inset ring-amber-500/30 hover:bg-amber-500/25'
    case 'SOLD_OUT':
      return 'bg-red-500/15 text-red-500 dark:text-red-400 ring-1 ring-inset ring-red-500/30 hover:bg-red-500/25'
  }
}

function errMsg(e: unknown, fallback: string): string {
  if (e instanceof CKApiError) return e.message || fallback
  return e instanceof Error ? e.message : fallback
}

/** True when a failed call 404'd — the endpoint isn't live on this backend deploy yet. */
function isNotFound(e: unknown): boolean {
  return e instanceof CKApiError && e.status === 404
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MerchantManagement() {
  const { user } = useAuth()
  // Both nav-granted roles (OUTLET_MANAGER, BRAND_MANAGER) may act here; OWNER
  // passes hasRole's short-circuit. No finer per-action split is specified for
  // this page, so every mutating control shares this single gate.
  const canWrite = hasRole(user?.role, ['OUTLET_MANAGER', 'BRAND_MANAGER'])
  const { selectedOutletId } = useOutlet()
  const qc = useQueryClient()
  const [searchParams] = useSearchParams()

  // ── Left rail state ───────────────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [selectedBrandId, setSelectedBrandId] = useState<string>('')
  const [activeTab, setActiveTab] = useState<'items' | 'outlets' | 'listings'>('items')

  // ── Brand list (shares the cache key Brands.tsx / Menu.tsx already use) ───
  const brandsQuery = useQuery({
    queryKey: ['brands', selectedOutletId],
    queryFn: async () => (await get<MerchantBrand[]>('/brands')).data,
  })
  const brands = brandsQuery.data ?? []

  // Default selection: ?brand= query param (deep-link from Merchants.tsx) if
  // valid, else the first brand in the list. Only runs once brands load and
  // nothing is selected yet.
  useEffect(() => {
    if (selectedBrandId || brands.length === 0) return
    const fromParam = searchParams.get('brand')
    const match = fromParam ? brands.find((b) => b.id === fromParam) : undefined
    setSelectedBrandId(match?.id ?? brands[0].id)
  }, [brands, selectedBrandId, searchParams])

  const selectedBrand = useMemo(
    () => brands.find((b) => b.id === selectedBrandId) ?? null,
    [brands, selectedBrandId],
  )

  const filteredBrands = useMemo(() => {
    let list = brands
    if (statusFilter === 'active') list = list.filter((b) => b.isActive)
    if (statusFilter === 'inactive') list = list.filter((b) => !b.isActive)
    const q = search.trim().toLowerCase()
    if (q) list = list.filter((b) => b.name.toLowerCase().includes(q))
    return list
  }, [brands, statusFilter, search])

  // ── Brand-scoped data ─────────────────────────────────────────────────────
  const menuQueryKey = useMemo(
    () => ['menu', selectedOutletId, selectedBrandId] as const,
    [selectedOutletId, selectedBrandId],
  )
  const itemsQuery = useQuery({
    queryKey: menuQueryKey,
    queryFn: async () => (await get<MerchantMenuItem[]>(`/brands/${selectedBrandId}/menu`)).data,
    enabled: !!selectedBrandId,
  })
  const items = itemsQuery.data ?? []

  const stationsQuery = useQuery({
    queryKey: ['stations', selectedOutletId],
    queryFn: async () => (await get<MerchantStation[]>('/stations')).data,
  })
  const stations = stationsQuery.data ?? []

  // Every outlet in the platform — used only for the empty-state "deploy this
  // brand somewhere first" hint (Outlets tab). Same query key as
  // OutletProfile.tsx's allOutletsQuery so the two share one cache entry.
  const outletsQuery = useQuery({
    queryKey: ['outlets', 'summary'],
    queryFn: async () => (await get<MerchantOutlet[]>('/outlets')).data,
  })

  const brandOutletsQueryKey = useMemo(
    () => ['brands', selectedBrandId, 'outlets'] as const,
    [selectedBrandId],
  )
  const brandOutletsQuery = useQuery({
    queryKey: brandOutletsQueryKey,
    queryFn: async () => fetchBrandOutlets(selectedBrandId),
    enabled: !!selectedBrandId,
  })
  const deployedOutlets = useMemo(
    () => (brandOutletsQuery.data ?? []).filter((o) => o.isActive),
    [brandOutletsQuery.data],
  )

  const accountsQueryKey = useMemo(() => ['brand-accounts', selectedBrandId] as const, [selectedBrandId])
  const accountsQuery = useQuery({
    queryKey: accountsQueryKey,
    queryFn: async () => (await get<MerchantAccount[]>(`/brands/${selectedBrandId}/accounts`)).data,
    enabled: !!selectedBrandId,
  })

  function invalidateBrands() {
    qc.invalidateQueries({ queryKey: ['brands'] })
  }
  function invalidateItems() {
    qc.invalidateQueries({ queryKey: menuQueryKey })
  }

  // ── Add brand dialog ──────────────────────────────────────────────────────
  const addBrandGuard = useSubmitGuard()
  const [addBrandOpen, setAddBrandOpen] = useState(false)
  const [addBrandName, setAddBrandName] = useState('')
  const [addBrandColor, setAddBrandColor] = useState('#10B981')
  const [addBrandLogoUrl, setAddBrandLogoUrl] = useState('')

  const handleAddBrand = addBrandGuard.guard(async (e: FormEvent) => {
    e.preventDefault()
    const name = addBrandName.trim()
    if (!name) return
    try {
      const res = await post<MerchantBrand>('/brands', {
        name,
        color: addBrandColor || '#10B981',
        logo_url: addBrandLogoUrl.trim() || undefined,
      })
      toast.success(`"${name}" added`)
      invalidateBrands()
      setSelectedBrandId(res.data.id)
      setAddBrandOpen(false)
      setAddBrandName('')
      setAddBrandColor('#10B981')
      setAddBrandLogoUrl('')
    } catch (e) {
      toast.error('Failed to add brand', { description: errMsg(e, 'Please try again.') })
    }
  })

  // ── Edit brand dialog (header card) ──────────────────────────────────────
  const editBrandGuard = useSubmitGuard()
  const [editBrandOpen, setEditBrandOpen] = useState(false)
  const [editBrandName, setEditBrandName] = useState('')
  const [editBrandColor, setEditBrandColor] = useState('#10B981')
  const [editBrandLogoUrl, setEditBrandLogoUrl] = useState('')

  const openEditBrand = useCallback(() => {
    if (!selectedBrand) return
    setEditBrandName(selectedBrand.name)
    setEditBrandColor(selectedBrand.color || '#10B981')
    setEditBrandLogoUrl(selectedBrand.logoUrl ?? '')
    setEditBrandOpen(true)
  }, [selectedBrand])

  const handleEditBrand = editBrandGuard.guard(async (e: FormEvent) => {
    e.preventDefault()
    if (!selectedBrand) return
    const payload: Record<string, unknown> = {}
    const name = editBrandName.trim()
    if (name && name !== selectedBrand.name) payload.name = name
    if (editBrandColor && editBrandColor !== selectedBrand.color) payload.color = editBrandColor
    const logo = editBrandLogoUrl.trim()
    if (logo !== (selectedBrand.logoUrl ?? '')) payload.logo_url = logo || undefined
    if (Object.keys(payload).length === 0) {
      setEditBrandOpen(false)
      return
    }
    try {
      await patch(`/brands/${selectedBrand.id}`, payload)
      toast.success('Brand updated')
      invalidateBrands()
      setEditBrandOpen(false)
    } catch (e) {
      toast.error('Failed to update brand', { description: errMsg(e, 'Please try again.') })
    }
  })

  // ── Active / inactive switch ──────────────────────────────────────────────
  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) =>
      (await patch<MerchantBrand>(`/brands/${id}`, { is_active: isActive })).data,
    onSuccess: (_data, vars) => {
      toast.success(vars.isActive ? 'Brand activated' : 'Brand deactivated')
      invalidateBrands()
    },
    onError: (e) => toast.error('Failed to update status', { description: errMsg(e, 'Please try again.') }),
  })

  function handleToggleActive(next: boolean) {
    if (!selectedBrand || toggleActiveMutation.isPending) return
    toggleActiveMutation.mutate({ id: selectedBrand.id, isActive: next })
  }

  // ── Brand-wide bulk availability ──────────────────────────────────────────
  const [bulkAvailOpen, setBulkAvailOpen] = useState(false)
  const [bulkAvailChoice, setBulkAvailChoice] = useState<Availability>('AVAILABLE')
  const bulkAvailMutation = useMutation({
    mutationFn: async ({ brandId, availability }: { brandId: string; availability: Availability }) =>
      setBrandAvailability(brandId, availability),
    onSuccess: (res) => {
      toast.success(`Updated ${res.updated} item${res.updated === 1 ? '' : 's'} to ${AVAIL_LABEL[bulkAvailChoice]}`)
      invalidateItems()
      setBulkAvailOpen(false)
    },
    onError: (e) => {
      if (isNotFound(e)) {
        toast.error('Not available yet', {
          description: 'Brand-wide availability isn’t live on this backend deploy yet.',
        })
      } else {
        toast.error('Failed to update availability', { description: errMsg(e, 'Please try again.') })
      }
    },
  })

  function confirmBulkAvailability() {
    if (!selectedBrand || bulkAvailMutation.isPending) return
    bulkAvailMutation.mutate({ brandId: selectedBrand.id, availability: bulkAvailChoice })
  }

  // ── Delete brand ──────────────────────────────────────────────────────────
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConflict, setDeleteConflict] = useState<string | null>(null)
  const deleteBrandMutation = useMutation({
    mutationFn: async (id: string) => deleteBrand(id),
    onSuccess: () => {
      toast.success(`"${selectedBrand?.name}" deleted`)
      invalidateBrands()
      setDeleteOpen(false)
      setDeleteConflict(null)
      setSelectedBrandId('')
    },
    onError: (e) => {
      if (e instanceof CKApiError && (e.code === 'HAS_LISTINGS' || e.code === 'HAS_ORDERS')) {
        setDeleteConflict(e.message)
      } else {
        toast.error('Failed to delete brand', { description: errMsg(e, 'Please try again.') })
        setDeleteOpen(false)
      }
    },
  })

  function openDeleteDialog() {
    setDeleteConflict(null)
    setDeleteOpen(true)
  }
  function confirmDelete() {
    if (!selectedBrand || deleteBrandMutation.isPending) return
    deleteBrandMutation.mutate(selectedBrand.id)
  }
  function deactivateInsteadOfDelete() {
    if (!selectedBrand || toggleActiveMutation.isPending) return
    toggleActiveMutation.mutate({ id: selectedBrand.id, isActive: false })
    setDeleteOpen(false)
    setDeleteConflict(null)
  }

  // ── Items tab: add / edit / delete / duplicate ────────────────────────────
  const [addItemOpen, setAddItemOpen] = useState(false)
  const [addName, setAddName] = useState('')
  const [addPrice, setAddPrice] = useState('')
  const [addPrep, setAddPrep] = useState('')
  const [addStation, setAddStation] = useState('')
  const [addAvailability, setAddAvailability] = useState<Availability>('AVAILABLE')
  const [addItemNo, setAddItemNo] = useState('')
  const [addRemarks, setAddRemarks] = useState('')
  const addItemGuard = useSubmitGuard()

  function resetAddItemForm() {
    setAddName('')
    setAddPrice('')
    setAddPrep('')
    setAddStation('')
    setAddAvailability('AVAILABLE')
    setAddItemNo('')
    setAddRemarks('')
  }

  const handleAddItem = addItemGuard.guard(async (e: FormEvent) => {
    e.preventDefault()
    if (!selectedBrandId) return
    try {
      await post<MerchantMenuItem>(`/brands/${selectedBrandId}/menu`, {
        name: addName.trim(),
        price: addPrice.trim(),
        prep_time_min: Number(addPrep) || 0,
        station_id: addStation && addStation !== '_none' ? addStation : null,
        availability: addAvailability,
        item_no: addItemNo.trim() || undefined,
        remarks: addRemarks.trim() || undefined,
      })
      toast.success(`"${addName.trim()}" added to the menu`)
      invalidateItems()
      setAddItemOpen(false)
      resetAddItemForm()
    } catch (e) {
      toast.error('Add failed', { description: errMsg(e, 'Failed to add item.') })
    }
  })

  const [editItemOpen, setEditItemOpen] = useState(false)
  const [editOriginal, setEditOriginal] = useState<MerchantMenuItem | null>(null)
  const [editName, setEditName] = useState('')
  const [editPrice, setEditPrice] = useState('')
  const [editPrep, setEditPrep] = useState('')
  const [editStation, setEditStation] = useState('')
  const [editAvailability, setEditAvailability] = useState<Availability>('AVAILABLE')
  const [editItemNo, setEditItemNo] = useState('')
  const [editRemarks, setEditRemarks] = useState('')
  const editItemGuard = useSubmitGuard()

  const openEditItem = useCallback((item: MerchantMenuItem) => {
    setEditOriginal(item)
    setEditName(item.name)
    setEditPrice(item.price)
    setEditPrep(item.prepTimeMin != null ? String(item.prepTimeMin) : '')
    setEditStation(item.stationId || '')
    setEditAvailability(item.availability)
    setEditItemNo(item.itemNo ?? '')
    setEditRemarks(item.remarks ?? '')
    setEditItemOpen(true)
  }, [])

  const handleEditItem = editItemGuard.guard(async (e: FormEvent) => {
    e.preventDefault()
    if (!editOriginal) return
    const payload: Record<string, unknown> = {}
    const trimmedName = editName.trim()
    if (trimmedName && trimmedName !== editOriginal.name) payload.name = trimmedName
    const trimmedPrice = editPrice.trim()
    if (trimmedPrice && trimmedPrice !== editOriginal.price) payload.price = trimmedPrice
    const prep = Number(editPrep) || 0
    if (prep !== (editOriginal.prepTimeMin ?? 0)) payload.prep_time_min = prep
    const stationVal = editStation && editStation !== '_none' ? editStation : ''
    if (stationVal && stationVal !== (editOriginal.stationId ?? '')) payload.station_id = stationVal
    if (editAvailability !== editOriginal.availability) payload.availability = editAvailability
    const trimmedItemNo = editItemNo.trim()
    if (trimmedItemNo !== (editOriginal.itemNo ?? '')) payload.item_no = trimmedItemNo || null
    const trimmedRemarks = editRemarks.trim()
    if (trimmedRemarks !== (editOriginal.remarks ?? '')) payload.remarks = trimmedRemarks || null

    if (Object.keys(payload).length === 0) {
      setEditItemOpen(false)
      return
    }
    try {
      await patch(`/menu/${editOriginal.id}`, payload)
      toast.success(`"${trimmedName || editOriginal.name}" updated`)
      invalidateItems()
      setEditItemOpen(false)
    } catch (e) {
      toast.error('Update failed', { description: errMsg(e, 'Failed to update item.') })
    }
  })

  const [deleteItemTarget, setDeleteItemTarget] = useState<MerchantMenuItem | null>(null)
  const deleteItemGuard = useSubmitGuard()

  // Duplicate + availability-cycle use a ref-keyed guard (per-row action, not a
  // single dialog) — same pattern as Menu.tsx's duplicatingIdsRef /
  // togglingAvailabilityIds.
  const duplicatingIdsRef = useRef<Set<string>>(new Set())
  const [togglingAvailabilityIds, setTogglingAvailabilityIds] = useState<Set<string>>(new Set())

  const handleDuplicateItem = useCallback(
    async (item: MerchantMenuItem) => {
      if (!canWrite || !selectedBrandId) return
      if (duplicatingIdsRef.current.has(item.id)) return
      duplicatingIdsRef.current.add(item.id)
      try {
        await post<MerchantMenuItem>(`/brands/${selectedBrandId}/menu`, {
          name: `${item.name} (copy)`,
          price: item.price,
          prep_time_min: item.prepTimeMin || undefined,
          station_id: item.stationId || undefined,
          availability: item.availability,
          remarks: item.remarks ?? undefined,
        })
        toast.success(`"${item.name}" duplicated`)
        invalidateItems()
      } catch (e) {
        toast.error('Duplicate failed', { description: errMsg(e, 'Failed to duplicate item.') })
      } finally {
        duplicatingIdsRef.current.delete(item.id)
      }
    },
    [canWrite, selectedBrandId],
  )

  const cycleItemAvailability = useCallback(
    async (item: MerchantMenuItem) => {
      if (!canWrite) return
      let already = false
      setTogglingAvailabilityIds((prev) => {
        if (prev.has(item.id)) {
          already = true
          return prev
        }
        return new Set(prev).add(item.id)
      })
      if (already) return
      const next = AVAIL_CYCLE[item.availability]
      try {
        await patch(`/menu/${item.id}`, { availability: next })
        toast.success(`"${item.name}" marked as ${AVAIL_LABEL[next]}`)
        invalidateItems()
      } catch (e) {
        toast.error('Update failed', { description: errMsg(e, 'Failed to update availability.') })
      } finally {
        setTogglingAvailabilityIds((prev) => {
          const nextSet = new Set(prev)
          nextSet.delete(item.id)
          return nextSet
        })
      }
    },
    [canWrite],
  )

  // ── Listings tab: create / edit account ───────────────────────────────────
  const [addListingOpen, setAddListingOpen] = useState(false)
  const [addListingAggregator, setAddListingAggregator] = useState<'FOODPANDA' | 'GRABFOOD' | 'OTHER'>('FOODPANDA')
  const [addListingExternalId, setAddListingExternalId] = useState('')
  const [addListingCredentialRef, setAddListingCredentialRef] = useState('')
  const [addListingLocationId, setAddListingLocationId] = useState('')
  const addListingGuard = useSubmitGuard()

  const handleAddListing = addListingGuard.guard(async (e: FormEvent) => {
    e.preventDefault()
    if (!selectedBrandId) return
    try {
      await createAccount(selectedBrandId, {
        aggregator: addListingAggregator,
        external_merchant_id: addListingExternalId.trim(),
        credential_ref: addListingCredentialRef.trim(),
        location_id: addListingLocationId || undefined,
      })
      toast.success('Listing added')
      qc.invalidateQueries({ queryKey: accountsQueryKey })
      setAddListingOpen(false)
      setAddListingExternalId('')
      setAddListingCredentialRef('')
      setAddListingLocationId('')
    } catch (e) {
      toast.error('Failed to add listing', { description: errMsg(e, 'Please try again.') })
    }
  })

  const [editListingTarget, setEditListingTarget] = useState<MerchantAccount | null>(null)
  const [editListingExternalId, setEditListingExternalId] = useState('')
  const [editListingCommission, setEditListingCommission] = useState('')
  const [editListingStatus, setEditListingStatus] = useState<ListingMappingStatus>('MAPPING_REQUIRED')
  const [editListingLocationId, setEditListingLocationId] = useState('')
  const editListingGuard = useSubmitGuard()

  const openEditListing = useCallback((account: MerchantAccount) => {
    setEditListingTarget(account)
    setEditListingExternalId(account.externalMerchantId ?? '')
    setEditListingCommission(account.commissionRate != null ? String(account.commissionRate) : '')
    setEditListingStatus(account.mappingStatus ?? 'MAPPING_REQUIRED')
    setEditListingLocationId(account.locationId ?? '')
  }, [])

  const handleEditListing = editListingGuard.guard(async (e: FormEvent) => {
    e.preventDefault()
    if (!editListingTarget) return
    const payload: Record<string, unknown> = {}
    const externalId = editListingExternalId.trim()
    if (externalId && externalId !== editListingTarget.externalMerchantId) payload.external_merchant_id = externalId
    if (editListingCommission.trim() !== '') {
      const num = Number(editListingCommission)
      if (!Number.isNaN(num)) payload.commission_rate = num
    }
    payload.status = editListingStatus
    if (editListingLocationId && editListingLocationId !== (editListingTarget.locationId ?? '')) {
      payload.location_id = editListingLocationId
    }
    try {
      await updateAccount(editListingTarget.id, payload)
      toast.success('Listing updated')
      qc.invalidateQueries({ queryKey: accountsQueryKey })
      setEditListingTarget(null)
    } catch (e) {
      if (isNotFound(e)) {
        toast.error('Not available yet', {
          description: 'Editing listing details isn’t live on this backend deploy yet.',
        })
      } else {
        toast.error('Failed to update listing', { description: errMsg(e, 'Please try again.') })
      }
    }
  })

  // ── Real delete-item handler (defined after the placeholder above so hooks
  //     stay in a stable order; this replaces the stub declared earlier). ───
  const performDeleteItem = deleteItemGuard.guard(async () => {
    if (!deleteItemTarget) return
    try {
      await del(`/menu/${deleteItemTarget.id}`)
      toast.success(`"${deleteItemTarget.name}" deleted`)
      invalidateItems()
      setDeleteItemTarget(null)
    } catch (e) {
      if (e instanceof CKApiError && e.code === 'HAS_ORDERS') {
        toast.error('Cannot delete — item has order history', {
          description: 'Past orders reference this product. Pause it instead.',
        })
        setDeleteItemTarget(null)
      } else {
        toast.error('Delete failed', { description: errMsg(e, 'Failed to delete item.') })
      }
    }
  })

  // ── Guards (after all hooks) ───────────────────────────────────────────────
  if (brandsQuery.isError) {
    return (
      <PageContainer>
        <PageHeader title="Merchant Management" subtitle="Manage merchants, items, and availability" />
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center">
          <p className="text-sm font-medium text-red-400">{errMsg(brandsQuery.error, 'Failed to load brands.')}</p>
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Merchant Management"
        subtitle="Add, edit, and remove merchants; manage items and availability system-wide, per outlet, and per merchant"
      />

      <div className="flex min-w-0 flex-1 flex-col gap-4 lg:flex-row">
        {/* ── Left rail: brand picker ─────────────────────────────────────── */}
        <aside className="w-full shrink-0 lg:w-72">
          <Card className="border-border bg-card">
            <CardContent className="flex flex-col gap-3 p-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search brands…"
                  className="h-8 pl-8 text-sm"
                />
              </div>

              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All brands</SelectItem>
                  <SelectItem value="active">Active only</SelectItem>
                  <SelectItem value="inactive">Inactive only</SelectItem>
                </SelectContent>
              </Select>

              {canWrite && (
                <Dialog open={addBrandOpen} onOpenChange={(o) => { setAddBrandOpen(o); if (!o) { setAddBrandName(''); setAddBrandColor('#10B981'); setAddBrandLogoUrl('') } }}>
                  <DialogTrigger asChild>
                    <Button
                      size="sm"
                      data-testid="brand-add"
                      className="h-8 w-full gap-1.5 bg-emerald-600 text-white hover:bg-emerald-500"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Brand
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                      <DialogTitle>Add Brand</DialogTitle>
                      <DialogDescription>Create a new merchant / food brand.</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={(e) => void handleAddBrand(e)} className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Name</label>
                        <Input required value={addBrandName} onChange={(e) => setAddBrandName(e.target.value)} placeholder="e.g. Chicken Charlie" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Brand color</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={addBrandColor}
                            onChange={(e) => setAddBrandColor(e.target.value)}
                            className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent p-0.5"
                            aria-label="Pick brand color"
                          />
                          <Input value={addBrandColor} onChange={(e) => setAddBrandColor(e.target.value)} className="font-mono text-sm" />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Logo URL (optional)</label>
                        <Input value={addBrandLogoUrl} onChange={(e) => setAddBrandLogoUrl(e.target.value)} placeholder="https://…" />
                      </div>
                      <DialogFooter>
                        <Button type="button" variant="outline" size="sm" onClick={() => setAddBrandOpen(false)} disabled={addBrandGuard.pending}>
                          Cancel
                        </Button>
                        <Button type="submit" size="sm" disabled={addBrandGuard.pending} className="bg-emerald-600 text-white hover:bg-emerald-500">
                          {addBrandGuard.pending ? 'Adding…' : 'Add Brand'}
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              )}

              <div className="max-h-[65vh] space-y-1 overflow-y-auto pt-1">
                {brandsQuery.isLoading ? (
                  <p className="px-2 py-3 text-xs text-muted-foreground">Loading brands…</p>
                ) : filteredBrands.length === 0 ? (
                  <p className="px-2 py-3 text-xs text-muted-foreground">No brands match.</p>
                ) : (
                  filteredBrands.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setSelectedBrandId(b.id)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors duration-150',
                        b.id === selectedBrandId
                          ? 'bg-emerald-500/10 ring-1 ring-inset ring-emerald-500/30'
                          : 'hover:bg-muted/60',
                      )}
                    >
                      <span
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                        style={{ backgroundColor: b.color || '#71717A' }}
                      >
                        {b.name.charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{b.name}</span>
                      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', b.isActive ? 'bg-emerald-400' : 'bg-zinc-500')} />
                    </button>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </aside>

        {/* ── Main panel ───────────────────────────────────────────────────── */}
        <section className="flex min-w-0 flex-1 flex-col gap-4">
          {!selectedBrand ? (
            <EmptyState icon={Store} title="Select a brand" description="Choose a brand from the list, or add a new one." />
          ) : (
            <>
              {/* ── Header card ──────────────────────────────────────────── */}
              <Card className="border-border bg-card">
                <CardContent className="p-5">
                  <div className="flex flex-wrap items-start gap-4">
                    <span
                      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-lg font-bold text-white"
                      style={{ backgroundColor: selectedBrand.color || '#71717A' }}
                    >
                      {selectedBrand.logoUrl ? (
                        <img src={selectedBrand.logoUrl} alt="" className="h-full w-full rounded-xl object-cover" />
                      ) : (
                        selectedBrand.name.charAt(0).toUpperCase()
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold text-foreground">{selectedBrand.name}</h3>
                        <span className={cn('flex items-center gap-1.5 text-xs', selectedBrand.isActive ? 'text-emerald-500' : 'text-muted-foreground')}>
                          <span className={cn('h-1.5 w-1.5 rounded-full', selectedBrand.isActive ? 'bg-emerald-400' : 'bg-zinc-500')} />
                          {selectedBrand.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {items.length} item{items.length === 1 ? '' : 's'} · {deployedOutlets.length} outlet{deployedOutlets.length === 1 ? '' : 's'}
                      </p>
                    </div>

                    {canWrite && (
                      <div className="flex shrink-0 items-center gap-2">
                        <Button variant="outline" size="sm" onClick={openEditBrand} className="gap-1.5">
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          data-testid="brand-delete"
                          onClick={openDeleteDialog}
                          className="gap-1.5 text-red-500 hover:bg-red-500/10 hover:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Active toggle + brand-wide availability */}
                  <div className="mt-4 flex flex-wrap items-center gap-6 border-t border-border pt-4">
                    <label className="flex items-center gap-2 text-sm text-foreground">
                      <Switch
                        checked={selectedBrand.isActive}
                        disabled={!canWrite || toggleActiveMutation.isPending}
                        onCheckedChange={handleToggleActive}
                        data-testid="brand-active-toggle"
                      />
                      Brand active
                    </label>

                    {canWrite && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-muted-foreground">Set ALL items to:</span>
                        <Select value={bulkAvailChoice} onValueChange={(v) => setBulkAvailChoice(v as Availability)}>
                          <SelectTrigger className="h-8 w-36 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="AVAILABLE">Available</SelectItem>
                            <SelectItem value="PAUSED">Paused</SelectItem>
                            <SelectItem value="SOLD_OUT">Sold Out</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button size="sm" variant="outline" className="h-8" onClick={() => setBulkAvailOpen(true)} disabled={items.length === 0}>
                          Apply
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* ── Tabs ─────────────────────────────────────────────────── */}
              <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
                <TabsList>
                  <TabsTrigger value="items">Items</TabsTrigger>
                  <TabsTrigger value="outlets">Outlets</TabsTrigger>
                  <TabsTrigger value="listings">Listings</TabsTrigger>
                </TabsList>

                {/* ── Items tab ──────────────────────────────────────────── */}
                <TabsContent value="items" className="mt-4 space-y-3">
                  {canWrite && (
                    <div className="flex justify-end">
                      <Dialog open={addItemOpen} onOpenChange={(o) => { setAddItemOpen(o); if (!o) resetAddItemForm() }}>
                        <DialogTrigger asChild>
                          <Button size="sm" data-testid="item-add" className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-500">
                            <Plus className="h-3.5 w-3.5" />
                            Add Item
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
                          <DialogHeader>
                            <DialogTitle>Add Menu Item</DialogTitle>
                            <DialogDescription>Add a new item to {selectedBrand.name}.</DialogDescription>
                          </DialogHeader>
                          <form onSubmit={(e) => void handleAddItem(e)} className="space-y-4">
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium text-muted-foreground">Name</label>
                              <Input required value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="e.g. Chicken Inasal" />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium text-muted-foreground">Price (₱)</label>
                              <Input required type="number" min="0" step="0.01" value={addPrice} onChange={(e) => setAddPrice(e.target.value)} placeholder="e.g. 150.00" />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium text-muted-foreground">Prep Time (min)</label>
                              <Input type="number" min="0" value={addPrep} onChange={(e) => setAddPrep(e.target.value)} placeholder="e.g. 15" />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium text-muted-foreground">Kitchen Station</label>
                              <Select value={addStation} onValueChange={setAddStation}>
                                <SelectTrigger><SelectValue placeholder="Select station…" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="_none">— None —</SelectItem>
                                  {stations.map((s) => (<SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium text-muted-foreground">Initial Availability</label>
                              <Select value={addAvailability} onValueChange={(v) => setAddAvailability(v as Availability)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="AVAILABLE">Available</SelectItem>
                                  <SelectItem value="PAUSED">Paused</SelectItem>
                                  <SelectItem value="SOLD_OUT">Sold Out</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium text-muted-foreground">Product No. (optional)</label>
                              <Input value={addItemNo} maxLength={32} onChange={(e) => setAddItemNo(e.target.value)} placeholder="e.g. TH-001" />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium text-muted-foreground">Remarks (optional)</label>
                              <textarea
                                value={addRemarks}
                                maxLength={500}
                                rows={2}
                                onChange={(e) => setAddRemarks(e.target.value)}
                                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                              />
                            </div>
                            <DialogFooter>
                              <Button type="button" variant="outline" size="sm" onClick={() => setAddItemOpen(false)} disabled={addItemGuard.pending}>Cancel</Button>
                              <Button type="submit" size="sm" disabled={addItemGuard.pending} className="bg-emerald-600 text-white hover:bg-emerald-500">
                                {addItemGuard.pending ? 'Adding…' : 'Add Item'}
                              </Button>
                            </DialogFooter>
                          </form>
                        </DialogContent>
                      </Dialog>
                    </div>
                  )}

                  {itemsQuery.isLoading ? (
                    <p className="p-6 text-center text-sm text-muted-foreground">Loading items…</p>
                  ) : items.length === 0 ? (
                    <EmptyState icon={UtensilsCrossed} title="No items yet" description="Add the first item using the button above." />
                  ) : (
                    <Card className="border-border bg-card">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-border hover:bg-transparent">
                            <TableHead>Name</TableHead>
                            <TableHead>Product No.</TableHead>
                            <TableHead>Price</TableHead>
                            <TableHead>Availability</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {items.map((item) => {
                            const isToggling = togglingAvailabilityIds.has(item.id)
                            return (
                              <TableRow key={item.id} className="border-border">
                                <TableCell>
                                  <div>
                                    <p className="font-medium text-foreground">{item.name}</p>
                                    {item.remarks && <p className="text-[11px] text-muted-foreground">{item.remarks}</p>}
                                  </div>
                                </TableCell>
                                <TableCell className="font-mono text-xs text-muted-foreground">{item.itemNo ?? '—'}</TableCell>
                                <TableCell className="tabular-nums text-sm">₱{Number(item.price).toFixed(2)}</TableCell>
                                <TableCell>
                                  <button
                                    type="button"
                                    data-testid="item-availability-cycle"
                                    onClick={() => void cycleItemAvailability(item)}
                                    disabled={!canWrite || isToggling}
                                    className={cn(
                                      'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide transition-colors duration-200',
                                      availBadgeClass(item.availability),
                                      (!canWrite || isToggling) && 'cursor-default opacity-70',
                                    )}
                                  >
                                    {AVAIL_LABEL[item.availability]}
                                  </button>
                                </TableCell>
                                <TableCell className="text-right">
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground">
                                        <MoreVertical className="h-3.5 w-3.5" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-40">
                                      <DropdownMenuItem className="gap-2 text-xs" disabled={!canWrite} onSelect={() => openEditItem(item)}>
                                        <Pencil className="h-3 w-3" /> Edit
                                      </DropdownMenuItem>
                                      <DropdownMenuItem className="gap-2 text-xs" disabled={!canWrite} onSelect={() => void handleDuplicateItem(item)}>
                                        <Copy className="h-3 w-3" /> Duplicate
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        className="gap-2 text-xs text-red-500 focus:text-red-400"
                                        disabled={!canWrite}
                                        onSelect={() => setDeleteItemTarget(item)}
                                      >
                                        <Trash2 className="h-3 w-3" /> Delete
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    </Card>
                  )}
                </TabsContent>

                {/* ── Outlets tab ────────────────────────────────────────── */}
                <TabsContent value="outlets" className="mt-4">
                  {brandOutletsQuery.isLoading || itemsQuery.isLoading ? (
                    <p className="p-6 text-center text-sm text-muted-foreground">Loading…</p>
                  ) : deployedOutlets.length === 0 ? (
                    <EmptyState
                      icon={Building2}
                      title="Not deployed to any outlet"
                      description={`Deploy ${selectedBrand.name} to an outlet from the Outlets page first, then come back here to manage per-outlet item availability.`}
                      action={
                        outletsQuery.data && outletsQuery.data.length > 0 ? (
                          <Button asChild variant="outline" size="sm">
                            <Link to="/outlets">Go to Outlets</Link>
                          </Button>
                        ) : undefined
                      }
                    />
                  ) : items.length === 0 ? (
                    <EmptyState icon={UtensilsCrossed} title="No items yet" description="Add items in the Items tab first." />
                  ) : (
                    <OutletsMatrix
                      items={items}
                      outlets={deployedOutlets}
                      stations={stations}
                      canWrite={canWrite}
                    />
                  )}
                </TabsContent>

                {/* ── Listings tab ───────────────────────────────────────── */}
                <TabsContent value="listings" className="mt-4 space-y-3">
                  {canWrite && (
                    <div className="flex justify-end">
                      <Dialog open={addListingOpen} onOpenChange={(o) => { setAddListingOpen(o); if (!o) { setAddListingExternalId(''); setAddListingCredentialRef(''); setAddListingLocationId('') } }}>
                        <DialogTrigger asChild>
                          <Button size="sm" data-testid="listing-add" className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-500">
                            <Plus className="h-3.5 w-3.5" />
                            Add Listing
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-sm">
                          <DialogHeader>
                            <DialogTitle>Add Channel Listing</DialogTitle>
                            <DialogDescription>Create a new aggregator account for {selectedBrand.name}.</DialogDescription>
                          </DialogHeader>
                          <form onSubmit={(e) => void handleAddListing(e)} className="space-y-4">
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium text-muted-foreground">Aggregator</label>
                              <Select value={addListingAggregator} onValueChange={(v) => setAddListingAggregator(v as typeof addListingAggregator)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="FOODPANDA">foodpanda</SelectItem>
                                  <SelectItem value="GRABFOOD">GrabFood</SelectItem>
                                  <SelectItem value="OTHER">Other</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium text-muted-foreground">External merchant ID</label>
                              <Input required value={addListingExternalId} onChange={(e) => setAddListingExternalId(e.target.value)} />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium text-muted-foreground">Credential reference</label>
                              <Input required value={addListingCredentialRef} onChange={(e) => setAddListingCredentialRef(e.target.value)} placeholder="vault key / id, never a raw secret" />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium text-muted-foreground">Outlet (optional)</label>
                              <Select value={addListingLocationId || '_none'} onValueChange={(v) => setAddListingLocationId(v === '_none' ? '' : v)}>
                                <SelectTrigger><SelectValue placeholder="Select outlet…" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="_none">— Unassigned —</SelectItem>
                                  {deployedOutlets.map((o) => (<SelectItem key={o.locationId} value={o.locationId}>{o.name}</SelectItem>))}
                                </SelectContent>
                              </Select>
                            </div>
                            <DialogFooter>
                              <Button type="button" variant="outline" size="sm" onClick={() => setAddListingOpen(false)} disabled={addListingGuard.pending}>Cancel</Button>
                              <Button type="submit" size="sm" disabled={addListingGuard.pending} className="bg-emerald-600 text-white hover:bg-emerald-500">
                                {addListingGuard.pending ? 'Adding…' : 'Add Listing'}
                              </Button>
                            </DialogFooter>
                          </form>
                        </DialogContent>
                      </Dialog>
                    </div>
                  )}

                  {accountsQuery.isLoading ? (
                    <p className="p-6 text-center text-sm text-muted-foreground">Loading listings…</p>
                  ) : (accountsQuery.data ?? []).length === 0 ? (
                    <EmptyState icon={LinkIcon} title="No channel listings" description="Add a foodpanda or GrabFood listing using the button above." />
                  ) : (
                    <Card className="border-border bg-card">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-border hover:bg-transparent">
                            <TableHead>Platform</TableHead>
                            <TableHead>Merchant ID</TableHead>
                            <TableHead>Commission</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(accountsQuery.data ?? []).map((a) => (
                            <TableRow key={a.id} className="border-border">
                              <TableCell className="text-sm">{a.aggregator}</TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">{a.externalMerchantId}</TableCell>
                              <TableCell className="tabular-nums text-sm">
                                {a.commissionRate != null ? `${a.commissionRate}%` : '—'}
                              </TableCell>
                              <TableCell>
                                <span className={cn('text-xs', (a.mappingStatus ?? 'MAPPING_REQUIRED') === 'RESOLVED' ? 'text-emerald-500' : 'text-muted-foreground')}>
                                  {a.mappingStatus ?? 'MAPPING_REQUIRED'}
                                </span>
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  {canWrite && (
                                    <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={() => openEditListing(a)}>
                                      <Pencil className="h-3 w-3" /> Edit
                                    </Button>
                                  )}
                                  <Button asChild variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs">
                                    <Link to="/merchant-console">
                                      <ExternalLink className="h-3 w-3" /> Console
                                    </Link>
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Card>
                  )}
                </TabsContent>
              </Tabs>
            </>
          )}
        </section>
      </div>

      {/* ── Edit brand dialog ────────────────────────────────────────────── */}
      <Dialog open={editBrandOpen} onOpenChange={setEditBrandOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Brand</DialogTitle>
            <DialogDescription>Update {selectedBrand?.name ?? 'this brand'}.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void handleEditBrand(e)} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Name</label>
              <Input required value={editBrandName} onChange={(e) => setEditBrandName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Brand color</label>
              <div className="flex items-center gap-2">
                <input type="color" value={editBrandColor} onChange={(e) => setEditBrandColor(e.target.value)} className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent p-0.5" />
                <Input value={editBrandColor} onChange={(e) => setEditBrandColor(e.target.value)} className="font-mono text-sm" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Logo URL (optional)</label>
              <Input value={editBrandLogoUrl} onChange={(e) => setEditBrandLogoUrl(e.target.value)} placeholder="https://…" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditBrandOpen(false)} disabled={editBrandGuard.pending}>Cancel</Button>
              <Button type="submit" size="sm" disabled={editBrandGuard.pending} className="bg-emerald-600 text-white hover:bg-emerald-500">
                {editBrandGuard.pending ? 'Saving…' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Brand-wide bulk availability confirm ─────────────────────────── */}
      <Dialog open={bulkAvailOpen} onOpenChange={(o) => { if (!o && !bulkAvailMutation.isPending) setBulkAvailOpen(false) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Set all items to {AVAIL_LABEL[bulkAvailChoice]}?</DialogTitle>
            <DialogDescription>
              This changes every one of {selectedBrand?.name}&rsquo;s <span className="font-medium text-foreground">{items.length}</span> item{items.length === 1 ? '' : 's'} to{' '}
              <span className="font-medium text-foreground">{AVAIL_LABEL[bulkAvailChoice]}</span>, system-wide.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setBulkAvailOpen(false)} disabled={bulkAvailMutation.isPending}>Cancel</Button>
            <Button
              size="sm"
              data-testid="brand-bulk-availability"
              onClick={confirmBulkAvailability}
              disabled={bulkAvailMutation.isPending}
              className="bg-emerald-600 text-white hover:bg-emerald-500"
            >
              {bulkAvailMutation.isPending ? 'Applying…' : 'Apply to all items'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete brand confirm ──────────────────────────────────────────── */}
      <Dialog open={deleteOpen} onOpenChange={(o) => { if (!o && !deleteBrandMutation.isPending) { setDeleteOpen(false); setDeleteConflict(null) } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-500">
              <Trash2 className="h-4 w-4" />
              Delete brand
            </DialogTitle>
            <DialogDescription>
              {deleteConflict ? (
                <span className="text-amber-500">{deleteConflict}</span>
              ) : (
                <>
                  Permanently delete <span className="font-medium text-foreground">{selectedBrand?.name}</span>? This cannot be undone.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setDeleteOpen(false); setDeleteConflict(null) }} disabled={deleteBrandMutation.isPending}>
              Cancel
            </Button>
            {deleteConflict ? (
              <Button
                size="sm"
                onClick={deactivateInsteadOfDelete}
                disabled={toggleActiveMutation.isPending}
                className="gap-1.5 bg-amber-600 text-white hover:bg-amber-500"
              >
                <PowerOff className="h-3.5 w-3.5" />
                Deactivate instead
              </Button>
            ) : (
              <Button
                size="sm"
                data-testid="brand-delete-confirm"
                onClick={confirmDelete}
                disabled={deleteBrandMutation.isPending}
                className="bg-red-600 text-white hover:bg-red-500"
              >
                {deleteBrandMutation.isPending ? 'Deleting…' : 'Delete brand'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit item dialog ──────────────────────────────────────────────── */}
      <Dialog open={editItemOpen} onOpenChange={setEditItemOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Menu Item</DialogTitle>
            <DialogDescription>Update {editOriginal?.name ?? 'this item'}.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void handleEditItem(e)} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Name</label>
              <Input required value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Price (₱)</label>
              <Input required type="number" min="0" step="0.01" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Prep Time (min)</label>
              <Input type="number" min="0" value={editPrep} onChange={(e) => setEditPrep(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Kitchen Station</label>
              <Select value={editStation} onValueChange={setEditStation}>
                <SelectTrigger><SelectValue placeholder="Select station…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— None —</SelectItem>
                  {stations.map((s) => (<SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Availability</label>
              <Select value={editAvailability} onValueChange={(v) => setEditAvailability(v as Availability)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="AVAILABLE">Available</SelectItem>
                  <SelectItem value="PAUSED">Paused</SelectItem>
                  <SelectItem value="SOLD_OUT">Sold Out</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Product No. (optional)</label>
              <Input value={editItemNo} maxLength={32} onChange={(e) => setEditItemNo(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Remarks (optional)</label>
              <textarea
                value={editRemarks}
                maxLength={500}
                rows={2}
                onChange={(e) => setEditRemarks(e.target.value)}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditItemOpen(false)} disabled={editItemGuard.pending}>Cancel</Button>
              <Button type="submit" size="sm" disabled={editItemGuard.pending} className="bg-emerald-600 text-white hover:bg-emerald-500">
                {editItemGuard.pending ? 'Saving…' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Delete item confirm ───────────────────────────────────────────── */}
      <Dialog open={deleteItemTarget !== null} onOpenChange={(o) => { if (!o && !deleteItemGuard.pending) setDeleteItemTarget(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-500">
              <Trash2 className="h-4 w-4" />
              Delete menu item
            </DialogTitle>
            <DialogDescription>
              Permanently delete <span className="font-medium text-foreground">&ldquo;{deleteItemTarget?.name}&rdquo;</span>? Items with order history cannot be deleted — pause them instead. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteItemTarget(null)} disabled={deleteItemGuard.pending}>Cancel</Button>
            <Button
              size="sm"
              data-testid="item-delete"
              onClick={() => void performDeleteItem()}
              disabled={deleteItemGuard.pending}
              className="bg-red-600 text-white hover:bg-red-500"
            >
              {deleteItemGuard.pending ? 'Deleting…' : 'Delete item'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit listing dialog ───────────────────────────────────────────── */}
      <Dialog open={editListingTarget !== null} onOpenChange={(o) => { if (!o) setEditListingTarget(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Channel Listing</DialogTitle>
            <DialogDescription>{editListingTarget?.aggregator} · {editListingTarget?.externalMerchantId}</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void handleEditListing(e)} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Merchant ID</label>
              <Input value={editListingExternalId} onChange={(e) => setEditListingExternalId(e.target.value)} placeholder="Merchant-facing listing identifier on this platform" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Commission rate (%)</label>
              <Input type="number" min="0" max="100" step="0.01" value={editListingCommission} onChange={(e) => setEditListingCommission(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <Select value={editListingStatus} onValueChange={(v) => setEditListingStatus(v as ListingMappingStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="RESOLVED">Resolved</SelectItem>
                  <SelectItem value="MAPPING_REQUIRED">Mapping required</SelectItem>
                  <SelectItem value="DISABLED">Disabled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Outlet</label>
              <Select value={editListingLocationId || '_none'} onValueChange={(v) => setEditListingLocationId(v === '_none' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="Select outlet…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— Unassigned —</SelectItem>
                  {deployedOutlets.map((o) => (<SelectItem key={o.locationId} value={o.locationId}>{o.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditListingTarget(null)} disabled={editListingGuard.pending}>Cancel</Button>
              <Button type="submit" size="sm" data-testid="listing-edit" disabled={editListingGuard.pending} className="bg-emerald-600 text-white hover:bg-emerald-500">
                {editListingGuard.pending ? 'Saving…' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}

// ─── Outlets tab: item × outlet matrix ─────────────────────────────────────────

interface OutletsMatrixProps {
  items: MerchantMenuItem[]
  outlets: BrandOutletDeployment[]
  stations: MerchantStation[]
  canWrite: boolean
}

function OutletsMatrix({ items, outlets, stations, canWrite }: OutletsMatrixProps) {
  const qc = useQueryClient()

  const deploymentQueries = useQueries({
    queries: items.map((item) => ({
      queryKey: ['menu-item-outlets', item.id],
      queryFn: () => fetchMenuItemOutlets(item.id),
      staleTime: 15_000,
    })),
  })

  const deploymentsByItem = useMemo(() => {
    const map = new Map<string, Map<string, MenuItemOutletDeployment>>()
    items.forEach((item, idx) => {
      const rows = deploymentQueries[idx]?.data ?? []
      const byOutlet = new Map<string, MenuItemOutletDeployment>()
      for (const row of rows) byOutlet.set(row.locationId, row)
      map.set(item.id, byOutlet)
    })
    return map
  }, [items, deploymentQueries])

  const allMissing = deploymentQueries.length > 0 && deploymentQueries.every((q) => q.isError && isNotFound(q.error))
  const anyLoading = deploymentQueries.some((q) => q.isLoading)

  function invalidateItemOutlets(itemId: string) {
    qc.invalidateQueries({ queryKey: ['menu-item-outlets', itemId] })
  }

  // ── Per-outlet bulk availability ──────────────────────────────────────────
  const [bulkTarget, setBulkTarget] = useState<BrandOutletDeployment | null>(null)
  const [bulkChoice, setBulkChoice] = useState<Availability>('AVAILABLE')
  const outletBulkMutation = useMutation({
    mutationFn: async ({ locationId, availability }: { locationId: string; availability: Availability }) =>
      setOutletMenuAvailability(locationId, availability),
    onSuccess: (res) => {
      toast.success(`Updated ${res.updated} item${res.updated === 1 ? '' : 's'} at ${bulkTarget?.name}`)
      qc.invalidateQueries({ queryKey: ['menu-item-outlets'] })
      setBulkTarget(null)
    },
    onError: (e) => {
      if (isNotFound(e)) {
        toast.error('Not available yet', { description: 'Per-outlet bulk availability isn’t live on this backend deploy yet.' })
      } else {
        toast.error('Failed to update availability', { description: errMsg(e, 'Please try again.') })
      }
    },
  })

  function confirmOutletBulk() {
    if (!bulkTarget || outletBulkMutation.isPending) return
    outletBulkMutation.mutate({ locationId: bulkTarget.locationId, availability: bulkChoice })
  }

  if (allMissing) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Per-outlet availability isn't available yet"
        description="This backend deploy doesn't have the per-outlet menu deployment endpoints yet. Try again once the backend update lands."
      />
    )
  }

  return (
    <>
      <Card className="border-border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="sticky left-0 bg-card">Item</TableHead>
              {outlets.map((o) => (
                <TableHead key={o.locationId} className="min-w-[220px]">
                  <div className="flex items-center justify-between gap-2">
                    <span>{o.name}</span>
                    {canWrite && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                        onClick={() => { setBulkTarget(o); setBulkChoice('AVAILABLE') }}
                      >
                        Set all
                      </Button>
                    )}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id} className="border-border">
                <TableCell className="sticky left-0 bg-card font-medium text-foreground">{item.name}</TableCell>
                {outlets.map((o) => {
                  const deployment = deploymentsByItem.get(item.id)?.get(o.locationId)
                  const outletStations = stations.filter((s) => s.locationId === o.locationId)
                  return (
                    <TableCell key={o.locationId}>
                      <DeployCell
                        itemId={item.id}
                        locationId={o.locationId}
                        deployment={deployment}
                        stations={outletStations}
                        canWrite={canWrite}
                        loading={anyLoading && !deployment}
                        onChanged={() => invalidateItemOutlets(item.id)}
                      />
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* ── Per-outlet bulk availability confirm ────────────────────────── */}
      <Dialog open={bulkTarget !== null} onOpenChange={(o) => { if (!o && !outletBulkMutation.isPending) setBulkTarget(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Set all items at {bulkTarget?.name}?</DialogTitle>
            <DialogDescription>
              This affects every menu item currently deployed at <span className="font-medium text-foreground">{bulkTarget?.name}</span> —
              not just {`this brand's`} items. Choose the new availability:
            </DialogDescription>
          </DialogHeader>
          <Select value={bulkChoice} onValueChange={(v) => setBulkChoice(v as Availability)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="AVAILABLE">Available</SelectItem>
              <SelectItem value="PAUSED">Paused</SelectItem>
              <SelectItem value="SOLD_OUT">Sold Out</SelectItem>
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setBulkTarget(null)} disabled={outletBulkMutation.isPending}>Cancel</Button>
            <Button
              size="sm"
              data-testid="outlet-bulk-availability"
              onClick={confirmOutletBulk}
              disabled={outletBulkMutation.isPending}
              className="bg-emerald-600 text-white hover:bg-emerald-500"
            >
              {outletBulkMutation.isPending ? 'Applying…' : 'Apply'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ─── Outlets tab: one item × outlet cell ───────────────────────────────────────

interface DeployCellProps {
  itemId: string
  locationId: string
  deployment: MenuItemOutletDeployment | undefined
  stations: MerchantStation[]
  canWrite: boolean
  loading: boolean
  onChanged: () => void
}

function DeployCell({ itemId, locationId, deployment, stations, canWrite, loading, onChanged }: DeployCellProps) {
  const toggleGuard = useSubmitGuard()
  const availGuard = useSubmitGuard()
  const stationGuard = useSubmitGuard()
  const [pickStationOpen, setPickStationOpen] = useState(false)
  const [pickedStation, setPickedStation] = useState('')
  const [pickedAvailability, setPickedAvailability] = useState<Availability>('AVAILABLE')

  const isDeployed = deployment?.isActive === true

  const handleToggle = toggleGuard.guard(async (next: boolean) => {
    try {
      if (next) {
        if (!deployment || !deployment.stationId) {
          setPickedStation(deployment?.stationId ?? '')
          setPickedAvailability(deployment?.availability ?? 'AVAILABLE')
          setPickStationOpen(true)
          return
        }
        await upsertMenuItemOutlet(itemId, locationId, {
          station_id: deployment.stationId,
          availability: deployment.availability,
          is_active: true,
        })
        toast.success('Deployed to outlet')
      } else {
        await removeMenuItemOutlet(itemId, locationId)
        toast.success('Removed from outlet')
      }
      onChanged()
    } catch (e) {
      if (isNotFound(e)) {
        toast.error('Not available yet', { description: 'Per-outlet deployment isn’t live on this backend deploy yet.' })
      } else {
        toast.error('Failed', { description: errMsg(e, 'Could not update outlet deployment.') })
      }
    }
  })

  const handleConfirmDeploy = stationGuard.guard(async () => {
    if (!pickedStation) {
      toast.error('Pick a kitchen station first')
      return
    }
    try {
      await upsertMenuItemOutlet(itemId, locationId, {
        station_id: pickedStation,
        availability: pickedAvailability,
        is_active: true,
      })
      toast.success('Deployed to outlet')
      setPickStationOpen(false)
      onChanged()
    } catch (e) {
      if (isNotFound(e)) {
        toast.error('Not available yet', { description: 'Per-outlet deployment isn’t live on this backend deploy yet.' })
      } else {
        toast.error('Failed to deploy', { description: errMsg(e, 'Please try again.') })
      }
    }
  })

  const handleAvailabilityChange = availGuard.guard(async (next: Availability) => {
    if (!deployment || !deployment.stationId) return
    try {
      await upsertMenuItemOutlet(itemId, locationId, {
        station_id: deployment.stationId,
        availability: next,
        is_active: true,
      })
      onChanged()
    } catch (e) {
      toast.error('Failed to update availability', { description: errMsg(e, 'Please try again.') })
    }
  })

  if (loading) {
    return <span className="text-xs text-muted-foreground">…</span>
  }

  return (
    <div className="flex items-center gap-2">
      <Switch
        checked={isDeployed}
        disabled={!canWrite || toggleGuard.pending}
        onCheckedChange={(v) => void handleToggle(v)}
        data-testid="item-deploy-toggle"
      />
      {isDeployed ? (
        <Select
          value={deployment?.availability ?? 'AVAILABLE'}
          onValueChange={(v) => void handleAvailabilityChange(v as Availability)}
          disabled={!canWrite || availGuard.pending}
        >
          <SelectTrigger className="h-7 w-28 text-[11px]" data-testid="item-outlet-availability">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="AVAILABLE">Available</SelectItem>
            <SelectItem value="PAUSED">Paused</SelectItem>
            <SelectItem value="SOLD_OUT">Sold Out</SelectItem>
          </SelectContent>
        </Select>
      ) : (
        <span className="text-[11px] text-muted-foreground">Not deployed</span>
      )}

      {/* First-deploy station picker */}
      <Dialog open={pickStationOpen} onOpenChange={(o) => { if (!o && !stationGuard.pending) setPickStationOpen(false) }}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>Deploy to this outlet</DialogTitle>
            <DialogDescription>Pick the kitchen station that prepares this item here.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={pickedStation} onValueChange={setPickedStation}>
              <SelectTrigger><SelectValue placeholder="Select station…" /></SelectTrigger>
              <SelectContent>
                {stations.length === 0 ? (
                  <SelectItem value="_none" disabled>No stations at this outlet</SelectItem>
                ) : (
                  stations.map((s) => (<SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>))
                )}
              </SelectContent>
            </Select>
            <Select value={pickedAvailability} onValueChange={(v) => setPickedAvailability(v as Availability)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="AVAILABLE">Available</SelectItem>
                <SelectItem value="PAUSED">Paused</SelectItem>
                <SelectItem value="SOLD_OUT">Sold Out</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPickStationOpen(false)} disabled={stationGuard.pending}>Cancel</Button>
            <Button
              size="sm"
              onClick={() => void handleConfirmDeploy()}
              disabled={stationGuard.pending || !pickedStation}
              className="bg-emerald-600 text-white hover:bg-emerald-500"
            >
              {stationGuard.pending ? 'Deploying…' : 'Deploy'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
