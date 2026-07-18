/**
 * Merchant Console API client — typed against the shapes MA-1 (backend) is
 * building in parallel for the per-listing tablet/phone replacement screen
 * (Documents/AGGREGATOR_API_INTEGRATION_SPEC.md §4 "Merchant console UI" +
 * §5 "Cutover plan"). These routes may not exist yet server-side — every
 * call here can 404/fail at runtime; callers MUST catch and degrade
 * gracefully (toast, no crash) rather than assume success. Nothing in this
 * module swallows errors itself, so callers keep full control of their
 * loading/error UI.
 *
 * `control_mode` (DEVICE | SHADOW | API) is the cutover-plan gate: a listing
 * still on its physical device (DEVICE) or being read-only-reconciled
 * (SHADOW) is NOT actually controlled by ORION yet — commands sent here
 * would not reach the aggregator. MerchantConsole.tsx disables write actions
 * unless `controlMode === 'API'` and shows why.
 */
import { get, post } from './api'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ControlMode = 'DEVICE' | 'SHADOW' | 'API'
export type ChannelListingStatus = 'ACTIVE' | 'PAUSED' | 'INACTIVE'
export type Aggregator = 'FOODPANDA' | 'GRABFOOD' | 'OTHER'

export interface ChannelListingBrand {
  id: string
  name: string
  color: string
}

export interface ChannelListingOutlet {
  id: string
  name: string
}

export interface ChannelListing {
  id: string
  brand: ChannelListingBrand
  outlet: ChannelListingOutlet
  aggregator: Aggregator
  status: ChannelListingStatus
  controlMode: ControlMode
  merchantId?: string | null
  pausedReason?: string | null
  pausedUntil?: string | null
}

export interface ChannelListingItem {
  id: string
  name: string
  category?: string | null
  price?: number | null
  available: boolean
}

export type ConsoleCommandType = 'ACCEPT_ORDER' | 'REJECT_ORDER' | 'MARK_READY'

export interface ConsoleCommandPayload {
  reason?: string
}

export interface ConsoleCommandBody {
  command_type: ConsoleCommandType
  order_id: string
  payload?: ConsoleCommandPayload
}

export interface PauseListingBody {
  duration_minutes: number
  reason: string
}

// ─── Calls ────────────────────────────────────────────────────────────────────

/** GET /channel-listings — every listing the caller may act on (server-side RBAC/outlet scoping). */
export async function fetchChannelListings(): Promise<ChannelListing[]> {
  const { data } = await get<ChannelListing[]>('/channel-listings')
  return data
}

/** GET /channel-listings/:id/items — this listing's menu with per-item availability. */
export async function fetchChannelListingItems(listingId: string): Promise<ChannelListingItem[]> {
  const { data } = await get<ChannelListingItem[]>(`/channel-listings/${listingId}/items`)
  return data
}

/** POST /channel-listings/:id/commands — accept / reject (with reason) / mark-ready for one order. */
export async function postChannelListingCommand(
  listingId: string,
  body: ConsoleCommandBody,
): Promise<void> {
  await post(`/channel-listings/${listingId}/commands`, body)
}

/** POST /channel-listings/:id/pause — store pause with a required duration + reason. */
export async function pauseChannelListing(listingId: string, body: PauseListingBody): Promise<void> {
  await post(`/channel-listings/${listingId}/pause`, body)
}

/** POST /channel-listings/:id/resume — lift an active pause. */
export async function resumeChannelListing(listingId: string): Promise<void> {
  await post(`/channel-listings/${listingId}/resume`)
}

/** POST /channel-listings/:id/items/:itemId/availability — sold-out toggle. */
export async function setChannelListingItemAvailability(
  listingId: string,
  itemId: string,
  available: boolean,
): Promise<void> {
  await post(`/channel-listings/${listingId}/items/${itemId}/availability`, { available })
}
