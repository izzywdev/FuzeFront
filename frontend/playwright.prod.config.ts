/**
 * playwright.prod.config.ts
 *
 * Playwright config for running the three production auth-flow tests against
 * the live app at https://app.fuzefront.com.
 *
 * Quick-start:
 *   cd frontend
 *   POST_PROD_EMAIL=you@example.com POST_PROD_PASSWORD=yourpassword \
 *     npx playwright test --config playwright.prod.config.ts --headed
 *
 * Useful flags:
 *   --headed            open Chromium so you can watch
 *   --slowmo 500        slow each action by 500ms
 *   --project chromium  skip the mobile project
 *   --grep "T2"         run only the sign-in flow
 */

import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: '**/prod-full-auth-flow.spec.ts',

  fullyParallel: false,   // run flows sequentially so screenshots are ordered
  retries: 0,
  workers: 1,

  reporter: [['html', { outputFolder: 'playwright-report-prod', open: 'never' }]],

  outputDir: 'test-results-prod',

  use: {
    baseURL: process.env.BASE_URL || 'https://app.fuzefront.com',
    headless: true,
    trace: 'on',
    screenshot: 'on',
    video: 'on',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // T3 is excluded here — Google blocks Playwright Chromium's fingerprint.
      // Run T3 with --project chrome (real Chrome with saved sessions).
      grep: /T1|T2/,
    },
    {
      // T3 only: use real Chrome so Google accepts the login
      // Run: GOOGLE_TEST_EMAIL=izzy.weinberg@gmail.com npx playwright test
      //        --config playwright.prod.config.ts --project chrome --headed --grep T3
      name: 'chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome', headless: false },
      grep: /T3/,
    },
  ],

  timeout: 90_000,
  expect: { timeout: 15_000 },
})
