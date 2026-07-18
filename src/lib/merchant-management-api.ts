/**
 * Merchant Management API client — typed against the NEW endpoints a parallel
 * backend builder is adding for the full merchant/brand management page
 * (MerchantManagement.tsx). Existing endpoints (brand CRUD, menu item CRUD,
 * brand→outlet deploy, brand accounts) already have call sites elsewhere
 * (Menu.tsx, OutletProfile.tsx, ChannelListings.tsx) — this module only wraps
 * the NEW surface plus a couple of thin re-exports so the page has one
 * import to reach for. Every call here can 404 on a dev environment that
 * hasn't picked up the backend wave yet; callers must degrade gracefully
 * (see the page's `isMissingEndpoint` helper) rather than assume success.
 */
import { del, get, patch, post, put } from './api'

// ─── Shared types ─────────────────────────────────────────────────────────────

export type Availability = 'AVAILABLE' | 'PAUSED' | 'SOLD_OUT'

export interface MerchantBrand {
  id: string
  name: string
  color: string
  logoUrl?: string | null
  salesPerfId?: string | null
  isActive: boolean
}

export interface MerchantMenuItem {
  id: string
  brandId: string
  name: string
  price: string
  prepTimeMin: number
  stationId: string
  availability: Availability
  itemNo?: string | null
  remarks?: string | null
  imageUrl?: string | null
}

export interface MerchantStation {
  id: string
  name: string
  locationId: string
}

export interface MerchantOutlet {
  id: string
  code: string
  name: string
  status: 'ACTIVE' | 'INACTIVE'
}

/** GET /brands/:id/outlets row — every outlet this brand is deployed to (home + additional). */
export interface BrandOutletDeployment {
  brandId: string
  locationId: string
  isActive: boolean
  createdAt: string
  code: string
  name: string
}

/** GET /menu/:id/outlets row (contract is snake_case on the wire). */
export interface MenuItemOutletRow {
  location_id: string
  station_id: string | null
  availability: Availability
  is_active: boolean
}

/** Normalized (camelCase) shape the page actually works with. */
export interface MenuItemOutletDeployment {
  locationId: string
  stationId: string | null
  availability: Availability
  isActive: boolean
}

/** GET /accounts response only ever carries mappingStatus (RESOLVED|MAPPING_REQUIRED|DISABLED) —
 *  there is no separate "status" key and no merchant_name column on the wire
 *  (see ckitchen_backend/src/modules/brands/routes.ts toPublicAccount/updateAccountSchema). */
export type ListingMappingStatus = 'RESOLVED' | 'MAPPING_REQUIRED' | 'DISABLED'

export interface MerchantAccount {
  id: string
  brandId: string
  locationId?: string | null
  aggregator: 'FOODPANDA' | 'GRABFOOD' | 'OTHER'
  externalMerchantId: string
  isActive: boolean
  /** Numeric string ("15.00") straight off the Postgres `numeric` column, or null. */
  commissionRate?: string | number | null
  mappingStatus?: ListingMappingStatus
  controlMode?: 'DEVICE' | 'SHADOW' | 'API'
}

export interface CreateAccountBody {
  aggregator: 'FOODPANDA' | 'GRABFOOD' | 'OTHER'
  external_merchant_id: string
  credential_ref: string
  location_id?: string
}

/** PATCH /accounts/:id body — matches updateAccountSchema exactly (backend truth as of
 *  this diff): no merchant_name key exists; the enum field's wire key is `status`
 *  (it updates the mappingStatus column, but the JSON body key zod parses is "status"). */
export interface UpdateAccountBody {
  external_merchant_id?: string
  commission_rate?: string | number | null
  status?: ListingMappingStatus
  location_id?: string | null
}

// ─── Normalizers ──────────────────────────────────────────────────────────────

/** Reads a GET /menu/:id/outlets row defensively (snake_case per contract, camelCase as a hedge). */
export function normalizeMenuItemOutletRow(
  row: MenuItemOutletRow | (Partial<MenuItemOutletDeployment> & Record<string, unknown>),
): MenuItemOutletDeployment {
  const r = row as Record<string, unknown>
  return {
    locationId: String(r.location_id ?? r.locationId ?? ''),
    stationId: (r.station_id ?? r.stationId ?? null) as string | null,
    availability: (r.availability ?? 'AVAILABLE') as Availability,
    isActive: Boolean(r.is_active ?? r.isActive ?? true),
  }
}

// ─── Brand ────────────────────────────────────────────────────────────────────

/** DELETE /brands/:id — 200 on success; 409 {code: HAS_LISTINGS|HAS_ORDERS} when it can't be hard-deleted. */
export async function deleteBrand(brandId: string): Promise<void> {
  await del(`/brands/${brandId}`)
}

/** POST /brands/:id/availability — bulk-set every one of the brand's items. Returns the row count touched. */
export async function setBrandAvailability(
  brandId: string,
  availability: Availability,
): Promise<{ updated: number }> {
  const { data } = await post<{ updated: number }>(`/brands/${brandId}/availability`, { availability })
  return data
}

/** GET /brands/:id/outlets — every outlet this brand is deployed to (active + inactive). */
export async function fetchBrandOutlets(brandId: string): Promise<BrandOutletDeployment[]> {
  const { data } = await get<BrandOutletDeployment[]>(`/brands/${brandId}/outlets`)
  return data
}

// ─── Menu item ↔ outlet deployment ─────────────────────────────────────────────

/** GET /menu/:id/outlets — this item's per-outlet deployment + availability. */
export async function fetchMenuItemOutlets(menuItemId: string): Promise<MenuItemOutletDeployment[]> {
  const { data } = await get<MenuItemOutletRow[]>(`/menu/${menuItemId}/outlets`)
  return (Array.isArray(data) ? data : []).map(normalizeMenuItemOutletRow)
}

/** PUT /menu/:id/outlets/:locationId — upsert: deploy (first call) or update station/availability/active. */
export async function upsertMenuItemOutlet(
  menuItemId: string,
  locationId: string,
  body: { station_id: string; availability?: Availability; is_active?: boolean },
): Promise<MenuItemOutletDeployment> {
  const { data } = await put<MenuItemOutletRow>(`/menu/${menuItemId}/outlets/${locationId}`, body)
  return normalizeMenuItemOutletRow(data)
}

/** DELETE /menu/:id/outlets/:locationId — soft undeploy (item stops showing at this outlet). */
export async function removeMenuItemOutlet(menuItemId: string, locationId: string): Promise<void> {
  await del(`/menu/${menuItemId}/outlets/${locationId}`)
}

// ─── Outlet-wide bulk availability ─────────────────────────────────────────────

/** POST /outlets/:locationId/menu-availability — bulk-set every item deployed at this outlet. */
export async function setOutletMenuAvailability(
  locationId: string,
  availability: Availability,
): Promise<{ updated: number }> {
  const { data } = await post<{ updated: number }>(`/outlets/${locationId}/menu-availability`, {
    availability,
  })
  return data
}

// ─── Channel listing (aggregator account) ──────────────────────────────────────

/** POST /brands/:id/accounts — now accepts an optional location_id (which outlet owns this listing). */
export async function createAccount(
  brandId: string,
  body: CreateAccountBody,
): Promise<MerchantAccount> {
  const { data } = await post<MerchantAccount>(`/brands/${brandId}/accounts`, body)
  return data
}

/** PATCH /accounts/:id — external merchant id / commission rate / mapping status / outlet link. */
export async function updateAccount(
  accountId: string,
  body: UpdateAccountBody,
): Promise<MerchantAccount> {
  const { data } = await patch<MerchantAccount>(`/accounts/${accountId}`, body)
  return data
}
