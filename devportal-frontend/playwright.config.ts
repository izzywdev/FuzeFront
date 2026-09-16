import { defineConfig, devices } from '@playwright/test'

/**
 * PRE-PROD config for devportal-frontend — the standalone developers.fuzefront.com
 * Vite/React SPA (NOT a Module-Federation remote; sibling to fuzefront-website/,
 * not part of the `frontend/` host workspace). Mirrors
 * fuzefront-website/frontend/playwright.config.ts's pattern: build the app, serve
 * the static `dist/` via `vite preview`, and run Playwright against that —
 * self-contained, no live backend required (every devportal-service call the
 * specs exercise is intercepted with `page.route`, since services/devportal-service
 * is out of this suite's scope).
 *
 * Run:  npm run build && npm run test:e2e
 * (build first — `webServer` runs `vite preview`, which serves ./dist and does
 * not build it)
 *
 * RED-by-design: `e2e/*.red.spec.ts` assert the approved
 * design/frames/devportal/manifest.json contract (data-* hooks) against the
 * CURRENT stub pages (src/pages/*Page.tsx), which do not implement it yet. They
 * are expected to fail until frontend-engineer lands the five flow orchestrators.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL: process.env.BASE_URL || 'http://127.0.0.1:4185',
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
    {
      name: 'mobile',
      use: { ...devices['iPhone 12'] },
    },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'npm run preview -- --port 4185 --host 127.0.0.1',
        url: 'http://127.0.0.1:4185',
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
      },
  timeout: 30_000,
  expect: { timeout: 10_000 },
})
