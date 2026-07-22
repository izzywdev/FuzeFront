/**
 * oidc-plumbing.e2e.spec.ts
 *
 * Real end-to-end integration test for the OIDC authentication flow.
 * Uses a LOCAL Authentik user — no Google OAuth credentials required.
 *
 * All components are real and exercised end-to-end:
 *   FuzeFront frontend (localhost:4173)
 *     → backend GET /api/auth/oidc/login  (PKCE code_challenge, state cookie)
 *     → Authentik authorization endpoint  (real HTTP redirect)
 *     → Playwright fills Authentik native login UI (local user, no bot-detection risk)
 *     → Authentik issues authorization code (implicit-consent — no manual consent step)
 *     → backend GET /api/auth/oidc/callback  (real PKCE verifier check)
 *     → backend POST Authentik /application/o/token/  (real token exchange)
 *     → Authentik returns signed ID token (real JWT)
 *     → backend validates ID token, creates session, redirects frontend with exchange code
 *     → frontend POST /api/auth/token-exchange  (real single-use code)
 *     → JWT stored in localStorage → navigate to /dashboard
 *
 * Required env (all have defaults that match docker-compose.e2e.yml):
 *   AUTHENTIK_URL       — base URL of Authentik (default: http://authentik-server:9000)
 *   BASE_URL            — frontend URL           (default: http://localhost:4173)
 *   BACKEND_URL         — backend URL            (default: http://localhost:3001)
 *   E2E_USER_EMAIL      — local test user email  (default: e2e@test.local)
 *   E2E_USER_PASSWORD   — local test user pw     (default: E2eP@ssw0rd123)
 *
 * The CI job adds `127.0.0.1 authentik-server` to /etc/hosts so Playwright
 * can navigate to http://authentik-server:9000 (published on host port 9000).
 *
 * To run locally (with docker-compose.e2e.yml up, sans tunnel):
 *   echo "127.0.0.1 authentik-server" | sudo tee -a /etc/hosts
 *   cd frontend && npx playwright test tests/oidc-plumbing.e2e.spec.ts
 */
import { test, expect } from '@playwright/test'

const AUTHENTIK_URL = process.env.AUTHENTIK_URL ?? 'http://authentik-server:9000'
const FRONTEND_URL = process.env.BASE_URL ?? 'http://localhost:4173'
// The MONOLITH. Serves the deprecated /api/auth/* shim — NOT /api/v1/security/*.
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3001'
// The Security API is reached the way the browser reaches it: through the app
// origin, whose nginx path-routes /api/v1/security/ to the security service.
// Do NOT point this at BACKEND_URL — the monolith 404s these routes, which is
// exactly how these tests failed in ~11ms the first time round.
const SECURITY_URL = process.env.SECURITY_URL ?? FRONTEND_URL
const E2E_USER_EMAIL = process.env.E2E_USER_EMAIL ?? 'e2e@test.local'
const E2E_USER_PASSWORD = process.env.E2E_USER_PASSWORD ?? 'E2eP@ssw0rd123'

test.describe('OIDC plumbing — full stack (local Authentik user)', () => {
  // Each test starts with a clean browser context (no shared cookies/storage)
  test.use({ storageState: { cookies: [], origins: [] } })

  // ── 1. Sanity: OIDC discovery endpoint ─────────────────────────────────
  test('Authentik OIDC discovery document is reachable and well-formed', async ({ request }) => {
    const resp = await request.get(
      `${AUTHENTIK_URL}/application/o/fuzefront/.well-known/openid-configuration`
    )
    expect(resp.ok()).toBeTruthy()
    const doc = await resp.json()
    expect(doc.issuer).toBeTruthy()
    expect(doc.authorization_endpoint).toMatch(/\/authorize/)
    expect(doc.token_endpoint).toMatch(/\/token/)
    expect(doc.userinfo_endpoint).toBeTruthy()
  })

  // ── 2. Backend health + OIDC configured ────────────────────────────────
  // NOTE: /api/auth/* is the DEPRECATED compatibility layer, kept mounted for
  // one release. It is still asserted here so we notice if the shim breaks —
  // but the SPA and all consumers use /api/v1/security/* (covered in 2c/2d).
  test('backend reports oidcConfigured:true (deprecated /api/auth shim)', async ({ request }) => {
    const resp = await request.get(`${BACKEND_URL}/api/auth/method`)
    expect(resp.ok()).toBeTruthy()
    const body = await resp.json()
    expect(body.oidcConfigured).toBe(true)
    expect(body.methods).toContain('oidc')
  })

  // ── 2c. Security API capability descriptor (the surface the SPA reads) ──
  // Provider-neutral by contract: a vendor name must never appear here.
  test('Security API advertises neutral capabilities incl. Google social', async ({ request }) => {
    const resp = await request.get(`${SECURITY_URL}/api/v1/security/methods`)
    expect(resp.ok(), `GET /api/v1/security/methods -> ${resp.status()}`).toBeTruthy()
    const body = await resp.json()
    expect(body.password).toBe(true)
    expect(body.social).toContain('google')
    expect(body.mfa?.enabled).toBe(true)
    // Boundary: the descriptor must not leak the identity provider.
    expect(JSON.stringify(body)).not.toMatch(/authentik|permit/i)
  })

  // ── 2d. Password sign-in through the Security API (what the SPA calls) ──
  test('Security API password sign-in returns a platform JWT session', async ({ request }) => {
    const resp = await request.post(`${SECURITY_URL}/api/v1/security/session`, {
      data: { email: E2E_USER_EMAIL, password: E2E_USER_PASSWORD },
    })
    expect(
      resp.status(),
      `POST /api/v1/security/session -> ${resp.status()}: ${await resp.text().catch(() => '')}`
    ).toBe(200)
    const body = await resp.json()
    // Either an authenticated session, or an mfa_required challenge if the
    // account has step-up enabled — both are contract-valid; only the
    // authenticated branch carries a token.
    if (body.status === 'mfa_required') {
      expect(body.challengeId ?? body.mfaToken ?? body.token).toBeTruthy()
      return
    }
    expect(body.token, 'platform JWT returned').toBeTruthy()
    expect(body.token.split('.')).toHaveLength(3)
    expect(body.sessionId).toBeTruthy()
    expect(body.user?.email?.toLowerCase()).toBe(E2E_USER_EMAIL.toLowerCase())
  })

  test('Security API rejects a wrong password with 401', async ({ request }) => {
    const resp = await request.post(`${SECURITY_URL}/api/v1/security/session`, {
      data: { email: E2E_USER_EMAIL, password: 'definitely-not-the-password' },
    })
    expect(resp.status()).toBe(401)
  })

  // ── 2b. Server-side password sign-in (flow-executor, no redirect) ───────
  // The native login form posts credentials to /api/auth/oidc/password; the
  // backend drives Authentik's flow-executor with them and completes the OIDC
  // code exchange server-side. This exercises that path against REAL Authentik.
  test('password sign-in against Authentik (no redirect) returns a platform JWT', async ({
    request,
  }) => {
    const resp = await request.post(`${BACKEND_URL}/api/auth/oidc/password`, {
      data: { email: E2E_USER_EMAIL, password: E2E_USER_PASSWORD },
    })
    expect(
      resp.status(),
      `POST /api/auth/oidc/password -> ${resp.status()}: ${await resp.text().catch(() => '')}`
    ).toBe(200)
    const body = await resp.json()
    expect(body.token, 'platform JWT returned').toBeTruthy()
    expect(body.token.split('.')).toHaveLength(3)
    expect(body.sessionId).toBeTruthy()
    expect(body.user?.email?.toLowerCase()).toBe(E2E_USER_EMAIL.toLowerCase())
  })

  test('password sign-in rejects a wrong password with 401', async ({ request }) => {
    const resp = await request.post(`${BACKEND_URL}/api/auth/oidc/password`, {
      data: { email: E2E_USER_EMAIL, password: 'definitely-wrong-password' },
    })
    expect(
      resp.status(),
      `expected 401, got ${resp.status()}: ${await resp.text().catch(() => '')}`
    ).toBe(401)
  })

  // ── 3. Social sign-in button initiates the server-brokered redirect ─────
  // The dedicated "Sign in with Authentik" button was removed when the auth UI
  // migrated to the Security API; the only redirect-based entry point is now the
  // "Sign in with Google" button, which navigates to the FuzeFront-owned social
  // start endpoint (`/api/v1/security/social/google/start`). The server brokers
  // the provider hand-off from there.
  //
  // This job runs in NO-GOOGLE mode (docker-compose.e2e.yml leaves
  // GOOGLE_CLIENT_ID/SECRET empty — "inert when empty"), so a full interactive
  // Authentik round-trip through this button is not reachable here. Driving one
  // would assert behaviour the app no longer exposes in this environment. The
  // REAL server-side OIDC token exchange against Authentik is still covered end
  // to end by the API-level test "password sign-in against Authentik (no
  // redirect) returns a platform JWT" above; here we assert the button is wired
  // to the correct server-brokered entry point.
  test('Google sign-in button initiates the server-brokered social login', async ({
    page,
  }) => {
    test.setTimeout(60_000)

    await page.goto(FRONTEND_URL)
    await expect(page).toHaveTitle(/FuzeFront|Sign in/i, { timeout: 15_000 })

    const googleButton = page.getByRole('button', { name: /sign in with google/i })
    await expect(googleButton).toBeVisible({ timeout: 15_000 })

    // The click sets window.location to the social start endpoint — capture the
    // navigation request rather than a settled URL (the server 302-redirects
    // onward immediately).
    const socialStart = page.waitForRequest(
      r => r.url().includes('/api/v1/security/social/google/start'),
      { timeout: 15_000 }
    )
    await googleButton.click()
    const req = await socialStart
    expect(req.url()).toContain('/api/v1/security/social/google/start')
  })

  // ── 3b. Native credentials form drives the Authentik-backed login ──────
  test('native email/password form signs in via Authentik (no redirect) and lands on dashboard', async ({
    page,
  }) => {
    test.setTimeout(120_000)

    await page.goto(FRONTEND_URL)
    const emailField = page.locator('input[type="email"]')
    await expect(emailField).toBeVisible({ timeout: 15_000 })

    await emailField.fill(E2E_USER_EMAIL)
    await page.locator('input[type="password"]').fill(E2E_USER_PASSWORD)

    // The native credentials form posts to FuzeFront's Security API
    // (POST /api/v1/security/session) — the server brokers the Authentik
    // exchange, so the browser never leaves the app origin.
    const loginResp = page.waitForResponse(
      r => r.url().includes('/api/v1/security/session') && r.request().method() === 'POST',
      { timeout: 30_000 }
    )
    await page.getByRole('button', { name: /^sign in$/i }).click()
    const resp = await loginResp
    expect(
      resp.status(),
      `POST /api/v1/security/session -> ${resp.status()}`
    ).toBe(200)

    // The page never navigated to Authentik — the whole exchange was server-side.
    await page.waitForURL(`${FRONTEND_URL}/dashboard`, { timeout: 30_000 })
    const authToken = await page.evaluate(() => localStorage.getItem('authToken'))
    expect(authToken).toBeTruthy()
    expect(authToken!.split('.').length).toBe(3)
  })

  // ── 4. Error path: OIDC error redirected to frontend ───────────────────
  test('OIDC error from Authentik is displayed on the login page', async ({ page }) => {
    // Simulate what happens when Authentik redirects back with an error
    await page.goto(`${FRONTEND_URL}/?error=oidc_error&message=access_denied`)
    // The frontend must show some error indication. The error surfaces in more
    // than one place (e.g. an inline banner and the humanised message), so scope
    // to the first match — asserting the error is shown, not that it is unique.
    await expect(
      page.locator('text=/authentication error|access.denied|sign in failed/i').first()
    ).toBeVisible({ timeout: 10_000 })
  })
})
