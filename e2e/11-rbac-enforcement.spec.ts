import { test, expect } from '@playwright/test'
import { ACCOUNTS, apiLogin, loginUI, snap } from './helpers'

/**
 * Spec 11 — falsifies that the admin RBAC matrix (role_page_access table +
 * GET/PUT /admin/rbac) has a REAL runtime effect. Before this endpoint
 * (GET /me/permissions) + its frontend consumers (Sidebar, RequireAccess)
 * existed, toggling a switch in the Permissions Matrix tab persisted to the
 * DB but changed NOTHING a non-OWNER actually saw — this spec closes that
 * loop.
 *
 * Uses KITCHEN_CREW + the '/orders' page: allowed=true by default
 * (auth/access.ts PAGE_ROLES / backend rbac-defaults.ts), and deliberately
 * NOT KITCHEN_CREW's own landing route ('/kitchen') — a role's landing route
 * is always reachable regardless of the matrix by design (safety: never
 * bounce someone off the one page they're guaranteed to land on), so it
 * wouldn't prove anything to flip that one off.
 *
 * Tests run in file order (playwright.config.ts: fullyParallel:false,
 * workers:1), so the PUT in the first test is visible to the ones after it.
 * The final test restores allowed=true regardless of whether the earlier
 * assertions passed, so this spec never leaves the shared dev DB's matrix
 * mutated for a later run.
 */

test.describe('RBAC matrix enforcement (admin edit -> nav + route guard)', () => {
  test('OWNER flips KITCHEN_CREW / "/orders" off via PUT /admin/rbac', async ({ request }) => {
    const token = await apiLogin(request, ACCOUNTS.OWNER)
    const auth = { Authorization: `Bearer ${token}` }

    // Sanity: confirm the seeded default is allowed=true before flipping it,
    // so this test is actually proving something (not a no-op toggle).
    const before = await request.get('/api/v1/admin/rbac', { headers: auth })
    expect(before.ok(), `GET /admin/rbac failed: ${before.status()}`).toBeTruthy()
    const beforeBody = await before.json()
    const beforeEntry = beforeBody.entries.find(
      (e: { role: string; pageKey: string; allowed: boolean }) => e.role === 'KITCHEN_CREW' && e.pageKey === '/orders',
    )
    expect(beforeEntry?.allowed, 'expected KITCHEN_CREW default allowed=true on /orders before this test flips it').toBe(true)

    const put = await request.put('/api/v1/admin/rbac', {
      headers: auth,
      data: [{ role: 'KITCHEN_CREW', pageKey: '/orders', allowed: false }],
    })
    expect(put.ok(), `PUT /admin/rbac failed: ${put.status()} ${await put.text()}`).toBeTruthy()
    const putBody = await put.json()
    const putEntry = putBody.entries.find(
      (e: { role: string; pageKey: string; allowed: boolean }) => e.role === 'KITCHEN_CREW' && e.pageKey === '/orders',
    )
    expect(putEntry?.allowed).toBe(false)
  })

  test('KITCHEN_CREW no longer sees "Live Orders" in the sidebar, and /orders bounces to their landing', async ({ page }) => {
    await loginUI(page, ACCOUNTS.KITCHEN_CREW) // lands on /kitchen

    // GET /me/permissions has to actually resolve before the sidebar reflects
    // the matrix (fail-open while loading) — give it a moment, then assert.
    await expect(page.getByRole('link', { name: /live orders/i })).toHaveCount(0, { timeout: 15_000 })
    // Their own landing route is untouched — still visible, still reachable.
    await expect(page.getByRole('link', { name: /kitchen \(kds\)/i })).toBeVisible()
    await snap(page, 'rbac-kitchen-crew-orders-hidden')

    // Route guard: a direct hit on /orders is bounced back to the landing route.
    await page.goto('/orders')
    await page.waitForURL((url) => url.pathname === ACCOUNTS.KITCHEN_CREW.landing, { timeout: 10_000 })
    expect(new URL(page.url()).pathname).toBe(ACCOUNTS.KITCHEN_CREW.landing)
  })

  test('OWNER still sees every nav item regardless of the matrix edit', async ({ page }) => {
    await loginUI(page, ACCOUNTS.OWNER) // lands on '/'

    await expect(page.getByRole('link', { name: /live orders/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /users & roles/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^settings$/i })).toBeVisible()

    // And the route itself is still reachable, not just the nav link.
    await page.goto('/orders')
    await expect(page).toHaveURL(/\/orders$/)
    await snap(page, 'rbac-owner-full-nav')
  })

  test('cleanup: restore KITCHEN_CREW / "/orders" to allowed=true', async ({ request }) => {
    const token = await apiLogin(request, ACCOUNTS.OWNER)
    const put = await request.put('/api/v1/admin/rbac', {
      headers: { Authorization: `Bearer ${token}` },
      data: [{ role: 'KITCHEN_CREW', pageKey: '/orders', allowed: true }],
    })
    expect(put.ok(), `restore PUT /admin/rbac failed: ${put.status()} ${await put.text()}`).toBeTruthy()
  })
})
