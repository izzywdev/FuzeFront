import { defineConfig, devices } from '@playwright/test'

/** Browser contract for the FuzeQuality federated remote. */
export default defineConfig({
  testDir: './tests/fuzequality',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-fuzequality' }]] : 'list',
  // Keep a compact replay for every passing and failing UX contract. CI transcodes
  // these recordings to a 3fps evidence artifact so review does not require a full
  // real-time capture.
  use: {
    baseURL: 'http://127.0.0.1:4181',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: { mode: 'on', size: { width: 960, height: 540 } },
  },
  webServer: { command: 'npm --prefix ../FuzeQuality run dev:web -- --host 127.0.0.1', url: 'http://127.0.0.1:4181', reuseExistingServer: !process.env.CI },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
