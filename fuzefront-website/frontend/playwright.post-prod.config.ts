import { defineConfig, devices } from '@playwright/test'

/**
 * POST-PRODUCTION config — runs the same navigation + contrast specs
 * READ-ONLY against the LIVE site (default https://fuzefront.com). Mirrors
 * the main app's playwright.post-prod.config.ts pattern (see
 * ../../frontend/playwright.post-prod.config.ts).
 *
 * Run:  npx playwright test --config playwright.post-prod.config.ts
 * Override target: POST_PROD_BASE_URL=https://staging.example npx playwright ...
 */
export default defineConfig({
  testDir: './e2e',
  testIgnore: '**/post-prod/**',
  // Live network target — never hammer it in parallel.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-post-prod' }]],
  outputDir: 'test-results-post-prod',
  use: {
    baseURL: process.env.POST_PROD_BASE_URL || 'https://fuzefront.com',
    trace: 'retain-on-failure',
    screenshot: 'on',
    ignoreHTTPSErrors: false,
    // See playwright.config.ts — use the sandbox/CI image's preinstalled
    // Chromium when present, instead of the version this package would
    // otherwise expect.
    launchOptions: process.env.PLAYWRIGHT_BROWSERS_PATH ? { executablePath: '/opt/pw-browsers/chromium' } : undefined,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  timeout: 90_000,
  expect: { timeout: 20_000 },
})
