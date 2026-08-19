import { test, expect, type Locator } from '@playwright/test'
import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * PRE-PRODUCTION verification — the FROZEN approved design frames.
 *
 * Independent front-end verification for the Billing "Invoice history" UI. The
 * React component (`@fuzefront/billing-ui → InvoiceHistoryPanel`) is NOT built
 * yet — it is gated on UX approval — so this pass pins the *frozen visual +
 * structural contract* the implementation will be checked against, using the
 * static approval frames in `design/frames/billing-invoices/` over `file://`
 * (no stack, no server — mirrors the repo's federated-apps frames gate).
 *
 * The stable selectors are the manifest `testHooks` / `data-*` attributes, so
 * these assertions survive markup churn as long as the data contract holds.
 *
 * When the component ships, the built-app e2e (React panel on an ephemeral kind
 * stack / contract mock) is added alongside this file; this frames gate stays.
 */

// design/frames/billing-invoices relative to this spec (tests/e2e/billing-invoices/).
const FRAMES_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'design',
  'frames',
  'billing-invoices'
)

type ManifestFrame = {
  id: string
  file: string
  label: string
  route: string
  summary: string
  testHooks: string[]
}
type Manifest = {
  name: string
  entry: string
  frames: ManifestFrame[]
  contract: { component: string; featureFlag: string }
}

const manifest: Manifest = JSON.parse(
  readFileSync(path.join(FRAMES_DIR, 'manifest.json'), 'utf-8')
)

function frameUrl(file: string): string {
  return pathToFileURL(path.join(FRAMES_DIR, file)).href
}

/** Vendor brand names that must NEVER leak into the rendered UI (word-boundary,
 *  case-insensitive). The invoice panel is vendor-neutral: ids/status/amount are
 *  served from FuzeFront's own store; the download link is an opaque hosted doc. */
const VENDOR_NAME = /\b(stripe|link)\b/i

async function assertNoVendorNameLeak(scope: Locator) {
  // Scope to the panel subtree (NOT the whole document) so the stylesheet
  // <link> in <head> is not a false positive — we care about what the panel
  // actually renders to the user, text and attribute values alike.
  const outerHtml = (await scope.evaluate((el) => el.outerHTML)).toLowerCase()
  expect(
    outerHtml,
    'a vendor brand name ("stripe"/"link") leaked into the invoice panel DOM'
  ).not.toMatch(VENDOR_NAME)
}

test.describe('Billing invoice history — approved frames (pre-production gate)', () => {
  test('manifest defines the frozen two-frame sequence + vendor-neutral contract', () => {
    // The ordered frame sequence the flow is verified against.
    expect(manifest.frames.map((f) => f.id)).toEqual([
      '01-invoice-history',
      '02-states',
    ])
    expect(manifest.entry).toBe('index.html')
    expect(manifest.contract.component).toContain('InvoiceHistoryPanel')
    expect(manifest.contract.featureFlag).toBe('fuzefront.billing.invoice-history')
  })

  // Manifest-driven: every declared testHook selector must resolve in its frame.
  for (const frame of manifest.frames) {
    test(`${frame.id}: every manifest testHook selector is present`, async ({ page }) => {
      await page.goto(frameUrl(frame.file))
      await expect(
        page.locator(`[data-frame='${frame.id}']`),
        `frame identity marker [data-frame='${frame.id}'] missing`
      ).toBeAttached()
      for (const hook of frame.testHooks) {
        await expect(
          page.locator(hook).first(),
          `${frame.id}: declared testHook "${hook}" not found`
        ).toBeAttached()
      }
    })
  }

  test('01-invoice-history: populated list structural contract', async ({ page }) => {
    await page.goto(frameUrl('01-invoice-history.html'))

    const panel = page.locator("[data-panel='invoice-history']")
    await expect(panel).toBeAttached()
    await expect(panel).toHaveCount(1)

    // Exactly 4 invoice rows.
    const rows = panel.locator('[data-invoice]')
    await expect(rows).toHaveCount(4)

    // FF-2026-0042 is paid.
    await expect(
      panel.locator("[data-invoice='FF-2026-0042'][data-status='paid']")
    ).toHaveCount(1)

    // Every row exposes a download link with a non-empty accessible name.
    const downloads = panel.locator('[data-download]')
    await expect(downloads).toHaveCount(4)
    const rowCount = await rows.count()
    for (let i = 0; i < rowCount; i++) {
      const row = rows.nth(i)
      const invoiceId = await row.getAttribute('data-invoice')
      const dl = row.locator('[data-download]')
      await expect(
        dl,
        `row ${invoiceId} is missing its [data-download] link`
      ).toHaveCount(1)
      // Accessible name for these <a> elements comes from aria-label.
      const accessibleName = (await dl.getAttribute('aria-label'))?.trim() ?? ''
      expect(
        accessibleName.length,
        `download link for ${invoiceId} has no accessible name`
      ).toBeGreaterThan(0)
      // The link must resolve via role+name (real a11y wiring, not just an attr).
      await expect(
        page.getByRole('link', { name: accessibleName })
      ).toBeVisible()
    }

    // Cursor pagination control.
    await expect(panel.locator("[data-action='load-more']")).toBeAttached()

    // Vendor-neutral: no "stripe"/"link" anywhere in the panel.
    await assertNoVendorNameLeak(panel)
  })

  test('02-states: loading / empty / error+retry / uncollectible variants present', async ({
    page,
  }) => {
    await page.goto(frameUrl('02-states.html'))

    // Loading skeleton state.
    await expect(page.locator("[data-state='loading']")).toBeAttached()

    // Empty state carries its empty marker.
    const empty = page.locator("[data-state='empty']")
    await expect(empty).toBeAttached()
    await expect(empty.locator('[data-empty]')).toBeAttached()

    // Error state carries a retry action.
    const error = page.locator("[data-state='error']")
    await expect(error).toBeAttached()
    await expect(error.locator("[data-action='retry']")).toBeAttached()
    await expect(
      error.getByRole('button', { name: /try again/i })
    ).toBeVisible()

    // Uncollectible status-pill variant.
    await expect(
      page.locator("[data-status='uncollectible']")
    ).toBeAttached()

    // Every panel on the states frame is vendor-neutral too.
    const panels = page.locator("[data-panel='invoice-history']")
    const panelCount = await panels.count()
    expect(panelCount).toBeGreaterThanOrEqual(4)
    for (let i = 0; i < panelCount; i++) {
      await assertNoVendorNameLeak(panels.nth(i))
    }
  })

  test('index → frames flow: entry links to both frames in order', async ({ page }) => {
    await page.goto(frameUrl(manifest.entry))
    for (const frame of manifest.frames) {
      await expect(
        page.locator(`a[href='${frame.file}']`),
        `entry index.html is missing the ordered link to ${frame.file}`
      ).toBeVisible()
    }
  })
})
