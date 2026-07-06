import { test, expect } from '@playwright/test'
import { ACCOUNTS, loginUI, snap } from './helpers'

/**
 * Attendance / DTR (W4b spec 7) — every seed role can reach /attendance
 * (auth/access.ts EVERYONE list). Headless Chromium has no real camera, so
 * this only asserts the punch UI is present/reachable, not a real photo
 * capture (per the W4b brief).
 */
test('any role reaches /attendance and the punch UI is present', async ({ page }) => {
  await loginUI(page, ACCOUNTS.OWNER)
  await page.goto('/attendance')

  await expect(page.getByPlaceholder(/search your name or employee/i)).toBeVisible()
  await expect(page.getByText('Select employee')).toBeVisible()
  await expect(page.getByRole('button', { name: /time in/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /time out/i })).toBeVisible()

  await snap(page, 'attendance-punch-ui')
})
