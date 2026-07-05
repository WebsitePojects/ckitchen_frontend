import type { UserRole } from './AuthContext'

/**
 * v1 -> v2 role alias map (D24/D29). Both role generations are accepted while
 * the backend enum migration + JWT payloads transition — `canAccess` always
 * normalizes through this map first. RIDER intentionally has no v2 target:
 * the role was removed (D29 — client employs no riders) and falls through to
 * whatever the (empty) matrix entry allows, i.e. nothing beyond Attendance.
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
  '/': ['OUTLET_MANAGER', 'BRAND_MANAGER', 'WAREHOUSE_MAIN', 'WAREHOUSE_OUTLET', 'PURCHASING', 'HR', 'ACCOUNTING'],
  '/orders': ['OUTLET_MANAGER', 'BRAND_MANAGER', 'KITCHEN_CREW', 'ACCOUNTING'],
  '/kitchen': ['OUTLET_MANAGER', 'KITCHEN_CREW'],
  '/printers': ['OUTLET_MANAGER', 'KITCHEN_CREW'],

  // Catalog
  '/brands': ['OUTLET_MANAGER', 'BRAND_MANAGER'],
  '/menu': ['OUTLET_MANAGER', 'BRAND_MANAGER', 'KITCHEN_CREW'], // KITCHEN_CREW = read-only (UI does not yet distinguish)
  '/channel-listings': ['BRAND_MANAGER'],

  // Inventory
  '/inventory': ['OUTLET_MANAGER', 'KITCHEN_CREW', 'WAREHOUSE_MAIN', 'WAREHOUSE_OUTLET', 'PURCHASING'], // KITCHEN_CREW = read-only
  '/stock-ledger': ['OUTLET_MANAGER', 'KITCHEN_CREW', 'WAREHOUSE_MAIN', 'WAREHOUSE_OUTLET', 'PURCHASING', 'ACCOUNTING'],

  // Purchasing
  '/master-data': ['WAREHOUSE_MAIN', 'PURCHASING'],

  // People
  '/employees': ['OUTLET_MANAGER', 'HR'],
  '/attendance': EVERYONE,
  '/users': ['HR'],

  // Insights
  '/reports': ['OUTLET_MANAGER', 'BRAND_MANAGER', 'PURCHASING', 'ACCOUNTING'],
  '/audit': ['OUTLET_MANAGER', 'WAREHOUSE_MAIN', 'HR', 'ACCOUNTING'],

  // System
  '/outlets': ['WAREHOUSE_MAIN'],
  '/settings': [], // OWNER only, via the short-circuit
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
