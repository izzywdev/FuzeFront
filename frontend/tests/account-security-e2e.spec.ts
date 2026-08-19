/**
 * ACCOUNT & SECURITY — INDEPENDENT UI e2e (frontend-test-engineer).
 *
 * Drives the account/security acceptance criteria against the built UI via
 * `playwright.prod.config.ts` (PROD_BASE_URL, default https://app.fuzefront.com).
 * These are separate from `prod-full-auth-flow.spec.ts` (which owns the sign-in
 * + provider-boundary headline gate) and focus on the post-sign-up account
 * self-service surface:
 *
 *   P1  Email verification during sign-up   (PRIORITY 1 — the requested drive)
 *   2FA phone enroll → OTP → challenge on next login
 *   Link / unlink Google + set-password
 *   Manage devices (list / revoke one / revoke-all-others)
 *   Password reset (request → confirm → login with new password)
 *   Switch account (two sessions, switch in profile menu)
 *
 * ── Provider boundary (kept enforced) ───────────────────────────────────────
 * Every drive that can touch a Google flow is wrapped in the SAME boundary
 * guard as the auth suite: during any Google interaction the browser must visit
 * ONLY app.fuzefront.com + accounts.google.com. A hop to `auth.fuzefront.com`
 * FAILS the test.
 *
 * ── Build state (why some tests are fixme) ──────────────────────────────────
 * The account/security UI is NOT merged into `frontend/src` yet, and only the
 * email + phone verification and MFA endpoints exist in the frozen Security
 * contract (packages/security/openapi.yaml). Drives whose UI/contract are not
 * yet built are marked `test.fixme(...)` with a TODO naming the missing slice,
 * so they are ready the moment the UI lands and are visibly "pending-UI", NOT
 * silently passing. `@authn-pending-deploy` tags the ones that will pass only
 * after the AuthN/account deploy.
 *
 * Credentials/test hooks come from env — never hard-coded:
 *   PROD_BASE_URL             target origin (default https://app.fuzefront.com)
 *   AUTHN_SIGNUP_EMAIL        fresh email for the signup drive (else random)
 *   AUTHN_SIGNUP_PASSWORD     password for the signup drive (else generated)
 *   EMAIL_VERIFY_TEST_CODE    test-mode OTP the backend accepts for the fresh
 *                             signup email (mailbox stub / seeded test code)
 *   MAILBOX_API_URL           optional: JSON mailbox endpoint to poll for the
 *                             real verification code (e.g. Mailpit/MailHog)
 *   PHONE_VERIFY_TEST_CODE    test-mode SMS OTP
 *   AUTHN_TEST_EMAIL/PASSWORD seeded password account (for device/link drives)
 *   GOOGLE_TEST_EMAIL/PASSWORD Google test account (link/unlink drive)
 */
import { test, expect, type Page, type Request } from '@playwright/test'

const FORBIDDEN_IDP_HOST = 'auth.fuzefront.com'
const APP_HOST_RE = /(^|\.)fuzefront\.com$/i

const AUTHN_TEST_EMAIL = process.env.AUTHN_TEST_EMAIL ?? ''
const AUTHN_TEST_PASSWORD = process.env.AUTHN_TEST_PASSWORD ?? ''
const GOOGLE_TEST_EMAIL = process.env.GOOGLE_TEST_EMAIL ?? ''
const GOOGLE_TEST_PASSWORD = process.env.GOOGLE_TEST_PASSWORD ?? ''

/** Fail the test the instant the browser reaches the internal IdP host. */
function guardProviderBoundary(page: Page): { violations: string[]; visited: Set<string> } {
  const violations: string[] = []
  const visited = new Set<string>()
  const inspect = (kind: string, url: string) => {
    let host = ''
    try {
      host = new URL(url).host
    } catch {
      return
    }
    visited.add(host)
    if (host.toLowerCase().includes(FORBIDDEN_IDP_HOST)) {
      violations.push(`${kind} -> ${url}`)
      throw new Error(`PROVIDER BOUNDARY BREACH: browser reached ${FORBIDDEN_IDP_HOST} via ${kind}: ${url}`)
    }
  }
  page.on('request', (req: Request) => inspect(`request(${req.resourceType()})`, req.url()))
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) inspect('navigation', frame.url())
  })
  page.on('popup', p => inspect('popup', p.url()))
  return { violations, visited }
}

/**
 * Obtain the email verification code deterministically: prefer an explicit
 * test-mode code, else poll a JSON mailbox (Mailpit/MailHog-style). Returns
 * null when neither is available so the caller can skip cleanly.
 */
async function resolveEmailCode(page: Page, email: string): Promise<string | null> {
  if (process.env.EMAIL_VERIFY_TEST_CODE) return process.env.EMAIL_VERIFY_TEST_CODE
  const mailbox = process.env.MAILBOX_API_URL
  if (!mailbox) return null
  // Poll a Mailpit-style API for the most recent message to `email` and pull a
  // 6-digit code out of the body. Deterministic: bounded retries, no sleeps > 1s.
  for (let i = 0; i < 15; i++) {
    try {
      const res = await page.request.get(`${mailbox}/api/v1/messages`)
      if (res.ok()) {
        const data = await res.json()
        const items: any[] = data.messages ?? data.items ?? []
        const msg = items.find(m => JSON.stringify(m).toLowerCase().includes(email.toLowerCase()))
        if (msg) {
          const detail = await page.request.get(`${mailbox}/api/v1/message/${msg.ID ?? msg.id}`)
          const text = JSON.stringify(await detail.json())
          const m = text.match(/\b(\d{6})\b/)
          if (m) return m[1]
        }
      }
    } catch {
      /* retry */
    }
    await page.waitForTimeout(1000)
  }
  return null
}

test.describe('Account & Security — self-service UI e2e', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  // ── PRIORITY 1: email verification during sign-up ─────────────────────────
  // signup → the email-verify step appears → complete it (test-hook / mailbox
  // stub) → land on /dashboard. Boundary-guarded throughout.
  test('P1 sign-up shows the email-verify step, completing it lands on /dashboard @authn-pending-deploy', async ({ page }) => {
    const { violations } = guardProviderBoundary(page)
    const email = process.env.AUTHN_SIGNUP_EMAIL || `e2e+verify${Date.now()}@fuzefront-test.dev`
    const password = process.env.AUTHN_SIGNUP_PASSWORD || `Aa1!${Date.now()}`

    await page.goto('/signup')
    await expect(page).toHaveURL(APP_HOST_RE)

    const emailInput = page.locator('input[type="email"]').first()
    await expect(emailInput).toBeVisible({ timeout: 20_000 })
    await emailInput.fill(email)
    await page.locator('input[type="password"]').first().fill(password)
    const confirm = page.locator('input[type="password"]').nth(1)
    if (await confirm.count()) await confirm.fill(password).catch(() => {})
    await page.getByRole('button', { name: /sign ?up|create account|register/i }).first().click()

    // The email-verify step MUST appear before /dashboard — either a dedicated
    // /verify route or an inline "check your email / enter code" panel.
    const verifyStep = page
      .getByText(/verify your email|check your (inbox|email)|enter the (\d|six).?digit code|verification code/i)
      .first()
    await expect(verifyStep, 'email-verify step is shown after sign-up').toBeVisible({ timeout: 30_000 })

    // Complete it with a test-mode code / mailbox-polled code.
    const code = await resolveEmailCode(page, email)
    test.skip(!code, 'EMAIL_VERIFY_TEST_CODE / MAILBOX_API_URL not set — cannot complete the verify step')

    const codeField = page
      .locator('input[autocomplete="one-time-code"], input[name*="code" i], input[inputmode="numeric"]')
      .first()
    await expect(codeField).toBeVisible({ timeout: 15_000 })
    await codeField.fill(code!)
    await page.getByRole('button', { name: /verify|confirm|continue|submit/i }).first().click()

    await page.waitForURL('**/dashboard', { timeout: 30_000 })
    await expect(page).toHaveURL(APP_HOST_RE)
    expect(violations, `boundary violations: ${violations.join(', ')}`).toEqual([])
  })

  // Negative: a wrong/expired code must fail closed (stay on the verify step).
  test('P1 email-verify fails closed on a bad code @authn-pending-deploy', async ({ page }) => {
    guardProviderBoundary(page)
    const email = `e2e+badcode${Date.now()}@fuzefront-test.dev`
    const password = `Aa1!${Date.now()}`

    await page.goto('/signup')
    const emailInput = page.locator('input[type="email"]').first()
    await expect(emailInput).toBeVisible({ timeout: 20_000 })
    await emailInput.fill(email)
    await page.locator('input[type="password"]').first().fill(password)
    const confirm = page.locator('input[type="password"]').nth(1)
    if (await confirm.count()) await confirm.fill(password).catch(() => {})
    await page.getByRole('button', { name: /sign ?up|create account|register/i }).first().click()

    const codeField = page
      .locator('input[autocomplete="one-time-code"], input[name*="code" i], input[inputmode="numeric"]')
      .first()
    await expect(codeField).toBeVisible({ timeout: 30_000 })
    await codeField.fill('000000')
    await page.getByRole('button', { name: /verify|confirm|continue|submit/i }).first().click()

    // Must NOT reach the dashboard; an error must surface.
    await expect(page.getByText(/invalid|incorrect|expired|try again/i).first()).toBeVisible({ timeout: 15_000 })
    await expect(page).not.toHaveURL(/\/dashboard/)
  })

  // ── 2FA phone: enroll → OTP → challenge on next login ─────────────────────
  test('2FA phone: enroll phone, enter OTP, then get a 2FA challenge on next login @authn-pending-deploy', async ({ page }) => {
    test.fixme(
      true,
      'TODO: unblock when the account-security UI (Security settings → "Add phone / 2FA") is merged into frontend/src. ' +
        'Contract endpoints exist (POST /v1/security/mfa/factors, .../activate, mfa/challenge, mfa/verify). ' +
        'Drive: Security settings → Add phone → PHONE_VERIFY_TEST_CODE → sign out → sign in → assert code field → verify → /dashboard.'
    )
    const { violations } = guardProviderBoundary(page)
    test.skip(!AUTHN_TEST_EMAIL || !AUTHN_TEST_PASSWORD, 'AUTHN_TEST_EMAIL/PASSWORD not set')
    const phone = process.env.MFA_TEST_PHONE || '+15555550123'
    const otp = process.env.PHONE_VERIFY_TEST_CODE || ''

    // 1) Sign in and open Security settings.
    await page.goto('/login')
    await page.locator('input[type="email"]').first().fill(AUTHN_TEST_EMAIL)
    await page.locator('input[type="password"]').first().fill(AUTHN_TEST_PASSWORD)
    await page.getByRole('button', { name: /^sign in$/i }).click()
    await page.waitForURL('**/dashboard', { timeout: 30_000 })

    await page.goto('/settings/security')
    await page.getByRole('button', { name: /add phone|enable 2fa|set up two.?factor/i }).first().click()
    await page.locator('input[type="tel"], input[name*="phone" i]').first().fill(phone)
    await page.getByRole('button', { name: /send code|continue/i }).first().click()
    await page.locator('input[autocomplete="one-time-code"], input[inputmode="numeric"]').first().fill(otp)
    await page.getByRole('button', { name: /verify|confirm/i }).first().click()
    await expect(page.getByText(/two.?factor.*(on|enabled)|2fa enabled/i).first()).toBeVisible()

    // 2) Sign out, sign in again → the 2FA challenge must appear.
    await page.goto('/logout')
    await page.goto('/login')
    await page.locator('input[type="email"]').first().fill(AUTHN_TEST_EMAIL)
    await page.locator('input[type="password"]').first().fill(AUTHN_TEST_PASSWORD)
    await page.getByRole('button', { name: /^sign in$/i }).click()
    const challenge = page.locator('input[autocomplete="one-time-code"], input[inputmode="numeric"]').first()
    await expect(challenge, '2FA challenge on next login').toBeVisible({ timeout: 20_000 })
    await challenge.fill(otp)
    await page.getByRole('button', { name: /verify|continue/i }).first().click()
    await page.waitForURL('**/dashboard', { timeout: 30_000 })
    expect(violations).toEqual([])
  })

  // ── Link / unlink Google + set-password ───────────────────────────────────
  test('Link Google, unlink (blocked if last method), add password to a social-only account @boundary @authn-pending-deploy', async ({ page }) => {
    test.fixme(
      true,
      'TODO: unblock when Security settings → "Connected accounts" (link/unlink Google) + "Set password" UI is merged, ' +
        'and the link/unlink + set-password endpoints are added to packages/security/openapi.yaml (NOT in the frozen ' +
        'contract yet). Boundary guard must hold during the Google link hop (app + accounts.google.com only).'
    )
    const { violations } = guardProviderBoundary(page)
    test.skip(!GOOGLE_TEST_EMAIL || !GOOGLE_TEST_PASSWORD, 'GOOGLE_TEST_EMAIL/PASSWORD not set')

    await page.goto('/settings/security')
    await page.getByRole('button', { name: /connect google|link google/i }).first().click()
    await page.waitForURL(/accounts\.google\.com/, { timeout: 30_000 })
    // ... complete Google consent, assert "Google connected", then:
    //  - unlink is BLOCKED when Google is the only method (assert error/disabled)
    //  - "Set password" adds a password method, after which unlink is allowed
    expect(violations).toEqual([])
  })

  // ── Manage devices / sessions ─────────────────────────────────────────────
  test('Manage devices: list sessions, revoke one, revoke-all-others @authn-pending-deploy', async ({ page }) => {
    test.fixme(
      true,
      'TODO: unblock when Security settings → "Devices / active sessions" UI is merged AND a sessions/devices list + ' +
        'revoke endpoint is added to the Security contract (packages/security/openapi.yaml has NO /sessions or ' +
        '/devices list/revoke path yet). Drive: two logins → settings shows >=2 sessions → revoke one → count drops → ' +
        'revoke-all-others → only current remains.'
    )
    guardProviderBoundary(page)
    test.skip(!AUTHN_TEST_EMAIL || !AUTHN_TEST_PASSWORD, 'AUTHN_TEST_EMAIL/PASSWORD not set')
    await page.goto('/settings/security')
    await expect(page.getByText(/active sessions|devices/i).first()).toBeVisible()
  })

  // ── Password reset ────────────────────────────────────────────────────────
  test('Password reset: request → confirm via emailed link/code → login with new password @authn-pending-deploy', async ({ page }) => {
    test.fixme(
      true,
      'TODO: unblock when the "Forgot password" request + reset-confirm UI is merged AND password/reset(request|confirm) ' +
        'endpoints are added to the Security contract (not present yet). Needs MAILBOX_API_URL to fetch the reset link/code. ' +
        'Drive: /login → Forgot password → email → open reset link → set new password → sign in with new password.'
    )
    guardProviderBoundary(page)
    test.skip(!process.env.MAILBOX_API_URL, 'MAILBOX_API_URL not set — cannot fetch the reset link')
    await page.goto('/login')
    await page.getByRole('link', { name: /forgot password/i }).first().click()
  })

  // ── Switch account ────────────────────────────────────────────────────────
  test('Switch account: two signed-in sessions, switch via the profile menu @authn-pending-deploy', async ({ page }) => {
    test.fixme(
      true,
      'TODO: unblock when the multi-account "Switch account" profile-menu UI is merged (session/exchange contract exists ' +
        'at POST /v1/security/session/exchange, but the account-switcher UI is not in frontend/src yet). Drive: sign in as ' +
        'account A → add account B → profile menu lists both → switch to A → dashboard reflects A.'
    )
    guardProviderBoundary(page)
    await page.goto('/dashboard')
  })
})
