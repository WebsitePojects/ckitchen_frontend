import type { UserRole } from './AuthContext'

/**
 * Role → page access matrix.
 *
 * SUPER_ADMIN is allowed everywhere (short-circuited in `canAccess`). The lists
 * below name the OTHER roles permitted on each route. Kept in sync with the
 * backend RBAC (`requireRole` allow-lists) so a user never sees a sidebar tab or
 * opens a page that the API would answer with 403.
 */
const ALL: UserRole[] = [
  'SUPER_ADMIN',
  'BRAND_MANAGER',
  'KITCHEN_STAFF',
  'WAREHOUSE',
  'SUPPLIER_COORDINATOR',
  'ACCOUNTANT',
  'RIDER',
]

export const PAGE_ROLES: Record<string, UserRole[]> = {
  '/': ALL, // Dashboard — everyone
  '/orders': ['BRAND_MANAGER', 'KITCHEN_STAFF', 'RIDER'],
  '/merchants': ['BRAND_MANAGER'],
  '/outlets': ['WAREHOUSE'],
  '/channel-listings': ['BRAND_MANAGER'],
  '/brands': ['BRAND_MANAGER'],
  '/kitchen': ['KITCHEN_STAFF'],
  '/printers': ['KITCHEN_STAFF'],
  '/menu': ['BRAND_MANAGER'],
  '/inventory': ['WAREHOUSE', 'KITCHEN_STAFF', 'SUPPLIER_COORDINATOR'],
  '/stock-ledger': ['WAREHOUSE', 'KITCHEN_STAFF', 'SUPPLIER_COORDINATOR', 'ACCOUNTANT'],
  '/master-data': ['WAREHOUSE', 'SUPPLIER_COORDINATOR'],
  '/users': [], // SUPER_ADMIN only
  '/employees': [], // SUPER_ADMIN only
  '/attendance': ALL, // everyone clocks in/out
  '/audit': ['BRAND_MANAGER'],
  '/reports': ['BRAND_MANAGER', 'ACCOUNTANT'],
  '/settings': ALL,
}

/** True if `role` may view the page at `path`. SUPER_ADMIN can access everything. */
export function canAccess(role: UserRole, path: string): boolean {
  if (role === 'SUPER_ADMIN') return true
  const allowed = PAGE_ROLES[path]
  return allowed ? allowed.includes(role) : false
}
