import { test, expect } from '@playwright/test'
import {
  ACCOUNTS,
  apiLogin,
  advanceOrderApi,
  findBrand,
  findMenuItem,
  ingestOrder,
  loginUI,
  snap,
  uniqueRef,
} from './helpers'

/**
 * W5 spec 9 — falsifies the two live-data complaints the client reported on
 * 2026-07-08:
 *   1. Orders that arrive/advance must appear on the Orders page WITHOUT a
 *      manual reload (socket-driven refetch) — and COMPLETED orders must stay
 *      listed (the "completed orders not showing" bug).
 *   2. The order simulator's running state must survive page navigation AND a
 *      full reload (SimulatorContext hydrating from GET /simulator/status).
 */

test.describe('Live data + simulator persistence', () => {
  test('Orders page reflects new + completed orders live (no reload)', async ({ page, request }) => {
    const token = await apiLogin(request, ACCOUNTS.OWNER)
    const brand = await findBrand(request, token, 'Manila Lechon')
    const menuItem = await findMenuItem(request, token, brand.id, 'Lechon Rice')
    const ref = uniqueRef('LIVE')

    await loginUI(page, ACCOUNTS.OWNER)
    await page.goto('/orders')
    await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible()
    await expect(page.getByText(ref)).toHaveCount(0)

    // Give the socket time to connect + join the outlet room before we ingest,
    // otherwise order.created fires before the page is listening.
    await page.waitForTimeout(2500)

    const { status, body } = await ingestOrder(request, token, {
      brand_id: brand.id,
      aggregator: 'FOODPANDA',
      external_ref: ref,
      customer_name: 'Live QA',
      items: [{ menu_item_id: menuItem.id, qty: 1 }],
    })
    expect(status, `ingest failed: ${JSON.stringify(body)}`).toBe(201)

    // Appears live — no page.reload() anywhere in this test.
    await expect(page.getByText(ref)).toBeVisible({ timeout: 15_000 })
    await snap(page, 'orders-live-1-new')

    // Drive it to COMPLETED via the API and confirm it REMAINS listed live
    // (the reported bug was completed orders vanishing from the Orders page).
    for (let i = 0; i < 3; i++) {
      const { status: adv } = await advanceOrderApi(request, token, body.order_id)
      expect(adv, `advance step ${i} failed`).toBe(200)
    }
    await expect(page.getByText(ref)).toBeVisible({ timeout: 15_000 })
    await snap(page, 'orders-live-2-completed')
  })

  test('Simulator stays running across navigation and full reload', async ({ page, request }) => {
    // Clean slate: make sure the simulator is stopped before we begin.
    const token = await apiLogin(request, ACCOUNTS.OWNER)
    await request.post('/api/v1/simulator/stop', { headers: { Authorization: `Bearer ${token}` } })

    await loginUI(page, ACCOUNTS.OWNER) // lands on '/'
    // Brand chips + Start/Stop are unique buttons on the Dashboard (the Top
    // Brands chart renders brand names as plain text, not buttons), so no card
    // scoping is needed.
    await page.getByRole('button', { name: 'Manila Lechon' }).click()
    await page.getByRole('button', { name: /start simulator/i }).click()

    const stopBtn = page.getByRole('button', { name: /stop simulator/i })
    await expect(stopBtn).toBeVisible({ timeout: 10_000 })

    // SPA navigation away and back — provider lives above the router.
    await page.goto('/orders')
    await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible()
    await page.goto('/')
    await expect(page.getByRole('button', { name: /stop simulator/i })).toBeVisible({ timeout: 10_000 })

    // Full reload — remounts the provider; only passes if it re-hydrates from
    // GET /simulator/status (the actual fix for the "resets to Start" bug).
    await page.reload()
    await expect(page.getByRole('button', { name: /stop simulator/i })).toBeVisible({ timeout: 10_000 })
    await snap(page, 'simulator-persisted-after-reload')

    // Cleanup so we don't leave the simulator running for later specs.
    await page.getByRole('button', { name: /stop simulator/i }).click()
    await expect(page.getByRole('button', { name: /start simulator/i })).toBeVisible({ timeout: 10_000 })
  })
})
