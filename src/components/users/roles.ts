/** Role names and labels shared by the Users page and the join-link screens. */

// Canonical v2 roles only (D24/D29) — matches the backend's V2_ROLES enum that
// createUserSchema/patchUserSchema/rbacPutSchema all validate against. Legacy
// v1 tokens (SUPER_ADMIN etc.) can still be *displayed* via ROLE_LABEL (a stray
// pre-migration account), but are never offered as a choice.
export const ROLES_V2: readonly string[] = [
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

// v1 (legacy) labels/colors, plus v2 (D24/D29) entries so a v2 role token
// never renders an undefined badge.
export const ROLE_LABEL: Record<string, string> = {
  // v1
  SUPER_ADMIN: 'Super Admin',
  BRAND_MANAGER: 'Brand Manager',
  KITCHEN_STAFF: 'Kitchen Staff',
  WAREHOUSE: 'Warehouse',
  SUPPLIER_COORDINATOR: 'Supplier Coord.',
  ACCOUNTANT: 'Accountant',
  RIDER: 'Rider',
  // v2
  OWNER: 'Owner',
  OUTLET_MANAGER: 'Outlet Manager',
  KITCHEN_CREW: 'Kitchen Crew',
  WAREHOUSE_MAIN: 'Warehouse (Main)',
  WAREHOUSE_OUTLET: 'Warehouse (Outlet)',
  PURCHASING: 'Purchasing',
  HR: 'HR',
  ACCOUNTING: 'Accounting',
}

// Roles that see every outlet (mirrors the backend's HQ_ALL_SCOPE_ROLES in
// ckitchen_backend src/modules/auth/roles.ts); outlet access is meaningless for them.
const ALL_OUTLET_ROLES: readonly string[] = ['OWNER', 'HR', 'ACCOUNTING', 'WAREHOUSE_MAIN']

export function roleSeesAllOutlets(role: string): boolean {
  return ALL_OUTLET_ROLES.includes(role)
}
