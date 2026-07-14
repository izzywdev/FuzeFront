import { test, expect, type Locator } from '@playwright/test'
import { pathToFileURL } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * BUILT-APP PRE-PRODUCTION verification — the REAL React component.
 *
 * Independent front-end verification that the shipped `@fuzefront/billing-ui →
 * InvoiceHistoryPanel` matches the approved frames' acceptance contract. Where
 * `frames.spec.ts` pins the frozen *static* frames, this spec mounts the actual
 * React component (imported from source) with a stubbed `listInvoices`, over
 * `file://`, and asserts the SAME data-* contract against live render output +
 * state transitions (loading / empty / error+retry / load-more).
 *
 * Harness (lightest that runs here): a tiny esbuild bundle of
 * `harness/entry.tsx` (the component + a mock) rendered into `.harness/index.html`.
 * Chromium is preinstalled; no dev server, no stack. React is force-aliased to a
 * single copy so the component's own node_modules React cannot cause a duplicate-
 * React "invalid hook call".
 *
 * If the harness build deps (esbuild / react / react-dom) are NOT installed in
 * this directory, every test here SKIPS CLEANLY with the exact install command —
 * never a hard failure. Run it where the deps exist with:
 *
 *   cd tests/e2e/billing-invoices
 *   PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install
 *   npx playwright test -c playwright.config.ts built-component.spec.ts
 */

const HARNESS_DIR = path.join(__dirname, 'harness')
const BUILD_DIR = path.join(__dirname, '.harness')
const ENTRY = path.join(HARNESS_DIR, 'entry.tsx')
const BUNDLE = path.join(BUILD_DIR, 'bundle.js')
const HTML = path.join(BUILD_DIR, 'index.html')

const INSTALL_HINT =
  'cd tests/e2e/billing-invoices && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install'

/** Resolve the harness build deps up-front (synchronously) so the whole suite
 *  can skip cleanly at collection time when they are absent. */
function resolveHarnessDeps(): { ok: boolean; reason: string } {
  for (const mod of ['esbuild', 'react', 'react-dom/client', 'react/jsx-runtime']) {
    try {
      require.resolve(mod)
    } catch {
      return {
        ok: false,
        reason: `built-component harness deps absent (cannot resolve "${mod}"). Install with: ${INSTALL_HINT}`,
      }
    }
  }
  return { ok: true, reason: '' }
}

const deps = resolveHarnessDeps()

/** Vendor brand names that must NEVER leak into the rendered UI (word-boundary,
 *  case-insensitive) — identical rule to the frames spec. */
const VENDOR_NAME = /\b(stripe|link)\b/i

async function assertNoVendorNameLeak(scope: Locator) {
  const outerHtml = (await scope.evaluate((el) => el.outerHTML)).toLowerCase()
  expect(
    outerHtml,
    'a vendor brand name ("stripe"/"link") leaked into the built invoice panel DOM'
  ).not.toMatch(VENDOR_NAME)
}

/** Build the harness bundle once (single React copy via alias). */
function buildBundle() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const esbuild = require('esbuild')
  mkdirSync(BUILD_DIR, { recursive: true })
  esbuild.buildSync({
    entryPoints: [ENTRY],
    bundle: true,
    outfile: BUNDLE,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
    // Force ONE React instance regardless of billing-ui's local node_modules.
    alias: {
      react: require.resolve('react'),
      'react-dom': require.resolve('react-dom'),
      'react-dom/client': require.resolve('react-dom/client'),
      'react/jsx-runtime': require.resolve('react/jsx-runtime'),
    },
  })
  // Static, test-only harness page (constant HTML; the <script src> is a fixed
  // local path to our own esbuild bundle — no external/dynamic input). Not a web
  // response and never served to users.
  // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag
  writeFileSync(
    HTML,
    `<!doctype html><html><head><meta charset="utf-8"><title>invoice-history harness</title></head><body><div id="root"></div><script src="./bundle.js"></script></body></html>`,
    'utf-8'
  )
}

/** file:// URL for a scenario (hash selects the mock in entry.tsx). */
function harnessUrl(scenario: string): string {
  return `${pathToFileURL(HTML).href}#${scenario}`
}

test.describe('Billing invoice history — built React component (pre-production)', () => {
  test.skip(!deps.ok, deps.reason)

  test.beforeAll(() => {
    buildBundle()
  })

  /** Navigate + wait for React's first commit. */
  async function open(page: import('@playwright/test').Page, scenario: string) {
    await page.goto(harnessUrl(scenario))
    await page.waitForFunction(
      () => (window as unknown as { __HARNESS_READY__?: boolean }).__HARNESS_READY__ === true
    )
  }

  test('populated: panel + rows + statuses + accessible download links + load-more', async ({
    page,
  }) => {
    await open(page, 'populated')

    const panel = page.locator("[data-panel='invoice-history']")
    await expect(panel).toHaveCount(1)
    await expect(panel).toHaveAttribute('data-testid', 'invoice-history-panel')

    // Four rows from the mocked data, in the invoice list container.
    await expect(panel.locator('[data-invoice-list]')).toBeVisible()
    const rows = panel.locator('[data-invoice]')
    await expect(rows).toHaveCount(4)
    await expect(panel.locator("[data-invoice-count='4']")).toBeVisible()

    // FF-2026-0042 is paid — same anchor assertion as the frames spec.
    await expect(
      panel.locator("[data-invoice='FF-2026-0042'][data-status='paid']")
    ).toHaveCount(1)

    // Status pills map paid/open/void/uncollectible to their DS tone class.
    const toneByStatus: Record<string, string> = {
      paid: 'success',
      open: 'warning',
      void: 'neutral',
      uncollectible: 'error',
    }
    for (const [status, tone] of Object.entries(toneByStatus)) {
      const row = panel.locator(`[data-status='${status}']`)
      await expect(row, `row with status ${status} missing`).toHaveCount(1)
      await expect(
        row.locator(`.ffb-invoices__pill--${tone}`),
        `status ${status} did not map to the "${tone}" pill tone`
      ).toBeVisible()
    }

    // Every row exposes a download link with a non-empty accessible name that
    // resolves via role+name (real a11y wiring, not just an attribute).
    const downloads = panel.locator('[data-download]')
    await expect(downloads).toHaveCount(4)
    const rowCount = await rows.count()
    for (let i = 0; i < rowCount; i++) {
      const row = rows.nth(i)
      const invoiceId = await row.getAttribute('data-invoice')
      const dl = row.locator('[data-download]')
      await expect(dl, `row ${invoiceId} missing its download link`).toHaveCount(1)
      // data-download is pdf|hosted (opaque), never a vendor name.
      expect(await dl.getAttribute('data-download')).toMatch(/^(pdf|hosted)$/)
      const accessibleName = (await dl.getAttribute('aria-label'))?.trim() ?? ''
      expect(
        accessibleName.length,
        `download link for ${invoiceId} has no accessible name`
      ).toBeGreaterThan(0)
      await expect(page.getByRole('link', { name: accessibleName })).toBeVisible()
      // Hosted document href is https and vendor-neutral.
      expect((await dl.getAttribute('href')) ?? '').toMatch(/^https:\/\//i)
    }

    // Cursor pagination control present (nextCursor advertised).
    await expect(panel.locator("[data-action='load-more']")).toBeVisible()

    // No vendor name anywhere in the rendered panel.
    await assertNoVendorNameLeak(panel)
  })

  test('load-more: fetches + appends the next cursor page, then hides the control', async ({
    page,
  }) => {
    await open(page, 'loadmore')

    const panel = page.locator("[data-panel='invoice-history']")
    const rows = panel.locator('[data-invoice]')
    await expect(rows).toHaveCount(2)

    const loadMore = panel.locator("[data-action='load-more']")
    await expect(loadMore).toBeVisible()
    await loadMore.click()

    // Page 2 appended -> 4 rows; control gone (nextCursor now null).
    await expect(rows).toHaveCount(4)
    await expect(panel.locator("[data-invoice='FF-2026-0038']")).toHaveCount(1)
    await expect(loadMore).toHaveCount(0)
    await assertNoVendorNameLeak(panel)
  })

  test('empty: renders the empty state', async ({ page }) => {
    await open(page, 'empty')

    const panel = page.locator("[data-panel='invoice-history']")
    await expect(panel).toHaveAttribute('data-state', 'empty')
    await expect(panel.locator('[data-empty]')).toBeVisible()
    await expect(panel.locator("[data-testid='invoice-empty']")).toBeVisible()
    await expect(panel.locator('[data-invoice]')).toHaveCount(0)
    await assertNoVendorNameLeak(panel)
  })

  test('loading: renders the skeleton loading state', async ({ page }) => {
    await open(page, 'loading')

    const panel = page.locator("[data-panel='invoice-history']")
    await expect(panel).toHaveAttribute('data-state', 'loading')
    await expect(panel).toHaveAttribute('aria-busy', 'true')
    // The skeleton container is present; its placeholder rows carry no text and
    // the harness intentionally loads no stylesheet, so assert attachment (the
    // structural contract) rather than a painted bounding box — same convention
    // the frames spec uses for the loading state.
    await expect(panel.locator("[data-testid='invoice-loading']")).toBeAttached()
    await expect(panel.locator('[data-invoice]')).toHaveCount(0)
  })

  test('error + retry: error state exposes retry; retry recovers to the list', async ({
    page,
  }) => {
    await open(page, 'error')

    const panel = page.locator("[data-panel='invoice-history']")
    await expect(panel).toHaveAttribute('data-state', 'error')
    await expect(panel.locator('[data-error]')).toBeVisible()

    const retry = panel.locator("[data-action='retry']")
    await expect(retry).toBeVisible()
    // Accessible-name wiring: the retry control is reachable as a button.
    await expect(page.getByRole('button', { name: /try again/i })).toBeVisible()

    await retry.click()

    // Recovered: rows render, error state cleared.
    await expect(panel.locator('[data-invoice]')).toHaveCount(4)
    await expect(panel.locator('[data-error]')).toHaveCount(0)
    await assertNoVendorNameLeak(panel)
  })

  test('no vendor name leaks across any state', async ({ page }) => {
    for (const scenario of ['populated', 'empty', 'error']) {
      await open(page, scenario)
      await assertNoVendorNameLeak(page.locator("[data-panel='invoice-history']"))
    }
  })
})
