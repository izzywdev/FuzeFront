/**
 * POST-PRODUCTION AuthN boundary smoke — READ-ONLY against the LIVE platform
 * (default https://app.fuzefront.com via playwright.post-prod.config.ts).
 *
 * Verifies the provider-agnostic Security API deploy (contract PR #243) once it
 * lands: the neutral `/api/v1/security/*` surface is served, the login UI is
 * FuzeFront-branded and provider-neutral, and — the headline — that starting
 * Google sign-in does NOT expose the internal IdP host `auth.fuzefront.com` to
 * the browser.
 *
 * ── Pre-deploy behaviour ────────────────────────────────────────────────────
 * The AuthN deploy is NOT live yet. Every test here is tagged
 * `@authn-pending-deploy` and self-skips (or is expected-failure) until the
 * `/api/v1/security/methods` capability endpoint responds 200. This keeps the
 * existing `live-smoke.spec.ts` (old model) as the current green gate while
 * this file becomes the gate the AuthN rollout is verified against. After the
 * deploy, run with `--grep @authn-pending-deploy` to assert it.
 *
 * Safe to run repeatedly: no mutations, no credentials driven through the UI.
 */
import { test, expect, type Page, type Request } from '@playwright/test'

const FORBIDDEN_IDP_HOST = 'auth.fuzefront.com'

/** Is the new Security API surface live on the target? Gates the whole file. */
async function securityApiLive(request: import('@playwright/test').APIRequestContext) {
  try {
    const r = await request.get('/api/v1/security/methods')
    return r.status() === 200
  } catch {
    return false
  }
}

function guardBoundary(page: Page): string[] {
  const violations: string[] = []
  const check = (kind: string, url: string) => {
    if (url.toLowerCase().includes(FORBIDDEN_IDP_HOST)) violations.push(`${kind} -> ${url}`)
  }
  page.on('request', (req: Request) => check(`request(${req.resourceType()})`, req.url()))
  page.on('framenavigated', f => {
    if (f === page.mainFrame()) check('navigation', f.url())
  })
  page.on('popup', p => check('popup', p.url()))
  return violations
}

test.describe('AuthN post-prod boundary smoke @authn-pending-deploy', () => {
  test('S1 neutral capability descriptor is served (/api/v1/security/methods)', async ({ request }) => {
    test.skip(!(await securityApiLive(request)), 'AuthN deploy not live yet (/api/v1/security/methods != 200)')
    const resp = await request.get('/api/v1/security/methods')
    expect(resp.status()).toBe(200)
    const body = await resp.json()
    // Provider-neutral: no vendor names leak in the capability descriptor.
    expect(JSON.stringify(body), 'capability descriptor must be provider-neutral').not.toMatch(/authentik|permit/i)
  })

  test('S2 /login shows FuzeFront-branded native form + Google, no Authentik redirect button', async ({ page, request }) => {
    test.skip(!(await securityApiLive(request)), 'AuthN deploy not live yet')
    await page.goto('/login')
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /sign in with google/i })).toBeVisible()
    // The old vendor-named redirect button must be gone.
    await expect(page.getByText(/sign in with authentik/i)).toHaveCount(0)
    await page.screenshot({ path: 'test-results-post-prod/authn-01-login.png', fullPage: true })
  })

  test('S3 starting Google sign-in never exposes auth.fuzefront.com (boundary) @boundary', async ({ page, request }) => {
    test.skip(!(await securityApiLive(request)), 'AuthN deploy not live yet')
    const violations = guardBoundary(page)

    await page.goto('/login')
    const googleBtn = page.getByRole('button', { name: /sign in with google/i })
    await expect(googleBtn).toBeVisible({ timeout: 20_000 })

    // Read-only: assert the click starts the SERVER-BROKERED social flow
    // (GET /api/v1/security/social/google/start) rather than a client redirect
    // to the internal IdP host. We do NOT drive real Google credentials here.
    const startCall = page.waitForRequest(
      req => /\/api\/v1\/security\/social\/google\/start/.test(req.url()),
      { timeout: 20_000 }
    )
    await googleBtn.click()
    await startCall

    // Give any redirect chain a beat to resolve, then assert the boundary held
    // up to the point the browser leaves for Google's own consent host.
    await page.waitForURL(/accounts\.google\.com|\/api\/v1\/security\/social/, { timeout: 20_000 }).catch(() => {})
    expect(
      violations,
      `PROVIDER BOUNDARY BREACH — browser reached ${FORBIDDEN_IDP_HOST}: ${violations.join(', ')}`
    ).toEqual([])
  })

  test('S4 no public auth.fuzefront.com ingress (internal host is not routable)', async ({ request }) => {
    // The new model removes the public auth.fuzefront.com Ingress; the internal
    // IdP host must not resolve as a first-class public host. A connection
    // error or a non-2xx/3xx is the pass; a friendly Authentik login page is a
    // regression (the host is still public).
    test.skip(!(await securityApiLive(request)), 'AuthN deploy not live yet')
    let reachable = false
    try {
      const r = await request.get('https://auth.fuzefront.com/', { maxRedirects: 0, timeout: 10_000 })
      reachable = r.status() < 400
    } catch {
      reachable = false // DNS/connection failure = internal host not public = pass
    }
    expect(reachable, 'auth.fuzefront.com must NOT be a public, browser-reachable host').toBe(false)
  })
})
