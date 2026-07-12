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
      `POST /api/auth/oidc/password -> ${resp.status()} (401 = Authentik rejected creds; 503 = flow-executor/authorize plumbing broken)`
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
    expect(resp.status()).toBe(401)
  })

  // ── 3. Full OIDC sign-in flow ───────────────────────────────────────────
  test('full OIDC sign-in flow with local user lands on dashboard with a real JWT', async ({
    page,
  }) => {
    // The provider uses implicit-consent (first-party app — no manual consent step).
    // Flow: identification → password → Authentik redirects to backend callback →
    // backend validates PKCE + exchanges token → redirects frontend with exchange code
    // → frontend POSTs /api/auth/token-exchange → JWT in localStorage → /dashboard.
    // Timeout covers: pwField gate (60s) + redirect chain + dashboard nav (30s) = 90s.
    test.setTimeout(240_000)

    // Step 1: Open FuzeFront
    await page.goto(FRONTEND_URL)
    await expect(page).toHaveTitle(/FuzeFront|Sign in/i, { timeout: 15_000 })

    // Step 2: the redirect entry point is now the Google button (the dedicated
    // "Sign in with Authentik" button was replaced by the native credentials
    // form). This e2e Authentik has no Google source, so the button lands on
    // Authentik's own identification flow — exactly what we want to drive.
    const oidcButton = page.getByRole('button', { name: /sign in with google/i })
    await expect(oidcButton).toBeVisible({ timeout: 15_000 })
    await oidcButton.click()

    // Step 3: Browser redirects to Authentik authorization endpoint
    await page.waitForURL(`${AUTHENTIK_URL}/**`, { timeout: 25_000 })

    // Step 4: Fill in local Authentik credentials (no Google, no bot detection)
    await fillAuthentikLogin(page, E2E_USER_EMAIL, E2E_USER_PASSWORD)

    // Step 5: Wait for the complete OIDC redirect chain to land on the dashboard.
    // With implicit-consent the backend callback + frontend exchange happen fast;
    // waiting for intermediate URLs risks a race if the chain completes before
    // waitForURL is called. Waiting directly for /dashboard is reliable — the
    // frontend navigates there only after localStorage.setItem('authToken', ...).
    await page.waitForURL(`${FRONTEND_URL}/dashboard`, { timeout: 90_000 })

    // Assert a real, well-formed JWT was stored (three base64url parts)
    const authToken = await page.evaluate(() => localStorage.getItem('authToken'))
    expect(authToken).toBeTruthy()
    expect(authToken!.split('.').length).toBe(3)

    // Decode payload (no signature verification needed — we just check the claims exist)
    const payload = JSON.parse(Buffer.from(authToken!.split('.')[1], 'base64url').toString())
    expect(payload.sub).toBeTruthy()
    expect(payload.email).toBeTruthy()
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

    const loginResp = page.waitForResponse(
      r => r.url().includes('/api/auth/oidc/password'),
      { timeout: 30_000 }
    )
    await page.getByRole('button', { name: /^sign in$/i }).click()
    const resp = await loginResp
    expect(
      resp.status(),
      `POST /api/auth/oidc/password -> ${resp.status()}`
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
    // The frontend must show some error indication
    await expect(
      page.locator('text=/authentication error|access.denied|sign in failed/i')
    ).toBeVisible({ timeout: 10_000 })
  })
})

// ── Helper: drive through Authentik's multi-stage login UI ────────────────────
// Authentik renders stages as custom elements (Lit) with shadow DOM.
// Playwright automatically pierces open shadow roots for attribute selectors.
// The provider uses implicit-consent so only identification + password are needed.

async function fillAuthentikLogin(page: Page, email: string, password: string): Promise<void> {
  // ── Stage 1: Identification (username / email) ─────────────────────────
  // 'input[name="uidField"]' pierces shadow DOM to the actual <input> (not the
  // outer <ak-form-element-horizontal name="uidField"> host, which also carries
  // the attribute). press('Enter') on the actual <input> fires the shadow-DOM
  // form's @submit, which Authentik's Lit handler intercepts for a fetch POST.
  // Using 'button[type="submit"]' is unreliable at the password stage because
  // Lit may leave the identification stage's button in the shadow tree; .first()
  // then clicks the stale/wrong button and no POST is sent to the executor.
  const uidField = page.locator('input[name="uidField"]')
  await expect(uidField).toBeVisible({ timeout: 15_000 })
  await uidField.fill(email)
  await uidField.press('Enter')

  // ── Stage 2: Password ──────────────────────────────────────────────────
  // Authentik's password stage is a Lit custom element (<ak-stage-password>) rendered
  // inside <ak-flow-executor>'s shadow root.  Several approaches all fail:
  //   • pwField.press('Enter'): the <input> is in a different shadow tree from the
  //     <form>, so native form-submission across shadow boundaries never fires.
  //   • ak-stage-password button[type="submit"] .click(): Playwright's synthetic CDP
  //     click doesn't reliably reach Lit's @click handler through 3 shadow layers.
  //   • form.requestSubmit(): may silently skip submission if HTML5 constraint
  //     validation doesn't see the cross-shadow-root input as form-associated.
  // Most reliable: call submitForm() directly on the ak-stage-password element.
  // It is a Lit custom element so its class methods are live on the DOM node.
  // submitForm() calls this.host.submit(data) which POSTs to the flow executor.
  //
  // Critical: submitForm() reads this.passwordInput which uses @query() —
  // that calls this.shadowRoot.querySelector('input[type="password"]').
  // If the <input> lives inside ak-form-element-horizontal's OWN shadow root
  // (not as a slotted child), this.passwordInput is null → empty password sent
  // → Authentik returns 200 with the password stage again (auth rejected).
  // Fix: deep-search all nested shadow roots to find the input, then force-set
  // its value via the native HTMLInputElement setter before calling submitForm().
  const pwField = page.locator('input[type="password"]')
  await expect(pwField).toBeVisible({ timeout: 60_000 })
  await pwField.fill(password)

  // page.locator() pierces shadow roots (Playwright's selector engine).
  // Native DOM APIs inside evaluate() do NOT pierce shadow roots, so we pass
  // the password as a parameter and do a recursive shadow-root search to find
  // and force-set the input before submitting.
  const stageResult = await page.locator('ak-stage-password').evaluate((el: any, pw: string) => {
    // Recursively search all shadow roots for a matching element.
    function deepQuery(root: any, sel: string): Element | null {
      const direct = root.querySelector?.(sel) as Element | null
      if (direct) return direct
      for (const child of Array.from<Element>(root.querySelectorAll?.('*') ?? [])) {
        const sr = (child as any).shadowRoot
        if (sr) {
          const found = deepQuery(sr, sel)
          if (found) return found
        }
      }
      return null
    }

    const pwInput = deepQuery(el.shadowRoot ?? el, 'input[type="password"]') as HTMLInputElement | null

    const info = {
      hasSubmitForm: typeof el.submitForm === 'function',
      hostTag: el.host?.tagName ?? 'null',
      hostHasSubmit: typeof el.host?.submit === 'function',
      hasShadowRoot: !!el.shadowRoot,
      hasForm: !!(el.shadowRoot?.querySelector('form')),
      pwInputFound: !!pwInput,
      pwValueBefore: pwInput?.value?.length ?? -1,
      pwValueAfter: -1,
      method: 'none' as string,
    }

    // Force-set the password via the native setter so no Lit/custom-element
    // override can intercept it, then fire input+change for reactive updates.
    if (pwInput) {
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      nativeSetter?.call(pwInput, pw)
      pwInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
      pwInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
      info.pwValueAfter = pwInput.value.length
    }

    if (typeof el.submitForm === 'function') {
      el.submitForm(new Event('submit', { cancelable: true }))
      info.method = 'submitForm'
    } else {
      // Fallback: call callAction on the spinner button (found via deep search)
      const spinnerBtn = deepQuery(el.shadowRoot ?? el, 'ak-spinner-button') as any
      if (typeof spinnerBtn?.callAction === 'function') {
        spinnerBtn.callAction()
        info.method = 'callAction'
      } else {
        const btn = deepQuery(el.shadowRoot ?? el, 'button[type="submit"]') as HTMLButtonElement | null
        if (btn) {
          btn.click()
          info.method = 'button-click'
        }
      }
    }
    return info
  }, password)
  // Logged here so CI output shows pwValueBefore/After and method used
  console.log('[fillAuthentikLogin] password stage submit:', JSON.stringify(stageResult))

  // Wait for the password form to disappear (Authentik navigates away after auth).
  // Authentik can take up to 60 s under CI resource pressure.
  await pwField.waitFor({ state: 'hidden', timeout: 90_000 }).catch(() => {
    // Field still visible (timeout) or already detached (navigated) — proceed.
  })
}
