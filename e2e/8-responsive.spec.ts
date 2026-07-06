import { test, expect } from '@playwright/test'
import { ACCOUNTS, loginUI } from './helpers'

/**
 * Responsive overflow check (W4b spec 8 / W4a mobile-pass verification).
 * At each breakpoint, the page body must never force horizontal scroll —
 * ui-refinement-w4.md rule #4 ("responsive verified at 375/768/1024/1440").
 */
const VIEWPORTS = [
  { width: 375, height: 812, label: '375' },
  { width: 768, height: 1024, label: '768' },
  { width: 1280, height: 800, label: '1280' },
]

const PAGES = [
  { path: '/', name: 'Dashboard' },
  { path: '/kitchen', name: 'Kitchen' },
  { path: '/orders', name: 'Orders (table page)' },
]

for (const { path, name } of PAGES) {
  test(`${name} has no horizontal body overflow at 375 / 768 / 1280`, async ({ page }) => {
    await loginUI(page, ACCOUNTS.OWNER)

    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await page.goto(path)
      await page.waitForLoadState('networkidle').catch(() => undefined)

      const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.body.scrollWidth,
        innerWidth: window.innerWidth,
      }))
      expect(
        scrollWidth,
        `${name} at ${vp.label}px: body.scrollWidth=${scrollWidth} > window.innerWidth=${innerWidth} (horizontal overflow)`,
      ).toBeLessThanOrEqual(innerWidth + 1)
    }
  })
}
