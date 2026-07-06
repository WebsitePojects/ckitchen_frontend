import { test, expect } from '@playwright/test'
import {
  ACCOUNTS,
  apiLogin,
  findBrand,
  findMenuItem,
  getInventory,
  getPrimaryOutlet,
  ingestOrder,
  loginUI,
  snap,
  uniqueRef,
} from './helpers'

/**
 * Cancellation rules (business-rules.md #2 + MOTM 2026-07-01 cancel-reason
 * requirement), verified against the real Pork ingredient balance:
 *   - cancel BEFORE PREPARING -> no stock change (deduction never fired)
 *   - cancel AFTER PREPARING  -> compensating restock (balance returns to baseline)
 * Both cancels go through the real KDS UI (reason-required dialog), not the API,
 * so the dialog itself is exercised and screenshotted.
 */

async function porkQty(request: import('@playwright/test').APIRequestContext, token: string, outletId: string): Promise<number> {
  const rows = await getInventory(request, token, outletId, 'KITCHEN')
  const pork = rows.find((r) => r.ingredient.name === 'Pork')
  expect(pork, 'expected a Pork ingredient row in KITCHEN inventory').toBeTruthy()
  return Number(pork!.quantity)
}

async function cancelViaKds(page: import('@playwright/test').Page, ref: string, reason: string): Promise<void> {
  const card = page.locator('div.group', { hasText: ref })
  await card.getByRole('button', { name: 'Cancel order' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText(ref)).toBeVisible()
  await page.waitForTimeout(300) // let the Radix open animation finish before the evidence screenshot
  await snap(page, `cancel-reason-modal-${ref}`)

  await dialog.getByPlaceholder(/customer cancelled/i).fill(reason)
  await dialog.getByRole('button', { name: 'Cancel order' }).click()
  await expect(dialog).toBeHidden()
}

test('cancel BEFORE preparing (still NEW) -> no stock change', async ({ page, request }) => {
  const token = await apiLogin(request, ACCOUNTS.OWNER)
  const outlet = await getPrimaryOutlet(request, token)
  const brand = await findBrand(request, token, 'Manila Lechon')
  const menuItem = await findMenuItem(request, token, brand.id, 'Lechon Rice')

  const baseline = await porkQty(request, token, outlet.id)

  const ref = uniqueRef('CANCEL-NEW')
  const { status, body } = await ingestOrder(request, token, {
    brand_id: brand.id,
    aggregator: 'FOODPANDA',
    external_ref: ref,
    items: [{ menu_item_id: menuItem.id, qty: 1 }],
  })
  expect(status).toBe(201)
  expect(body.status).toBe('NEW')

  await loginUI(page, ACCOUNTS.OWNER)
  await page.goto('/kitchen')
  await expect(page.getByText(ref)).toBeVisible()

  await cancelViaKds(page, ref, 'QA: customer changed mind before prep')
  await expect(page.getByText(ref)).toHaveCount(0)

  const after = await porkQty(request, token, outlet.id)
  expect(after, 'Pork balance must be untouched — deduction only fires at PREPARING (rule #2)').toBe(baseline)
})

test('cancel AFTER preparing -> compensating restock', async ({ page, request }) => {
  const token = await apiLogin(request, ACCOUNTS.OWNER)
  const outlet = await getPrimaryOutlet(request, token)
  const brand = await findBrand(request, token, 'Manila Lechon')
  const menuItem = await findMenuItem(request, token, brand.id, 'Lechon Rice')

  const baseline = await porkQty(request, token, outlet.id)

  const ref = uniqueRef('CANCEL-PREP')
  const { status, body } = await ingestOrder(request, token, {
    brand_id: brand.id,
    aggregator: 'GRABFOOD',
    external_ref: ref,
    items: [{ menu_item_id: menuItem.id, qty: 1 }],
  })
  expect(status).toBe(201)
  expect(body.status).toBe('NEW')

  await loginUI(page, ACCOUNTS.OWNER)
  await page.goto('/kitchen')
  await expect(page.getByText(ref)).toBeVisible()

  // NEW -> PREPARING: fires the 180g Pork deduction (1x Lechon Rice recipe portion)
  await page.getByRole('button', { name: new RegExp(`Advance order ${ref} to PREPARING`) }).click()
  await expect(page.getByRole('button', { name: new RegExp(`Advance order ${ref} to READY`) })).toBeVisible()

  const afterDeduction = await porkQty(request, token, outlet.id)
  expect(afterDeduction, 'Pork should be deducted once the order enters PREPARING').toBeLessThan(baseline)

  await cancelViaKds(page, ref, 'QA: kitchen ran out of a garnish, cancelling after prep started')
  await expect(page.getByText(ref)).toHaveCount(0)

  const afterCancel = await porkQty(request, token, outlet.id)
  expect(afterCancel, 'cancel-after-PREPARING must post a compensating restock back to baseline (rule #2)').toBe(baseline)
})
