import { test, expect, type Page, type ConsoleMessage } from '@playwright/test'
import { seedMockSession } from '../../tests/support/account-vault'

/**
 * POST-PRODUCTION smoke / synthetic verification — READ-ONLY against the LIVE
 * platform (default https://app.fuzefront.com via playwright.post-prod.config.ts).
 *
 * Verifies the acceptance-criteria critical journey on the real deployment:
 *   1. The Module-Federation SHELL serves (root 200, correct title).
 *   2. Core API health is up.
 *   3. The Security API advertises the expected capabilities
 *      (/api/v1/security/methods) — a non-empty `social` array is what renders
 *      the Google button, so it is asserted explicitly.
 *   4. /login shows the NATIVE credentials form (email/password verified
 *      server-side by the identity provider — no redirect) plus a "Sign in with
 *      Google" button. The old "Sign in with Authentik" redirect button is gone.
 *   5. Clicking "Sign in with Google" hands off into the OIDC flow.
 *   6. The auth backend is routable.
 *   7. The dashboard renders for an authenticated user and Module-Federation
 *      remote apps load — app cards render, and at least one remote module
 *      mounts at /app/:id with no MF/console load error and no 502 from
 *      /api/apps.
 *   8. The Authentik login surface itself is configured: identification
 *      challenge offers the Google source, a sign-up (enrollment) link, a
 *      recovery link, and FuzeFront branding — catches "handoff works but the
 *      IdP was never configured".
 *
 * The authenticated journey (test 7) obtains its session via the API
 * (POST /api/v1/security/session) rather than the UI: driving real Google
 * credentials through a synthetic check is brittle + a security liability.
 * This is the same endpoint the SPA uses, so it still fails if sign-in
 * genuinely breaks. The API path remains as
 * the platform's machine/break-glass authentication.
 *
 * The synthetic account SELF-PROVISIONS: test 7 asks whether it exists, creates
 * it if not, and signs in if it does. Nothing is provisioned by hand, and a
 * rebuilt prod database heals on the next run instead of going permanently red.
 */

// The synthetic's ADDRESS is not a credential, so it lives here rather than in
// a secret. Fixing it in code is what makes the account stable across runs and
// discoverable when someone wonders what it is.
const EMAIL = process.env.POST_PROD_EMAIL || 'postprod-smoke@fuzefront.com'

// The PASSWORD has no in-repo fallback, deliberately.
//
// izzywdev/FuzeFront is a PUBLIC repository. A literal here would publish a
// working production login to anyone who clones it — permanently, in git
// history — and MFA is not enforced, so the password alone would be enough to
// use it. The previous fallback (`admin123`) was survivable ONLY because
// `admin@fuzefront.dev` does not exist in prod: `initializeDatabase()` calls
// `runSeeds()` when NODE_ENV !== 'production', so the seeded admin is
// local-only. A real password with a real account behind it is a different
// thing entirely, and self-provisioning creates exactly that account.
//
// Absent → test 7 SKIPS loudly as missing coverage. It must never fall back to
// a guessable value and report green.
const PASSWORD = process.env.POST_PROD_PASSWORD
const HAS_SYNTHETIC_CREDS = Boolean(PASSWORD)

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

  test('3. Security API advertises the expected auth capabilities in prod', async ({ request }) => {
    // The SPA reads the provider-agnostic Security API, not the deprecated
    // /api/auth shim — smoke the surface prod actually serves to browsers.
    const resp = await request.get('/api/v1/security/methods')
    expect(resp.status(), '/api/v1/security/methods status').toBe(200)
    const body = await resp.json()
    expect(
      body.social,
      'social login must be advertised in prod — an empty array hides the Google button'
    ).toContain('google')
    expect(body.password, 'password sign-in must be advertised in prod').toBe(true)
    // Boundary: prod must never leak the identity/authz vendor to a browser.
    expect(JSON.stringify(body)).not.toMatch(/authentik|permit/i)
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

    // Clicking must navigate into the social flow, which 302s on to the
    // Authentik authorize endpoint. Assert we leave the login page rather than
    // completing a login (read-only synthetic — no credentials driven).
    //
    // The endpoint here MUST track authAPI.startSocialLogin(). This assertion
    // used to watch `/api/auth/oidc/login`, the legacy backend route — but the
    // SPA moved to the Security service's social-start endpoint
    // (services/api.ts: `${SECURITY_BASE}/social/${provider}/start`) and the
    // spec was never updated. The legacy route still EXISTS on the backend, so
    // nothing failed to compile and nothing 404'd; the test just watched for a
    // request the app no longer makes and failed against a healthy production.
    const socialRedirect = page.waitForRequest(
      req => /\/api\/v1\/security\/social\/google\/start/.test(req.url()),
      { timeout: 20_000 }
    )
    await googleBtn.click()
    await socialRedirect
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

  test('7. authenticated dashboard + Module-Federation apps load', async ({ page, request }, testInfo) => {
    // Skip LOUDLY rather than fail on a credential problem: an unprovisioned
    // synthetic must not masquerade as a broken dashboard. Set the
    // POST_PROD_EMAIL / POST_PROD_PASSWORD repo secrets to a dedicated
    // production account to restore this coverage.
    test.skip(
      !HAS_SYNTHETIC_CREDS,
      `POST_PROD_PASSWORD not set — cannot provision or sign in as ${EMAIL}. ` +
        'The password has no in-repo fallback on purpose: this repository is public, so a literal would ' +
        'publish a working production login. This is MISSING COVERAGE, not a passing test.'
    )
    testInfo.annotations.push({
      type: 'coverage',
      description: 'authenticated journey requires the POST_PROD_PASSWORD secret',
    })

    const { consoleErrors, pageErrors, failedRequests } = attachErrorCollectors(page)

    // Authenticate via the Security API (machine/break-glass path) — the same
    // surface the SPA uses, so this smoke fails if real sign-in is broken.
    // SELF-PROVISIONING. Ask whether the synthetic exists, create it if not,
    // sign in if it does — so account creation is part of the smoke run rather
    // than a manual prerequisite, and a rebuilt prod database heals itself on
    // the next run instead of going permanently red.
    //
    // Both branches exercise a real production surface the SPA also uses:
    // signup on the first run, sign-in on every run after. This still fails if
    // either genuinely breaks.
    const availResp = await request.get('/api/v1/security/email-available', {
      params: { email: EMAIL },
    })
    expect(
      availResp.status(),
      `GET /api/v1/security/email-available -> ${availResp.status()} ` +
        '(429 = per-IP rate limit of 20/min, likely concurrent smoke runs; 5xx = backend error)'
    ).toBe(200)
    const { available } = await availResp.json()

    let loginBody: { status?: string; token?: string }

    if (available) {
      const signupResp = await request.post('/api/v1/security/signup', {
        data: { email: EMAIL, password: PASSWORD, firstName: 'Post-prod', lastName: 'Smoke' },
      })

      if (signupResp.status() === 409) {
        // Not a failure: two runners can race between the availability check
        // and the signup, and the loser must fall through to signing in.
        const raceLogin = await request.post('/api/v1/security/session', {
          data: { email: EMAIL, password: PASSWORD },
        })
        expect(
          raceLogin.status(),
          `signup raced (409) and the follow-up sign-in returned ${raceLogin.status()} — ` +
            'a 401 here means the existing account has a DIFFERENT password than POST_PROD_PASSWORD'
        ).toBe(200)
        loginBody = await raceLogin.json()
      } else {
        expect(
          signupResp.status(),
          `POST /api/v1/security/signup -> ${signupResp.status()} while creating ${EMAIL} ` +
            '(400 = password rejected by policy; 503 = signup disabled or backend down)'
        ).toBe(201)
        // Signup returns a LoginResponse, so a fresh account is already signed in.
        loginBody = await signupResp.json()
        testInfo.annotations.push({
          type: 'provisioned',
          description: `created the production synthetic ${EMAIL} on this run`,
        })
      }
    } else {
      // Steady state: the account exists, so this is the real sign-in path.
      const loginResp = await request.post('/api/v1/security/session', {
        data: { email: EMAIL, password: PASSWORD },
      })
      expect(
        loginResp.status(),
        `POST /api/v1/security/session -> ${loginResp.status()} — ${EMAIL} EXISTS but its ` +
          'credentials were rejected, so POST_PROD_PASSWORD does not match the account. Reset it in ' +
          'prod and update the secret; do NOT hard-code a password here (public repo). 5xx = backend error.'
      ).toBe(200)
      loginBody = await loginResp.json()
    }
    expect(
      loginBody.status,
      'break-glass account must not require MFA step-up, or this synthetic cannot sign in'
    ).not.toBe('mfa_required')
    const token: string = loginBody.token
    expect(token, 'API login returned a token').toBeTruthy()

    // Seed the SPA session before the app boots, into the ACCOUNT VAULT's
    // provisional namespace (src/lib/accounts.ts) rather than the bare
    // `authToken` key. A bare key would still boot today, but only because the
    // vault's one-time legacy migration sweeps it — this synthetic must not
    // depend on an upgrade path, or it goes quietly red against prod the day
    // that migration is retired.
    await page.addInitScript(seedMockSession, token)

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

  test('8. Authentik login surface is configured (Google source + sign-up + recovery + brand)', async ({ request }) => {
    // Black-box probe of the IdP itself: the login page's identification
    // challenge advertises exactly what a user will see. This is the test that
    // catches "the app hands off fine but Authentik was never configured" —
    // unthemed page, no Google button, no sign-up link (the failure mode that
    // shipped once already).
    const AUTH_ORIGIN =
      process.env.POST_PROD_AUTH_ORIGIN || 'https://auth.fuzefront.com'

    const resp = await request.get(
      `${AUTH_ORIGIN}/api/v3/flows/executor/default-authentication-flow/?query=`,
      { headers: { Accept: 'application/json' }, maxRedirects: 5 }
    )
    expect(resp.status(), 'flow executor reachable').toBe(200)
    const challenge = await resp.json()

    expect(
      challenge.component,
      `first challenge should be the identification stage, got ${JSON.stringify(challenge.component)}`
    ).toBe('ak-stage-identification')

    // Sign-up link → enrollment flow applied AND wired into the stage.
    expect(
      challenge.enroll_url,
      'enroll_url missing — enrollment flow not linked on the identification stage (sign-up dead)'
    ).toBeTruthy()

    // Recovery link → recovery flow applied and wired.
    expect(
      challenge.recovery_url,
      'recovery_url missing — recovery flow not linked (forgot-password dead)'
    ).toBeTruthy()

    // Google shows as a federated source button.
    const sources: Array<{ name?: string; challenge?: { to?: string } }> =
      challenge.sources ?? []
    expect(
      sources.some(s => /google/i.test(s.name ?? '')),
      `Google source not offered on the login page — sources: ${JSON.stringify(sources.map(s => s.name))}`
    ).toBe(true)

    // Brand applied (title comes from the flow/brand config, not authentik's default).
    expect(
      String(challenge.flow_info?.title ?? ''),
      `login page still shows the default authentik title — brand/flow blueprints not applied (got ${JSON.stringify(challenge.flow_info?.title)})`
    ).toMatch(/fuzefront/i)
  })
})
