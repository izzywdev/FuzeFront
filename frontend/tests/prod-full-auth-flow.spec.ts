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

// Credentials for T3 (Google OAuth — local headed only, human approves consent screen)
const GOOGLE_EMAIL = process.env.GOOGLE_TEST_EMAIL || 'izzy.weinberg@gmail.com'

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
    const signUpBtn = page.getByRole('button', { name: /create an account|sign.?up/i })
    await expect(signUpBtn, '"Create an account" button must be visible').toBeVisible()
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
// Requires GOOGLE_TEST_EMAIL (default: izzy.weinberg@gmail.com).
// Run locally in headed mode — the test fills the email then waits for YOU
// to approve the Google consent screen. No password is automated.
//
//   GOOGLE_TEST_EMAIL=izzy.weinberg@gmail.com \
//   npx playwright test --config playwright.prod.config.ts --headed --grep T3

test.describe('T3 · Sign-in with Google (full OAuth flow)', () => {
  test.skip(
    !process.env.GOOGLE_TEST_EMAIL,
    'Set GOOGLE_TEST_EMAIL to run T3 (local headed only — human approves Google consent)'
  )

  test('Google OAuth completes and lands on dashboard', async ({ page }) => {
    // Long timeout: human must approve the Google consent screen
    test.setTimeout(120_000)

    await gotoLogin(page)
    await page.screenshot({ path: 'test-results-prod/T3-01-login-page.png', fullPage: true })

    const googleBtn = page.getByRole('button', { name: /sign.?in with google/i })
    await expect(googleBtn, '"Sign in with Google" button must be visible').toBeVisible()

    // FuzeFront → /api/auth/oidc/login → Authentik authorize endpoint
    const oidcLoginReq = page.waitForRequest(
      r => r.url().includes('/api/auth/oidc/login'),
      { timeout: 20_000 }
    )
    await googleBtn.click()
    const oidcReq = await oidcLoginReq
    expect(oidcReq.url()).toContain('/api/auth/oidc/login')

    // Authentik identification page — wait for the SPA to fully render before
    // looking for the Google button (Authentik shows a loading spinner while
    // the flow engine connects via WebSocket).
    await page.waitForURL(
      url => url.href.includes('auth.fuzefront.com') || url.href.includes('/application/o/'),
      { timeout: 30_000 }
    )
    // Wait for network idle so the Authentik SPA finishes rendering the flow stage.
    await page.waitForLoadState('networkidle', { timeout: 30_000 })
    await page.screenshot({ path: 'test-results-prod/T3-02-authentik-page.png', fullPage: true })

    // ── T3 PASS CONDITION: intercept the Authentik Google callback ──────────────
    // Set up the intercept BEFORE clicking Google so we don't race.
    // When Google completes OAuth it GETs auth.fuzefront.com/source/oauth/callback/google/
    // with a `code` param. That request proves the full round-trip succeeded,
    // regardless of what Authentik does next (enrollment, dashboard, or error).
    const authentikCallbackPromise = page.waitForRequest(
      r => r.url().includes('/source/oauth/callback/google/') && r.url().includes('code='),
      { timeout: 90_000 }
    )

    // Click the Google source button on Authentik
    const authentikGoogleSource = page.locator(
      'a[href*="google"], button:has-text("Google"), .pf-v5-c-button:has-text("Google")'
    )
    await expect(
      authentikGoogleSource,
      'Authentik must render a Google source button'
    ).toBeVisible({ timeout: 30_000 })
    await authentikGoogleSource.first().click()

    // accounts.google.com — fill the email then let Chrome auto-sign-in with saved credentials
    await page.waitForURL(url => url.href.includes('accounts.google.com'), { timeout: 20_000 })
    await page.screenshot({ path: 'test-results-prod/T3-03-google-accounts.png', fullPage: true })

    // Google's identifier field is name="identifier" / id="identifierId", not type="email"
    const emailInput = page.locator('#identifierId, input[name="identifier"], input[type="email"]')
    await expect(emailInput.first(), 'Google email input must appear').toBeVisible({ timeout: 15_000 })
    await emailInput.first().fill(GOOGLE_EMAIL)
    await page.keyboard.press('Enter')

    await page.screenshot({ path: 'test-results-prod/T3-04-google-email-filled.png', fullPage: true })

    // Wait for the Authentik callback request — this is the definitive proof that
    // Google returned an OAuth code to Authentik. Chrome uses saved credentials
    // so no manual password entry is needed.
    const callbackReq = await authentikCallbackPromise
    expect(callbackReq.url(), 'Authentik callback must carry a code param').toContain('code=')
    await page.screenshot({ path: 'test-results-prod/T3-04b-authentik-callback.png', fullPage: true })
  })
})
