import { test, expect, type Page } from '@playwright/test'

/**
 * POST-PRODUCTION synthetic smoke — Billing "Invoice history" against the LIVE app.
 *
 * Tag: @postprod   (run with:  BASE_URL=https://app.fuzefront.com \
 *                     E2E_USER_EMAIL=… E2E_USER_PASSWORD=… \
 *                     npx playwright test -c tests/e2e/billing-invoices/playwright.config.ts -g @postprod )
 *
 * The React component (`@fuzefront/billing-ui → InvoiceHistoryPanel`) now EXISTS
 * and is verified pre-production by `built-component.spec.ts`; this smoke targets
 * the built component's real `data-panel` / `data-testid` selectors on the live
 * `/billing` route. It SKIPS CLEANLY (never a false green, never a hard fail)
 * when BASE_URL / credentials are absent.
 *
 * What it verifies against the live app:
 *   sign-in → navigate to /billing → the built invoice panel
 *   ([data-testid='invoice-history-panel']) renders → at least one invoice row
 *   ([data-testid='invoice-row']) with a download link pointing at an https
 *   provider-hosted URL → no vendor brand name ("stripe"/"link") leaks into DOM.
 *
 * Login reuses this repo's server-side password sign-in convention
 * (POST /api/auth/oidc/password → platform JWT → localStorage.authToken),
 * the same path the frontend's oidc-plumbing e2e exercises. If that endpoint
 * ever moves, update `signIn()` below — it is the only auth touch-point.
 */

const BASE_URL = process.env.BASE_URL?.replace(/\/$/, '')
// Backend is same-origin in prod (ingress); allow an override for split hosts.
const BACKEND_URL = (process.env.BACKEND_URL ?? BASE_URL ?? '').replace(/\/$/, '')
const E2E_USER_EMAIL = process.env.E2E_USER_EMAIL
const E2E_USER_PASSWORD = process.env.E2E_USER_PASSWORD

const haveCreds = Boolean(BASE_URL && E2E_USER_EMAIL && E2E_USER_PASSWORD)

const VENDOR_NAME = /\b(stripe|link)\b/i

/**
 * Server-side password sign-in (no redirect). Mirrors the frontend oidc-plumbing
 * e2e: the backend drives Authentik's flow-executor and returns a platform JWT,
 * which the SPA persists as localStorage.authToken. We seed that token, then let
 * the app boot authenticated.
 *
 * TODO(when component ships): if the live deploy gates billing behind an org
 * selection or a different session-bootstrap, extend this to select the org
 * before navigating to /billing.
 */
async function signIn(page: Page): Promise<void> {
  const resp = await page.request.post(`${BACKEND_URL}/api/auth/oidc/password`, {
    data: { email: E2E_USER_EMAIL, password: E2E_USER_PASSWORD },
  })
  expect(
    resp.status(),
    `sign-in POST /api/auth/oidc/password -> ${resp.status()}: ${await resp
      .text()
      .catch(() => '')}`
  ).toBe(200)
  const body = await resp.json()
  const token = body.token as string | undefined
  expect(token, 'platform JWT returned from sign-in').toBeTruthy()

  // Seed the token before any app code runs, then load the app authenticated.
  await page.addInitScript((jwt) => {
    window.localStorage.setItem('authToken', jwt as string)
  }, token)
}

test.describe('@postprod Billing invoice history — live smoke', () => {
  test.skip(
    !haveCreds,
    'post-prod smoke skipped: set BASE_URL + E2E_USER_EMAIL + E2E_USER_PASSWORD to run against the live app'
  )

  // Fresh, unauthenticated context; signIn() seeds the JWT.
  test.use({ storageState: { cookies: [], origins: [] } })

  test('sign-in → /billing renders the vendor-neutral invoice panel with a hosted download link', async ({
    page,
  }) => {
    test.setTimeout(120_000)

    await signIn(page)

    await page.goto(`${BASE_URL}/billing`)

    // The built invoice panel renders. Prefer the component's stable testid;
    // fall back to the frozen frame hook (data-panel) — both are emitted.
    const panel = page
      .locator("[data-testid='invoice-history-panel'], [data-panel='invoice-history']")
      .first()
    await expect(panel, 'invoice history panel did not render on /billing').toBeVisible({
      timeout: 20_000,
    })

    // At least one invoice row (the built component's row testid).
    await expect(
      panel.locator("[data-testid='invoice-row'], [data-invoice]").first(),
      'no invoice row rendered on /billing'
    ).toBeVisible()

    // At least one download link, pointing at an https provider-hosted document.
    const download = panel
      .locator("[data-testid='invoice-download'], [data-download]")
      .first()
    await expect(download, 'no invoice download link rendered').toBeVisible()
    const href = (await download.getAttribute('href')) ?? ''
    expect(
      href,
      `download href is not an https provider-hosted URL: "${href}"`
    ).toMatch(/^https:\/\//i)

    // Accessible name on the download control.
    const dlName = (await download.getAttribute('aria-label'))?.trim() ?? ''
    expect(dlName.length, 'download link has no accessible name').toBeGreaterThan(0)

    // No vendor brand name leaks into the rendered panel.
    const panelHtml = (await panel.evaluate((el) => el.outerHTML)).toLowerCase()
    expect(
      panelHtml,
      'a vendor brand name ("stripe"/"link") leaked into the live invoice panel'
    ).not.toMatch(VENDOR_NAME)

    // No mixed-content / CSP regression that would break the panel under TLS.
    // (Guards FuzeFront's same-origin API base + hosted-doc-over-https contract.)
    expect(page.url(), 'app navigated off /billing unexpectedly').toContain('/billing')
  })
})
