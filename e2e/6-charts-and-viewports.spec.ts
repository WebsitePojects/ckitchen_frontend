import { test, expect } from '@playwright/test'
import { ACCOUNTS, loginUI, snap } from './helpers'

/**
 * W4a chart verification + desktop/mobile screenshot evidence (W4b spec 6).
 * Runs AFTER 2/3/4-*.spec.ts on purpose (numeric file ordering — Playwright
 * with workers:1 runs test files in discovery order) so the Dashboard's
 * orders-over-time / aggregator-split / top-brands charts have real order
 * data behind them instead of empty-state placeholders.
 */

const MOBILE = { width: 375, height: 812 }
const DESKTOP = { width: 1280, height: 800 }

test.describe('Dashboard charts render with real data', () => {
  test('3 recharts charts render (not empty-state) on Dashboard', async ({ page }) => {
    await loginUI(page, ACCOUNTS.OWNER)
    await expect(page).toHaveURL(/\/$/)
    await page.waitForLoadState('networkidle').catch(() => undefined)

    // Scope to each chart's own Card so an empty-state (no <svg> at all) on
    // any ONE chart is caught precisely, rather than asserting a brittle
    // exact total (recharts' default <Legend> also renders its own small
    // svg.recharts-surface per icon, so the page-wide count is >3, not ==3).
    for (const title of ['Orders Today', 'Aggregator Split', 'Top Brands']) {
      const card = page.locator('div.rounded-xl', { hasText: title })
      await expect(card.locator('svg.recharts-surface').first(), `"${title}" chart never rendered an svg — still an empty-state?`).toBeVisible({ timeout: 15_000 })
    }
  })
})

test.describe('Desktop + mobile screenshots', () => {
  const pages: Array<{ path: string; name: string }> = [
    { path: '/', name: 'dashboard' },
    { path: '/kitchen', name: 'kitchen' },
    { path: '/tv', name: 'tv' },
  ]

  for (const { path, name } of pages) {
    test(`${name} — desktop (${DESKTOP.width}x${DESKTOP.height}) + mobile (${MOBILE.width}x${MOBILE.height})`, async ({ page }) => {
      await loginUI(page, ACCOUNTS.OWNER)

      await page.setViewportSize(DESKTOP)
      await page.goto(path)
      await page.waitForLoadState('networkidle').catch(() => undefined)
      await snap(page, `viewport-${name}-desktop`)

      await page.setViewportSize(MOBILE)
      await page.goto(path)
      await page.waitForLoadState('networkidle').catch(() => undefined)
      await snap(page, `viewport-${name}-mobile`)
    })
  }
})
