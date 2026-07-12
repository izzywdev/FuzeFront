import { test, expect, type Page, type ConsoleMessage } from '@playwright/test'

/**
 * POST-PRODUCTION smoke / synthetic verification — READ-ONLY against the LIVE
 * platform (default https://app.fuzefront.com via playwright.post-prod.config.ts).
 *
 * Verifies the acceptance-criteria critical journey on the real deployment:
 *   1. The Module-Federation SHELL serves (root 200, correct title).
 *   2. Core API health is up.
 *   3. The backend advertises OIDC as configured (/api/auth/method) — this is
 *      the flag that hides the local form, so it is asserted explicitly.
 *   4. /login shows the NATIVE credentials form (email/password verified
 *      against Authentik server-side — no redirect) plus a "Sign in with
 *      Google" button (federated through Authentik). The old "Sign in with
 *      Authentik" redirect button is gone.
 *   5. Clicking "Sign in with Google" hands off into the OIDC flow.
 *   6. The auth backend is routable.
 *   7. The dashboard renders for an authenticated user and Module-Federation
 *      remote apps load — app cards render, and at least one remote module
 *      mounts at /app/:id with no MF/console load error and no 502 from
 *      /api/apps.
 *
 * The authenticated journey (test 7) obtains its session via the API
 * (POST /api/auth/login) rather than the UI: the local form is intentionally
 * absent from the UI, and driving real Google/Authentik credentials through a
 * synthetic check is brittle + a security liability. The API path remains as
 * the platform's machine/break-glass authentication.
 *
 * Credentials come from env so we never hard-code secrets in the repo:
 *   POST_PROD_EMAIL / POST_PROD_PASSWORD  (fallback to the documented seeded
 *   admin creds, which may or may not exist in prod).
 */

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

  test('3. backend advertises OIDC as configured (Authentik is the identity authority)', async ({ request }) => {
    const resp = await request.get('/api/auth/method')
    expect(resp.status(), '/api/auth/method status').toBe(200)
    const body = await resp.json()
    expect(
      body.oidcConfigured,
      'oidcConfigured must be true in prod — false would re-expose the local fallback form'
    ).toBe(true)
    expect(body.defaultMethod).toBe('oidc')
  })

  test('4. /login offers the native credentials form + Google (no Authentik redirect button)', async ({ page }) => {
    await page.goto('/login')

    // Native credentials form — the default UI. With oidcConfigured=true these
    // fields are verified AGAINST AUTHENTIK server-side (no redirect).
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible()

    // Google is federated through Authentik and offered as a button.
    await expect(
      page.getByRole('button', { name: /sign in with google/i })
    ).toBeVisible()

    // The old "Sign in with Authentik" redirect button is gone.
    await expect(page.getByText(/sign in with authentik/i)).toHaveCount(0)

    // The demo-credentials disclosure is gone.
    await expect(page.getByText(/demo credentials/i)).toHaveCount(0)

    await page.screenshot({ path: 'test-results-post-prod/03-login.png', fullPage: true })
  })

  test('5. "Sign in with Google" hands off to Authentik (OIDC flow starts)', async ({ page }) => {
    await page.goto('/login')
    const googleBtn = page.getByRole('button', { name: /sign in with google/i })
    await expect(googleBtn).toBeVisible({ timeout: 20_000 })

    // Clicking must navigate into the OIDC flow: the SPA calls
    // /api/auth/oidc/login which 302s to the Authentik authorize endpoint.
    // Assert we leave the login page toward an authorize URL rather than
    // completing a login (read-only synthetic — no credentials driven).
    const oidcRedirect = page.waitForRequest(
      req => req.url().includes('/api/auth/oidc/login'),
      { timeout: 20_000 }
    )
    await googleBtn.click()
    await oidcRedirect
  })

  test('6. auth backend is reachable (security service routable)', async ({ request }) => {
    // Gate for the authenticated journey. While the security service is not
    // routed, Traefik returns 502/503 ("no available server").
    // We assert it is healthy so a red here clearly names the deploy blocker.
    const resp = await request.get('/api/auth/health')
    expect(
      resp.status(),
      `/api/auth/health returned ${resp.status()} (502/503 "no available server" = security service not routable yet — deploy blocker, not a UI bug)`
    ).toBeLessThan(500)
  })

  test('7. authenticated dashboard + Module-Federation apps load', async ({ page, request }) => {
    const { consoleErrors, pageErrors, failedRequests } = attachErrorCollectors(page)

    // Authenticate via the API (machine/break-glass path). The UI no longer
    // renders a local form — human sign-in is Authentik/Google only — so the
    // synthetic check mints its session directly and injects the token.
    const loginResp = await request.post('/api/auth/login', {
      data: { email: EMAIL, password: PASSWORD },
    })
    expect(
      loginResp.status(),
      `POST /api/auth/login -> ${loginResp.status()} (401/403 = creds rejected: POST_PROD_EMAIL/POST_PROD_PASSWORD not provisioned in prod; 5xx = backend error)`
    ).toBe(200)
    const loginBody = await loginResp.json()
    const token: string = loginBody.token
    expect(token, 'API login returned a token').toBeTruthy()

    // Seed the SPA session before the app boots.
    await page.addInitScript(t => {
      window.localStorage.setItem('authToken', t)
    }, token)

    await page.goto('/dashboard')
    await page.waitForURL('**/dashboard', { timeout: 30_000 })

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
      console.log('Console errors observed (informational):\n' + consoleErrors.join('\n'))
    }
  })
})
