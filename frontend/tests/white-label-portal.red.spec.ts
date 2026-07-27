/**
 * WHITE-LABEL TENANT PORTAL — INDEPENDENT, PRE-PRODUCTION, RED-by-design UI e2e.
 * (frontend-test-engineer — independent verification, NOT the implementer.)
 *
 * ── What this file is ────────────────────────────────────────────────────────
 * TDD RED specs for the two APPROVED white-label-portal flows:
 *   - portal-shell  (approved by @izzywdev, stamp 61c774adba75, design-approval #419)
 *   - portal-login  (approved by @izzywdev, stamp 61c774adba75, design-approval #419)
 *
 * Derived STRICTLY from the approved visual contract:
 *   design/frames/white-label-portal/manifest.json     (build inventory + data-* hooks)
 *   design/frames/white-label-portal/01-branded-shell.html  (1) CorpABC-branded shell
 *   design/frames/white-label-portal/02-root-shell.html     (2) Root FuzeFront shell (same markup)
 *   design/frames/white-label-portal/03-white-label-login.html (3) White-label login
 *   design/frames/white-label-portal/04-theme-layers.html   (4) Light/dark theming
 *   design/frames/white-label-portal/05-states.html         (5) States (contract)
 *
 * and from the epics named in the manifest: FF-EPIC-13 (white-label shell/branding),
 * FF-EPIC-10 (portal-context resolution + fail-closed cases), FF-EPIC-09 (portals +
 * branding jsonb + seeded root portal).
 *
 * The manifest `build` block names what MUST exist for these to go GREEN:
 *   flow portal-shell   orchestrator PortalShell        route /
 *   flow portal-login   orchestrator PortalLoginFlow    route /login
 *   package @fuzefront/portal-branding-ui
 *   components PortalBrandingProvider, PortalThemeScope, BrandedTopBar,
 *              BrandedSidePanel, PortalAppGrid, PortalBrandLockup,
 *              WhiteLabelLoginCard, BrandingBoundary, PortalUnavailableNotice
 *   DS primitive BrandTokenScope (NET-NEW in @fuzefront/design-system)
 *
 * ── Why they are RED right now (READ THIS before "fixing" a failure) ─────────
 * Neither `/` (as the branded PortalShell) nor `/login` (as WhiteLabelLoginCard)
 * exists yet, and `GET /api/v1/portal/context` is not wired into the SPA boot.
 * Every test below is EXPECTED to fail today, and it must fail for the RIGHT
 * reason: the shell/login markers are ABSENT from the DOM — not a harness/config
 * error. That RED state is the proof this is TDD (specs written against the
 * approved contract BEFORE the implementation), not tests retrofitted to a
 * shipped UI.
 *
 * They are deliberately NOT test.skip / test.fixme — hiding the RED would
 * defeat the entire point. They turn GREEN when frontend-engineer lands
 * @fuzefront/portal-branding-ui and wires the `/` and `/login` routes to call
 * `GET /api/v1/portal/context`.
 *
 * Selectors are ONLY the data-* hooks the frames/manifest declare
 * (manifest.frames[].testHooks). No invented selectors.
 *
 * Because the real deployment resolves the active portal from the request
 * Host header (subdomain/custom-domain routing), and this spec runs against a
 * single dev host, every scenario drives the portal identity by intercepting
 * the boot call the shell/login issue — `GET /api/v1/portal/context` — with a
 * controlled `PortalContext` response. This is the same technique the
 * account-security-hub.red.spec.ts RED suite uses for its fail-closed states,
 * and it means these specs exercise the CONTRACT the frame declares regardless
 * of which host actually resolves it in prod.
 *
 * Run (pre-prod, against a built UI on the ephemeral stack / dev host):
 *   BASE_URL=http://fuzefront.dev.local npx playwright test tests/white-label-portal.red
 * Config: frontend/playwright.config.ts (chromium + mobile projects).
 */
import { test, expect, type Page, type ConsoleMessage, type Request } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Sample PortalContext fixtures (incl. the CorpABC tenant accent) live in a JSON
// fixture, not inline in this .ts — gate-ds-conformance forbids raw color
// literals on changed UI-code lines, and a JSON test fixture is sample data,
// not a styling decision (the real accent comes from the API, never a literal
// baked into product code). Loaded via fs.readFileSync + import.meta.url
// (not a static `import … from '*.json'`, and not __dirname) because
// frontend/ is "type": "module" — Playwright runs this spec as real ESM, so
// __dirname is undefined and a static JSON import would need a Node
// import-attribute the TS loader doesn't add.
type PortalBranding = {
  name: string
  logo: string | null
  favicon: string | null
  accent: string | null
  tagline: string | null
}
type PortalContext = {
  portalId: string
  slug: string
  status: string
  branding: PortalBranding
}
const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES_PATH = path.join(SPEC_DIR, 'fixtures', 'white-label-portal.fixtures.json')
const portalFixtures = JSON.parse(fs.readFileSync(FIXTURES_PATH, 'utf8')) as {
  corpabcContext: PortalContext
  rootContext: PortalContext
}

const PORTAL_CONTEXT_ROUTE = '**/api/v1/portal/context'
const SESSION_ROUTE = '**/api/v1/security/session'

const CORPABC_CONTEXT = portalFixtures.corpabcContext
const ROOT_CONTEXT = portalFixtures.rootContext

async function mockPortalContext(page: Page, body: unknown, status = 200) {
  await page.route(PORTAL_CONTEXT_ROUTE, route =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }),
  )
}

async function gotoShell(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
}

async function gotoLogin(page: Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
}

test.describe('Portal shell — CorpABC branded render (frame 01-branded-shell)', () => {
  test('shell mounts topbar / side-panel / app-grid regions', async ({ page }) => {
    await mockPortalContext(page, CORPABC_CONTEXT)
    await gotoShell(page)

    await expect(
      page.locator("[data-region='topbar']"),
      'PortalShell must mount a [data-region="topbar"] header',
    ).toBeVisible()
    await expect(
      page.locator("[data-region='side-panel']"),
      'BrandedSidePanel must mount [data-region="side-panel"]',
    ).toBeVisible()
    await expect(
      page.locator("[data-region='app-grid']"),
      'PortalAppGrid must mount [data-region="app-grid"]',
    ).toBeVisible()
  })

  test('topbar brand lockup renders the resolved portal name (CorpABC), never a broken logo', async ({
    page,
  }) => {
    await mockPortalContext(page, CORPABC_CONTEXT)
    await gotoShell(page)

    await expect(
      page.locator('[data-branding-name]').first(),
      'the brand lockup must render branding.name from GET /api/v1/portal/context',
    ).toHaveText('CorpABC')
    // Logo slot must exist even when branding.logo is null (initials/default fallback,
    // never a broken-image icon — DS primitive requirement in manifest.build).
    await expect(page.locator('[data-branding-logo]').first()).toBeVisible()
  })

  test('the shell is scoped by [data-portal="corpabc"] — the token-override hook', async ({
    page,
  }) => {
    await mockPortalContext(page, CORPABC_CONTEXT)
    await gotoShell(page)

    await expect(
      page.locator('[data-portal="corpabc"]'),
      'BrandTokenScope must apply [data-portal="corpabc"] so the accent tokens re-point to CorpABC',
    ).toBeAttached()
  })
})

test.describe('Portal shell — root FuzeFront branding, same markup (frame 02-root-shell)', () => {
  test('root portal renders the default FuzeFront branding through the SAME shell', async ({
    page,
  }) => {
    await mockPortalContext(page, ROOT_CONTEXT)
    await gotoShell(page)

    await expect(page.locator("[data-region='topbar']")).toBeVisible()
    await expect(page.locator('[data-branding-name]').first()).toHaveText('FuzeFront')
    await expect(
      page.locator('[data-portal="root"]'),
      'the root portal must resolve [data-portal="root"] — proving the reskin is token-only, zero component fork',
    ).toBeAttached()
  })

  test('the portal badge reflects the resolved portal (portal · root)', async ({ page }) => {
    await mockPortalContext(page, ROOT_CONTEXT)
    await gotoShell(page)

    await expect(
      page.locator('[data-portal-badge]'),
      'frame 02 declares a [data-portal-badge] element naming the resolved portal',
    ).toContainText('root')
  })
})

test.describe('Portal login — white-label sign-in (frame 03-white-label-login)', () => {
  test('renders the branded login form at /login', async ({ page }) => {
    await mockPortalContext(page, CORPABC_CONTEXT)
    await gotoLogin(page)

    await expect(
      page.locator("[data-whitelabel='true']"),
      'WhiteLabelLoginCard must mount a [data-whitelabel="true"] surface at /login',
    ).toBeVisible()
    await expect(page.locator("[data-form='login']")).toBeVisible()
  })

  test('the login pane is branded (name + tagline) and the submit action names the portal', async ({
    page,
  }) => {
    await mockPortalContext(page, CORPABC_CONTEXT)
    await gotoLogin(page)

    await expect(page.locator('[data-branding-name]').first()).toHaveText('CorpABC')
    await expect(
      page.locator("[data-action='submit']"),
      'frame 03: the submit button reads "Sign in to CorpABC" — branding.name interpolated',
    ).toContainText('CorpABC')
    await expect(page.locator("[data-action='forgot']")).toBeVisible()
    await expect(page.locator("[data-action='social-sso']")).toBeVisible()
    await expect(page.locator("[data-nav='signup']")).toBeVisible()
  })

  test('WHITE-LABEL INVARIANT: the tenant login surface never says "FuzeFront"', async ({
    page,
  }) => {
    await mockPortalContext(page, CORPABC_CONTEXT)
    await gotoLogin(page)

    await expect(page.locator("[data-whitelabel='true']")).toBeVisible()
    const surfaceText = await page.locator("[data-whitelabel='true']").innerText()
    expect(
      surfaceText,
      'auth is served same-origin by the hidden FuzeFront platform — the tenant never sees the FuzeFront wordmark',
    ).not.toContain('FuzeFront')
  })
})

test.describe('Portal shell/login — light/dark theming (frame 04-theme-layers)', () => {
  test('CorpABC accent is preserved across both light and dark theme surfaces', async ({
    page,
  }) => {
    await mockPortalContext(page, CORPABC_CONTEXT)
    await gotoShell(page)

    // Theme is an orthogonal layer ([data-theme]) from branding ([data-portal]) —
    // switching theme must not drop or fork the portal branding.
    await expect(page.locator('[data-portal="corpabc"]')).toBeAttached()
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(page.locator('[data-branding-name]').first()).toHaveText('CorpABC')
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(page.locator('[data-branding-name]').first()).toHaveText('CorpABC')
  })
})

test.describe('Portal shell/login — states & fail-closed (frame 05-states)', () => {
  test('boot shows a neutral loading skeleton — NO flash of default FuzeFront branding', async ({
    page,
  }) => {
    // Delay the context response so the loading state is observable, and make the
    // eventual resolution CorpABC — proving the shell never paints a default
    // FuzeFront frame while branding is still in flight (FF-EPIC-10-S2 AC3).
    await page.route(PORTAL_CONTEXT_ROUTE, async route => {
      await new Promise(resolve => setTimeout(resolve, 300))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(CORPABC_CONTEXT),
      })
    })
    await gotoShell(page)

    const skeleton = page.locator("[data-state='loading']")
    await expect(
      skeleton,
      'a neutral skeleton [data-state="loading"] must render while portal context resolves',
    ).toBeVisible()
    const skeletonText = await skeleton.innerText().catch(() => '')
    expect(
      skeletonText,
      'the loading skeleton must not show the default FuzeFront brand name before the tenant resolves',
    ).not.toContain('FuzeFront')

    await expect(page.locator('[data-branding-name]').first()).toHaveText('CorpABC')
    await expect(skeleton).toBeHidden()
  })

  test('context load failure shows the error state with a retry affordance', async ({ page }) => {
    await mockPortalContext(page, { error: 'boom' }, 500)
    await gotoShell(page)

    await expect(
      page.locator("[data-state='error']"),
      'a failed/timed-out portal-context fetch must render [data-state="error"] — never a silent unbranded fallback',
    ).toBeVisible()
    await expect(page.locator("[data-action='retry']")).toBeVisible()
  })

  test('suspended portal fails closed: "This portal is unavailable" (403)', async ({ page }) => {
    await mockPortalContext(page, { error: 'PORTAL_SUSPENDED' }, 403)
    await gotoShell(page)

    await expect(
      page.locator("[data-state='suspended']"),
      'resolvePortalContext → suspended must render [data-state="suspended"] (FF-EPIC-10-S1 AC4)',
    ).toBeVisible()
    await expect(page.locator("[data-state='suspended']")).toContainText('unavailable')
  })

  test('unknown host falls back to the root portal, never leaks another tenant (fail-closed)', async ({
    page,
  }) => {
    await mockPortalContext(page, ROOT_CONTEXT, 404)
    await gotoShell(page)

    // An unrecognized host must fall back to the root FuzeFront portal for
    // shell/UI routes — fail-closed, never fail-open (FF-EPIC-10-S1 AC3).
    await expect(page.locator('[data-portal="root"]')).toBeAttached()
    await expect(page.locator('[data-branding-name]').first()).toHaveText('FuzeFront')
  })

  test('cross-portal login is rejected: "This account isn\'t part of CorpABC"', async ({
    page,
  }) => {
    await mockPortalContext(page, CORPABC_CONTEXT)
    await page.route(SESSION_ROUTE, route => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 'cross_portal_rejected',
            message: "This account isn't part of CorpABC.",
          }),
        })
      }
      return route.continue()
    })

    const pageErrors: string[] = []
    page.on('pageerror', err => pageErrors.push(String(err)))

    await gotoLogin(page)
    await page.locator("[data-action='submit']").click()

    await expect(
      page.locator("[data-state='cross-portal-reject']"),
      'a portal_id/host mismatch at login must surface [data-state="cross-portal-reject"] (FF-EPIC-10-S3 AC3)',
    ).toBeVisible()
    await expect(page.locator("[data-state='cross-portal-reject']")).toContainText(
      "isn't part of CorpABC",
    )
    await expect(page.locator("[data-action='retry-login']")).toBeVisible()
    expect(
      pageErrors,
      'the 403 cross-portal rejection must be handled — never an uncaught error',
    ).toEqual([])
  })
})

test.describe('Portal shell/login — runtime console-clean gate (ui-runtime-validation)', () => {
  async function assertCleanConsole(page: Page, navigate: () => Promise<void>, presenceLocator: string) {
    const consoleErrors: string[] = []
    const failedRequests: string[] = []

    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', err => consoleErrors.push(`pageerror: ${String(err)}`))
    page.on('requestfailed', (req: Request) => {
      const url = req.url()
      if (url.includes('/api/v1/portal') || url.includes('/assets') || url.includes('/login')) {
        failedRequests.push(`${req.method()} ${url} :: ${req.failure()?.errorText ?? 'failed'}`)
      }
    })

    await navigate()
    await expect(page.locator(presenceLocator)).toBeVisible()

    expect(consoleErrors, `console errors:\n${consoleErrors.join('\n')}`).toEqual([])
    expect(failedRequests, `failed app requests:\n${failedRequests.join('\n')}`).toEqual([])
  }

  test('the rendered shell has a clean console (0 errors, 0 CSP/mixed-content, 0 failed app requests)', async ({
    page,
  }) => {
    await mockPortalContext(page, CORPABC_CONTEXT)
    await assertCleanConsole(page, () => gotoShell(page), "[data-region='topbar']")
  })

  test('the rendered login has a clean console (0 errors, 0 CSP/mixed-content, 0 failed app requests)', async ({
    page,
  }) => {
    await mockPortalContext(page, CORPABC_CONTEXT)
    await assertCleanConsole(page, () => gotoLogin(page), "[data-whitelabel='true']")
  })
})
