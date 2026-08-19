import { defineConfig, devices } from '@playwright/test'

/**
 * Post-production smoke / synthetic config — runs READ-ONLY against the LIVE
 * deployed platform (default https://app.fuzefront.com).
 *
 * This is deliberately SEPARATE from `playwright.config.ts` (which targets the
 * local/ephemeral stack). Post-prod checks confirm the real deployment works:
 * the MF shell serves, sign-in succeeds, and Module-Federation remote apps
 * actually load — no mixed-content/CSP/federation-load regressions.
 *
 * Run:  npx playwright test --config playwright.post-prod.config.ts
 * Override target: POST_PROD_BASE_URL=https://staging.example npx playwright ...
 */
export default defineConfig({
  testDir: './e2e/post-prod',
  // These hit a live network target; never run in parallel against prod.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // Live network can blip; one retry smooths transient flakiness without
  // masking a real outage (a real outage fails both attempts).
  retries: process.env.CI ? 2 : 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-post-prod' }]],
  outputDir: 'test-results-post-prod',
  use: {
    baseURL: process.env.POST_PROD_BASE_URL || 'https://app.fuzefront.com',
    trace: 'retain-on-failure',
    screenshot: 'on',
    video: 'retain-on-failure',
    // Live TLS endpoint; don't ignore HTTPS errors — a cert/mixed-content
    // problem is exactly the kind of prod regression we want to catch.
    ignoreHTTPSErrors: false,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Live calls (login round-trip + MF remote fetch) can be slow.
  timeout: 90_000,
  expect: { timeout: 20_000 },
})
