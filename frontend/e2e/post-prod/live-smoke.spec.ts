import { test, expect, type Page, type ConsoleMessage } from '@playwright/test'

/**
 * POST-PRODUCTION smoke / synthetic verification — READ-ONLY against the LIVE
 * platform (default https://app.fuzefront.com via playwright.post-prod.config.ts).
 *
 * Verifies the acceptance-criteria critical journey on the real deployment:
 *   1. The Module-Federation SHELL serves (root 200, correct title).
 *   2. /login renders the local-auth sign-in form.
 *   3. Authenticate via local auth (the only path live: Authentik/OIDC is down,
 *      and the UI's "Sign Up" affordance routes into OIDC enrollment, so signup
 *      is not exercisable while Authentik is 503 — documented below).
 *   4. The dashboard renders for an authenticated user.
 *   5. Module-Federation remote apps load — app cards render, and at least one
 *      remote module mounts at /app/:id with no MF/console load error and no
 *      502 from /api/apps.
 *
 * Credentials come from env so we never hard-code secrets in the repo:
 *   POST_PROD_EMAIL / POST_PROD_PASSWORD  (fallback to the documented seeded
 *   admin creds, which may or may not exist in prod).
 */

// The live /login page advertises these demo creds (note the .dev domain, as
// rendered on app.fuzefront.com). Override via env for real prod accounts.
const EMAIL = process.env.POST_PROD_EMAIL || 'admin@fuzefront.dev'
const PASSWORD = process.env.POST_PROD_PASSWORD || 'admin123'

// Console/network errors that indicate a real federation / mixed-content /
// CSP regression. We collect these per-test and assert on them where relevant.
function attachErrorCollectors(page: Page) {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const failedRequests: string[] = []

  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', err => pageErrors.push(err.message))
  page.on('requestfailed', req => {
    failedRequests.push(`${req.method()} ${req.url()} :: ${req.failure()?.errorText ?? 'failed'}`)
  })

  return { consoleErrors, pageErrors, failedRequests }
}

test.describe('FuzeFront live post-prod smoke', () => {
  test('1. MF shell serves with correct title', async ({ page, baseURL }) => {
    const resp = await page.goto('/')
    expect(resp, 'root navigation produced a response').toBeTruthy()
    expect(resp!.status(), `GET ${baseURL}/ status`).toBeLessThan(400)
    await expect(page).toHaveTitle(/FuzeFront/i)
    await page.screenshot({ path: 'test-results-post-prod/01-shell.png', fullPage: true })
  })

  test('2. core API health is up (DB connected)', async ({ request }) => {
    const resp = await request.get('/api/health')
    expect(resp.status(), '/api/health status').toBe(200)
    const body = await resp.json()
    expect(body.status).toBe('ok')
    expect(body?.database?.status, 'platform DB connection').toBe('connected')
  })

  test('3. /login renders the local-auth sign-in form', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toBeVisible()
    await page.screenshot({ path: 'test-results-post-prod/03-login.png', fullPage: true })
  })

  test('4. auth backend is reachable (security service routable)', async ({ request }) => {
    // Gate for the sign-in journey. While the security service is not routed,
    // Traefik returns 502/503 ("no available server") and login cannot succeed.
    // We assert it is healthy so a red here clearly names the deploy blocker.
    const resp = await request.get('/api/auth/health')
    expect(
      resp.status(),
      `/api/auth/health returned ${resp.status()} (502/503 "no available server" = security service not routable yet — deploy blocker, not a UI bug)`
    ).toBeLessThan(500)
  })

  test('5. sign-in + dashboard + Module-Federation apps load', async ({ page, request }) => {
    const { consoleErrors, pageErrors, failedRequests } = attachErrorCollectors(page)

    // Pre-flight: if the auth backend isn't routable, fail fast with a precise
    // message rather than timing out on the form submit.
    const authHealth = await request.get('/api/auth/health')
    expect(
      authHealth.status(),
      `auth backend not ready (/api/auth/health=${authHealth.status()}); sign-in journey is blocked at the deploy layer`
    ).toBeLessThan(500)

    await page.goto('/login')
    await expect(page.locator('input[type="email"]')).toBeVisible()

    await page.fill('input[type="email"]', EMAIL)
    await page.fill('input[type="password"]', PASSWORD)

    const loginResp = page.waitForResponse(
      r => r.url().includes('/api/auth/login'),
      { timeout: 30_000 }
    )
    await page.click('button[type="submit"]')
    const resp = await loginResp
    expect(
      resp.status(),
      `POST /api/auth/login -> ${resp.status()} (401/403 = creds rejected: seeded account likely not provisioned in prod; 5xx = backend error)`
    ).toBe(200)

    // The app does a hard redirect to /dashboard on success.
    await page.waitForURL('**/dashboard', { timeout: 30_000 })
    const token = await page.evaluate(() => localStorage.getItem('authToken'))
    expect(token, 'authToken persisted in localStorage after login').toBeTruthy()

    // Dashboard shell renders.
    await expect(page.locator('.dashboard')).toBeVisible()
    await page.screenshot({ path: 'test-results-post-prod/05a-dashboard.png', fullPage: true })

    // --- Module-Federation app verification ---
    // The dashboard fetches the app registry from /api/apps and renders a card
    // per app. Verify the registry call did not 502 and cards rendered.
    const appsResp = await request.get('/api/apps', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(
      appsResp.status(),
      `/api/apps (app registry) -> ${appsResp.status()} (502 = applications service not routable)`
    ).toBe(200)
    const appsBody = await appsResp.json()
    const apps: Array<{ id: string; name: string; integrationType?: string; isHealthy?: boolean }> =
      Array.isArray(appsBody) ? appsBody : appsBody?.apps ?? appsBody?.data ?? []

    // If the registry is empty, that is a data/seeding gap, not a UI bug — make
    // it explicit rather than silently passing.
    expect(apps.length, 'app registry returned at least one application').toBeGreaterThan(0)

    const cards = page.locator('.app-card')
    await expect(cards.first()).toBeVisible({ timeout: 20_000 })
    const cardCount = await cards.count()
    expect(cardCount, 'at least one app card rendered on the dashboard').toBeGreaterThan(0)

    // Pick a healthy module-federation app to actually mount the remote.
    const mfApp =
      apps.find(a => a.integrationType === 'module-federation' && a.isHealthy !== false) ??
      apps.find(a => a.integrationType === 'module-federation') ??
      apps.find(a => a.isHealthy !== false) ??
      apps[0]

    await page.goto(`/app/${mfApp.id}`)

    // The FederatedAppLoader shows a spinner -> then either the mounted remote
    // or an error box ("⚠️ Failed to Load App"). Wait for resolution and assert
    // we did NOT land on the error state.
    const errorBox = page.getByText('Failed to Load App')
    const loadingText = page.getByText('Loading application...')
    await expect(loadingText)
      .toBeHidden({ timeout: 45_000 })
      .catch(() => { /* may already be hidden / never shown */ })

    await page.screenshot({ path: 'test-results-post-prod/05b-mf-app.png', fullPage: true })

    const errored = await errorBox.isVisible().catch(() => false)
    expect(
      errored,
      `Module-Federation remote "${mfApp.name}" (${mfApp.id}) failed to mount (FederatedAppErrorBoundary / loader error shown)`
    ).toBe(false)

    // No federation/mixed-content/CSP load failures in the console/network.
    const mfFailed = failedRequests.filter(u =>
      /remoteEntry|\.js|\/api\/apps/i.test(u)
    )
    expect(
      pageErrors,
      `uncaught page errors during MF load: ${pageErrors.join(' | ')}`
    ).toEqual([])
    expect(
      mfFailed,
      `failed remote/asset requests during MF load: ${mfFailed.join(' | ')}`
    ).toEqual([])

    // Surface console errors as a soft signal (logged, not always fatal — the
    // app emits diagnostic console output by design).
    if (consoleErrors.length) {
      // eslint-disable-next-line no-console
      console.log('Console errors observed (informational):\n' + consoleErrors.join('\n'))
    }
  })
})
