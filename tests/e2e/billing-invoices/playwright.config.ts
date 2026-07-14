import { defineConfig, devices } from '@playwright/test'

/**
 * INDEPENDENT front-end verification for the Billing "Invoice history" UI.
 *
 * This config is intentionally SELF-CONTAINED and scoped to
 * `tests/e2e/billing-invoices/` for two reasons:
 *
 *   1. The repo-root `playwright.config.ts` is dedicated to the
 *      federated-apps approved-frames gate (`testMatch: federated-apps-frames`)
 *      and must stay that way — it is a merge gate other agents own.
 *   2. This feature's UI component (`@fuzefront/billing-ui → InvoiceHistoryPanel`)
 *      is NOT built yet (gated on UX approval). So the specs here run in two
 *      phases that need different (or no) infrastructure:
 *
 *        - frames.spec.ts        pre-production, `file://` frozen approval
 *                                frames — no stack, no server.
 *        - postprod.smoke.spec.ts post-production synthetic smoke against a
 *                                live BASE_URL — skips cleanly when unset.
 *
 * The built-app e2e (React InvoiceHistoryPanel on an ephemeral kind stack) is
 * added here once the component ships.
 *
 * Chromium is preinstalled at /opt/pw-browsers (PLAYWRIGHT_BROWSERS_PATH).
 * The Claude Code environment ships a fixed executable; when
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH is set we use it, otherwise Playwright
 * resolves the browser from its own cache (as on CI after `playwright install`).
 */
export default defineConfig({
  testDir: __dirname,
  testMatch: /\.spec\.ts$/,

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',

  use: {
    // Post-prod smoke target; the frames spec ignores this (it uses file://).
    baseURL: process.env.BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
          : {},
      },
    },
  ],

  timeout: 30_000,
  expect: { timeout: 10_000 },
})
