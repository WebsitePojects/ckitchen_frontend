import { test, expect } from '@playwright/test'
import { ACCOUNTS, apiLogin, findBrand, findMenuItem, ingestOrder, loginUI, uniqueRef } from './helpers'

/**
 * Business-rules.md #5: (aggregator, external_ref) is unique — a replayed
 * webhook must be an idempotent no-op (same order_id back, never a duplicate
 * row), protecting against aggregator/middleware retries.
 */
test('duplicate ingest (same external_ref) is idempotent — no dupe on KDS', async ({ page, request }) => {
  const token = await apiLogin(request, ACCOUNTS.OWNER)
  const brand = await findBrand(request, token, 'Manila Lechon')
  const menuItem = await findMenuItem(request, token, brand.id, 'Lechon Rice')
  const ref = uniqueRef('IDEMPOTENT')

  const first = await ingestOrder(request, token, {
    brand_id: brand.id,
    aggregator: 'FOODPANDA',
    external_ref: ref,
    items: [{ menu_item_id: menuItem.id, qty: 1 }],
  })
  expect(first.status, `first ingest failed: ${JSON.stringify(first.body)}`).toBe(201)
  const orderId = first.body.order_id

  const replay = await ingestOrder(request, token, {
    brand_id: brand.id,
    aggregator: 'FOODPANDA',
    external_ref: ref,
    items: [{ menu_item_id: menuItem.id, qty: 1 }],
  })
  expect(replay.status, `replay should be a 200 idempotent no-op: ${JSON.stringify(replay.body)}`).toBe(200)
  expect(replay.body.code).toBe('DUPLICATE_ORDER')
  expect(replay.body.order_id, 'replay must return the SAME order_id, not a new one').toBe(orderId)

  await loginUI(page, ACCOUNTS.OWNER)
  await page.goto('/kitchen')
  await expect(page.getByText(ref)).toHaveCount(1)
})
