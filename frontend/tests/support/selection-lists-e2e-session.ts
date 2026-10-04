import type { ConsoleMessage, Page } from '@playwright/test'

/**
 * Selection List red-spec harness — authenticated-session mock for a
 * backend-less run (the `selection-list-service-e2e` CI job serves the
 * frontend with `vite preview`, no backend, no Authentik).
 *
 * Every other authenticated Playwright spec in this repo (auth.spec.ts,
 * mobile-layout.spec.ts, clock-load.spec.ts, ...) signs in against a REAL
 * backend + Authentik on a full local-up stack. This job intentionally does
 * not run that stack — it only builds and serves the static frontend bundle,
 * so the selection-list red specs mock the shell's session/flag/org
 * dependencies directly instead. Without this, `/settings/selection-lists`
 * (and its /translations, /access siblings) redirect straight to
 * `/dashboard` before any UI under test ever mounts — regardless of how
 * complete @fuzeone/selection-lists-ui is.
 *
 * What has to be faked, and why (traced from the shell's own auth chain):
 *
 * 1. `localStorage.authToken` — the LEGACY (pre-multi-account) token key.
 *    `migrateLegacySession()` (frontend/src/lib/accounts.ts) moves it into
 *    the provisional per-account namespace on first read; only THEN does
 *    `getActiveAuthToken()` return a token, which is what makes
 *    `AuthWrapper.initializeAuth()` (App.tsx) call `getCurrentUser()` in the
 *    first place instead of short-circuiting on "No auth token found".
 * 2. `GET /api/v1/security/session` — what `getCurrentUser()` calls. Its
 *    response becomes `state.user`, and `isAuthenticated = !!state.user`
 *    (useCurrentUser, lib/shared.tsx) is the gate every settings route sits
 *    behind.
 * 3. `GET /api/flags` — `useFlag('fuzefront.selection-lists.service', false)`
 *    (App.tsx's SelectionListsRoute/TranslationWorkbenchRoute/
 *    SelectionListAccessRoute) is the SECOND gate on top of auth; without
 *    this the route renders `<Navigate to="/dashboard" />` even once
 *    authenticated.
 * 4. `sessionStorage['ff.workspaceReady'] = '1'` — WorkspaceProvisioningGate
 *    wraps the entire authenticated route tree and otherwise shows a
 *    "Creating your workspace…" card while it polls `GET /api/organizations`
 *    for a provisioned membership. Setting its own "already confirmed this
 *    session" key (which the real app also sets, to avoid re-flashing the
 *    card on every navigation) skips straight to the `ready` render path.
 * 5. `GET /api/v1/app-registry/apps*` — AppRegistryProvider (always mounted
 *    above the route tree) fetches the app menu in the background. It does
 *    not block rendering, but an unmocked call 404s and logs
 *    `console.error('Failed to load registered apps:', …)`, which trips the
 *    suite's own runtime console-clean assertions. Mocked to an empty,
 *    successful list so it is silent.
 *
 * The 4 gated flows' spec files (list-management, translation-workbench,
 * access-control) call this once per test, before navigating; the picker
 * spec does NOT need it — `/embed/selection-list-picker` is a deliberately
 * public, pre-auth surface (App.tsx AppContent, checked before the auth
 * gate) and is reachable with zero mocking beyond its own list/item data.
 */
export async function mockAuthenticatedSelectionListsSession(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('authToken', 'e2e-selection-lists-fake-token')
    sessionStorage.setItem('ff.workspaceReady', '1')
  })

  await page.route('**/api/v1/security/session', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: 'usr_e2e_selection_lists',
          email: 'e2e-selection-lists@fuzefront.dev',
          firstName: 'E2E',
          lastName: 'Tester',
          roles: ['org:admin'],
        },
      }),
    })
  })

  await page.route('**/api/flags', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        flags: { 'fuzefront.selection-lists.service': true },
      }),
    })
  })

  await page.route('**/api/v1/app-registry/apps*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ apps: [] }),
    })
  })

  await stubExternalFonts(page)
}

/**
 * index.html pulls Google Fonts over the network. Stub them so a run is deterministic
 * (and silent) on runners with no/filtered egress instead of logging net::ERR_*
 * resource errors that have nothing to do with the feature under test.
 */
export async function stubExternalFonts(page: Page): Promise<void> {
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, async route => {
    await route.fulfill({ status: 200, contentType: 'text/css', body: '' })
  })
}

/**
 * Console errors that come from the SHELL running backend-less in this harness, not
 * from the selection-lists UI under test. The console-clean gates ignore exactly
 * these and nothing else — every other error (CSP, mixed content, uncaught
 * exception, failed selection-list request) still fails the gate.
 *
 *  - the shell's realtime notifications channel (socket.io WebSocket + the
 *    /api/v1/notifications/stream SSE fallback) has no server behind `vite preview`;
 *  - the specs run with `serviceWorkers: 'block'` (so the PWA SW cannot bypass
 *    page.route mocks), which makes the shell's own SW registration log a failure.
 */
export function isShellHarnessNoise(msg: ConsoleMessage): boolean {
  const text = msg.text()
  const url = msg.location().url ?? ''
  if (/Service worker registration failed/i.test(text)) return true
  if (/WebSocket connection (error|to)/i.test(text) || url.includes('/socket.io/')) return true
  if (url.includes('/api/v1/notifications/stream')) return true
  return false
}

/**
 * Navigate to a `fuzefront.selection-lists.service`-gated route (/settings/selection-lists…).
 *
 * WHY NOT a plain `page.goto(route)`: on a hard load the shell mounts the route tree
 * before `GET /api/flags` settles; `useFlag()` returns its OFF default while
 * `loaded === false`, so `SelectionListsRoute` & co. immediately render
 * `<Navigate to="/dashboard">` and the deep link is lost (a real shell defect — it is
 * asserted on its own in the "deep link" spec in selection-lists-list-management.red.spec.ts,
 * and stays RED until the shell waits for the flag fetch). Without this helper that one
 * defect would mask every other assertion in the four selection-lists specs, so the
 * per-frame specs reach the route the way a signed-in user does: load the shell, let the
 * flags settle, then navigate client-side.
 */
export async function gotoFlagGatedRoute(page: Page, route: string): Promise<void> {
  const flagsSettled = page.waitForResponse(r => new URL(r.url()).pathname === '/api/flags')
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
  await flagsSettled
  await page.evaluate(async target => {
    // Let FeatureFlagProvider commit the fetched flags before the router sees the route.
    await new Promise(resolve => setTimeout(resolve, 50))
    window.history.pushState({}, '', target)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, route)
}
