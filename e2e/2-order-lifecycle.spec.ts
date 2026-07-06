import { test, expect } from '@playwright/test'
import {
  ACCOUNTS,
  apiLogin,
  findBrand,
  findMenuItem,
  ingestOrder,
  loginUI,
  snap,
  uniqueRef,
} from './helpers'

/**
 * Order lifecycle x aggregator (W4b spec 2). Ingests via the same
 * POST /ingest/order contract the real aggregator middleware will use
 * (CK1-API-003 §7), then drives the KDS UI through the full
 * NEW -> PREPARING -> READY -> COMPLETED stage advance (business-rules.md #2:
 * deduction fires on NEW->PREPARING, verified separately in
 * 3-cancel.spec.ts's stock-diff checks).
 */
test.describe('Order lifecycle x aggregator', () => {
  for (const aggregator of ['FOODPANDA', 'GRABFOOD'] as const) {
    test(`${aggregator}: ingest -> KDS -> PREPARING -> READY -> COMPLETED`, async ({ page, request }) => {
      const token = await apiLogin(request, ACCOUNTS.OWNER)
      const brand = await findBrand(request, token, 'Manila Lechon')
      const menuItem = await findMenuItem(request, token, brand.id, 'Lechon Rice')
      const ref = uniqueRef(aggregator)

      const { status, body } = await ingestOrder(request, token, {
        brand_id: brand.id,
        aggregator,
        external_ref: ref,
        customer_name: 'QA Bot',
        items: [{ menu_item_id: menuItem.id, qty: 2 }],
      })
      expect(status, `ingest failed: ${JSON.stringify(body)}`).toBe(201)
      expect(body.status).toBe('NEW')

      await loginUI(page, ACCOUNTS.OWNER)
      await page.goto('/kitchen')
      await expect(page.getByText(ref)).toBeVisible()
      await snap(page, `kds-${aggregator.toLowerCase()}-1-new`)

      // NEW -> PREPARING (business-rules.md #2: ingredient deduction fires here)
      await page.getByRole('button', { name: new RegExp(`Advance order ${ref} to PREPARING`) }).click()
      const toReady = page.getByRole('button', { name: new RegExp(`Advance order ${ref} to READY`) })
      await expect(toReady).toBeVisible()
      await snap(page, `kds-${aggregator.toLowerCase()}-2-preparing`)

      // PREPARING -> READY
      await toReady.click()
      const toCompleted = page.getByRole('button', { name: new RegExp(`Advance order ${ref} to COMPLETED`) })
      await expect(toCompleted).toBeVisible()
      await snap(page, `kds-${aggregator.toLowerCase()}-3-ready`)

      // READY -> COMPLETED — Kitchen.tsx drops COMPLETED orders from the board
      await toCompleted.click()
      await expect(page.getByText(ref)).toHaveCount(0)
      await snap(page, `kds-${aggregator.toLowerCase()}-4-completed`)
    })
  }
})
