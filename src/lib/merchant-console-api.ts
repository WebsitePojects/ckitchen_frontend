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
  /**
   * Seconds a NEW order on this listing has to be accepted before the
   * aggregator auto-expires it (SITE_VISIT_VIDEO_ANALYSIS.md §1b — Grab's
   * "05:00" accept countdown). Null when the aggregator/listing doesn't
   * enforce one, or on pre-MC-1 backend deploys that don't send this field
   * yet. Per-order `acceptDeadlineAt` (see lib/kds.ts KdsOrder) is the
   * source of truth for any single order's countdown; this is only kept
   * here for listing-level display/config.
   */
  acceptSlaSeconds?: number | null
}

export interface ChannelListingItem {
  id: string
  name: string
  category?: string | null
  price?: number | null
  available: boolean
}

export type ConsoleCommandType = 'ACCEPT_ORDER' | 'REJECT_ORDER' | 'MARK_READY'

/**
 * Enumerated reject reasons (SITE_VISIT_VIDEO_ANALYSIS.md §6 row H —
 * "aggregators require an enumerated reason list", replacing ORION's old
 * free-text `reason`). `note` is optional except when `reason_code` is
 * `OTHER`, where the UI requires it (MerchantConsole.tsx's RejectOrderDialog).
 */
export type RejectReasonCode =
  | 'OUT_OF_STOCK'
  | 'KITCHEN_CLOSED'
  | 'TOO_BUSY'
  | 'CUSTOMER_REQUEST'
  | 'INCORRECT_ORDER'
  | 'OTHER'

export const REJECT_REASON_LABELS: Record<RejectReasonCode, string> = {
  OUT_OF_STOCK: 'Out of stock',
  KITCHEN_CLOSED: 'Kitchen closed',
  TOO_BUSY: 'Too busy',
  CUSTOMER_REQUEST: 'Customer request',
  INCORRECT_ORDER: 'Incorrect order',
  OTHER: 'Other',
}

export interface ConsoleCommandPayload {
  /** Legacy free-text reason — kept optional for callers not yet migrated. */
  reason?: string
  reason_code?: RejectReasonCode
  /** Required by the backend when reason_code === 'OTHER'. */
  note?: string
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

// ─── Disputes (SITE_VISIT_VIDEO_ANALYSIS.md §5 + §6 row N2) ───────────────────
//
// Audio evidence (§5): "Hindi po automatic i-refund... kailangan i-contest mo
// po lagi" — refunds/compensation on a cancel-after-accept order are NOT
// automatic; the merchant must actively contest with the aggregator, and V3
// names the exact fraud pattern this guards against ("Biglang cancel...
// parang modus"). This is a client-confirmed, high-priority gap (§6 row N2),
// not a nice-to-have refund button.

export type DisputeReason = 'SUSPECTED_FRAUD' | 'ALREADY_PREPARED' | 'RIDER_NO_SHOW' | 'OTHER'

export const DISPUTE_REASON_LABELS: Record<DisputeReason, string> = {
  SUSPECTED_FRAUD: 'Suspected fraud',
  ALREADY_PREPARED: 'Already prepared',
  RIDER_NO_SHOW: 'Rider no-show',
  OTHER: 'Other',
}

export type DisputeStatus =
  | 'OPEN'
  | 'CONTESTED'
  | 'RESOLVED_MERCHANT_FAVOR'
  | 'RESOLVED_AGGREGATOR_FAVOR'
  | 'EXPIRED'

export interface OrderDispute {
  id: string
  orderId: string
  reason: DisputeReason
  status: DisputeStatus
  createdAt: string
  resolvedAt: string | null
  resolutionNote: string | null
}

export interface ContestCancellationBody {
  dispute_reason: DisputeReason
  evidence_note?: string
}

// ─── Item availability (contract only — no snooze-window UI built this pass) ──
//
// SITE_VISIT_VIDEO_ANALYSIS.md §2d documents foodpanda's "unavailable until
// tomorrow/specific date (yellow) vs indefinitely (grey)" snooze legend, and
// §6 row F/G call out option-group-level availability as a real gap. Typed
// here so callers built against the MC-1 contract compile; the Items panel
// in MerchantConsole.tsx still only exercises the plain `available` boolean
// this pass (scope/option_group_id/unavailable_until UI was not in this
// build's numbered scope) — building the snooze UI is left for a follow-up.

export interface AvailabilityBody {
  available: boolean
  scope?: 'ITEM' | 'OPTION_GROUP'
  option_group_id?: string
  unavailable_until?: string | null
}

/** Best-effort idempotency key — mirrors the pattern other mutating console actions should use for retried POSTs. */
export function makeIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`
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

/**
 * POST /channel-listings/:id/items/:itemId/availability — sold-out toggle.
 * `extra` accepts the MC-1 contract's scope/option_group_id/unavailable_until
 * fields for forward-compat; MerchantConsole.tsx's ItemsPanel only sends
 * `available` this pass (see AvailabilityBody's doc comment above).
 */
export async function setChannelListingItemAvailability(
  listingId: string,
  itemId: string,
  available: boolean,
  extra?: Omit<AvailabilityBody, 'available'>,
): Promise<void> {
  await post(`/channel-listings/${listingId}/items/${itemId}/availability`, { available, ...extra })
}

/**
 * POST /channel-listings/:id/orders/:orderId/contest-cancellation — dispute a
 * cancel-after-accept order (SITE_VISIT_VIDEO_ANALYSIS.md §5/§6 row N2).
 * `idempotencyKey` mirrors how pause/resume are documented to send one for
 * a retried mutating POST — sent as `Idempotency-Key` so a network retry
 * from MerchantConsole.tsx never opens two disputes for the same click.
 */
export async function contestOrderCancellation(
  listingId: string,
  orderId: string,
  body: ContestCancellationBody,
  idempotencyKey: string,
): Promise<void> {
  await post(
    `/channel-listings/${listingId}/orders/${orderId}/contest-cancellation`,
    body,
    { headers: { 'Idempotency-Key': idempotencyKey } },
  )
}

/** GET /channel-listings/:id/disputes — every dispute raised for this listing's orders. */
export async function fetchChannelListingDisputes(listingId: string): Promise<OrderDispute[]> {
  const { data } = await get<OrderDispute[]>(`/channel-listings/${listingId}/disputes`)
  return data
}
