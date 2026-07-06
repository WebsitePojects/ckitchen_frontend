import { defineConfig, devices } from '@playwright/test'

/**
 * ORION W4b Playwright E2E suite.
 *
 * Boots BOTH the backend (port 4000) and the frontend (port 5173) as
 * `webServer` entries so `npm run e2e` is a single self-contained command.
 *
 * DB safety (read this before touching webServer.env): the backend's own
 * `.env` currently has `DATABASE_URL` pointed at the REAL Supabase cloud
 * Postgres project. If the backend dev server inherited that as-is, this
 * suite would ingest/cancel/advance orders against production data. To
 * avoid that:
 *   - NODE_ENV=test makes src/config.ts skip loading `.env` entirely
 *     (`if (process.env.NODE_ENV !== "test" && existsSync(".env"))`), so only
 *     the env vars listed below apply.
 *   - DATABASE_URL is deliberately NOT set below, so `config.ts` falls back
 *     to the file-backed PGlite store at `ckitchen_backend/.data/ck.db`
 *     (already migrated + seeded — see e2e/README notes in qa-notes.md).
 *   - NODE_ENV=test also raises the login-rate-limit ceiling (config.ts) so
 *     the many per-role logins across this suite don't trip the 10/15min
 *     production default.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    screenshot: 'on',
    trace: 'on-first-retry',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npm run dev',
      cwd: '../ckitchen_backend',
      url: 'http://localhost:4000/api/v1/health',
      // Deliberately NOT reusing an existing server: if something is already
      // listening on :4000 we don't know what env it was started with (could
      // be pointed at Supabase) — fail loud instead of silently trusting it.
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NODE_ENV: 'test',
        PORT: '4000',
      },
    },
    {
      command: 'npm run dev',
      cwd: '.',
      url: 'http://localhost:5173',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
