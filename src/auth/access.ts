import type { UserRole } from './AuthContext'

/**
 * v1 -> v2 role alias map (D24/D29). Both role generations are accepted while
 * the backend enum migration + JWT payloads transition — `canAccess` always
 * normalizes through this map first. RIDER intentionally has NO v2 target:
 * the role was removed (D29 — client employs no riders). It is deliberately
 * left out of ROLE_ALIASES so `normalizeRole('RIDER')` falls through to the
 * literal string 'RIDER', which the matrix below grants no access beyond
 * Attendance + Settings (a stray pre-migration RIDER account is not fully
 * locked out, but gets no operational access).
 */
export const ROLE_ALIASES: Record<string, string> = {
  SUPER_ADMIN: 'OWNER',
  KITCHEN_STAFF: 'KITCHEN_CREW',
  WAREHOUSE: 'WAREHOUSE_OUTLET',
  SUPPLIER_COORDINATOR: 'PURCHASING',
  ACCOUNTANT: 'ACCOUNTING',
}

/** Resolves a v1 or v2 role token to its canonical v2 name. */
export function normalizeRole(role: UserRole): string {
  return ROLE_ALIASES[role] ?? role
}

/** Every v2 role clocks in/out — Attendance stays open platform-wide (business-rules.md #9-adjacent). */
const EVERYONE: string[] = [
  'OWNER',
  'OUTLET_MANAGER',
  'BRAND_MANAGER',
  'KITCHEN_CREW',
  'WAREHOUSE_MAIN',
  'WAREHOUSE_OUTLET',
  'PURCHASING',
  'HR',
  'ACCOUNTING',
]

/**
 * Role -> page access matrix (v2 role names; v1 roles resolve through
 * ROLE_ALIASES before lookup in `canAccess`). OWNER (+ legacy SUPER_ADMIN,
 * via the alias) is allowed everywhere — short-circuited in `canAccess`, so
 * it does not need to be listed below. Mirrors platform-ia-navigation.md §4
 * "Role -> visible groups/items" exactly; keep both in sync with backend
 * `requireRole` allow-lists so a user never sees a sidebar tab the API would
 * 403 on.
 */
export const PAGE_ROLES: Record<string, string[]> = {
  // Overview
  // Only roles that actually LAND on the Dashboard get the nav link. Roles with a
  // ROLE_LANDING override (WAREHOUSE_MAIN/WAREHOUSE_OUTLET/PURCHASING/HR/ACCOUNTING)
  // were bounced straight back to their landing page every time they clicked
  // "Dashboard" (W4b gap #5 — a visible dead link), so they're excluded here.
  // OWNER lands on '/' via canAccess's short-circuit; OUTLET_MANAGER/BRAND_MANAGER
  // have no override, so '/' is their real home.
  '/': ['OUTLET_MANAGER', 'BRAND_MANAGER'],
  '/orders': ['OUTLET_MANAGER', 'BRAND_MANAGER', 'KITCHEN_CREW', 'ACCOUNTING'],
  '/kitchen': ['OUTLET_MANAGER', 'KITCHEN_CREW'],
  '/printers': ['OUTLET_MANAGER', 'KITCHEN_CREW'],
  // TV display board (D32) — big-screen KDS/ops view. Same viewers as '/kitchen'
  // plus OWNER (already covered by canAccess's short-circuit). Deliberately not
  // in nav-items.ts / the sidebar — reached only via Kitchen's "TV Mode" button
  // or a direct URL on the outlet's TV browser.
  '/tv': ['OUTLET_MANAGER', 'KITCHEN_CREW'],

  // Catalog
  '/brands': ['OUTLET_MANAGER', 'BRAND_MANAGER'],
  // KITCHEN_CREW is read-only here: Menu.tsx gates every write (add item, availability
  // edits) behind `hasRole(role, ['BRAND_MANAGER'])`, so kitchen crew view but can't mutate.
  '/menu': ['OUTLET_MANAGER', 'BRAND_MANAGER', 'KITCHEN_CREW'],
  '/channel-listings': ['BRAND_MANAGER'],
  // Merchant Console (Documents/AGGREGATOR_API_INTEGRATION_SPEC.md §4 "Security" —
  // "server-side RBAC (OWNER/OUTLET_MANAGER for store pause; KITCHEN_CREW for
  // order actions)") — page access is the union of everyone who acts on it;
  // per-action gating (pause/resume, accept/reject/ready, item availability)
  // is enforced inside MerchantConsole.tsx via hasRole.
  '/merchant-console': ['OUTLET_MANAGER', 'BRAND_MANAGER', 'KITCHEN_CREW'],

  // Inventory — KITCHEN_CREW is read-only except requesting an ITO (a legitimate kitchen
  // replenishment action); Inventory.tsx gates receive/confirm-ITO/adjust to warehouse roles.
  '/inventory': ['OUTLET_MANAGER', 'KITCHEN_CREW', 'WAREHOUSE_MAIN', 'WAREHOUSE_OUTLET', 'PURCHASING'],
  '/stock-ledger': ['OUTLET_MANAGER', 'KITCHEN_CREW', 'WAREHOUSE_MAIN', 'WAREHOUSE_OUTLET', 'PURCHASING', 'ACCOUNTING'],

  // Purchasing
  // '/purchasing' mirrors the backend purchasing module's union of role sets
  // (requesters / PO / receive / budget viewers) minus KITCHEN_CREW (kitchen
  // raises replenishment via ITO on '/inventory', not POs) — matches the
  // backend rbac-defaults entry added in the same wave.
  '/purchasing': ['OUTLET_MANAGER', 'PURCHASING', 'WAREHOUSE_MAIN', 'WAREHOUSE_OUTLET', 'ACCOUNTING'],
  '/master-data': ['WAREHOUSE_MAIN', 'PURCHASING'],

  // People
  '/employees': ['OUTLET_MANAGER', 'HR'],
  '/attendance': [...EVERYONE, 'RIDER'], // + a stray unaliased RIDER account (D29)
  '/users': ['HR'],

  // Insights
  '/reports': ['OUTLET_MANAGER', 'BRAND_MANAGER', 'PURCHASING', 'ACCOUNTING'],
  // Matches backend GET /audit as of 2026-07-05 (ckitchen_backend
  // src/modules/ems/routes.ts: `requireRole("OWNER", "BRAND_MANAGER")`).
  // OUTLET_MANAGER/WAREHOUSE_MAIN/HR/ACCOUNTING previously listed here landed
  // on a page that always 403'd — removed until the backend D31 matrix widens
  // GET /audit. BRAND_MANAGER already matches AuditTrail.tsx's own hasRole
  // gate; OWNER passes via canAccess's short-circuit.
  '/audit': ['BRAND_MANAGER'],

  // System
  '/outlets': ['WAREHOUSE_MAIN'],
  '/settings': ['RIDER'], // OWNER only otherwise, via the short-circuit
}

/**
 * Per-role landing page (platform-ia-navigation.md §4). Roles not listed here
 * land on the Dashboard ('/'). Consumed by `RoleLanding` (the index-route
 * element) so both "just logged in" and "navigated back to /" funnel through
 * the same rule.
 */
export const ROLE_LANDING: Record<string, string> = {
  KITCHEN_CREW: '/kitchen',
  WAREHOUSE_MAIN: '/inventory',
  WAREHOUSE_OUTLET: '/inventory',
  PURCHASING: '/master-data',
  HR: '/attendance',
  ACCOUNTING: '/reports',
}

/** True if `role` may view the page at `path`. OWNER (+ legacy SUPER_ADMIN) can access everything. */
export function canAccess(role: UserRole, path: string): boolean {
  const normalized = normalizeRole(role)
  if (normalized === 'OWNER') return true
  const allowed = PAGE_ROLES[path]
  return allowed ? allowed.includes(normalized) : false
}

/**
 * True if `userRole` (v1 or v2 token) is a member of `allowed` (v2 role
 * names), after normalizing through ROLE_ALIASES. OWNER (+ legacy
 * SUPER_ADMIN, via the alias) always passes, mirroring `canAccess`'s
 * short-circuit. Use this to gate in-page actions (buttons/menus, not nav —
 * nav goes through `canAccess`) so v2 role tokens don't silently lose
 * actions that hardcoded v1-only role arrays used to grant.
 */
export function hasRole(userRole: UserRole | undefined, allowed: UserRole[]): boolean {
  if (!userRole) return false
  const normalized = normalizeRole(userRole)
  if (normalized === 'OWNER') return true
  return allowed.includes(normalized as UserRole)
}
