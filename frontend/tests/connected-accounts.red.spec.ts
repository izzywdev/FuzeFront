/**
 * CONNECTED ACCOUNTS — INDEPENDENT, PRE-PRODUCTION, RED-by-design UI e2e.
 * (frontend-test-engineer — independent verification, NOT the implementer.)
 *
 * ── What this file is ────────────────────────────────────────────────────────
 * These are TDD RED specs for the approved connected-accounts design (owner
 * approved `connected-accounts / connected-accounts`, FFRNT-296). They are
 * derived STRICTLY from the approved visual contract:
 *
 *   design/frames/connected-accounts/manifest.json  (the build inventory + hooks)
 *   design/frames/connected-accounts/01-connections.html  (a) Connections list
 *   design/frames/connected-accounts/02-connect.html      (b) Connect a provider
 *   design/frames/connected-accounts/03-states.html       (c) States & fail-closed
 *
 * and from the frozen API contract packages/security/openapi.yaml
 *   GET    /v1/security/identity/connections  -> IdentityConnections { providers[], hasPassword }
 *   POST   /v1/security/social/{provider}/link -> SocialLinkStart { redirectUrl }; 409 if already linked
 *   DELETE /v1/security/social/{provider}/link -> IdentityConnections; 409 if it would leave 0 methods
 *   POST   /v1/security/password
 *
 * The manifest `build` block names what MUST exist for these to go GREEN:
 *   flow      connected-accounts  (orchestrator ConnectedAccountsPanel)
 *   route     /account/security/connections
 *   package   @fuzefront/account-security-ui
 *   components ConnectedAccountsPanel, SignInMethodsList, ConnectedAccountRow,
 *             ConnectProviderButton, SetPasswordBanner, StatusCallout, LoadErrorRetry
 *
 * ── Why they are RED right now (READ THIS before "fixing" a failure) ─────────
 * The route /account/security/connections does not render a ConnectedAccountsPanel
 * yet (securityClient has unlinkProvider but not linkProvider — see the
 * manifest's `build.reuses`). Every test below is EXPECTED to fail today, and
 * it must fail for the RIGHT reason: the panel / rows / guards are ABSENT from
 * the DOM — not a harness/config error. That RED state is the proof this is
 * TDD (specs written against the approved contract BEFORE the implementation),
 * not tests retrofitted to a shipped UI.
 *
 * They are deliberately NOT test.skip / test.fixme — hiding the RED would
 * defeat the entire point. They turn GREEN when frontend-engineer adds
 * linkProvider to @fuzefront/security-client and lands ConnectedAccountsPanel
 * in @fuzefront/account-security-ui, wired to the /account/security/connections
 * route.
 *
 * Selectors are ONLY the data-* hooks the frames declare (manifest.testHooks).
 * No invented selectors. Where a frame is ambiguous the assertion follows what
 * the frame SHOWS and the ambiguity is noted, never softened.
 *
 * Run (pre-prod, against a built UI on the ephemeral stack / dev host):
 *   BASE_URL=http://fuzefront.dev.local npx playwright test connected-accounts.red
 * Config: frontend/playwright.config.ts (chromium + mobile projects).
 */
import { test, expect, type Page, type ConsoleMessage, type Request } from '@playwright/test'

const CONNECTIONS_ROUTE = '/account/security/connections'

/** Vendor names that must NEVER reach the DOM — a real product boundary. */
const FORBIDDEN_VENDORS = ['Authentik', 'authentik', 'Permit', 'permit.io']

/** The one social provider the frozen contract supports today (SocialProvider enum: [google]). */
const PROVIDER = 'google'

/** A same-origin-safe stand-in for the real accounts.google.com hop — mocked so the
 *  spec never makes a real network call, while still proving the SPA follows
 *  whatever redirectUrl the contract returns. */
const REDIRECT_URL = 'https://accounts.google.com/o/oauth2/v2/auth?mock-link=google'

/**
 * Navigate to the connected-accounts surface. Kept as a helper so the RED
 * failure surfaces at the assertion (element absent) rather than here.
 */
async function gotoConnections(page: Page) {
  await page.goto(CONNECTIONS_ROUTE, { waitUntil: 'domcontentloaded' })
}

function connectionsBody(providers: Array<{ provider: string; linkedAt?: number }>, hasPassword: boolean) {
  return JSON.stringify({ providers, hasPassword })
}

test.describe('Connected accounts — connections list (frame 01-connections)', () => {
  test('renders the connected-accounts panel at /account/security/connections', async ({ page }) => {
    await page.route('**/v1/security/identity/connections', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: connectionsBody([{ provider: PROVIDER, linkedAt: Date.now() }], true),
      }),
    )
    await gotoConnections(page)
    // manifest hook: [data-panel='connected-accounts'] on the ConnectedAccountsPanel orchestrator.
    await expect(
      page.locator("[data-panel='connected-accounts']"),
      'ConnectedAccountsPanel must mount a [data-panel="connected-accounts"] container at /account/security/connections',
    ).toBeVisible()
  })

  test('sign-in-methods list shows password and each linked provider with an unlink action', async ({ page }) => {
    await page.route('**/v1/security/identity/connections', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: connectionsBody([{ provider: PROVIDER, linkedAt: Date.now() }], true),
      }),
    )
    await gotoConnections(page)

    const methods = page.locator("[data-panel='sign-in-methods']")
    await expect(methods, 'SignInMethodsList must render [data-panel="sign-in-methods"]').toBeVisible()

    // Password method row (frame 01 always shows password when hasPassword:true).
    await expect(
      methods.locator("[data-method='password']"),
      'the password sign-in method must render as [data-method="password"]',
    ).toBeVisible()

    // Linked Google row + its unlink affordance (ConnectedAccountRow).
    const googleRow = methods.locator("[data-connection='google']")
    await expect(googleRow, 'a linked provider must render as [data-connection="google"]').toBeVisible()
    await expect(
      googleRow.locator("[data-action='unlink']"),
      'a linked provider row must offer [data-action="unlink"] (frame 01-connections)',
    ).toBeVisible()
  })

  test('an unlinked provider offers a connect affordance', async ({ page }) => {
    // No providers linked yet, but a password exists — google is offered to connect.
    await page.route('**/v1/security/identity/connections', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: connectionsBody([], true),
      }),
    )
    await gotoConnections(page)

    const connect = page.locator("[data-connect='google']")
    await expect(
      connect,
      'an unlinked provider must render [data-connect="google"] under "Add a way to sign in" (frame 01-connections)',
    ).toBeVisible()
    await expect(
      connect.locator("[data-action='connect']"),
      'the connect affordance must expose [data-action="connect"]',
    ).toBeVisible()
    // Not shown as an already-linked row when it isn't linked.
    await expect(page.locator("[data-panel='sign-in-methods'] [data-connection='google']")).toHaveCount(0)
  })

  test('NO identity-vendor name appears anywhere on the connections list', async ({ page }) => {
    await page.route('**/v1/security/identity/connections', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: connectionsBody([{ provider: PROVIDER, linkedAt: Date.now() }], true),
      }),
    )
    await gotoConnections(page)
    await expect(page.locator("[data-panel='connected-accounts']")).toBeVisible()
    const bodyText = await page.locator('body').innerText()
    for (const vendor of FORBIDDEN_VENDORS) {
      expect(
        bodyText,
        `vendor name "${vendor}" must never surface in the DOM — the panel speaks the FuzeFront boundary, not the provider`,
      ).not.toContain(vendor)
    }
  })
})

test.describe('Connected accounts — connect a provider (frame 02-connect)', () => {
  test('[data-action="connect"] posts the link-start request and follows the returned redirectUrl', async ({ page }) => {
    await page.route('**/v1/security/identity/connections', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: connectionsBody([], true) }),
    )

    let sawLinkPost = false
    await page.route(`**/v1/security/social/${PROVIDER}/link`, async route => {
      if (route.request().method() === 'POST') {
        sawLinkPost = true
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ redirectUrl: REDIRECT_URL }),
        })
      }
      return route.continue()
    })
    // Fulfil the mocked redirect target locally — no real egress to Google.
    await page.route(REDIRECT_URL, route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body data-mock="google-consent"></body></html>' }),
    )

    await gotoConnections(page)

    // Step 1 (frame 01 -> 02): the initial connect affordance opens the redirect-intent state.
    await page.locator("[data-connect='google'] [data-action='connect']").click()
    await expect(
      page.locator("[data-state='redirecting']"),
      'clicking connect must render the redirect-intent state [data-state="redirecting"] (frame 02-connect step 1)',
    ).toBeVisible()
    await expect(
      page.locator("[data-action='cancel']"),
      'the redirect-intent state must offer a [data-action="cancel"] control',
    ).toBeVisible()

    // Confirming inside the redirect-intent state fires POST /social/google/link and follows redirectUrl.
    await page.locator("[data-state='redirecting'] [data-action='connect']").click()
    await page.waitForURL(REDIRECT_URL)
    expect(sawLinkPost, 'confirming the connect action must POST /v1/security/social/google/link').toBe(true)
  })

  test('the return state (?linked=google) shows the newly linked provider row', async ({ page }) => {
    await page.route('**/v1/security/identity/connections', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: connectionsBody([{ provider: PROVIDER, linkedAt: Date.now() }], true),
      }),
    )
    await page.goto(`${CONNECTIONS_ROUTE}?linked=${PROVIDER}`, { waitUntil: 'domcontentloaded' })

    await expect(
      page.locator("[data-state='linked'][data-linked='google']"),
      'a successful return must render [data-state="linked"][data-linked="google"] (frame 02-connect step 2)',
    ).toBeVisible()
    await expect(
      page.locator("[data-panel='sign-in-methods'] [data-connection='google']"),
      'the newly linked provider must appear as a [data-connection="google"] row',
    ).toBeVisible()
  })
})

test.describe('Connected accounts — states & fail-closed (frame 03-states)', () => {
  test('shows the loading state, then resolves it', async ({ page }) => {
    await page.route('**/v1/security/identity/connections', async route => {
      await new Promise(resolve => setTimeout(resolve, 300))
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: connectionsBody([{ provider: PROVIDER, linkedAt: Date.now() }], true),
      })
    })
    await gotoConnections(page)
    const loading = page.locator("[data-state='loading']")
    await expect(
      loading,
      'a loading state [data-state="loading"] must appear while the connections load',
    ).toBeVisible()
    await expect(page.locator("[data-panel='connected-accounts']")).toBeVisible()
    await expect(loading).toBeHidden()
  })

  test('load-error path shows the error state with a retry affordance', async ({ page }) => {
    await page.route('**/v1/security/**', route =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }),
    )
    await gotoConnections(page)
    await expect(
      page.locator("[data-state='error']"),
      'LoadErrorRetry must render [data-state="error"] when the connections read fails',
    ).toBeVisible()
    await expect(
      page.locator("[data-action='retry']"),
      'the error state must offer a [data-action="retry"] control (frame 03-states)',
    ).toBeVisible()
  })

  test('social-only account (hasPassword:false) shows the "set a password first" guard and disables unlink', async ({ page }) => {
    // Contract: GET /identity/connections -> { providers:[google], hasPassword:false }.
    await page.route('**/v1/security/identity/connections', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: connectionsBody([{ provider: PROVIDER, linkedAt: Date.now() }], false),
      }),
    )
    await gotoConnections(page)
    // SetPasswordBanner — data-guard='set-password-first' + data-action='set-password'.
    await expect(
      page.locator("[data-guard='set-password-first']"),
      'a social-only account must fail-closed with the set-password-first guard',
    ).toBeVisible()
    await expect(page.locator("[data-action='set-password']").first()).toBeVisible()
    // Frame 03: the sole provider's unlink control is disabled while it's the only method.
    await expect(
      page.locator("[data-connection='google'] [data-action='unlink']"),
      'unlink must be disabled while the linked provider is the account\'s only sign-in method',
    ).toBeDisabled()
  })

  test('unlinking the last sign-in method is blocked (409 surfaced as a guard, not a crash)', async ({ page }) => {
    // Contract: unlink of the only remaining method -> 409. UI must surface the
    // last-sign-in-method guard — NOT crash and NOT silently succeed. Forced
    // through the (expected-disabled) control to exercise the server-side
    // fail-closed guard as defense-in-depth, independent of the client-side one.
    await page.route('**/v1/security/identity/connections', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: connectionsBody([{ provider: PROVIDER, linkedAt: Date.now() }], false),
      }),
    )
    await page.route(`**/v1/security/social/${PROVIDER}/link`, route => {
      if (route.request().method() === 'DELETE') {
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'last_sign_in_method', message: 'Keep at least one way to sign in' }),
        })
      }
      return route.continue()
    })

    // Track uncaught page errors — a 409 must be HANDLED, never crash the panel.
    const pageErrors: string[] = []
    page.on('pageerror', err => pageErrors.push(String(err)))

    await gotoConnections(page)

    const unlink = page.locator("[data-connection='google'] [data-action='unlink']")
    await unlink.click({ force: true })

    // The guard must be surfaced (NOT a crash, NOT a silent success).
    await expect(
      page.locator("[data-guard='last-sign-in-method']"),
      '409 on last-method unlink must surface the last-sign-in-method guard',
    ).toBeVisible()
    expect(pageErrors, 'a 409 guard must be handled — the panel must not throw an uncaught error').toEqual([])
  })

  test('a failed link handshake shows the link-failed state', async ({ page }) => {
    await page.route('**/v1/security/identity/connections', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: connectionsBody([], true) }),
    )
    await page.route(`**/v1/security/social/${PROVIDER}/link`, route => {
      if (route.request().method() === 'POST') {
        return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"link_failed"}' })
      }
      return route.continue()
    })
    await gotoConnections(page)

    await page.locator("[data-connect='google'] [data-action='connect']").click()
    await expect(page.locator("[data-state='redirecting']")).toBeVisible()
    await page.locator("[data-state='redirecting'] [data-action='connect']").click()

    await expect(
      page.locator("[data-state='link-failed']"),
      'a failed/cancelled link handshake must render [data-state="link-failed"] (frame 03-states)',
    ).toBeVisible()
  })

  test('a repeat connect attempt (already linked) shows the already-linked state', async ({ page }) => {
    // Contract: POST /social/{provider}/link -> 409 "already linked" per openapi.yaml.
    await page.route('**/v1/security/identity/connections', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: connectionsBody([{ provider: PROVIDER, linkedAt: Date.now() }], false),
      }),
    )
    await page.route(`**/v1/security/social/${PROVIDER}/link`, route => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'already_linked', message: 'This provider is already linked to the account.' }),
        })
      }
      return route.continue()
    })
    await gotoConnections(page)

    // Frame 03's last-sign-in-method guard offers "Connect another" — with only one
    // supported provider today it targets google again, hitting the already-linked 409.
    await page.locator("[data-guard='last-sign-in-method'] [data-action='connect']").click()

    await expect(
      page.locator("[data-state='already-linked']"),
      'a repeat connect on an already-linked provider must render [data-state="already-linked"] (frame 03-states)',
    ).toBeVisible()
  })

  test('NO identity-vendor name appears in any fail-closed state', async ({ page }) => {
    await page.route('**/v1/security/identity/connections', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: connectionsBody([{ provider: PROVIDER, linkedAt: Date.now() }], false),
      }),
    )
    await gotoConnections(page)
    await expect(page.locator("[data-guard='set-password-first']")).toBeVisible()
    const bodyText = await page.locator('body').innerText()
    for (const vendor of FORBIDDEN_VENDORS) {
      expect(bodyText, `vendor "${vendor}" must not appear in fail-closed copy`).not.toContain(vendor)
    }
  })
})

test.describe('Connected accounts — runtime console-clean gate (ui-runtime-validation)', () => {
  test('the rendered panel has a clean console (0 errors, 0 CSP/mixed-content, 0 failed app requests)', async ({ page }) => {
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

    await page.route('**/v1/security/identity/connections', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: connectionsBody([{ provider: PROVIDER, linkedAt: Date.now() }], true),
      }),
    )

    await gotoConnections(page)
    // The panel must actually be present for this gate to be meaningful — RED until it exists.
    await expect(page.locator("[data-panel='connected-accounts']")).toBeVisible()

    expect(consoleErrors, `console errors on the connected-accounts panel:\n${consoleErrors.join('\n')}`).toEqual([])
    expect(failedRequests, `failed app requests on the connected-accounts panel:\n${failedRequests.join('\n')}`).toEqual([])
  })
})
