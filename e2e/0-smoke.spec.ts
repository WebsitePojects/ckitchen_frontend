import { test, expect } from '@playwright/test'
import { snap } from './helpers'

/**
 * Step-0 smoke spec. Per the W4b brief: if this fails to even launch/render,
 * STOP — Chromium/dev-server viability is out of scope to debug further here.
 */
test('login page renders the Orion brand mark', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByText('Orion', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Email address')).toBeVisible()
  await expect(page.getByLabel('Password')).toBeVisible()
  await snap(page, 'smoke-login')
})
