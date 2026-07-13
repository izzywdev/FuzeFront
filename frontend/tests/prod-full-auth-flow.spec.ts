/**
 * prod-full-auth-flow.spec.ts
 *
 * End-to-end browser tests for the three prod authentication journeys.
 * Runs against the live app (default: https://app.fuzefront.com).
 *
 * Usage:
 *   # all three flows, headless
 *   BASE_URL=https://app.fuzefront.com \
 *   POST_PROD_EMAIL=you@example.com \
 *   POST_PROD_PASSWORD=yourpassword \
 *   npx playwright test tests/prod-full-auth-flow.spec.ts
 *
 *   # headed + slowmo to watch each step
 *   BASE_URL=https://app.fuzefront.com \
 *   POST_PROD_EMAIL=you@example.com \
 *   POST_PROD_PASSWORD=yourpassword \
 *   npx playwright test tests/prod-full-auth-flow.spec.ts --headed --slowmo 400
 *
 * Environment variables:
 *   BASE_URL          – root of the FuzeFront app (default https://app.fuzefront.com)
 *   POST_PROD_EMAIL   – existing account email for T2 sign-in (required for T2)
 *   POST_PROD_PASSWORD– password for T2 (required for T2)
 *   SIGNUP_EMAIL      – email to use for T1 sign-up (default: timestamped address)
 *   SIGNUP_PASSWORD   – password for the new account (default: Test@12345678!)
 *
 * T1 (sign-up) creates a real user in Authentik; clean it up afterwards via
 * the Authentik admin UI or the post-prod teardown hook if you add one.
 */

import { test, expect, type Page } from '@playwright/test'

// ── Configuration ────────────────────────────────────────────────────────────

const BASE = process.env.BASE_URL || 'https://app.fuzefront.com'
const AUTH_ORIGIN = process.env.POST_PROD_AUTH_ORIGIN || 'https://auth.fuzefront.com'

// Credentials for T2 (sign-in with existing account)
const SIGNIN_EMAIL = process.env.POST_PROD_EMAIL || ''
const SIGNIN_PASSWORD = process.env.POST_PROD_PASSWORD || ''

// Credentials for T1 (create a new account)
const ts = Date.now()
const SIGNUP_EMAIL = process.env.SIGNUP_EMAIL || `test+e2e-${ts}@fuzefront.dev`
const SIGNUP_PASSWORD = process.env.SIGNUP_PASSWORD || 'Test@12345678!'
const SIGNUP_USERNAME = `e2e${ts}`

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Navigate to /login and wait for the native form to render. */
async function gotoLogin(page: Page) {
  await page.goto(`${BASE}/login`)
  await expect(
    page.locator('input[type="email"]'),
    'email input must appear on /login'
  ).toBeVisible({ timeout: 15_000 })
}

/** Assert the user landed on the dashboard after authentication. */
async function expectDashboard(page: Page, label: string) {
  await page.waitForURL(`${BASE}/dashboard`, { timeout: 30_000 })
  await expect(
    page.locator('.dashboard'),
    `${label}: .dashboard element must be visible`
  ).toBeVisible({ timeout: 20_000 })
  await page.screenshot({
    path: `test-results-prod/${label.replace(/\s+/g, '-')}.png`,
    fullPage: true,
  })
}

// ── T1: Sign-up via Authentik enrollment ─────────────────────────────────────

test.describe('T1 · Sign-up (Authentik enrollment flow)', () => {
  test('clicking Sign Up redirects to Authentik enrollment and creates a new account', async ({
    page,
  }) => {
    test.setTimeout(90_000)

    await gotoLogin(page)
    await page.screenshot({ path: 'test-results-prod/T1-01-login-page.png', fullPage: true })

    // Click the Sign Up button — this calls window.location.href = /api/auth/oidc/signup
    // which 302s to the Authentik enrollment flow.
    const signUpBtn = page.getByRole('button', { name: /sign.?up/i })
    await expect(signUpBtn, 'Sign Up button must be visible').toBeVisible()
    await signUpBtn.click()

    // We should now be on Authentik's enrollment flow (auth.fuzefront.com).
    await page.waitForURL(`${AUTH_ORIGIN}/**`, { timeout: 30_000 })
    await page.screenshot({ path: 'test-results-prod/T1-02-authentik-enrollment.png', fullPage: true })

    expect(
      page.url(),
      'must be on Authentik after clicking Sign Up'
    ).toMatch(/auth\.fuzefront\.com/)

    // Fill the Authentik enrollment form.
    // Fields: email, username, password, password_repeat, tos checkbox.
    const emailField = page.locator('input[name="email"], input[type="email"]')
    const usernameField = page.locator('input[name="username"]')
    const passwordField = page.locator('input[name="password"]').first()
    const passwordRepeatField = page.locator('input[name="password_repeat"], input[id*="repeat"]')
    const tosCheckbox = page.locator('input[type="checkbox"]')

    await expect(emailField, 'email field on enrollment form').toBeVisible({ timeout: 15_000 })

    await emailField.fill(SIGNUP_EMAIL)
    await usernameField.fill(SIGNUP_USERNAME)
    await passwordField.fill(SIGNUP_PASSWORD)
    await passwordRepeatField.fill(SIGNUP_PASSWORD)

    // Accept ToS if the checkbox is present.
    if (await tosCheckbox.isVisible()) {
      await tosCheckbox.check()
    }

    await page.screenshot({ path: 'test-results-prod/T1-03-enrollment-filled.png', fullPage: true })

    // Submit the enrollment form.
    await page.getByRole('button', { name: /continue|submit|sign.?up|create/i }).click()

    // Authentik processes the enrollment → user-write → user-login stages,
    // then redirects back to FuzeFront with an OIDC code → backend exchanges
    // for a JWT → frontend navigates to /dashboard.
    await expectDashboard(page, 'T1-04-dashboard-after-signup')
  })
})

// ── T2: Native email/password sign-in ────────────────────────────────────────

test.describe('T2 · Sign-in (native email/password form)', () => {
  test.skip(
    !SIGNIN_EMAIL || !SIGNIN_PASSWORD,
    'Set POST_PROD_EMAIL and POST_PROD_PASSWORD to run T2'
  )

  test('filling the native form and submitting lands on the dashboard', async ({ page }) => {
    test.setTimeout(60_000)

    await gotoLogin(page)
    await page.screenshot({ path: 'test-results-prod/T2-01-login-page.png', fullPage: true })

    // The native email/password form lives directly in FuzeFront's SPA
    // (no redirect to Authentik for credentials entry).
    const emailInput = page.locator('input[type="email"]')
    const passwordInput = page.locator('input[type="password"]')
    const signInBtn = page.getByRole('button', { name: /^sign.?in$/i })

    await emailInput.fill(SIGNIN_EMAIL)
    await passwordInput.fill(SIGNIN_PASSWORD)

    await page.screenshot({ path: 'test-results-prod/T2-02-credentials-filled.png', fullPage: true })

    // Watch the /api/auth/oidc/password request so we can assert the 200.
    const pwLoginResp = page.waitForResponse(
      r => r.url().includes('/api/auth/oidc/password') && r.request().method() === 'POST',
      { timeout: 30_000 }
    )

    await signInBtn.click()

    const resp = await pwLoginResp
    expect(
      resp.status(),
      `POST /api/auth/oidc/password returned ${resp.status()} — expected 200`
    ).toBe(200)

    const body = await resp.json().catch(() => ({}))
    expect(body.token, 'response must contain a JWT token').toBeTruthy()

    await expectDashboard(page, 'T2-03-dashboard-after-signin')
  })
})

// ── T3: Google OAuth sign-in ──────────────────────────────────────────────────

test.describe('T3 · Sign-in with Google (OIDC handoff)', () => {
  test('clicking Sign in with Google hands off to Authentik which offers Google', async ({
    page,
  }) => {
    test.setTimeout(60_000)

    await gotoLogin(page)
    await page.screenshot({ path: 'test-results-prod/T3-01-login-page.png', fullPage: true })

    const googleBtn = page.getByRole('button', {
      name: /sign.?in with google/i,
    })
    await expect(googleBtn, '"Sign in with Google" button must be visible').toBeVisible()

    // The button triggers GET /api/auth/oidc/login → 302 → Authentik authorize endpoint.
    // Intercept the navigation request at the OIDC login initiation point.
    const oidcLoginReq = page.waitForRequest(
      r => r.url().includes('/api/auth/oidc/login'),
      { timeout: 20_000 }
    )
    await googleBtn.click()
    const oidcReq = await oidcLoginReq

    expect(
      oidcReq.url(),
      'click must trigger /api/auth/oidc/login'
    ).toContain('/api/auth/oidc/login')

    await page.screenshot({ path: 'test-results-prod/T3-02-oidc-initiated.png', fullPage: true })

    // Follow through to Authentik — we should land on the authorization endpoint.
    await page.waitForURL(
      url => url.href.includes('auth.fuzefront.com') || url.href.includes('/application/o/'),
      { timeout: 30_000 }
    )

    await page.screenshot({ path: 'test-results-prod/T3-03-authentik-auth-page.png', fullPage: true })

    // Authentik's identification page (the "login" stage shown before selecting a source).
    // It should offer a "Sign in with Google" source button from the Google social source.
    const authentikGoogleSource = page.locator(
      'a[href*="google"], button:has-text("Google"), .pf-v5-c-button:has-text("Google")'
    )
    await expect(
      authentikGoogleSource,
      'Authentik must render a Google source button — check social-source binding on the authentication flow'
    ).toBeVisible({ timeout: 20_000 })

    await page.screenshot({ path: 'test-results-prod/T3-04-authentik-google-source.png', fullPage: true })

    // We stop here — clicking the Google button would hand off to accounts.google.com
    // which requires a real Google account and is out of scope for automated E2E.
    // The assertions above confirm: FuzeFront → /api/auth/oidc/login → Authentik →
    // Google source button is present. T3 is verified.
  })
})
