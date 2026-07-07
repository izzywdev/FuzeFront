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
 *     → Authentik issues authorization code
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
import { test, expect, type Page } from '@playwright/test'

const AUTHENTIK_URL = process.env.AUTHENTIK_URL ?? 'http://authentik-server:9000'
const FRONTEND_URL = process.env.BASE_URL ?? 'http://localhost:4173'
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3001'
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
  test('backend reports oidcConfigured:true', async ({ request }) => {
    const resp = await request.get(`${BACKEND_URL}/api/auth/method`)
    expect(resp.ok()).toBeTruthy()
    const body = await resp.json()
    expect(body.oidcConfigured).toBe(true)
    expect(body.methods).toContain('oidc')
  })

  // ── 3. Full OIDC sign-in flow ───────────────────────────────────────────
  test('full OIDC sign-in flow with local user lands on dashboard with a real JWT', async ({
    page,
  }) => {
    // This test drives a full multi-step Authentik login (identification → password →
    // consent) which takes 30-60 s in resource-constrained CI. Override the global
    // 30 s per-test timeout so waitForURL's own timeouts can actually fire.
    test.setTimeout(120_000)

    // Step 1: Open FuzeFront
    await page.goto(FRONTEND_URL)
    await expect(page).toHaveTitle(/FuzeFront|Sign in/i, { timeout: 15_000 })

    // Step 2: OIDC button visible (backend is configured with Authentik)
    const oidcButton = page.getByRole('button', { name: /sign in with authentik/i })
    await expect(oidcButton).toBeVisible({ timeout: 15_000 })
    await oidcButton.click()

    // Step 3: Browser redirects to Authentik authorization endpoint
    await page.waitForURL(`${AUTHENTIK_URL}/**`, { timeout: 25_000 })

    // Step 4: Fill in local Authentik credentials (no Google, no bot detection)
    await fillAuthentikLogin(page, E2E_USER_EMAIL, E2E_USER_PASSWORD)

    // Step 5: Authentik issues code → backend callback
    // Generous timeout: consent page + Authentik's redirect can take 20+ s in CI
    await page.waitForURL(`${BACKEND_URL}/api/auth/oidc/callback**`, { timeout: 60_000 })

    // Step 6: Backend validates code+PKCE, creates session, redirects to frontend
    await page.waitForURL(`${FRONTEND_URL}/**`, { timeout: 15_000 })
    // The URL carries a short-lived exchange code the frontend uses to get a JWT
    await expect(page).toHaveURL(/[?&]code=/)

    // Step 7: Frontend exchanges code → JWT in localStorage → dashboard
    await page.waitForURL(`${FRONTEND_URL}/dashboard`, { timeout: 15_000 })

    // Assert a real, well-formed JWT was stored (three base64url parts)
    const authToken = await page.evaluate(() => localStorage.getItem('authToken'))
    expect(authToken).toBeTruthy()
    expect(authToken!.split('.').length).toBe(3)

    // Decode payload (no signature verification needed — we just check the claims exist)
    const payload = JSON.parse(Buffer.from(authToken!.split('.')[1], 'base64url').toString())
    expect(payload.sub).toBeTruthy()
    expect(payload.email).toBeTruthy()
  })

  // ── 4. Error path: OIDC error redirected to frontend ───────────────────
  test('OIDC error from Authentik is displayed on the login page', async ({ page }) => {
    // Simulate what happens when Authentik redirects back with an error
    await page.goto(`${FRONTEND_URL}/?error=oidc_error&message=access_denied`)
    // The frontend must show some error indication
    await expect(
      page.locator('text=/authentication error|access.denied|sign in failed/i')
    ).toBeVisible({ timeout: 10_000 })
  })
})

// ── Helper: drive through Authentik's multi-stage login UI ────────────────────
// Authentik renders stages as custom elements (Lit) with shadow DOM.
// Playwright automatically pierces open shadow roots for attribute selectors.

async function fillAuthentikLogin(page: Page, email: string, password: string): Promise<void> {
  // ── Stage 1: Identification (username / email) ─────────────────────────
  // The field has name="uidField" inside <ak-stage-identification>'s shadow root
  const uidField = page.locator('[name="uidField"]')
  await expect(uidField).toBeVisible({ timeout: 15_000 })
  await uidField.fill(email)
  // Submit the stage — first visible submit button on the page
  await page.locator('[type="submit"]').first().click()

  // ── Stage 2: Password ──────────────────────────────────────────────────
  const pwField = page.locator('[type="password"]')
  await expect(pwField).toBeVisible({ timeout: 10_000 })
  await pwField.fill(password)
  await page.locator('[type="submit"]').first().click()

  // Wait for the password form to disappear before looking for the consent
  // button. Without this, `consentBtn.waitFor({ state: 'visible' })` resolves
  // immediately against the still-visible password-submit button (same selector),
  // clicks it as a no-op, and the real consent page is never actioned.
  await pwField.waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {
    // Field already gone (navigation happened) — that's fine.
  })

  // ── Stage 3: Consent (explicit-consent flow — appears on first login) ──
  // Only reached after password stage completes. In CI the Docker stack is
  // resource-constrained, so the transition can take 10-20 s.
  try {
    const consentBtn = page.locator('[type="submit"]').first()
    await consentBtn.waitFor({ timeout: 30_000, state: 'visible' })
    // Only click if we haven't already navigated away (i.e. we're still on Authentik)
    if (page.url().includes(new URL(AUTHENTIK_URL).hostname)) {
      await consentBtn.click()
    }
  } catch {
    // No consent step — redirect already happened
  }
}
