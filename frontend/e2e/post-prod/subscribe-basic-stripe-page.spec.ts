import { test, expect, request as pwRequest } from '@playwright/test'

/**
 * POST-PRODUCTION (LIVE) — Stripe Checkout PAGE proof for the Basic $9 plan.
 *
 * This complements subscribe-basic-live.spec.ts. The in-app Subscribe button is
 * currently unreachable because /billing errors out (GET /billing/subscriptions
 * 404 rejects the page load — see the live spec). This spec proves the OTHER end
 * of the contract that the in-app flow would reach: it drives the SAME real,
 * authenticated calls the UI makes (login → create a fresh org → POST
 * /api/v1/billing/checkout for the Basic price), then opens the returned LIVE
 * checkout.stripe.com URL in a real browser and asserts the Stripe Checkout page
 * shows the "FuzeFront Basic" line item at "$9.00" / month.
 *
 * It NEVER enters a card. Live Stripe ⇒ a human completes payment manually.
 *
 * A FRESH org is created so the deterministic Stripe idempotency key
 * `checkout-{org}-{price}-{user}` is clean (the personal org's key is polluted
 * for ~24h), and so this also exercises the new-org provisioning path.
 */

const EMAIL = process.env.FF_EMAIL || 'admin@fuzefront.dev'
const PASSWORD = process.env.FF_PASSWORD || 'FuzeFront2026Admin'
const PLAN_NAME = 'FuzeFront Basic'
const PRICE_STRIPE = '$9.00'

const SHOT = (n: string) => `test-results-post-prod/live-${n}.png`

test.describe('LIVE: Stripe Checkout page shows FuzeFront Basic $9.00 (no card)', () => {
  test.setTimeout(180_000)

  test('fresh org → POST /checkout → checkout.stripe.com shows Basic $9.00', async ({
    page,
    baseURL,
  }) => {
    const api = await pwRequest.newContext({ baseURL: baseURL || 'https://app.fuzefront.com' })

    // 1. Log in (same local-auth call the UI makes).
    const loginRes = await api.post('/api/auth/login', {
      data: { email: EMAIL, password: PASSWORD },
    })
    expect(loginRes.status(), 'POST /api/auth/login').toBe(200)
    const token = (await loginRes.json()).token as string
    expect(token).toBeTruthy()
    const auth = { Authorization: `Bearer ${token}` }

    // 2. The Basic plan exists in the live catalog at $9 (unitAmount 900).
    const plansRes = await api.get('/api/v1/billing/plans', { headers: auth })
    expect(plansRes.status(), 'GET /api/v1/billing/plans').toBe(200)
    const plans = (await plansRes.json()).plans as Array<Record<string, unknown>>
    const basic = plans.find(p => String(p.displayName || p.tierName).match(/basic/i))
    expect(basic, 'FuzeFront Basic plan present in /plans').toBeTruthy()
    expect(basic!.unitAmount, 'Basic unitAmount is 900 cents ($9)').toBe(900)
    expect(String(basic!.currency).toLowerCase(), 'currency usd').toBe('usd')
    expect(String(basic!.billingInterval), 'monthly').toBe('month')
    const priceId = basic!.stripePriceId as string

    // 3. Create a FRESH org (clean idempotency key + new-org path).
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`
    const orgRes = await api.post('/api/organizations', {
      headers: auth,
      data: { name: `Proof Stripe ${stamp}`, slug: `proof-stripe-${stamp}`, type: 'organization' },
    })
    expect(orgRes.status(), 'POST /api/organizations (new org)').toBeLessThan(300)
    const org = await orgRes.json()
    const orgId = org.id as string
    console.log(`NEW ORG: name="${org.name}" id="${orgId}"`)

    // New-org Permit role needs a few seconds to propagate to the PDP.
    await page.waitForTimeout(7_000)

    // 4. POST /checkout (the exact call the Subscribe button makes) → Stripe URL.
    const doCheckout = async () =>
      api.post('/api/v1/billing/checkout', {
        headers: auth,
        data: {
          planId: priceId,
          organizationId: orgId,
          successUrl: 'https://app.fuzefront.com/billing?checkout=success',
          cancelUrl: 'https://app.fuzefront.com/billing?checkout=cancel',
        },
      })
    let coRes = await doCheckout()
    if (coRes.status() >= 300) {
      console.log(`First /checkout ${coRes.status()} (PDP role propagation); retrying in 8s…`)
      await page.waitForTimeout(8_000)
      coRes = await doCheckout()
    }
    expect(coRes.status(), `POST /api/v1/billing/checkout -> ${coRes.status()}`).toBeLessThan(300)
    const session = await coRes.json()
    const stripeUrl = session.url as string
    expect(stripeUrl, 'checkout session url').toContain('checkout.stripe.com')
    console.log(`STRIPE CHECKOUT URL: ${stripeUrl}`)

    // 5. Open the LIVE Stripe Checkout page in the browser — assert Basic + $9.00.
    await page.goto(stripeUrl, { waitUntil: 'domcontentloaded' })
    await expect(
      page.getByText(new RegExp(PLAN_NAME, 'i')).first(),
      'Stripe Checkout shows the "FuzeFront Basic" line item'
    ).toBeVisible({ timeout: 30_000 })
    await expect(
      page.getByText(PRICE_STRIPE, { exact: false }).first(),
      'Stripe Checkout displays "$9.00"'
    ).toBeVisible({ timeout: 30_000 })
    await page.screenshot({ path: SHOT('stripe-page-basic-9'), fullPage: true })

    // HARD STOP — never enter a card. A human completes payment manually.
    console.log('=== Verified Stripe Checkout page; NO card entered (by design). ===')
    await api.dispose()
  })
})
