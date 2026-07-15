import { defineConfig, devices } from '@playwright/test'

/**
 * PRE-PRODUCTION boundary-regression / full-auth-flow config.
 *
 * Targets the built FuzeFront UI on an ephemeral/local stack (or any BASE_URL
 * override) and drives the NEW provider-agnostic Security API flow
 * (`/api/v1/security/*`, contract PR #243). It is deliberately SEPARATE from:
 *   - `playwright.config.ts`        (component/e2e against the dev server)
 *   - `playwright.post-prod.config.ts` (read-only smoke vs the LIVE app)
 *
 * The headline test here is the PROVIDER-BOUNDARY GATE: during the whole Google
 * sign-in flow the browser must visit ONLY `app.fuzefront.com` and
 * `accounts.google.com`. Any navigation/request to `auth.fuzefront.com` (the
 * internal IdP host, which must never be browser-visible under the new model)
 * FAILS the run. See `tests/prod-full-auth-flow.spec.ts`.
 *
 * Run (boundary gate, real Chrome, headed, with a real Google test account):
 *   GOOGLE_TEST_EMAIL=... GOOGLE_TEST_PASSWORD=... \
 *     npx playwright test --config playwright.prod.config.ts --project chrome --headed --grep "@boundary"
 *
 * Override target:  PROD_BASE_URL=https://app.fuzefront.com npx playwright ...
 */
export default defineConfig({
  testDir: './tests',
  testMatch: /(prod-full-auth-flow|account-security-e2e)\.spec\.ts/,
  // Auth flows mutate session state and share the same test account — never
  // run them in parallel against one target.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-prod' }]],
  outputDir: 'test-results-prod',
  use: {
    baseURL: process.env.PROD_BASE_URL || 'https://app.fuzefront.com',
    trace: 'retain-on-failure',
    screenshot: 'on',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: false,
  },
  projects: [
    {
      // Headless Chromium — used for the non-Google boundary/API assertions
      // (signup T1, password T2, MFA, verification) that don't need Google's
      // real consent screen.
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
          : {},
      },
    },
    {
      // REAL Chrome (stable channel) with NO automation flags — Google's
      // consent screen (`accounts.google.com`) blocks obviously-automated
      // Chromium. The Google boundary path (T3) runs only here, headed.
      name: 'chrome',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        // Do NOT add --disable-blink-features=AutomationControlled etc.; the
        // whole point of this project is a browser Google will accept.
      },
    },
  ],
  timeout: 120_000,
  expect: { timeout: 20_000 },
})
