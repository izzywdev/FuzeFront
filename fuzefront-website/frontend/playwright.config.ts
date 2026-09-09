import { defineConfig, devices } from '@playwright/test'

/**
 * PRE-PROD config — runs against a locally built + previewed copy of the
 * site (`vite build` + `vite preview`), started automatically via
 * `webServer` below. This is what CI runs on every PR touching this site.
 *
 * Run:  npm run build && npm run test:e2e
 * (build first — `webServer` runs `vite preview`, which serves ./dist and
 * does not build it)
 */
export default defineConfig({
  testDir: './e2e',
  testIgnore: '**/post-prod/**',
  // Sequential, not parallel: contrast.spec.ts screenshots each visible text
  // element individually, many times per page. Multiple worker PROCESSES
  // each running their own Chromium and competing for the same CPU can cause
  // an occasional screenshot to capture an incomplete/stale paint frame under
  // contention — a real flake in the MEASUREMENT, not in the site. One
  // worker removes that variable; the suite is small enough (15 routes) that
  // running it sequentially is still fast.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL: process.env.BASE_URL || 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // The sandbox/CI image ships a preinstalled Chromium at a fixed path
    // (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1) rather than whatever revision this
    // @playwright/test version would otherwise expect — point at it directly.
    launchOptions: process.env.PLAYWRIGHT_BROWSERS_PATH ? { executablePath: '/opt/pw-browsers/chromium' } : undefined,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'npm run preview -- --port 4173 --host 127.0.0.1',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
      },
  timeout: 60_000,
  expect: { timeout: 10_000 },
})
