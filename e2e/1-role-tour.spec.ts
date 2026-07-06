import { test, expect } from '@playwright/test'
import { ACCOUNTS, ROLE_ORDER, loginUI, snap } from './helpers'

/**
 * Per-role "day in the life" tour (W4b spec 1). For each of the 9 seed roles:
 *   - login -> assert the expected landing route (auth/access.ts ROLE_LANDING)
 *   - capture the sidebar nav items actually rendered (canAccess filtering)
 *   - screenshot the landing page
 *   - spot-check up to 2 other visible nav links for a 403 (sidebar/backend
 *     RBAC drift) — soft-asserted so one role's drift doesn't hide the rest
 */

test.describe('Per-role tour (9 roles)', () => {
  for (const roleKey of ROLE_ORDER) {
    const account = ACCOUNTS[roleKey]

    test(`${roleKey} logs in, lands on ${account.landing}, sidebar + 403 spot-check`, async ({ page }) => {
      const forbidden: string[] = []
      page.on('response', (res) => {
        if (res.url().includes('/api/v1/') && res.status() === 403) {
          forbidden.push(`${res.status()} ${res.request().method()} ${res.url()}`)
        }
      })

      await loginUI(page, account)
      expect(new URL(page.url()).pathname).toBe(account.landing)

      // Sidebar nav items actually rendered for this role (desktop rail —
      // default project viewport is >= lg breakpoint so it's not behind the
      // mobile Sheet).
      const navLinks = page.locator('nav a:visible')
      const count = await navLinks.count()
      const items: string[] = []
      const hrefs: string[] = []
      for (let i = 0; i < count; i++) {
        items.push((await navLinks.nth(i).innerText()).trim())
        hrefs.push((await navLinks.nth(i).getAttribute('href')) ?? '')
      }
      console.log(`[role-tour] ${roleKey} sidebar (${count} items): ${items.join(' | ')}`)
      expect(count, `${roleKey} should see at least one nav item`).toBeGreaterThan(0)

      await snap(page, `role-${roleKey.toLowerCase()}-landing`)

      // Spot-check up to 2 OTHER nav links (skip the one matching the current
      // landing route) for a client/backend RBAC mismatch (a visible link the
      // API 403s on).
      const candidates = hrefs.filter((h) => h && h !== account.landing).slice(0, 2)
      for (const href of candidates) {
        await page.goto(href)
        await page.waitForLoadState('networkidle').catch(() => undefined)
        const bodyText = await page.locator('body').innerText()
        expect
          .soft(/forbidden|403|not authorized/i.test(bodyText), `${roleKey}: ${href} shows a forbidden/error state in the body text`)
          .toBeFalsy()
      }

      expect.soft(forbidden, `${roleKey}: sidebar link(s) that 403 — RBAC drift between nav-items.ts and backend requireRole`).toEqual([])
    })
  }
})
