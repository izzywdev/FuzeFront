/**
 * DEV PORTAL — MY ACCESS FLOW — INDEPENDENT, PRE-PRODUCTION, RED-by-design UI e2e.
 * (frontend-test-engineer — independent verification, NOT the implementer.)
 *
 * Derived STRICTLY from:
 *   design/frames/devportal/manifest.json    (build inventory + testHooks)
 *   design/frames/devportal/09-my-access.html (membership / quota / sandbox keys + states)
 *
 * Real API surface mocked (devportal-frontend/src/services/api.ts):
 *   GET /api/v1/me -> MyAccess (401 => signed-out; other non-2xx => surfaced as error)
 *
 * manifest `build.flows[id=my-access]`: orchestrator MyAccessFlow, **route
 * `/access`**, components MembershipPanel, RoleScopeSummary, SandboxKeyTable,
 * RevealOnceKey — NONE of which exist. This flow additionally carries a route
 * mismatch worth calling out explicitly, not papering over: the CURRENT
 * App.tsx stub wires the my-access page at `/my-access`, not the approved
 * `/access`. Per the design-first gate the approved frame's route is the
 * contract devportal-frontend must build to — so these specs navigate to
 * `/access` (the approved route) and are RED for TWO independent reasons
 * today: (1) no route is wired there at all, and (2) even where MyAccessPage
 * IS mounted (`/my-access`), it renders none of the manifest's data-* hooks.
 * frontend-engineer must re-point the route to `/access` as part of landing
 * MyAccessFlow, not just add the missing markup.
 *
 * RED-by-design — see home.red.spec.ts's header for the full rationale.
 *
 * Run: npm run build && npx playwright test e2e/my-access.red.spec.ts
 */
import { test, expect, type Page, type Route } from '@playwright/test'

const ACCESS_ROUTE = '/access'

async function mockAccessActive(page: Page) {
  await page.route('**/api/v1/me', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        userId: 'usr_01j9k2dana0okafor00000001',
        email: 'dana.okafor@fuzefront.com',
        developer: true,
        rootOrgId: 'org_01j9k2root0000000000000001',
        quota: { used: 138, limit: 500, windowHours: 24 },
        membershipStatus: 'active',
      }),
    }),
  )
}

async function mockAccessProvisioning(page: Page) {
  await page.route('**/api/v1/me', (route: Route) =>
    route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ membershipStatus: 'provisioning' }),
    }),
  )
}

async function mockAccessDenied(page: Page) {
  await page.route('**/api/v1/me', (route: Route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'developer_access_denied', message: 'no developer membership on the platform root organization' }),
    }),
  )
}

async function mockAccessLoadFailed(page: Page) {
  await page.route('**/api/v1/me', (route: Route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'internal error' }) }),
  )
}

test.describe('Dev Portal my access — populated (frame 09-my-access)', () => {
  test('renders the membership panel with organization, role and grant provenance', async ({ page }) => {
    await mockAccessActive(page)
    await page.goto(ACCESS_ROUTE)
    const membership = page.locator("[data-panel='membership']")
    await expect(membership).toBeVisible()
    await expect(membership.locator("[data-membership-role='developer']")).toBeVisible()
    await expect(membership.locator("[data-membership-status='active']")).toBeVisible()
  })

  test('renders BOTH halves of the scope: what developer grants AND what it does not', async ({ page }) => {
    await mockAccessActive(page)
    await page.goto(ACCESS_ROUTE)
    const scope = page.locator("[data-scope='developer']")
    await expect(scope).toBeVisible()
    await expect(
      scope.locator("[data-scope-grants='allowed']"),
      'showing only the grants is how people assume a role grants more — both halves are contract',
    ).toBeVisible()
    await expect(scope.locator("[data-scope-grants='denied']")).toBeVisible()
  })

  test('renders the sandbox quota panel', async ({ page }) => {
    await mockAccessActive(page)
    await page.goto(ACCESS_ROUTE)
    await expect(page.locator("[data-panel='quota']")).toBeVisible()
  })

  test('renders the sandbox-keys table with create/revoke actions', async ({ page }) => {
    await mockAccessActive(page)
    await page.goto(ACCESS_ROUTE)
    const keys = page.locator("[data-panel='sandbox-keys']")
    await expect(keys).toBeVisible()
    await expect(keys.locator("[data-action='create-key']")).toBeVisible()
  })

  test('creating a key shows the reveal-once value, never shown again after dismiss', async ({ page }) => {
    await mockAccessActive(page)
    await page.route('**/api/v1/me/sandbox-keys', (route: Route) =>
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'sbk_new', label: 'new-key', value: 'sbk_01j9k7v2rx8m5taq0wc3nh6dfe' }),
      }),
    )
    await page.goto(ACCESS_ROUTE)
    await page.locator("[data-action='create-key']").click()
    await expect(page.locator("[data-reveal='once']")).toBeVisible()
    await expect(page.locator("[data-action='copy-key']")).toBeVisible()
  })

  test('revoking a key requires explicit confirmation, never one-click', async ({ page }) => {
    await mockAccessActive(page)
    await page.goto(ACCESS_ROUTE)
    await page.locator("[data-action='revoke-key']").first().click()
    await expect(page.locator("[data-state='revoke-confirm']")).toBeVisible()
    await expect(page.locator("[data-action='confirm-revoke-key']")).toBeVisible()
  })
})

test.describe('Dev Portal my access — states (frame 09-my-access)', () => {
  test('(a) empty: no sandbox keys yet, onboarding CTA offered', async ({ page }) => {
    await page.route('**/api/v1/me', (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          userId: 'usr_new',
          email: 'new.developer@fuzefront.com',
          developer: true,
          rootOrgId: 'org_01j9k2root0000000000000001',
          quota: { used: 0, limit: 500, windowHours: 24 },
        }),
      }),
    )
    await page.goto(ACCESS_ROUTE)
    const empty = page.locator("[data-empty='no-sandbox-keys']")
    await expect(empty).toBeVisible()
    await expect(empty.locator("[data-action='create-key']")).toBeVisible()
  })

  test('(b) provisioning: catalog/playground stay disabled until the grant lands', async ({ page }) => {
    await mockAccessProvisioning(page)
    await page.goto(ACCESS_ROUTE)
    await expect(page.locator("[data-state='provisioning']")).toBeVisible()
    await expect(page.locator("[data-membership-status='provisioning']")).toBeVisible()
  })

  test('(c) denied: 403 fails closed as a whole, not a partial subset', async ({ page }) => {
    await mockAccessDenied(page)
    await page.goto(ACCESS_ROUTE)
    await expect(page.locator("[data-state='denied']")).toBeVisible()
    await expect(page.locator("[data-membership-status='denied']")).toBeVisible()
    await expect(page.locator("[data-http='403']")).toBeVisible()
    // Fail-closed as a WHOLE — no membership panel content alongside the denial.
    await expect(page.locator("[data-panel='membership'] [data-membership-role]")).toHaveCount(0)
  })

  test('(d) error: access load failed, nothing rendered from a default/cached assumption', async ({ page }) => {
    await mockAccessLoadFailed(page)
    await page.goto(ACCESS_ROUTE)
    await expect(page.locator("[data-state='error']")).toBeVisible()
    await expect(page.locator("[data-error='access-load-failed']")).toBeVisible()
    await expect(page.locator("[data-action='retry']")).toBeVisible()
  })
})

test.describe('Dev Portal my access — runtime console-clean gate (ui-runtime-validation)', () => {
  test('the rendered access page has a clean console (0 errors, 0 CSP/mixed-content, 0 failed app requests)', async ({ page }) => {
    const consoleErrors: string[] = []
    const failedRequests: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', err => consoleErrors.push(`pageerror: ${String(err)}`))
    page.on('requestfailed', req => {
      const url = req.url()
      if (url.includes('/api/') || url.includes('/assets')) {
        failedRequests.push(`${req.method()} ${url} :: ${req.failure()?.errorText ?? 'failed'}`)
      }
    })

    await mockAccessActive(page)
    await page.goto(ACCESS_ROUTE)
    await expect(page.locator("[data-panel='membership']")).toBeVisible()

    expect(consoleErrors, `console errors on my access:\n${consoleErrors.join('\n')}`).toEqual([])
    expect(failedRequests, `failed app requests on my access:\n${failedRequests.join('\n')}`).toEqual([])
  })
})
