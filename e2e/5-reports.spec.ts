import { test, expect } from '@playwright/test'
import { ACCOUNTS, loginUI, snap } from './helpers'

/**
 * Reports (W4b spec 5). ACCOUNTING is the only seed role that sees the Sales
 * Report + export section (Analytics.tsx: `hasRole(user?.role, ['ACCOUNTING'])`
 * — the backend 403s everyone else on /reports/sales*). Exports are triggered
 * client-side via an axios blob + synthetic <a download> click
 * (Analytics.tsx `triggerBlobDownload`), which Chromium still surfaces as a
 * real `download` event Playwright can await.
 */
test('ACCOUNTING runs the sales report and exports Excel + PDF', async ({ page }) => {
  await loginUI(page, ACCOUNTS.ACCOUNTING)
  await expect(page).toHaveURL(/\/reports$/)

  await expect(page.getByText('Sales Report')).toBeVisible()
  // Let the default-range fetch settle before screenshotting/exporting.
  await page.waitForLoadState('networkidle').catch(() => undefined)
  await snap(page, 'reports-sales-report')

  const [xlsxDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /export excel/i }).click(),
  ])
  expect(xlsxDownload.suggestedFilename()).toMatch(/\.xlsx$/)

  const [pdfDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /export pdf/i }).click(),
  ])
  expect(pdfDownload.suggestedFilename()).toMatch(/\.pdf$/)
})
