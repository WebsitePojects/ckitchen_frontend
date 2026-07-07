import { test, expect } from '@playwright/test'
import { ACCOUNTS, apiLogin, loginUI, snap } from './helpers'

/**
 * W5 spec 10 — falsifies the P8 admin console + P9 brand activity log wire up
 * to the live backend:
 *   A. /users loads real users from GET /admin/users (not the old seed stub),
 *      and the Permissions Matrix tab renders the RBAC editor grid.
 *   B. Toggling a brand active/inactive writes brand_activity_log rows, and the
 *      per-brand Activity log viewer renders them.
 */

test.describe('Admin console + brand activity log', () => {
  test('Users console loads live data + RBAC matrix renders', async ({ page }) => {
    await loginUI(page, ACCOUNTS.OWNER) // lands '/'
    await page.goto('/users')
    await expect(page.getByRole('heading', { name: 'Users & Roles' })).toBeVisible()

    // Live data from GET /admin/users — the logged-in OWNER's own account row.
    await expect(page.getByText('admin@cloudkitchen.local')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: /new user/i })).toBeVisible()
    await snap(page, 'admin-users-list')

    // RBAC editor grid renders (role x page switches).
    await page.getByRole('tab', { name: 'Permissions Matrix' }).click()
    await expect(page.getByRole('switch').first()).toBeVisible({ timeout: 10_000 })
    await snap(page, 'admin-rbac-matrix')
  })

  test('Brand activity log renders Active/Inactive events after a toggle', async ({ page, request }) => {
    const token = await apiLogin(request, ACCOUNTS.OWNER)
    const auth = { Authorization: `Bearer ${token}` }
    // Use whatever the first real brand is (seed-agnostic).
    const brands = (await (await request.get('/api/v1/brands', { headers: auth })).json()) as Array<{ id: string; name: string }>
    expect(brands.length, 'expected at least one brand').toBeGreaterThan(0)
    const brand = brands[0]
    // Generate two transitions: active -> inactive -> active (writes 2 log rows).
    await request.patch(`/api/v1/brands/${brand.id}`, { headers: auth, data: { is_active: false } })
    await request.patch(`/api/v1/brands/${brand.id}`, { headers: auth, data: { is_active: true } })

    await loginUI(page, ACCOUNTS.OWNER)
    await page.goto('/brands')

    // Open that brand's Activity log dialog (scope to its card).
    const card = page
      .locator('div')
      .filter({ hasText: brand.name })
      .filter({ has: page.getByRole('button', { name: /activity log/i }) })
      .last()
    await card.getByRole('button', { name: /activity log/i }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(new RegExp(brand.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeVisible()
    // At least one transition pill rendered (events fell in the current month).
    await expect(dialog.getByText(/Active|Inactive/).first()).toBeVisible({ timeout: 10_000 })
    await snap(page, 'brand-activity-log')
  })
})
