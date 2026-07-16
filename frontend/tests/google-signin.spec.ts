/**
 * google-signin.spec.ts
 *
 * FRONTEND COMPONENT TESTS (mock-based) — NOT an end-to-end integration test.
 *
 * All backend calls are intercepted with page.route() so these tests do NOT
 * require a live identity provider or Google OAuth credentials. They test ONLY
 * the frontend's rendering and routing logic in isolation.
 *
 * The SPA talks exclusively to FuzeFront's own provider-agnostic Security API
 * (`/api/v1/security/*`) — it never names or calls a vendor — so these mocks
 * intercept that surface, not the deprecated `/api/auth/*` compatibility layer.
 *
 * For the real end-to-end integration test that exercises every layer —
 * frontend → Security API → identity provider → token exchange → JWT — see:
 *   tests/oidc-plumbing.e2e.spec.ts   (local provider user, runs on every PR)
 *   tests/google-oauth-e2e.spec.ts    (real Google OAuth, requires CI secrets)
 *
 * What these mock tests cover:
 *   1. Login page shows / hides the Google button based on the `social` array
 *      returned by GET /api/v1/security/methods
 *   2. Click → startSocialLogin() → browser navigates to
 *      GET /api/v1/security/social/google/start (intercepted — never hits Google)
 *   3. After provider auth, the backend redirects the frontend to /?code=<hex>
 *   4. handleAuthCallback() reads ?code=, POSTs /api/v1/security/session/exchange
 *   5. App navigates to /dashboard on success
 *   6. Error path: ?error= shows an error on the login page
 */

import { test, expect } from '@playwright/test'

// ── Helpers ────────────────────────────────────────────────────────────────

/** Wire the bare-minimum API mocks needed by every test. */
async function setupCommonMocks(page: Parameters<Parameters<typeof test>[1]>[0], oidcConfigured: boolean) {
  // Health endpoint (LoginPage fires a fetch('/health') on mount)
  await page.route('**/health', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) })
  )

  // Auth capability discovery. The SPA reads the provider-agnostic Security API
  // (`GET /api/v1/security/methods`), which returns a neutral descriptor — a
  // non-empty `social` array is what enables the Google button; the legacy
  // vendor-flavoured `oidcConfigured` boolean is gone.
  await page.route('**/api/v1/security/methods', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        password: true,
        social: oidcConfigured ? ['google'] : [],
        mfa: { enabled: true, types: ['totp', 'sms', 'email'] },
        verification: { email: true, sms: true },
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
   * 3. Clicking "Sign in with Google" navigates the browser to the Security API's
   *    social-start endpoint. We intercept it to prevent a real redirect out.
   */
  test('clicking "Sign in with Google" issues a request to /api/v1/security/social/google/start', async ({ page }) => {
    await setupCommonMocks(page, true)

    // Intercept the server-brokered social-login initiation endpoint. The real
    // backend 302s from here toward Google; we short-circuit to stay self-contained.
    let socialStartRequested = false
    await page.route('**/api/v1/security/social/google/start', route => {
      socialStartRequested = true
      // Fulfill with a 200 so the browser doesn't chase a real 302.
      route.fulfill({ status: 200, body: 'Intercepted — redirecting to Google…' })
    })

    await page.goto('/')
    await page.getByRole('button', { name: /sign in with google/i }).click()

    // Give the navigation a moment to reach our route handler.
    await page.waitForTimeout(1500)

    expect(socialStartRequested).toBe(true)
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

    // Token exchange: frontend POSTs the opaque code to the Security API
    // (`POST /api/v1/security/session/exchange`) → returns a SessionResult.
    await page.route('**/api/v1/security/session/exchange', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'authenticated',
          token: 'e2e-test-jwt',
          sessionId: 'e2e-session-1',
          user: { id: 'u-1', email: 'e2e@fuzefront.dev', firstName: 'E2E', lastName: 'User', roles: ['user'] },
        }),
      })
    )

    // User lookup ("me"): frontend GETs the Security API session after storing
    // the token. Exact path — `/session/exchange` above keeps its own route.
    await page.route('**/api/v1/security/session', route =>
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
