import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'

/**
 * ROOT Playwright config — the repo-level entry point for the PRE-PROD
 * APPROVED-FRAMES GATE (acceptance criterion #2 of the Federated App Platform).
 *
 * This config runs the self-contained frames-gate specs
 * (`frontend/tests/*-frames.spec.ts`) — currently the Federated App Platform
 * (`federated-apps-frames.spec.ts`, frames in `design/frames/federated-apps/`)
 * and Locked App Mode (`locked-app-mode-frames.spec.ts`, frames in
 * `design/frames/locked-app-mode/`). Each loads its approved static design
 * frames over `file://` and needs NO running stack, so it can gate a merge from
 * a cold checkout.
 *
 * The app-driven specs (sign-in, register→activate, FuzeClock load) live under
 * `frontend/` and run via `frontend/playwright.config.ts`
 * (`npm --prefix frontend run test:e2e`) and the E2E workflow, which brings up
 * Postgres + backend + frontend first.
 *
 * Run the frames gate:
 *   # Playwright resolves from frontend/node_modules (the workspace that owns it):
 *   npx --prefix frontend playwright test -c playwright.config.ts
 *   # or, with @playwright/test available at the repo root:
 *   npx playwright test
 */
export default defineConfig({
  // Only the frames-gate specs; the app-driven specs are owned by frontend/.
  testDir: path.join('frontend', 'tests'),
  testMatch: /-frames\.spec\.ts$/,

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-frames' }]],
  outputDir: 'test-results-frames',

  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'frames-gate',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  timeout: 30_000,
  expect: { timeout: 10_000 },
})
