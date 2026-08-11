import { test, expect, type Page, type ConsoleMessage } from '@playwright/test'

/**
 * PRE-PROD built-UI acceptance suite for the Portals Directory
 * (design/frames/portals-directory), INDEPENDENT of the implementer
 * (frontend-test-engineer, S4). Drives the REAL built React shell
 * (`frontend/src/pages/PortalsDirectory.tsx` + `components/portalsDirectory/**`,
 * route `/portals`) against a MOCKED contract surface — there is no live
 * backend in this session, mirroring the pattern already established by
 * `federated-apps-register-activate.frontend.spec.ts`:
 *
 *   - session   (GET /api/v1/security/session) -> an authenticated admin
 *   - orgs      (GET /api/organizations)        -> a personal org (opens the
 *                                                  workspace-provisioning gate)
 *   - flags     (GET /api/flags)                -> fuzefront.platform.portals-directory: true
 *   - app-registry (GET /api/v1/app-registry/**) -> empty (AppRegistryProvider
 *                                                  always mounts around every
 *                                                  authenticated route)
 *   - portals   (GET /api/v1/admin/portals)      -> the ONE surface under test,
 *                                                  mocked per-scenario below.
 *
 * Every test also runs the MANDATORY console/network inspection gate
 * (ui-runtime-validation): 0 unexplained console errors, 0 CSP/mixed-content
 * violations, 0 failed (network-level) requests. Known, pre-existing,
 * feature-UNRELATED noise (documented in the task brief, PLUS what this
 * harness discovered driving the real shell) is filtered rather than
 * silently ignored — see `KNOWN_NOISE_RE`. Everything genuinely mockable
 * (NotificationBell's polling/stream, the login capability probe) IS mocked
 * below instead of filtered, so the remaining allowlist stays small and each
 * entry is independently justified.
 */

const PORTALS_PATH = '**/api/v1/admin/portals**'
const FLAG_KEY = 'fuzefront.platform.portals-directory'

// Pre-existing, app-wide noise this suite must NOT attribute to the Portals
// Directory feature (per the task brief, PLUS what was found driving the
// real built shell against a mocked backend):
//   - the global `fonts.googleapis.com` @import in index.css (no egress in
//     this sandbox -> a failed stylesheet load, not a portals-directory bug)
//   - the ungated `services/api.ts` axios response-error interceptor's
//     `console.error`/`console.group` diagnostics (fires on every non-2xx,
//     including the deliberately-mocked 403/500/401 in the state tests below)
//   - the same file's `/api/health` connectivity probe on module load (same
//     interceptor family; unrelated to this route)
//   - `services/websocket.ts` (`socket.io-client`), mounted app-wide from
//     App.tsx for ALL authenticated routes (not portals-directory-specific);
//     there is no live backend socket.io server in this mocked pre-prod
//     harness, so it times out/resets on every route, including /portals —
//     both the socket.io-client diagnostic AND its underlying XHR
//     long-poll/websocket-upgrade attempt getting reset by the sandbox's
//     blocked egress (same failure mode as the fonts.googleapis stylesheet).
//   - Chrome's own generic "Failed to load resource: the server responded
//     with a status of NNN" / "net::ERR_CONNECTION_RESET" echoes — these are
//     the BROWSER mirroring an HTTP status or a blocked-egress network error
//     to the console, not a JS exception; every non-2xx source in this suite
//     is either the deliberately-mocked `PORTALS_PATH` response under test in
//     that specific test, or fonts.googleapis/socket.io above.
const KNOWN_NOISE_RE =
  /API (Health Check|Response Error|Request Setup Error)|Error Details:|fonts\.googleapis\.com|Unauthorized - clearing the active account session|WebSocket connection (error|to 'ws:\/\/)|Failed to load resource: (net::ERR_CONNECTION_RESET|the server responded with a status of)/i

function trackConsole(page: Page): { errors: string[]; failedRequests: string[]; all: ConsoleMessage[] } {
  const state = { errors: [] as string[], failedRequests: [] as string[], all: [] as ConsoleMessage[] }
  page.on('console', msg => {
    state.all.push(msg)
    if (msg.type() === 'error') state.errors.push(msg.text())
  })
  page.on('pageerror', err => state.errors.push(`pageerror: ${err.message}`))
  page.on('requestfailed', req =>
    state.failedRequests.push(`${req.method()} ${req.url()} (${req.failure()?.errorText})`)
  )
  return state
}

function unexplainedErrors(errors: string[]): string[] {
  return errors.filter(e => !KNOWN_NOISE_RE.test(e))
}

/**
 * Failed (network-level) requests, excluding React 18 StrictMode's
 * intentional dev-mode double-effect: the FIRST of a duplicated fetch is
 * deliberately `AbortController.abort()`-ed by the first effect instance's
 * cleanup, and the SECOND (identical) request is the one actually used —
 * this is a Vite-dev-mode-only artifact of React's double-invoke, not a
 * portals-directory defect (production has no StrictMode double-invoke).
 */
function unexplainedFailedRequests(failed: string[]): string[] {
  return failed.filter(
    f =>
      !f.includes('net::ERR_ABORTED') &&
      !f.includes('fonts.googleapis.com') &&
      !f.includes('/socket.io/')
  )
}

/** Run both mandatory console/network assertions at once, at the end of a test. */
function assertCleanRuntime(state: { errors: string[]; failedRequests: string[] }) {
  expect(unexplainedErrors(state.errors), state.errors.join('\n')).toEqual([])
  expect(unexplainedFailedRequests(state.failedRequests), state.failedRequests.join('\n')).toEqual([])
}

/** Seed an auth token exactly as a real first sign-in parks it (lib/accounts.ts). */
async function seedAuth(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('ff.acct.__provisional__.authToken', 'e2e-mock-token')
    sessionStorage.setItem('ff.workspaceReady', '1')
  })
}

/** Base mocks every authenticated route needs, regardless of the scenario under test. */
async function installBaseMocks(page: Page) {
  await page.route('**/api/v1/security/session', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: 'admin-1',
          email: 'admin@fuzefront.dev',
          roles: ['admin', 'user'],
          firstName: 'Admin',
          lastName: 'User',
        },
      }),
    })
  )

  await page.route('**/api/organizations', route => {
    if (route.request().method() !== 'GET') return route.fallback()
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        organizations: [
          {
            id: '00000000-0000-0000-0000-000000000001',
            name: 'Personal',
            slug: 'personal-admin-1',
            type: 'personal',
            ownerId: 'admin-1',
          },
        ],
      }),
    })
  })

  await page.route('**/api/v1/app-registry/apps**', route => {
    if (route.request().method() !== 'GET') return route.fallback()
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ apps: [], nextCursor: null }),
    })
  })

  // The `fuzefront.platform.portals-directory` flag ON — this is what the
  // Playwright harness itself must flip to exercise the surface (task brief).
  await page.route('**/api/flags', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ flags: { [FLAG_KEY]: true } }),
    })
  )

  // Unrelated to this feature; mocked so the health probe never adds
  // network-level noise to the failed-request assertions below.
  await page.route('**/api/health', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' })
  )

  // `NotificationBell` (frontend/src/components/NotificationBell.tsx) mounts
  // app-wide in the authenticated Layout/TopBar for EVERY route, not just
  // /portals — unrelated to this feature but real network calls that would
  // otherwise 404/retry forever (EventSource auto-reconnects) and pollute
  // every scenario's console/network assertions.
  await page.route('**/api/v1/notifications/unread-count**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 0 }) })
  )
  await page.route('**/api/v1/notifications/stream**', route =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' })
  )

  // The Login page's capability probe (`AuthPanel`/`authAPI.getAuthMethods`,
  // GET /v1/security/methods) — needed only by the 401 -> /login redirect
  // scenario, but harmless to mock unconditionally so /login always renders
  // cleanly regardless of which test navigates there.
  await page.route('**/api/v1/security/methods', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        password: true,
        social: ['google'],
        mfa: { enabled: false, types: [] },
        verification: { email: false, sms: false },
      }),
    })
  )
}

// ---- Fixtures --------------------------------------------------------------

function softPortal() {
  return {
    id: 'prt_northwind',
    slug: 'northwind',
    name: 'Northwind',
    status: 'active',
    isRoot: false,
    organizationId: 'org-1',
    billingMode: 'platform',
    branding: {},
    identityPolicy: {},
    domains: [],
    primaryDomain: 'portal.northwind.example',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    identity_mode: 'soft',
    launchUrl: 'https://portal.northwind.example/',
  }
}

function hardPortal() {
  return {
    id: 'prt_mendys',
    slug: 'mendys',
    name: 'Mendys Robotics',
    status: 'active',
    isRoot: false,
    organizationId: 'org-1',
    billingMode: 'platform',
    branding: {},
    identityPolicy: {},
    domains: [],
    primaryDomain: 'live.mendysrobotics.com',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    identity_mode: 'hard',
    launchUrl: 'https://live.mendysrobotics.com/',
  }
}

function suspendedPortal() {
  return {
    id: 'prt_acme',
    slug: 'acme',
    name: 'Acme Reseller',
    status: 'suspended',
    isRoot: false,
    organizationId: 'org-1',
    billingMode: 'platform',
    branding: {},
    identityPolicy: {},
    domains: [],
    primaryDomain: 'portal.acme.example',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    identity_mode: 'soft',
    launchUrl: 'https://portal.acme.example/',
  }
}

test.describe('Portals Directory — built UI (mocked contract surface)', () => {
  test.beforeEach(async ({ page }) => {
    await seedAuth(page)
    await installBaseMocks(page)
  })

  // ── Acceptance #1: directory renders from the list endpoint, tier/status,
  //    cursor pagination "Load more" follows nextCursor/hasMore ─────────────
  test('renders portals from GET /api/v1/admin/portals; tier badges map to identity_mode; Load more follows the cursor', async ({
    page,
  }) => {
    const consoleState = trackConsole(page)

    const cursorsRequested: (string | null)[] = []
    await page.route(PORTALS_PATH, route => {
      const url = new URL(route.request().url())
      cursorsRequested.push(url.searchParams.get('cursor'))
      if (url.searchParams.get('cursor') === 'cur_2') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [suspendedPortal()],
            page: { nextCursor: null, hasMore: false, total: 3 },
          }),
        })
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [softPortal(), hardPortal()],
          page: { nextCursor: 'cur_2', hasMore: true, total: 3 },
        }),
      })
    })

    await page.goto('/portals')
    await expect(page.locator('[data-panel="portals-directory"]')).toBeVisible()
    await expect(page.getByText('Portals you manage')).toBeVisible()

    // Soft-tier row.
    const northwind = page.locator('[data-portal="prt_northwind"]')
    await expect(northwind).toBeVisible()
    await expect(northwind).toHaveAttribute('data-tier', 'soft')
    await expect(northwind.locator('[data-portal-status="active"]')).toBeVisible()
    await expect(northwind.locator('[data-domain="primary"]')).toHaveText(
      'portal.northwind.example'
    )

    // Hard-tier row (own IdP).
    const mendys = page.locator('[data-portal="prt_mendys"]')
    await expect(mendys).toHaveAttribute('data-tier', 'hard')
    await expect(mendys).toContainText('own IdP')

    // "Load more" is present because `hasMore: true` / a `nextCursor`.
    const loadMore = page.locator('[data-action="load-more"]')
    await expect(loadMore).toBeVisible()

    await loadMore.click()
    await expect(page.locator('[data-portal="prt_acme"]')).toBeVisible()
    // "Load more" followed the server-issued `nextCursor` ('cur_2') — the
    // load-bearing assertion for cursor pagination. (React 18 StrictMode's
    // dev-only double-effect can duplicate the FIRST, cursor-less request, so
    // this asserts cur_2 was requested rather than an exact call count.)
    expect(cursorsRequested).toContain('cur_2')
    // The cursor page was exhausted (`hasMore: false`) -> "Load more" is gone.
    await expect(loadMore).toHaveCount(0)

    assertCleanRuntime(consoleState)
  })

  // ── Acceptance #2: "Open portal" is a real external anchor, never window.open,
  //    never an in-app route; launchUrl rendered verbatim ────────────────────
  test('"Open portal" is a real <a target="_blank" rel="noopener noreferrer" href> to the launchUrl, never window.open / in-app route', async ({
    page,
  }) => {
    const consoleState = trackConsole(page)

    // Spy on window.open — the anchor must NEVER be wired to it.
    await page.addInitScript(() => {
      ;(window as any).__openCalls = []
      const real = window.open
      window.open = (...args: unknown[]) => {
        ;(window as any).__openCalls.push(args)
        return real.apply(window, args as never)
      }
    })

    await page.route(PORTALS_PATH, route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [softPortal(), hardPortal()],
          page: { nextCursor: null, hasMore: false, total: 2 },
        }),
      })
    )

    await page.goto('/portals')
    const link = page.locator('[data-portal="prt_northwind"] [data-action="open-portal"]')
    await expect(link).toBeVisible()

    // The exact external-navigation contract — asserted attribute-for-attribute.
    await expect(link).toHaveAttribute('href', 'https://portal.northwind.example/')
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    await expect(link).toHaveJSProperty('tagName', 'A')

    // launchUrl rendered VERBATIM, not client-composed (a different domain
    // than the row's `primaryDomain` display text would only be possible if
    // the client re-derived a host from client-held data — it must not).
    const hardLink = page.locator('[data-portal="prt_mendys"] [data-action="open-portal"]')
    await expect(hardLink).toHaveAttribute('href', 'https://live.mendysrobotics.com/')

    // This sandbox has no egress, so the popup's real navigation to
    // portal.northwind.example would fail DNS resolution near-instantly and
    // land on Chromium's own `chrome-error://chromewebdata/` interstitial
    // before we can observe the intended URL. Stub the destination at the
    // context/network layer (same mechanism as every other mock in this
    // suite) purely so the popup's navigation SUCCEEDS and its committed URL
    // is observable — this does not touch what the anchor itself declares
    // (already asserted attribute-for-attribute above).
    await page.context().route('https://portal.northwind.example/**', route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>ok</title>' })
    )

    // Clicking opens a NEW tab/popup and does NOT navigate the shell away
    // from /portals (no same-tab / in-app-route hijack).
    const [popup] = await Promise.all([page.waitForEvent('popup'), link.click()])
    await popup.waitForLoadState('domcontentloaded')
    expect(popup.url()).toBe('https://portal.northwind.example/')
    await popup.close()
    await expect(page).toHaveURL(/\/portals$/)

    // Never wired through window.open() (which can be popup-blocked) — a real
    // <a target="_blank"> click never calls window.open at all.
    const openCalls = await page.evaluate(() => (window as any).__openCalls)
    expect(openCalls).toEqual([])

    assertCleanRuntime(consoleState)
  })

  // ── Acceptance #3: all six contract states ──────────────────────────────
  test.describe('states (design/frames/portals-directory 02-portals-list-states)', () => {
    test('d1 loading: aria-busy region while the request is in flight', async ({ page }) => {
      const consoleState = trackConsole(page)
      let resolveRoute: (() => void) | undefined
      const gate = new Promise<void>(resolve => {
        resolveRoute = resolve
      })
      await page.route(PORTALS_PATH, async route => {
        await gate
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: [], page: { nextCursor: null, hasMore: false } }),
        })
      })

      await page.goto('/portals')
      const loading = page.locator('[data-state="loading"][aria-busy="true"]')
      await expect(loading).toBeVisible()
      resolveRoute?.()
      await expect(loading).toHaveCount(0)

      assertCleanRuntime(consoleState)
    })

    test('d2 empty: a REAL non-error state — no alert, no launch affordances', async ({
      page,
    }) => {
      const consoleState = trackConsole(page)
      await page.route(PORTALS_PATH, route =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: [], page: { nextCursor: null, hasMore: false } }),
        })
      )
      await page.goto('/portals')
      await expect(page.getByText('No portals to manage')).toBeVisible()
      await expect(page.getByRole('alert')).toHaveCount(0)
      await expect(page.locator('[data-action="open-portal"]')).toHaveCount(0)

      assertCleanRuntime(consoleState)
    })

    test('d3 error: renders [data-action="retry"], never a sign-in redirect, retry recovers', async ({
      page,
    }) => {
      const consoleState = trackConsole(page)
      let fail = true
      await page.route(PORTALS_PATH, route => {
        if (fail) {
          return route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'internal_error' }),
          })
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [softPortal()],
            page: { nextCursor: null, hasMore: false },
          }),
        })
      })

      await page.goto('/portals')
      await expect(page.getByText("Couldn't load your portals")).toBeVisible()
      await expect(page).toHaveURL(/\/portals$/) // NEVER a sign-in redirect on a 500.
      const retry = page.locator('[data-action="retry"]')
      await expect(retry).toBeVisible()

      fail = false
      await retry.click()
      await expect(page.locator('[data-portal="prt_northwind"]')).toBeVisible()

      // The 500 is DELIBERATE (this is exactly what d3 exercises) — its
      // interceptor diagnostics are the documented known noise, filtered by
      // KNOWN_NOISE_RE; anything else must still be zero.
      assertCleanRuntime(consoleState)
    })

    test('d5 suspended: no ENABLED launch affordance — a disabled button, never a link', async ({
      page,
    }) => {
      const consoleState = trackConsole(page)
      await page.route(PORTALS_PATH, route =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [suspendedPortal()],
            page: { nextCursor: null, hasMore: false },
          }),
        })
      )
      await page.goto('/portals')
      const row = page.locator('[data-portal="prt_acme"]')
      await expect(row).toHaveAttribute('data-status', 'suspended')
      await expect(row.locator('a[data-action="open-portal"]')).toHaveCount(0)
      const btn = row.locator('button[data-action="open-portal"]')
      await expect(btn).toBeVisible()
      await expect(btn).toBeDisabled()

      assertCleanRuntime(consoleState)
    })

    test('d6 fail-closed 403: permission-denied panel in place, ZERO launch anchors/buttons anywhere, never a sign-in redirect', async ({
      page,
    }) => {
      const consoleState = trackConsole(page)
      await page.route(PORTALS_PATH, route =>
        route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'FORBIDDEN' }),
        })
      )
      await page.goto('/portals')

      const panel = page.locator('[data-panel="permission-denied"]')
      await expect(panel).toBeVisible()
      const forbidden = page.locator('[data-state="forbidden"]')
      await expect(forbidden).toHaveAttribute('data-http', '403')
      await expect(forbidden).toHaveAttribute('data-error-code', 'FORBIDDEN')
      await expect(page).toHaveURL(/\/portals$/) // a 403 is NEVER a sign-in redirect.

      // The load-bearing assertion: ZERO launch anchors/buttons ANYWHERE in
      // the DOM for the fail-closed case.
      await expect(page.locator('a[data-action="open-portal"]')).toHaveCount(0)
      await expect(page.locator('button[data-action="open-portal"]')).toHaveCount(0)
      await expect(page.getByRole('link', { name: /open portal/i })).toHaveCount(0)
      await expect(page.getByRole('button', { name: /open portal/i })).toHaveCount(0)

      // --- FRAME/BUILD MISMATCH (reported, not fixed here — see PR description) ---
      // The approved frame's d6 (`design/frames/portals-directory/02-portals-list-states.html`)
      // depicts a READ-ONLY PROJECTION: portal rows stay visible (name/domain/
      // tier) with a `[data-list="portals"][data-readonly="true"]` wrapper and
      // per-row `[data-can-open="false"]` / `[data-action-absent="open-portal"]`
      // "— no access —" spans — two of the manifest's REQUIRED testHooks for
      // this frame. The BUILT app instead renders NO rows at all on 403 (only
      // the banner) because `GET /api/v1/admin/portals` denies the WHOLE
      // request (`requireRole(['admin'])`, `backend/src/routes/adminPortals.ts`)
      // with no partial/row-scoped 200 to project as read-only. This assertion
      // is INTENTIONALLY LEFT FAILING to keep the gap visible until the
      // mismatch is resolved (see the Jira bug filed for this).
      await expect(
        page.locator('[data-list="portals"][data-readonly="true"]'),
        'FRAME/BUILD MISMATCH: the approved frame’s read-only row projection ' +
          '(data-readonly="true") is never rendered by the built UI on a 403 — ' +
          'see the bug filed against this finding'
      ).toBeVisible()

      assertCleanRuntime(consoleState)
    })

    test('401: no error/forbidden banner — the global interceptor re-authenticates (redirects to /login)', async ({
      page,
    }) => {
      const consoleState = trackConsole(page)
      await page.route(PORTALS_PATH, route =>
        route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'UNAUTHORIZED' }),
        })
      )
      await page.goto('/portals')

      // Neither the generic load-error banner NOR the permission-denied panel.
      await expect(page.getByText("Couldn't load your portals")).toHaveCount(0)
      await expect(page.locator('[data-panel="permission-denied"]')).toHaveCount(0)

      // Only a 401 re-authenticates — the shared api client's interceptor
      // redirects to /login.
      await page.waitForURL(/\/login$/, { timeout: 10_000 })

      // A 401 IS the documented "Unauthorized - clearing the active account
      // session" / interceptor-diagnostic noise — filtered by KNOWN_NOISE_RE;
      // anything else must still be zero.
      assertCleanRuntime(consoleState)
    })
  })

  // ── Device/viewport conformance (mobile-conformance skill) ────────────────
  //
  // The repo's `mobile` Playwright project (iPhone 12, WebKit) cannot run in
  // this sandbox: `npx playwright install webkit` is blocked by the outbound
  // proxy (`403 request rejected: host not permitted` from both Microsoft's
  // and Playwright's CDN hosts) — a pre-existing SANDBOX/CI-parity gap that
  // would block ANY spec under `--project=mobile` here, not something
  // specific to this feature (see the PR description / DONE report). As the
  // best available substitute, this block emulates the SAME iPhone 12
  // viewport/DPR/touch metrics on Chromium (already installed) so the small-
  // screen layout itself is still verified in this session; the true WebKit
  // engine pass is deferred to CI's `mobile` project.
  test.describe('mobile viewport (Chromium-emulated iPhone 12 metrics — WebKit unavailable in this sandbox)', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 })

    test('directory renders on a small touch viewport; tapping "Open portal" still opens a real new-tab anchor', async ({
      page,
    }) => {
      const consoleState = trackConsole(page)
      await page.route(PORTALS_PATH, route =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [softPortal(), suspendedPortal()],
            page: { nextCursor: null, hasMore: false },
          }),
        })
      )
      await page.context().route('https://portal.northwind.example/**', route =>
        route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>ok</title>' })
      )

      await page.goto('/portals')
      await expect(page.locator('[data-panel="portals-directory"]')).toBeVisible()

      const northwind = page.locator('[data-portal="prt_northwind"]')
      await expect(northwind).toBeVisible()
      const link = northwind.locator('[data-action="open-portal"]')
      await expect(link).toHaveAttribute('target', '_blank')
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer')

      // No horizontal overflow at the mobile viewport width — the directory
      // panel must fit, not force horizontal scroll on a 390px-wide screen.
      const panelBox = await page.locator('[data-panel="portals-directory"]').boundingBox()
      expect(panelBox && panelBox.width).toBeLessThanOrEqual(390)

      // Suspended row still exposes a disabled (not enabled) affordance at
      // this viewport, same fail-closed contract as desktop.
      const suspendedBtn = page
        .locator('[data-portal="prt_acme"] button[data-action="open-portal"]')
      await expect(suspendedBtn).toBeDisabled()

      // A touch tap on the real external anchor opens a new tab/popup.
      const [popup] = await Promise.all([page.waitForEvent('popup'), link.tap()])
      await popup.waitForLoadState('domcontentloaded')
      expect(popup.url()).toBe('https://portal.northwind.example/')
      await popup.close()

      assertCleanRuntime(consoleState)
    })
  })
})
