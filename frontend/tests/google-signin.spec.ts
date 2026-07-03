/**
 * google-signin.spec.ts
 *
 * Playwright E2E tests for the Google Sign-In (via Authentik OIDC) flow.
 *
 * All backend/Authentik calls are intercepted with page.route() so these tests
 * do NOT require a live Authentik instance or Google OAuth credentials. They DO
 * require the frontend dev server to be running (see playwright.config.ts baseURL).
 *
 * Flow under test:
 *   1. User visits login page → frontend calls GET /api/auth/method
 *   2. If oidcConfigured:true → "Sign in with Authentik" button is shown
 *   3. Click → loginWithOIDC() → browser navigates to GET /api/auth/oidc/login
 *      (backend redirects to Authentik; here we intercept and short-circuit)
 *   4. After Authentik auth, backend redirects frontend to /?code=<hex>
 *   5. LoginPage.handleOIDCCallback() reads ?code=, POSTs /api/auth/token-exchange
 *   6. Backend returns { token, sessionId }; app fetches /api/auth/user
 *   7. App navigates to /dashboard
 *
 * Error path:
 *   - If Authentik returns ?error=&message=, the error is shown on the login page.
 */

import { test, expect } from '@playwright/test'

// ── Helpers ────────────────────────────────────────────────────────────────

/** Wire the bare-minimum API mocks needed by every test. */
async function setupCommonMocks(page: Parameters<Parameters<typeof test>[1]>[0], oidcConfigured: boolean) {
  // Health endpoint (LoginPage fires a fetch('/health') on mount)
  await page.route('**/health', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) })
  )

  // Auth method discovery endpoint
  await page.route('**/api/auth/method', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        methods: oidcConfigured ? ['local', 'oidc'] : ['local'],
        oidcConfigured,
        defaultMethod: oidcConfigured ? 'oidc' : 'local',
      }),
    })
  )
}

// ── Tests ──────────────────────────────────────────────────────────────────

test.describe('OIDC / Google Sign-In — pre-production E2E', () => {

  /**
   * 1. Login page shows the OIDC button when the backend reports oidcConfigured:true.
   */
  test('shows "Sign in with Authentik" button when oidcConfigured is true', async ({ page }) => {
    await setupCommonMocks(page, true)

    await page.goto('/')

    await expect(
      page.getByRole('button', { name: /sign in with authentik/i })
    ).toBeVisible()
  })

  /**
   * 2. Login page hides the OIDC button when the backend reports oidcConfigured:false.
   */
  test('does NOT show "Sign in with Authentik" button when oidcConfigured is false', async ({ page }) => {
    await setupCommonMocks(page, false)

    await page.goto('/')
    // Wait for the page to fully settle (auth methods loaded → button absence is final)
    await page.waitForLoadState('networkidle')

    await expect(
      page.getByRole('button', { name: /sign in with authentik/i })
    ).not.toBeVisible()
  })

  /**
   * 3. Clicking "Sign in with Authentik" navigates the browser to /api/auth/oidc/login.
   *    We intercept that route to prevent a real redirect to Authentik.
   */
  test('clicking "Sign in with Authentik" issues a request to /api/auth/oidc/login', async ({ page }) => {
    await setupCommonMocks(page, true)

    // Intercept the OIDC login initiation endpoint.  The real backend would
    // redirect here to Authentik; we short-circuit to keep the test self-contained.
    let oidcLoginRequested = false
    await page.route('**/api/auth/oidc/login', route => {
      oidcLoginRequested = true
      // Fulfill with a 200 so the browser doesn't chase a real 302.
      route.fulfill({ status: 200, body: 'Intercepted — redirecting to Authentik…' })
    })

    await page.goto('/')
    await page.getByRole('button', { name: /sign in with authentik/i }).click()

    // Give the navigation a moment to reach our route handler.
    await page.waitForTimeout(1500)

    expect(oidcLoginRequested).toBe(true)
  })

  /**
   * 4. If the URL has ?error=&message=, the page shows an authentication error.
   *    (This is the OIDC provider error-return path — no exchange is attempted.)
   */
  test('?error= in URL shows authentication error on login page', async ({ page }) => {
    await setupCommonMocks(page, false)

    // Navigate directly to the login page as if Authentik returned an error.
    await page.goto('/?error=oidc_error&message=User+denied+access')

    // The error block renders with "Authentication Error:" header.
    await expect(page.getByText(/authentication error/i)).toBeVisible({ timeout: 8000 })
    // The message detail (decoded from the URL) is shown below the header.
    await expect(page.getByText(/user denied access/i)).toBeVisible()
  })

  /**
   * 5. Landing on /?code=<hex> triggers token-exchange and redirects to /dashboard.
   *    Simulates the backend callback redirecting the browser back to the frontend
   *    with the short-lived exchange code.
   */
  test('?code= in URL triggers token exchange and redirects to /dashboard', async ({ page }) => {
    // Broad catch-all for any un-matched /api/* calls made by the dashboard
    // page after the redirect (keeps the test isolated).
    await page.route('**/api/**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    )

    // More-specific routes registered AFTER the catch-all take precedence
    // (Playwright evaluates routes in reverse-registration order).
    await setupCommonMocks(page, true)

    // Token exchange: frontend POSTs the code → backend returns JWT.
    await page.route('**/api/auth/token-exchange', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'e2e-test-jwt', sessionId: 'e2e-session-1' }),
      })
    )

    // User lookup: frontend GETs /api/auth/user after storing the token.
    await page.route('**/api/auth/user', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: 'u-1',
            email: 'google-user@example.com',
            firstName: 'Google',
            lastName: 'User',
            roles: ['user'],
          },
        }),
      })
    )

    // Navigate as if the backend redirected here after completing the OIDC flow.
    await page.goto('/?code=abc123def456abc123def456abc123de')

    // The exchange token should be stored in localStorage.
    await page.waitForFunction(
      () => localStorage.getItem('authToken') === 'e2e-test-jwt',
      { timeout: 8000 }
    )

    const storedToken = await page.evaluate(() => localStorage.getItem('authToken'))
    expect(storedToken).toBe('e2e-test-jwt')

    // The app should navigate away from the login page to /dashboard.
    await page.waitForURL(/\/dashboard/, { timeout: 8000 })
  })
})
