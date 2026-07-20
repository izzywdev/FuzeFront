/**
 * ACCOUNT SECURITY HUB — INDEPENDENT, PRE-PRODUCTION, RED-by-design UI e2e.
 * (frontend-test-engineer — independent verification, NOT the implementer.)
 *
 * ── What this file is ────────────────────────────────────────────────────────
 * These are TDD RED specs for the FIRST approved account-security design
 * (owner approved `account-security / account-security`, issue #313). They are
 * derived STRICTLY from the approved visual contract:
 *
 *   design/frames/account-security/manifest.json  (the build inventory + hooks)
 *   design/frames/account-security/01-hub.html     (a) Security hub
 *   design/frames/account-security/02-states.html  (b) States & fail-closed
 *
 * and from the frozen API contract packages/security/openapi.yaml
 *   GET /v1/security/identity/connections   -> { providers[], hasPassword }
 *   GET /v1/security/methods                 -> AuthMethods
 *   DELETE unlink last method                -> 409 (fail-closed guard)
 *
 * The manifest `build` block names what MUST exist for these to go GREEN:
 *   flow      account-security  (orchestrator AccountSecurityHub)
 *   route     /account/security
 *   package   @fuzefront/account-security-ui
 *   components SecurityHub, SecurityPostureSummary, SecurityCard,
 *             SignInMethodsList, SetPasswordBanner, ConnectedAccountRow,
 *             SecurityCardGridSkeleton, LoadErrorRetry
 *
 * ── Why they are RED right now (READ THIS before "fixing" a failure) ─────────
 * The route /account/security and @fuzefront/account-security-ui are NOT built
 * yet. Every test below is EXPECTED to fail today, and it must fail for the
 * RIGHT reason: the hub panel / cards / guards are ABSENT from the DOM — not a
 * harness/config error. That RED state is the proof this is TDD (specs written
 * against the approved contract BEFORE the implementation), not tests
 * retrofitted to a shipped UI.
 *
 * They are deliberately NOT test.skip / test.fixme — hiding the RED would
 * defeat the entire point. They turn GREEN when frontend-engineer lands
 * @fuzefront/account-security-ui and wires the /account/security route.
 *
 * Selectors are ONLY the data-* hooks the frames declare (manifest.testHooks).
 * No invented selectors. Where a frame is ambiguous the assertion follows what
 * the frame SHOWS and the ambiguity is noted, never softened.
 *
 * Run (pre-prod, against a built UI on the ephemeral stack / dev host):
 *   BASE_URL=http://fuzefront.dev.local npx playwright test account-security-hub.red
 * Config: frontend/playwright.config.ts (chromium + mobile projects).
 */
import { test, expect, type Page, type ConsoleMessage, type Request } from '@playwright/test'

const HUB_ROUTE = '/account/security'

/** Vendor names that must NEVER reach the DOM — a real product boundary. */
const FORBIDDEN_VENDORS = ['Authentik', 'authentik', 'Permit', 'permit.io']

/**
 * Navigate to the hub. Kept as a helper so the RED failure surfaces at the
 * assertion (element absent) rather than here.
 */
async function gotoHub(page: Page) {
  await page.goto(HUB_ROUTE, { waitUntil: 'domcontentloaded' })
}

test.describe('Account Security hub — hub render (frame 01-hub)', () => {
  test('renders the security-hub panel at /account/security', async ({ page }) => {
    await gotoHub(page)
    // manifest hook: [data-panel='security-hub'] on the AccountSecurityHub orchestrator.
    await expect(
      page.locator("[data-panel='security-hub']"),
      'AccountSecurityHub must mount a [data-panel="security-hub"] container at /account/security',
    ).toBeVisible()
  })

  test('renders the security posture summary', async ({ page }) => {
    await gotoHub(page)
    // Frame shows <section data-posture="..."> derived from /identity/connections + /methods.
    // The frame's happy path is data-posture="good"; assert the posture element exists
    // (value may vary with real account state — the ELEMENT is the contract).
    await expect(
      page.locator('[data-posture]'),
      'SecurityPostureSummary must expose a [data-posture] element',
    ).toBeVisible()
  })

  test('renders all five security cards linking to their sibling surfaces', async ({ page }) => {
    await gotoHub(page)
    const cards: Array<{ card: string; route: string }> = [
      { card: 'password', route: '/account/security/password' },
      { card: 'two-factor', route: '/account/security/two-factor' },
      { card: 'sessions', route: '/account/security/devices' },
      { card: 'tokens', route: '/account/security/tokens' },
      { card: 'connected', route: '/account/security/connections' },
    ]
    for (const { card, route } of cards) {
      const el = page.locator(`[data-card='${card}']`)
      await expect(el, `card [data-card="${card}"] must render`).toBeVisible()
      // Frame declares data-route on every card — the navigational spine.
      await expect(
        el,
        `card [data-card="${card}"] must declare data-route="${route}" (frame 01-hub)`,
      ).toHaveAttribute('data-route', route)
    }
  })

  test('connected-accounts card shows a linked provider and password-enabled state', async ({ page }) => {
    await gotoHub(page)
    const connected = page.locator("[data-card='connected']")
    await expect(connected).toBeVisible()
    // Frame acceptanceNotes: linked provider (Google) + password enabled badge.
    await expect(connected).toContainText(/Google/i)
    await expect(connected).toContainText(/Password/i)
  })

  test('NO identity-vendor name appears anywhere on the hub (product boundary)', async ({ page }) => {
    await gotoHub(page)
    await expect(page.locator("[data-panel='security-hub']")).toBeVisible()
    const bodyText = await page.locator('body').innerText()
    for (const vendor of FORBIDDEN_VENDORS) {
      expect(
        bodyText,
        `vendor name "${vendor}" must never surface in the DOM — the hub speaks the FuzeFront boundary, not the provider`,
      ).not.toContain(vendor)
    }
  })
})

test.describe('Account Security hub — states & fail-closed (frame 02-states)', () => {
  test('shows the loading skeleton, then resolves it', async ({ page }) => {
    await gotoHub(page)
    // SecurityCardGridSkeleton — [data-state='loading'] while GET /connections + /methods in flight.
    const skeleton = page.locator("[data-state='loading']")
    await expect(
      skeleton,
      'a loading skeleton [data-state="loading"] must appear while the security data loads',
    ).toBeVisible()
    // ...and then resolve to the real hub once data arrives.
    await expect(page.locator("[data-panel='security-hub']")).toBeVisible()
    await expect(skeleton).toBeHidden()
  })

  test('load-error path shows the StatusCallout with a retry affordance', async ({ page }) => {
    // Force the security reads to fail so the error state renders.
    await page.route('**/v1/security/**', route =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }),
    )
    await gotoHub(page)
    await expect(
      page.locator("[data-state='error']"),
      'LoadErrorRetry must render [data-state="error"] when the security reads fail',
    ).toBeVisible()
    await expect(
      page.locator("[data-action='retry']"),
      'the error state must offer a [data-action="retry"] control (frame 02-states)',
    ).toBeVisible()
  })

  test('social-only account (hasPassword:false) shows the "set a password first" guard', async ({ page }) => {
    // Contract: GET /identity/connections -> { providers:[google], hasPassword:false }.
    await page.route('**/v1/security/identity/connections', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ providers: [{ provider: 'google', linked: true }], hasPassword: false }),
      }),
    )
    await gotoHub(page)
    // SetPasswordBanner — data-guard='set-password-first' + data-action='set-password'.
    await expect(
      page.locator("[data-guard='set-password-first']"),
      'a social-only account must fail-closed with the set-password-first guard',
    ).toBeVisible()
    await expect(page.locator("[data-action='set-password']").first()).toBeVisible()
  })

  test('unlinking the last sign-in method is blocked (409 surfaced as a guard, not a crash)', async ({ page }) => {
    // Contract: unlink of the only remaining method -> 409. UI must surface the
    // last-sign-in-method guard — NOT crash and NOT silently succeed.
    await page.route('**/v1/security/identity/connections', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ providers: [{ provider: 'google', linked: true }], hasPassword: false }),
      }),
    )
    await page.route(/\/v1\/security\/identity\/connections\/.+/, route => {
      if (route.request().method() === 'DELETE') {
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'last_sign_in_method', message: 'Keep at least one way to sign in' }),
        })
      }
      return route.continue()
    })

    // Track uncaught page errors — a 409 must be HANDLED, never crash the hub.
    const pageErrors: string[] = []
    page.on('pageerror', err => pageErrors.push(String(err)))

    await gotoHub(page)

    // Attempt to unlink the last provider from the connected-accounts surface.
    const unlink = page.locator("[data-action='unlink'], [data-action='unlink-provider']").first()
    await unlink.click()

    // The guard must be surfaced (NOT a crash, NOT a silent success).
    await expect(
      page.locator("[data-guard='last-sign-in-method']"),
      '409 on last-method unlink must surface the last-sign-in-method guard',
    ).toBeVisible()
    expect(pageErrors, 'a 409 guard must be handled — the hub must not throw an uncaught error').toEqual([])
  })

  test('NO identity-vendor name appears in any fail-closed state', async ({ page }) => {
    await page.route('**/v1/security/identity/connections', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ providers: [{ provider: 'google', linked: true }], hasPassword: false }),
      }),
    )
    await gotoHub(page)
    await expect(page.locator("[data-guard='set-password-first']")).toBeVisible()
    const bodyText = await page.locator('body').innerText()
    for (const vendor of FORBIDDEN_VENDORS) {
      expect(bodyText, `vendor "${vendor}" must not appear in fail-closed copy`).not.toContain(vendor)
    }
  })
})

test.describe('Account Security hub — runtime console-clean gate (ui-runtime-validation)', () => {
  test('the rendered hub has a clean console (0 errors, 0 CSP/mixed-content, 0 failed app requests)', async ({ page }) => {
    const consoleErrors: string[] = []
    const failedRequests: string[] = []

    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', err => consoleErrors.push(`pageerror: ${String(err)}`))
    page.on('requestfailed', (req: Request) => {
      // Same-origin app requests only — the boundary is the app, not third parties.
      const url = req.url()
      if (url.includes('/v1/security') || url.includes('/assets') || url.includes('/account/security')) {
        failedRequests.push(`${req.method()} ${url} :: ${req.failure()?.errorText ?? 'failed'}`)
      }
    })

    await gotoHub(page)
    // The hub must actually be present for this gate to be meaningful — RED until it exists.
    await expect(page.locator("[data-panel='security-hub']")).toBeVisible()

    expect(consoleErrors, `console errors on the hub:\n${consoleErrors.join('\n')}`).toEqual([])
    expect(failedRequests, `failed app requests on the hub:\n${failedRequests.join('\n')}`).toEqual([])
  })
})
