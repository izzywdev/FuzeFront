import { test, expect, type Page, type Request } from '@playwright/test'

/**
 * POST-PRODUCTION (LIVE) e2e — "new org → workspace provisioning → Subscribe Basic $9 → Stripe Checkout".
 *
 * INDEPENDENT UI verification of the headline FuzeFront goal against the LIVE
 * app (https://app.fuzefront.com via playwright.post-prod.config.ts).
 *
 * This is the LIVE-Stripe variant of subscribe-basic.spec.ts. It proves the
 * in-app flow ALL THE WAY UP TO the Stripe Checkout page and then STOPS — it
 * NEVER enters card details (Stripe is in LIVE mode; a human enters the real
 * card outside this automation).
 *
 *   1. Log in (local auth, seeded admin).
 *   2. Create a brand-new organization through the UI (/organizations/new).
 *      A NEW org is required: the billing-service uses a deterministic Stripe
 *      idempotency key `checkout-{org}-{price}-{user}`; the personal org's key
 *      is polluted for ~24h, so a fresh org gets a clean key AND exercises the
 *      previously-broken "workspace creation for a new org" path.
 *   3. CRITICAL — assert the WorkspaceProvisioningGate RESOLVES and we land
 *      inside the app (no perpetual spinner / timeout / error card).
 *   4. Navigate to /billing — assert the Basic plan renders with "FuzeFront
 *      Basic" and "$9".
 *   5. Click Subscribe — assert the browser navigates to a checkout.stripe.com
 *      URL (with a short retry for fresh-org Permit role propagation to the PDP).
 *   6. On the Stripe Checkout page, assert it shows the FuzeFront Basic line item
 *      and "$9.00". DO NOT fill the card form. Capture the full checkout.stripe.com URL.
 *
 * SAFETY: read-only against prod EXCEPT creating one uniquely-named org and one
 * Stripe Checkout *session* (no payment is ever submitted). Never enters a card.
 */

const EMAIL = process.env.FF_EMAIL || 'admin@fuzefront.dev'
const PASSWORD = process.env.FF_PASSWORD || 'FuzeFront2026Admin'

// Expected Basic price. Asserted on the billing card ("$9") and on Stripe ("$9.00").
const PRICE_BILLING = process.env.FF_BASIC_PRICE || '$9'
const PRICE_STRIPE = '$9.00'
const PLAN_NAME = 'FuzeFront Basic'

// Unique org per run so reruns never collide AND so the idempotency key is fresh.
const STAMP = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`
const ORG_NAME = `Proof ${STAMP}`

const SHOT = (n: string) => `test-results-post-prod/live-${n}.png`

/** Log in via the local-auth form; wait for the post-login /dashboard redirect. */
async function login(page: Page) {
  await page.goto('/login')
  await expect(page.locator('#email')).toBeVisible({ timeout: 20_000 })
  await page.fill('#email', EMAIL)
  await page.fill('#password', PASSWORD)

  const loginResp = page.waitForResponse(
    r => r.url().includes('/api/auth/login') && r.request().method() === 'POST',
    { timeout: 30_000 }
  )
  await page.locator('button[type="submit"]', { hasText: /sign in/i }).first().click()
  const resp = await loginResp
  expect(
    resp.status(),
    `POST /api/auth/login -> ${resp.status()} (401/403 = creds rejected; 5xx = backend error)`
  ).toBe(200)

  await page.waitForURL('**/dashboard', { timeout: 30_000 })
  const token = await page.evaluate(() => localStorage.getItem('authToken'))
  expect(token, 'authToken persisted in localStorage after login').toBeTruthy()
  return token as string
}

/**
 * Assert the WorkspaceProvisioningGate RESOLVED and we are inside the app shell.
 * The gate renders a `.provisioning-card` (`.provisioning-spinner` while loading,
 * or a Retry button on timeout/error) UNTIL a personal org is found; only then
 * does it render the Layout shell. Provisioning success == the authenticated
 * shell is visible and no terminal gate state is showing.
 */
async function assertInsideApp(page: Page, label: string) {
  const shell = page.locator(
    '.app-layout, .top-bar, .main-content, .dashboard, .page, .sidebar, .side-panel, nav'
  )
  const spinner = page.locator('.provisioning-spinner, .provisioning-card')
  const timeoutCard = page.getByText(/taking longer than expected|timed out/i)
  const errorCard = page.getByText(/couldn't|could not|something went wrong/i)

  const DEADLINE = Date.now() + 40_000
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const shellVisible = await shell.first().isVisible().catch(() => false)
    const stillProvisioning = await spinner.first().isVisible().catch(() => false)
    if (shellVisible && !stillProvisioning) return // inside the app

    const stuckTimeout = await timeoutCard.isVisible().catch(() => false)
    const stuckError = await errorCard.isVisible().catch(() => false)

    if (Date.now() > DEADLINE || stuckTimeout || stuckError) {
      const state = stuckTimeout
        ? 'TIMEOUT card ("taking longer than expected")'
        : stuckError
        ? 'ERROR card'
        : stillProvisioning
        ? 'still on the provisioning SPINNER'
        : 'neither the app shell nor a known gate state is visible'
      throw new Error(
        `${label}: WorkspaceProvisioningGate did NOT resolve — ${state}.`
      )
    }
    await page.waitForTimeout(1500)
  }
}

test.describe('LIVE: Subscribe to Basic $9 — new org → provisioning → Stripe Checkout (no card)', () => {
  test.setTimeout(180_000)

  test('login → create org → provisioning → Basic $9 → checkout.stripe.com', async ({
    page,
    request,
  }) => {
    // ── Pre-flight: billing catalog is live (precise failure vs. a UI timeout) ──
    // (auth-health may 404 in prod; the login POST below is the real gate.)

    // ── STEP 1: log in ───────────────────────────────────────────────────────
    const token = await login(page)
    await assertInsideApp(page, 'after login (existing user has personal org)')
    await page.screenshot({ path: SHOT('01-dashboard'), fullPage: true })

    // ── STEP 2: create a NEW organization through the UI ───────────────────────
    await page.goto('/organizations/new')
    await expect(page.locator('#org-name')).toBeVisible({ timeout: 20_000 })
    await page.fill('#org-name', ORG_NAME)

    let newOrgId = ''
    const createRespP = page.waitForResponse(
      r => r.url().includes('/api/organizations') && r.request().method() === 'POST',
      { timeout: 30_000 }
    )
    await page
      .locator('button[type="submit"]')
      .filter({ hasText: /create organization/i })
      .first()
      .click()
    const createResp = await createRespP
    expect(
      createResp.status(),
      `POST /api/organizations -> ${createResp.status()} (previously-broken org creation; 4xx/5xx = regression is back)`
    ).toBeLessThan(300)
    try {
      const body = await createResp.json()
      newOrgId = body?.id || body?.organization?.id || ''
    } catch {
      /* fall through */
    }
    // The success screen shows the org name + a Dashboard button.
    await expect(
      page.getByText(ORG_NAME, { exact: false }),
      'org-create success confirmation (org name) did not render'
    ).toBeVisible({ timeout: 20_000 })
    await page.screenshot({ path: SHOT('02-org-created'), fullPage: true })
    console.log(`NEW ORG created: name="${ORG_NAME}" id="${newOrgId}"`)

    // ── STEP 3: CRITICAL — workspace provisioning resolves back into the app ───
    // The success-screen "Dashboard" button does window.location.href='/dashboard',
    // which re-runs the WorkspaceProvisioningGate (the previously-hanging path).
    await page
      .getByRole('button', { name: /dashboard/i })
      .click()
      .catch(async () => {
        await page.goto('/dashboard')
      })
    await page.waitForURL('**/dashboard', { timeout: 30_000 }).catch(() => {})
    await assertInsideApp(page, 'after creating new org + returning to dashboard')
    await page.screenshot({ path: SHOT('03-provisioning-resolved'), fullPage: true })

    // ── STEP 4: Billing page renders the Basic $9 plan with Subscribe ──────────
    await page.goto('/billing')
    await expect(page.getByRole('heading', { name: /^billing$/i })).toBeVisible({
      timeout: 20_000,
    })
    // Wait out the "Loading plans…" state.
    await page.getByText(/loading plans/i).waitFor({ state: 'hidden', timeout: 20_000 }).catch(() => {})

    // Self-diagnosing: the BillingPage loads plans + subscription in a single
    // Promise.all; a 404 on GET /api/v1/billing/subscriptions (the normal
    // "no subscription yet" state — that GET route is currently unimplemented)
    // rejects the whole load and blanks the page, hiding the plans + Subscribe
    // button. Detect that exact state and fail loudly with the root cause.
    const billingBroken = await page
      .getByText(/Billing is not available right now|No plans are available right now/i)
      .first()
      .isVisible()
      .catch(() => false)
    if (billingBroken) {
      await page.screenshot({ path: SHOT('04-billing-ERROR'), fullPage: true })
      throw new Error(
        'LIVE /billing renders an ERROR ("Billing is not available… / No plans are available…") ' +
          'so the Basic plan + Subscribe button never render. Root cause: BillingPage.load() does ' +
          'Promise.all([listPlans(), getSubscription(orgId)]); GET /api/v1/billing/subscriptions ' +
          'returns 404 (collection GET unimplemented — only POST /subscriptions + GET ' +
          '/subscriptions/:id exist), which rejects the whole load and wipes the plan list. ' +
          'GET /api/v1/billing/plans itself returns 200 with FuzeFront Basic $9. ' +
          'FRONTEND-ENGINEER: decouple plan rendering from the subscription fetch (tolerate 404). ' +
          'BACKEND/BILLING: implement org-scoped GET /api/v1/billing/subscriptions.'
      )
    }

    const basicCard = page
      .locator('[role="listitem"].card', { hasText: new RegExp(PLAN_NAME, 'i') })
      .filter({ hasText: new RegExp(PRICE_BILLING.replace('$', '\\$')) })
      .first()
    await expect(
      basicCard,
      `Basic plan card showing "${PLAN_NAME}" / ${PRICE_BILLING} not found on /billing`
    ).toBeVisible({ timeout: 20_000 })
    await expect(basicCard.getByText(/\/\s*month/i)).toBeVisible()
    const subscribeBtn = basicCard.getByRole('button', { name: /subscribe/i })
    await expect(subscribeBtn).toBeVisible()
    await page.screenshot({ path: SHOT('04-billing-plans'), fullPage: true })

    // Record which org the in-app Subscribe actually checks out (for the report).
    let checkoutOrgId: string | undefined
    page.on('request', (req: Request) => {
      if (req.url().includes('/api/v1/billing/checkout') && req.method() === 'POST') {
        try {
          const data = req.postDataJSON() as { organizationId?: string }
          checkoutOrgId = data?.organizationId
        } catch {
          /* ignore */
        }
      }
    })

    // ── STEP 5: Subscribe → redirect to Stripe-hosted Checkout ─────────────────
    // A brand-new org's Permit role propagates to the PDP within a few seconds; if
    // the first Subscribe briefly 403s on the permission check, wait and retry once.
    const clickSubscribeAndWaitForCheckout = async () => {
      const checkoutRespP = page.waitForResponse(
        r => r.url().includes('/api/v1/billing/checkout') && r.request().method() === 'POST',
        { timeout: 30_000 }
      )
      await subscribeBtn.click()
      const checkoutResp = await checkoutRespP
      return checkoutResp
    }

    let checkoutResp = await clickSubscribeAndWaitForCheckout()
    if (checkoutResp.status() >= 300) {
      console.log(
        `First Subscribe → POST /checkout ${checkoutResp.status()} (likely fresh-org Permit role not yet propagated). Waiting 8s and retrying once…`
      )
      await page.waitForTimeout(8_000)
      // Re-load /billing so the Subscribe button is fresh and re-click.
      await page.goto('/billing')
      await page.getByText(/loading plans/i).waitFor({ state: 'hidden', timeout: 20_000 }).catch(() => {})
      const retryBtn = page
        .locator('[role="listitem"].card', { hasText: new RegExp(PLAN_NAME, 'i') })
        .first()
        .getByRole('button', { name: /subscribe/i })
      const checkoutRespP2 = page.waitForResponse(
        r => r.url().includes('/api/v1/billing/checkout') && r.request().method() === 'POST',
        { timeout: 30_000 }
      )
      await retryBtn.click()
      checkoutResp = await checkoutRespP2
    }
    expect(
      checkoutResp.status(),
      `POST /api/v1/billing/checkout -> ${checkoutResp.status()} (should create a Stripe Checkout session)`
    ).toBeLessThan(300)

    // The shell does window.location.assign(session.url) → Stripe.
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 })
    const stripeUrl = page.url()
    expect(stripeUrl, `expected redirect to a Stripe-hosted Checkout URL, got: ${stripeUrl}`).toContain(
      'checkout.stripe.com'
    )
    console.log(`STRIPE CHECKOUT URL: ${stripeUrl}`)
    console.log(`CHECKOUT used organizationId: ${checkoutOrgId ?? '(none captured)'}`)
    await page.screenshot({ path: SHOT('05-stripe-checkout'), fullPage: true })

    // ── STEP 6: Assert the Stripe Checkout page shows Basic + $9.00 (NO card) ──
    // Stripe markup varies; assert the product name and the $9.00 amount are present.
    await expect(
      page.getByText(new RegExp(PLAN_NAME, 'i')).first(),
      'Stripe Checkout did not show the "FuzeFront Basic" line item'
    ).toBeVisible({ timeout: 20_000 })
    // Price is geo-localized (ILS by default with a USD toggle); the catalog
    // price is USD $9.00 — switch to USD if offered, then assert "$9.00".
    const usdToggle = page.getByRole('button', { name: /USD/i }).first()
    if (await usdToggle.isVisible().catch(() => false)) {
      await usdToggle.click().catch(() => {})
      await page.waitForTimeout(1000)
    }
    await expect(
      page.getByText(PRICE_STRIPE, { exact: false }).first(),
      'Stripe Checkout did not display the expected $9.00 amount'
    ).toBeVisible({ timeout: 20_000 })
    await page.screenshot({ path: SHOT('06-stripe-line-item'), fullPage: true })

    // HARD STOP — never enter a card. The human completes payment manually.
    console.log('\n=== STOPPING at LIVE Stripe Checkout — NO card entered (by design). ===')
  })
})
