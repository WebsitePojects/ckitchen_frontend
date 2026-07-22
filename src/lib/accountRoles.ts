// ---------------------------------------------------------------------------
// Shared between pages/Employees.tsx and pages/EmployeeProfile.tsx — the
// "one registration creates both an Employee record and a login" fix
// (2026-07-22 client flaw: adding an employee previously did not create a
// login, forcing the owner to register a person twice).
//
// Role tokens mirror the canonical v2 role set from src/auth/access.ts /
// pages/Users.tsx's CreateUserDialog, minus OWNER — OWNER accounts are not
// created through the employee-login flow.
// ---------------------------------------------------------------------------

export const ACCOUNT_ROLES = [
  'OUTLET_MANAGER',
  'BRAND_MANAGER',
  'KITCHEN_CREW',
  'WAREHOUSE_MAIN',
  'WAREHOUSE_OUTLET',
  'PURCHASING',
  'HR',
  'ACCOUNTING',
] as const

export type AccountRole = (typeof ACCOUNT_ROLES)[number]

export const ACCOUNT_ROLE_LABEL: Record<string, string> = {
  OUTLET_MANAGER: 'Outlet Manager',
  BRAND_MANAGER: 'Brand Manager',
  KITCHEN_CREW: 'Kitchen Crew',
  WAREHOUSE_MAIN: 'Warehouse (Main)',
  WAREHOUSE_OUTLET: 'Warehouse (Outlet)',
  PURCHASING: 'Purchasing',
  HR: 'HR',
  ACCOUNTING: 'Accounting',
}

/**
 * Suggested login role from an employee's department — a starting point the
 * admin can still override via the Role select, not an enforced mapping.
 * Keys match the DEPARTMENTS list in Employees.tsx.
 */
export const DEPARTMENT_ACCOUNT_ROLE: Record<string, AccountRole> = {
  KITCHEN: 'KITCHEN_CREW',
  WAREHOUSE: 'WAREHOUSE_OUTLET',
  PURCHASING: 'PURCHASING',
  SALES: 'OUTLET_MANAGER',
  PRODUCTION: 'WAREHOUSE_OUTLET',
  QA: 'OUTLET_MANAGER',
  ACCOUNTING: 'ACCOUNTING',
  ADMIN: 'OUTLET_MANAGER',
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidAccountEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim())
}

export function isValidAccountPassword(password: string): boolean {
  return password.length >= 8
}
