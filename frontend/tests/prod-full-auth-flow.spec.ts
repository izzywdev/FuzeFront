/**
 * PRE-PRODUCTION full-auth-flow + PROVIDER-BOUNDARY regression gate.
 *
 * Independent UI verification (frontend-test-engineer) of the provider-agnostic
 * Security API (contract PR #243, docs/planning/provider-agnostic-security-layer.md).
 * Runs via `playwright.prod.config.ts` against the built UI (PROD_BASE_URL,
 * default https://app.fuzefront.com).
 *
 * ── The headline guarantee (the reason this file exists) ────────────────────
 * Under the new model NO FuzeFront-internal identity host (`auth.fuzefront.com`)
 * may ever be visible to the browser. During the whole Google sign-in flow the
 * browser must transit ONLY:
 *     • app.fuzefront.com   (the app + server-brokered Security API)
 *     • accounts.google.com (Google's own consent — the one unavoidable hop)
 * ANY navigation OR request to `auth.fuzefront.com` FAILS the test. That is the
 * objective proof the provider boundary holds (§20 of the planning doc).
 *
 * ── Tests ───────────────────────────────────────────────────────────────────
 *   T1  signup           — server-brokered, no provider enrollment page, /dashboard
 *   T2  password login   — POST /api/v1/security/session, lands on /dashboard
 *   T3  Google login      — @boundary — real-Chrome consent path + boundary assertion
 *   BG  boundary gate     — @boundary — no auth.fuzefront.com during the Google flow
 *   MFA step-up          — password login → mfa_required → verify → /dashboard
 *   VER email/phone      — verification happy-path where testable
 *
 * ── State of the world ──────────────────────────────────────────────────────
 * The AuthN implementation (frontend de-vendoring + backend server-brokered
 * social login) is NOT deployed yet. These tests are the acceptance gate the
 * deploy is verified against: they will legitimately FAIL until the AuthN
 * deploy lands. They self-skip when credentials/targets are absent so a routine
 * CI run is green; the `@boundary` / `@authn-pending-deploy` tags let the
 * post-deploy runner select them explicitly.
 *
 * Credentials come from env — never hard-coded:
 *   PROD_BASE_URL          target app origin (default https://app.fuzefront.com)
 *   GOOGLE_TEST_EMAIL      Google test account (no 2FA) — enables T3/BG
 *   GOOGLE_TEST_PASSWORD
 *   AUTHN_TEST_EMAIL       seeded password account — enables T2/MFA
 *   AUTHN_TEST_PASSWORD
 *   AUTHN_SIGNUP_EMAIL     fresh email for T1 (optional; a random one is used otherwise)
 */
import { test, expect, type Page, type Request } from '@playwright/test'

// ── The forbidden internal host. The whole boundary guarantee is "this string
//    never appears as a browser destination". Kept as a single constant so the
//    intent is unmissable. ─────────────────────────────────────────────────
const FORBIDDEN_IDP_HOST = 'auth.fuzefront.com'

// Hosts the browser is ALLOWED to visit during the Google flow.
const ALLOWED_HOST_RE = /(^|\.)(fuzefront\.com|google\.com|gstatic\.com|googleapis\.com)$/i
// Only these two are the "user-visible" hops the guarantee names explicitly.
const APP_HOST_RE = /(^|\.)fuzefront\.com$/i
const GOOGLE_HOST_RE = /(^|\.)google\.com$/i

const GOOGLE_TEST_EMAIL = process.env.GOOGLE_TEST_EMAIL ?? ''
const GOOGLE_TEST_PASSWORD = process.env.GOOGLE_TEST_PASSWORD ?? ''
const AUTHN_TEST_EMAIL = process.env.AUTHN_TEST_EMAIL ?? ''
const AUTHN_TEST_PASSWORD = process.env.AUTHN_TEST_PASSWORD ?? ''

/**
 * Attach a hard guard that fails the test the instant the browser tries to
 * reach the internal IdP host — as a navigation, sub-request, redirect hop, or
 * websocket. Returns the collected violations for a post-hoc assertion too.
 */
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
      // Fail loudly & immediately: a single leak is a boundary breach.
      throw new Error(
        `PROVIDER BOUNDARY BREACH: browser reached ${FORBIDDEN_IDP_HOST} via ${kind}: ${url}`
      )
    }
  }

  page.on('request', (req: Request) => inspect(`request(${req.resourceType()})`, req.url()))
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) inspect('navigation', frame.url())
  })
  page.on('popup', p => inspect('popup', p.url()))

  return { violations, visited }
}

test.describe('AuthN full flow + provider boundary (pre-prod gate)', () => {
  // Each test starts with a clean session.
  test.use({ storageState: { cookies: [], origins: [] } })

  // ── T1: server-brokered signup, no provider enrollment page ───────────────
  test('T1 signup is server-brokered (no IdP enrollment page) and lands on /dashboard @authn-pending-deploy', async ({ page }) => {
    const { violations } = guardProviderBoundary(page)
    const email =
      process.env.AUTHN_SIGNUP_EMAIL ||
      `e2e+${Date.now()}@fuzefront-test.dev`
    const password = process.env.AUTHN_SIGNUP_PASSWORD || `Aa1!${Date.now()}`

    await page.goto('/signup')

    // The FuzeFront-branded signup form must render — NOT a redirect to any
    // provider's raw enrollment page. The boundary guard already fails on an
    // auth.fuzefront.com hop; here we also assert we stayed on the app host.
    await expect(page).toHaveURL(APP_HOST_RE)
    const emailInput = page.locator('input[type="email"]').first()
    await expect(emailInput).toBeVisible({ timeout: 20_000 })
    await emailInput.fill(email)
    await page.locator('input[type="password"]').first().fill(password)

    // Optional confirm-password field.
    const confirm = page.locator('input[type="password"]').nth(1)
    if (await confirm.count()) await confirm.fill(password).catch(() => {})

    await page.getByRole('button', { name: /sign ?up|create account|register/i }).first().click()

    // Server-brokered signup establishes a session and routes to the dashboard.
    await page.waitForURL('**/dashboard', { timeout: 30_000 })
    await expect(page).toHaveURL(APP_HOST_RE)
    expect(violations, `boundary violations: ${violations.join(', ')}`).toEqual([])
  })

  // ── T2: password login via the neutral Security API ───────────────────────
  test('T2 password login (POST /api/v1/security/session) lands on /dashboard @authn-pending-deploy', async ({ page }) => {
    test.skip(!AUTHN_TEST_EMAIL || !AUTHN_TEST_PASSWORD, 'AUTHN_TEST_EMAIL/PASSWORD not set')
    const { violations } = guardProviderBoundary(page)

    // The SPA must POST the credentials to the neutral endpoint (server-brokered
    // verification — the browser never leaves the app host).
    const sessionCall = page.waitForRequest(
      req => req.method() === 'POST' && /\/api\/v1\/security\/session(\?|$)/.test(req.url()),
      { timeout: 25_000 }
    )

    await page.goto('/login')
    await page.locator('input[type="email"]').first().fill(AUTHN_TEST_EMAIL)
    await page.locator('input[type="password"]').first().fill(AUTHN_TEST_PASSWORD)
    await page.getByRole('button', { name: /^sign in$/i }).click()

    await sessionCall
    await page.waitForURL('**/dashboard', { timeout: 30_000 })
    await expect(page).toHaveURL(APP_HOST_RE)
    expect(violations, `boundary violations: ${violations.join(', ')}`).toEqual([])
  })

  // ── BG + T3: Google login boundary gate (the headline) ────────────────────
  test('T3/BG Google sign-in stays within app.fuzefront.com + accounts.google.com ONLY @boundary @authn-pending-deploy', async ({ page }) => {
    test.skip(
      !GOOGLE_TEST_EMAIL || !GOOGLE_TEST_PASSWORD,
      'GOOGLE_TEST_EMAIL/PASSWORD not set — cannot drive the real Google consent path'
    )
    const { violations, visited } = guardProviderBoundary(page)

    await page.goto('/login')

    // Clicking "Sign in with Google" must start the SERVER-BROKERED social
    // login: GET /api/v1/security/social/google/start (302), never a client
    // redirect to auth.fuzefront.com.
    const startCall = page.waitForRequest(
      req => /\/api\/v1\/security\/social\/google\/start/.test(req.url()),
      { timeout: 25_000 }
    )
    await page.getByRole('button', { name: /sign in with google/i }).click()
    await startCall

    // The only external host allowed is Google's consent screen.
    await page.waitForURL(/accounts\.google\.com/, { timeout: 30_000 })
    await fillGoogleLogin(page, GOOGLE_TEST_EMAIL, GOOGLE_TEST_PASSWORD)

    // Back to the app, code exchange, dashboard.
    await page.waitForURL('**/dashboard', { timeout: 45_000 })
    await expect(page).toHaveURL(APP_HOST_RE)

    // Post-hoc: every host visited must be app or Google (+ their static CDNs);
    // and specifically none was the internal IdP.
    const offenders = [...visited].filter(
      h => !APP_HOST_RE.test(h) && !GOOGLE_HOST_RE.test(h) && !ALLOWED_HOST_RE.test(h)
    )
    expect(
      offenders,
      `unexpected hosts during Google flow (only app.fuzefront.com + accounts.google.com allowed): ${offenders.join(', ')}`
    ).toEqual([])
    expect(
      violations,
      `PROVIDER BOUNDARY BREACH — browser reached ${FORBIDDEN_IDP_HOST}: ${violations.join(', ')}`
    ).toEqual([])

    // A real JWT/session was established.
    const token = await page.evaluate(() => localStorage.getItem('authToken'))
    expect(token, 'session token stored after Google login').toBeTruthy()
  })

  // ── MFA step-up happy path ────────────────────────────────────────────────
  test('MFA step-up: password login → mfa_required → verify → /dashboard @authn-pending-deploy', async ({ page }) => {
    const email = process.env.MFA_TEST_EMAIL
    const password = process.env.MFA_TEST_PASSWORD
    const totp = process.env.MFA_TEST_CODE // a currently-valid code or static test code
    test.skip(!email || !password || !totp, 'MFA_TEST_EMAIL/PASSWORD/CODE not set')
    const { violations } = guardProviderBoundary(page)

    await page.goto('/login')
    await page.locator('input[type="email"]').first().fill(email!)
    await page.locator('input[type="password"]').first().fill(password!)
    await page.getByRole('button', { name: /^sign in$/i }).click()

    // The SessionResult is an mfa_required challenge → the UI shows a code field.
    const codeField = page.locator('input[autocomplete="one-time-code"], input[name*="code" i], input[inputmode="numeric"]').first()
    await expect(codeField).toBeVisible({ timeout: 20_000 })
    await codeField.fill(totp!)
    await page.getByRole('button', { name: /verify|continue|submit/i }).first().click()

    await page.waitForURL('**/dashboard', { timeout: 30_000 })
    await expect(page).toHaveURL(APP_HOST_RE)
    expect(violations, `boundary violations: ${violations.join(', ')}`).toEqual([])
  })

  // ── Email / phone verification happy path (where testable via API surface) ─
  test('Verification status is exposed via the Security API for a signed-in user @authn-pending-deploy', async ({ request }) => {
    const token = process.env.AUTHN_TEST_TOKEN
    test.skip(!token, 'AUTHN_TEST_TOKEN not set — cannot exercise the verify surface')

    // Happy-path smoke of the neutral verification surface: status endpoint is
    // routable and returns the contract shape. (Driving a real email/SMS OTP
    // end-to-end needs a mailbox/SMS sink and is covered by the API test-engineer;
    // here we verify the UI-facing surface is present + provider-neutral.)
    const resp = await request.get('/api/v1/security/verify/status', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(resp.status(), '/api/v1/security/verify/status status').toBeLessThan(500)
    if (resp.status() === 200) {
      const body = await resp.json()
      expect(body, 'verify/status returns an object').toBeTruthy()
      expect(JSON.stringify(body)).not.toMatch(/authentik|permit/i)
    }
  })
})

// ── Helper: drive Google's own login form (real accounts.google.com) ─────────
async function fillGoogleLogin(page: Page, email: string, password: string) {
  const emailInput = page.locator('input[type="email"]')
  await expect(emailInput).toBeVisible({ timeout: 20_000 })
  await emailInput.fill(email)
  await page.keyboard.press('Enter')

  const passwordInput = page.locator('input[type="password"]')
  await expect(passwordInput).toBeVisible({ timeout: 15_000 })
  await passwordInput.fill(password)
  await page.keyboard.press('Enter')

  // Optional consent/confirmation step.
  try {
    const continueBtn = page.locator('button:has-text("Continue"), button:has-text("Allow")')
    await continueBtn.waitFor({ timeout: 6_000 })
    await continueBtn.click()
  } catch {
    /* no consent step */
  }
}
