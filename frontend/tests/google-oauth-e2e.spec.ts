/**
 * Real end-to-end test for Google Sign-In via Authentik OIDC.
 *
 * Requires the full docker-compose.e2e.yml stack running with a live
 * Cloudflare tunnel, real Google dev OAuth credentials, and a test Google
 * account that has NO 2-factor authentication.
 *
 * Required env vars (set in CI secrets or local .env):
 *   TUNNEL_HOSTNAME        — public tunnel hostname (default: auth-dev.fuzefront.com)
 *   GOOGLE_TEST_EMAIL      — test Google account email
 *   GOOGLE_TEST_PASSWORD   — test Google account password (no 2FA)
 *
 * To skip locally: don't set GOOGLE_TEST_EMAIL — the test skips itself.
 *
 * CI: google-oauth-e2e.yml starts the stack, then runs this file.
 */
import { test, expect, Page } from '@playwright/test'

const TUNNEL_HOSTNAME = process.env.TUNNEL_HOSTNAME ?? 'auth-dev.fuzefront.com'
const GOOGLE_TEST_EMAIL = process.env.GOOGLE_TEST_EMAIL ?? ''
const GOOGLE_TEST_PASSWORD = process.env.GOOGLE_TEST_PASSWORD ?? ''

// Skip the whole suite if credentials are not provided
test.beforeAll(() => {
  if (!GOOGLE_TEST_EMAIL || !GOOGLE_TEST_PASSWORD) {
    // eslint-disable-next-line no-console
    console.warn(
      'Skipping Google OAuth E2E: GOOGLE_TEST_EMAIL / GOOGLE_TEST_PASSWORD not set.'
    )
  }
})

test.describe('Google Sign-In E2E — full stack', () => {
  test.skip(
    !GOOGLE_TEST_EMAIL || !GOOGLE_TEST_PASSWORD,
    'GOOGLE_TEST_EMAIL and GOOGLE_TEST_PASSWORD must be set'
  )

  // Each test starts fresh (no shared cookies)
  test.use({ storageState: { cookies: [], origins: [] } })

  test('Google button is visible on the Authentik login page', async ({ page }) => {
    // Navigate to Authentik directly through the tunnel
    await page.goto(`https://${TUNNEL_HOSTNAME}/`)
    // Authentik's default login page shows available sources
    await expect(page.locator('text=Sign in with Google')).toBeVisible({ timeout: 15_000 })
  })

  test('full Google Sign-In flow completes and lands on FuzeFront dashboard', async ({ page }) => {
    // ── Step 1: Open FuzeFront frontend ──────────────────────────────────
    await page.goto('http://localhost:4173')
    await expect(page).toHaveTitle(/FuzeFront|Sign in/, { timeout: 15_000 })

    // ── Step 2: Click "Sign in with Authentik" ────────────────────────────
    const oidcButton = page.getByRole('button', { name: /sign in with authentik/i })
    await expect(oidcButton).toBeVisible({ timeout: 10_000 })
    await oidcButton.click()

    // ── Step 3: Authentik login page via tunnel ────────────────────────────
    await page.waitForURL(`https://${TUNNEL_HOSTNAME}/**`, { timeout: 20_000 })
    await expect(page.locator('text=Sign in with Google')).toBeVisible({ timeout: 15_000 })

    // ── Step 4: Click "Sign in with Google" ───────────────────────────────
    await page.locator('text=Sign in with Google').click()

    // ── Step 5: Google accounts.google.com login ──────────────────────────
    await page.waitForURL('https://accounts.google.com/**', { timeout: 20_000 })

    await fillGoogleLogin(page, GOOGLE_TEST_EMAIL, GOOGLE_TEST_PASSWORD)

    // ── Step 6: Back to Authentik (Google redirects to the tunnel callback) ─
    await page.waitForURL(`https://${TUNNEL_HOSTNAME}/**`, { timeout: 30_000 })

    // ── Step 7: Authentik redirects to backend callback ───────────────────
    await page.waitForURL('http://localhost:3001/**', { timeout: 15_000 })

    // ── Step 8: Backend redirects to frontend with exchange code ──────────
    await page.waitForURL('http://localhost:4173/**', { timeout: 15_000 })
    await expect(page).toHaveURL(/[?&]code=/)

    // ── Step 9: Frontend exchanges code → JWT stored, redirects to dashboard ─
    await page.waitForURL('http://localhost:4173/dashboard', { timeout: 15_000 })

    // Verify a real JWT was stored (not a mock)
    const authToken = await page.evaluate(() => localStorage.getItem('authToken'))
    expect(authToken).toBeTruthy()
    expect(authToken!.split('.').length).toBe(3) // JWT has 3 dot-separated parts
  })

  test('error from Google (user cancels) shows error on FuzeFront', async ({ page }) => {
    await page.goto('http://localhost:4173')
    const oidcButton = page.getByRole('button', { name: /sign in with authentik/i })
    await expect(oidcButton).toBeVisible({ timeout: 10_000 })
    await oidcButton.click()

    // Authentik login page
    await page.waitForURL(`https://${TUNNEL_HOSTNAME}/**`, { timeout: 20_000 })

    // Simulate Google declining by navigating back to FuzeFront with an error
    // (mimics what Authentik does when Google returns error=access_denied)
    await page.goto('http://localhost:4173/?error=oidc_error&message=access_denied')
    await expect(page.locator('text=/authentication error|access.denied/i')).toBeVisible({
      timeout: 5_000,
    })
  })
})

// ── Helper: drive through Google's login form ────────────────────────────────

async function fillGoogleLogin(page: Page, email: string, password: string) {
  // Email step
  const emailInput = page.locator('input[type="email"]')
  await expect(emailInput).toBeVisible({ timeout: 15_000 })
  await emailInput.fill(email)
  await page.keyboard.press('Enter')

  // Password step (appears after email is accepted)
  const passwordInput = page.locator('input[type="password"]')
  await expect(passwordInput).toBeVisible({ timeout: 10_000 })
  await passwordInput.fill(password)
  await page.keyboard.press('Enter')

  // Google may show a consent/confirmation step — handle it gracefully
  try {
    const continueBtn = page.locator('button:has-text("Continue"), button:has-text("Allow")')
    await continueBtn.waitFor({ timeout: 5_000 })
    await continueBtn.click()
  } catch {
    // No consent step — that's fine
  }
}
