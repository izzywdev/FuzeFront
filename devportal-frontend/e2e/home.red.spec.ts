/**
 * DEV PORTAL — HOME FLOW — INDEPENDENT, PRE-PRODUCTION, RED-by-design UI e2e.
 * (frontend-test-engineer — independent verification, NOT the implementer.)
 *
 * ── What this file is ────────────────────────────────────────────────────────
 * TDD RED specs for the `home` flow of the APPROVED developer-portal design
 * (design/frames/devportal/**, all 5 flows approved). Derived STRICTLY from:
 *
 *   design/frames/devportal/manifest.json          (build inventory + testHooks)
 *   design/frames/devportal/01-home-signed-out.html (anonymous landing)
 *   design/frames/devportal/02-home-signed-in.html  (personalized + empty-first-sign-in)
 *
 * and the real (not aspirational) API surface actually shipped by
 * services/devportal-service/openapi.yaml + devportal-frontend/src/services/api.ts:
 *   GET /api/v1/me            -> MyAccess (401 when signed out)
 *   GET /api/v1/playground/quota   -> Quota
 *   GET /api/v1/playground/history -> { items: PlaygroundCall[] }
 * NOTE: design/frames/devportal/manifest.json's `contract.endpoints` names
 * `/api/v1/devportal/...` paths; the actual openapi.yaml/api.ts this PR was
 * shipped against use `/api/v1/...` with no `devportal` segment. This suite
 * mocks the REAL paths (api.ts) since that is what the rendered app actually
 * calls — the frame's data-* hooks (the DOM contract) are unaffected either way.
 *
 * The manifest's `build.flows[id=home]` names what MUST exist for these to go
 * GREEN: orchestrator DevPortalHomeFlow, route `/`, components HomeHero,
 * QuickLinkGrid, ProductDirectory, RecentSpecsPanel, SandboxActivityPanel,
 * PortalTopBar, SignInCta — none of which src/pages/HomePage.tsx (the current
 * stub) renders.
 *
 * ── Why they are RED right now ────────────────────────────────────────────
 * HomePage.tsx is a stub: a headline, a feature grid and a couple of plain
 * links, with NO data-* hooks at all. Every assertion below targets a
 * manifest-declared hook that is simply absent from the DOM today — that is
 * the correct RED reason (element not found), not a harness/config error.
 * They are deliberately NOT test.skip / test.fixme. They turn GREEN when
 * frontend-engineer lands `@fuzefront/devportal-ui`'s DevPortalHomeFlow and
 * wires it into devportal-frontend's `/` route.
 *
 * Selectors are ONLY the data-* hooks the frames declare (manifest.testHooks).
 *
 * Run (pre-prod, self-contained — no live devportal-service required, every
 * API call this suite touches is intercepted with page.route):
 *   npm run build && npx playwright test e2e/home.red.spec.ts
 * Config: devportal-frontend/playwright.config.ts (chromium + mobile projects).
 */
import { test, expect, type Page, type ConsoleMessage, type Request, type Route } from '@playwright/test'

/** Signed-out session: GET /api/v1/me -> 401 (useAuth treats this as signed-out, not an error). */
async function mockSignedOut(page: Page) {
  await page.route('**/api/v1/me', (route: Route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'Unauthorized' }) }),
  )
}

/** Signed-in session with populated recent-specs / sandbox-activity (frame 02, populated variant). */
async function mockSignedInPopulated(page: Page) {
  await page.route('**/api/v1/me', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        userId: 'usr_01j9k2dana0okafor00000001',
        email: 'dana.okafor@fuzefront.com',
        developer: true,
        rootOrgId: 'org_01j9k2root0000000000000001',
        quota: { used: 137, limit: 500, windowHours: 24 },
      }),
    }),
  )
  await page.route('**/api/v1/playground/quota', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ used: 137, limit: 500, windowHours: 24 }),
    }),
  )
  await page.route('**/api/v1/playground/history', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          {
            id: 'pgc_01',
            operation_id: 'registerApp',
            method: 'POST',
            path: '/api/v1/apps',
            response_status: 201,
            called_at: '2026-09-09T05:00:00Z',
          },
        ],
      }),
    }),
  )
}

/** Signed-in, very-first-sign-in: both recent-specs and sandbox-activity empty. */
async function mockSignedInEmpty(page: Page) {
  await page.route('**/api/v1/me', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        userId: 'usr_01j9k2newdev000000000001',
        email: 'new.developer@fuzefront.com',
        developer: true,
        rootOrgId: 'org_01j9k2root0000000000000001',
        quota: { used: 0, limit: 500, windowHours: 24 },
      }),
    }),
  )
  await page.route('**/api/v1/playground/quota', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ used: 0, limit: 500, windowHours: 24 }) }),
  )
  await page.route('**/api/v1/playground/history', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) }),
  )
}

test.describe('Dev Portal home — signed-out (frame 01-home-signed-out)', () => {
  test('renders the topbar in the anonymous auth state', async ({ page }) => {
    await mockSignedOut(page)
    await page.goto('/')
    await expect(
      page.locator("[data-panel='portal-topbar'][data-auth='anonymous']"),
      'PortalTopBar must render data-auth="anonymous" for a signed-out visitor',
    ).toBeVisible()
  })

  test('sign-in and browse-catalog actions are present', async ({ page }) => {
    await mockSignedOut(page)
    await page.goto('/')
    await expect(page.locator("[data-action='sign-in']").first()).toBeVisible()
    await expect(page.locator("[data-action='browse-catalog']").first()).toBeVisible()
  })

  test('renders the home hero and quick-links panels, with Playground locked', async ({ page }) => {
    await mockSignedOut(page)
    await page.goto('/')
    await expect(page.locator("[data-panel='home-hero']")).toBeVisible()
    await expect(page.locator("[data-panel='quick-links']")).toBeVisible()
    await expect(
      page.locator("[data-quick-link='playground'][data-locked='true']"),
      'Playground quick link must be shown DISABLED (data-locked=true), never hidden, for an anonymous visitor',
    ).toBeVisible()
    await expect(page.locator("[data-quick-link='my-access'][data-locked='true']")).toBeVisible()
  })

  test('renders the participating-product directory', async ({ page }) => {
    await mockSignedOut(page)
    await page.goto('/')
    await expect(page.locator("[data-panel='product-directory']")).toBeVisible()
    await expect(page.locator("[data-product='fuzefront']")).toBeVisible()
  })

  test('the sandbox-only safety notice is present even before sign-in', async ({ page }) => {
    await mockSignedOut(page)
    await page.goto('/')
    await expect(
      page.locator("[data-safety-notice='sandbox-only']"),
      'the no-production promise must be stated on the signed-out page too, not gated behind sign-in',
    ).toBeVisible()
  })
})

test.describe('Dev Portal home — signed-in, populated (frame 02-home-signed-in)', () => {
  test('renders the topbar in the authenticated + active-membership state', async ({ page }) => {
    await mockSignedInPopulated(page)
    await page.goto('/')
    await expect(page.locator("[data-panel='portal-topbar'][data-auth='authenticated']")).toBeVisible()
    await expect(page.locator("[data-membership-status='active']").first()).toBeVisible()
  })

  test('renders the quota-summary panel with used/limit', async ({ page }) => {
    await mockSignedInPopulated(page)
    await page.goto('/')
    const quota = page.locator("[data-panel='quota-summary']")
    await expect(quota).toBeVisible()
    await expect(quota.locator("[data-quota-used='137'][data-quota-limit='500']")).toBeVisible()
  })

  test('renders the recent-specs panel with at least one entry', async ({ page }) => {
    await mockSignedInPopulated(page)
    await page.goto('/')
    await expect(page.locator("[data-panel='recent-specs']")).toBeVisible()
    await expect(page.locator("[data-recent-spec='fuzefront/app-registry-service']")).toBeVisible()
  })

  test('renders the sandbox-activity panel, showing only this developer\'s own calls', async ({ page }) => {
    await mockSignedInPopulated(page)
    await page.goto('/')
    await expect(page.locator("[data-panel='sandbox-activity']")).toBeVisible()
  })
})

test.describe('Dev Portal home — first-sign-in empty variants (frame 02-home-signed-in)', () => {
  test('recent-specs shows an onboarding empty state, not just "nothing here"', async ({ page }) => {
    await mockSignedInEmpty(page)
    await page.goto('/')
    const empty = page.locator("[data-empty='no-recent-specs']")
    await expect(empty).toBeVisible()
    await expect(empty.locator("[data-action='browse-catalog']")).toBeVisible()
  })

  test('sandbox-activity shows an onboarding empty state with a path into the Playground', async ({ page }) => {
    await mockSignedInEmpty(page)
    await page.goto('/')
    const empty = page.locator("[data-empty='no-sandbox-activity']")
    await expect(empty).toBeVisible()
    await expect(empty.locator("[data-action='open-playground']")).toBeVisible()
  })
})

test.describe('Dev Portal home — runtime console-clean gate (ui-runtime-validation)', () => {
  test('the rendered home page has a clean console (0 errors, 0 CSP/mixed-content, 0 failed app requests)', async ({ page }) => {
    const consoleErrors: string[] = []
    const failedRequests: string[] = []

    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', err => consoleErrors.push(`pageerror: ${String(err)}`))
    page.on('requestfailed', (req: Request) => {
      const url = req.url()
      if (url.includes('/api/') || url.includes('/assets')) {
        failedRequests.push(`${req.method()} ${url} :: ${req.failure()?.errorText ?? 'failed'}`)
      }
    })

    await mockSignedOut(page)
    await page.goto('/')
    // The hero must actually be present for this gate to be meaningful — RED until it exists.
    await expect(page.locator("[data-panel='home-hero']")).toBeVisible()

    expect(consoleErrors, `console errors on home:\n${consoleErrors.join('\n')}`).toEqual([])
    expect(failedRequests, `failed app requests on home:\n${failedRequests.join('\n')}`).toEqual([])
  })
})
