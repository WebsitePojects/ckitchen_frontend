import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { APIRequestContext, Page } from '@playwright/test'
import { expect } from '@playwright/test'

// ESM has no __dirname — package.json is "type": "module" (Vite project).
const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * ORION W4b Playwright QA suite — shared fixtures/helpers.
 *
 * All API calls go through the frontend's own baseURL (http://localhost:5173)
 * so they ride the same Vite dev proxy (`/api` -> :4000) the real SPA uses —
 * no separate backend base URL to keep in sync.
 */

export const ARTIFACTS_DIR = join(__dirname, 'artifacts')

/** Screenshot to e2e/artifacts/<name>.png, creating the dir if needed. */
export async function snap(page: Page, name: string): Promise<void> {
  const path = join(ARTIFACTS_DIR, `${name}.png`)
  mkdirSync(dirname(path), { recursive: true })
  await page.screenshot({ path, fullPage: true })
}

// ─── Seed accounts (docs/qa/qa-notes.md) ───────────────────────────────────

export interface SeedAccount {
  email: string
  password: string
  role: string
  /** Expected post-login landing route (auth/access.ts ROLE_LANDING). */
  landing: string
}

export const ACCOUNTS: Record<string, SeedAccount> = {
  OWNER: { email: 'admin@cloudkitchen.local', password: 'admin123', role: 'OWNER', landing: '/' },
  OUTLET_MANAGER: { email: 'outlet_manager@cloudkitchen.local', password: 'password123', role: 'OUTLET_MANAGER', landing: '/' },
  BRAND_MANAGER: { email: 'brand_manager@cloudkitchen.local', password: 'password123', role: 'BRAND_MANAGER', landing: '/' },
  KITCHEN_CREW: { email: 'kitchen_staff@cloudkitchen.local', password: 'password123', role: 'KITCHEN_CREW', landing: '/kitchen' },
  WAREHOUSE_MAIN: { email: 'warehouse_main@cloudkitchen.local', password: 'password123', role: 'WAREHOUSE_MAIN', landing: '/inventory' },
  WAREHOUSE_OUTLET: { email: 'warehouse@cloudkitchen.local', password: 'password123', role: 'WAREHOUSE_OUTLET', landing: '/inventory' },
  PURCHASING: { email: 'supplier_coordinator@cloudkitchen.local', password: 'password123', role: 'PURCHASING', landing: '/master-data' },
  HR: { email: 'hr@cloudkitchen.local', password: 'password123', role: 'HR', landing: '/attendance' },
  ACCOUNTING: { email: 'accountant@cloudkitchen.local', password: 'password123', role: 'ACCOUNTING', landing: '/reports' },
}

/** Ordered per platform-ia-navigation.md role list (used to iterate the 9-role tour). */
export const ROLE_ORDER = [
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

// ─── UI login ───────────────────────────────────────────────────────────────

/** Logs in through the real Login page and waits for the post-login redirect. */
export async function loginUI(page: Page, account: SeedAccount): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(account.email)
  await page.getByLabel('Password').fill(account.password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL((url) => url.pathname === account.landing, { timeout: 10_000 })
}

// ─── API-level login + calls (request context, no browser) ────────────────

export async function apiLogin(request: APIRequestContext, account: SeedAccount): Promise<string> {
  const res = await request.post('/api/v1/auth/login', {
    data: { email: account.email, password: account.password },
  })
  expect(res.ok(), `login failed for ${account.email}: ${res.status()} ${await res.text()}`).toBeTruthy()
  const body = await res.json()
  return body.token as string
}

function authHeaders(token: string, outletId?: string): Record<string, string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  if (outletId) headers['X-Outlet-Id'] = outletId
  return headers
}

export interface Outlet {
  id: string
  code: string
  name: string
  warehouses: Array<{ id: string; locationId: string; type: 'MAIN' | 'KITCHEN' }>
}

/** Fetches the seeded pilot outlet (CK1 / "Main Cloud Kitchen") — looked up live, never hardcoded. */
export async function getPrimaryOutlet(request: APIRequestContext, token: string): Promise<Outlet> {
  const res = await request.get('/api/v1/outlets', { headers: authHeaders(token) })
  expect(res.ok(), `GET /outlets failed: ${res.status()}`).toBeTruthy()
  const outlets = (await res.json()) as Outlet[]
  expect(outlets.length, 'expected at least one seeded outlet').toBeGreaterThan(0)
  return outlets[0]
}

export interface Brand {
  id: string
  name: string
  locationId: string
}

export async function findBrand(request: APIRequestContext, token: string, name: string): Promise<Brand> {
  const res = await request.get('/api/v1/brands', { headers: authHeaders(token) })
  expect(res.ok(), `GET /brands failed: ${res.status()}`).toBeTruthy()
  const brands = (await res.json()) as Brand[]
  const brand = brands.find((b) => b.name === name)
  expect(brand, `brand named "${name}" not found in seed data`).toBeTruthy()
  return brand!
}

export interface MenuItem {
  id: string
  brandId: string
  name: string
  price: string
}

export async function findMenuItem(
  request: APIRequestContext,
  token: string,
  brandId: string,
  name: string,
): Promise<MenuItem> {
  const res = await request.get(`/api/v1/brands/${brandId}/menu`, { headers: authHeaders(token) })
  expect(res.ok(), `GET /brands/${brandId}/menu failed: ${res.status()}`).toBeTruthy()
  const items = (await res.json()) as MenuItem[]
  const item = items.find((i) => i.name === name)
  expect(item, `menu item named "${name}" not found for brand ${brandId}`).toBeTruthy()
  return item!
}

export interface IngestResult {
  order_id: string
  status: string
  code?: string
  print_jobs?: unknown[]
}

export async function ingestOrder(
  request: APIRequestContext,
  token: string,
  input: {
    brand_id: string
    aggregator: 'FOODPANDA' | 'GRABFOOD' | 'OTHER'
    external_ref: string
    customer_name?: string
    items: Array<{ menu_item_id: string; qty: number }>
  },
): Promise<{ status: number; body: IngestResult }> {
  const res = await request.post('/api/v1/ingest/order', {
    headers: authHeaders(token),
    data: input,
  })
  const body = (await res.json()) as IngestResult
  return { status: res.status(), body }
}

export async function advanceOrderApi(
  request: APIRequestContext,
  token: string,
  orderId: string,
): Promise<{ status: number; body: any }> {
  const res = await request.post(`/api/v1/orders/${orderId}/advance`, { headers: authHeaders(token) })
  return { status: res.status(), body: await res.json() }
}

export async function cancelOrderApi(
  request: APIRequestContext,
  token: string,
  orderId: string,
  reason: string,
): Promise<{ status: number; body: any }> {
  const res = await request.post(`/api/v1/orders/${orderId}/cancel`, {
    headers: authHeaders(token),
    data: { reason },
  })
  return { status: res.status(), body: await res.json() }
}

export interface InventoryRow {
  id: string
  warehouseId: string
  ingredientId: string
  quantity: string
  ingredient: { id: string; name: string; unit: string }
}

export async function getInventory(
  request: APIRequestContext,
  token: string,
  outletId: string,
  warehouse: 'MAIN' | 'KITCHEN',
): Promise<InventoryRow[]> {
  const res = await request.get(`/api/v1/inventory?warehouse=${warehouse}`, {
    headers: authHeaders(token, outletId),
  })
  expect(res.ok(), `GET /inventory?warehouse=${warehouse} failed: ${res.status()}`).toBeTruthy()
  return (await res.json()) as InventoryRow[]
}

/** Unique external_ref per test run so re-runs never collide with prior data. */
export function uniqueRef(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10_000)}`
}
