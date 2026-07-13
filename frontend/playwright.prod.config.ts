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
    },
  ],

  timeout: 90_000,
  expect: { timeout: 15_000 },
})
