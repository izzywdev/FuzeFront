import { test, expect, type Page } from '@playwright/test'

/**
 * PRE-PROD register → activate → load (acceptance criterion #1), against the
 * REAL built React shell.
 *
 * Flow verified through the actual UI (ApplicationsPage / AddApplicationPage /
 * AppSelector / SidePanel / App routes), driven by the manifest:
 *
 *   1. Open the application menu — the "Add application" CTA is present.
 *   2. Use the Add-application flow to register a "FuzeMarket" manifest whose
 *      menuLabel is "Market", then "Register & activate".
 *   3. The success card confirms it is activated and "appears in the menu as
 *      Market".
 *   4. Back on the menu, the activated app appears as "Market" (launcher card +
 *      side-nav Apps item + the 9-dots launcher).
 *   5. Loading it navigates to its portal mount /app/<slug>.
 *
 * DETERMINISM: the full live stack (Postgres + backend + Authentik + Permit +
 * a real Module-Federation remote) is not runnable in this sandbox, so this
 * spec MOCKS the contract surface via Playwright request interception:
 *   - auth   (/api/v1/security/session) → an authenticated admin
 *   - orgs   (/api/organizations)      → a personal org (opens the provisioning gate)
 *   - registry (/api/v1/app-registry/*)→ stateful list/register/activate
 *
 * Each assertion is tagged [MOCKED] (deterministic here) or [LIVE-ONLY]
 * (requires the real stack — exercised by the E2E workflow / post-prod smoke).
 *
 * The registry mock is the FROZEN #107 contract surface
 * (`apps-client/src/client.ts`): GET /apps, POST /apps, POST /apps/{slug}/activate,
 * GET /apps/{slug}. The same-origin base is `/api/v1/app-registry`
 * (`frontend/src/platform/appRegistry.tsx`).
 */

const SLUG = 'market'
const MENU_LABEL = 'Market'

// --- FuzeMarket manifest fixture (menuLabel "Market"), matching the frozen
//     AppManifest shape and the seed example `market` manifest. ---
const marketManifest = {
  manifestVersion: '1',
  slug: SLUG,
  name: 'Market',
  menuLabel: MENU_LABEL,
  description: 'A federated marketplace app mounted in the portal shell.',
  icon: { kind: 'emoji', value: '🛒' },
  mode: 'portal',
  builtin: false,
  integration: {
    type: 'module-federation',
    remoteEntry: 'https://market.example.com/remoteEntry.js',
    scope: 'marketApp',
    module: './MarketApp',
  },
  chrome: { menu: 'host', topbar: 'host' },
  visibility: 'organization',
  roles: [],
}

function activatedApp(): Record<string, unknown> {
  const now = new Date().toISOString()
  return {
    slug: SLUG,
    status: 'activated',
    mode: 'portal',
    builtin: false,
    organizationId: '00000000-0000-0000-0000-000000000001',
    manifest: marketManifest,
    isHealthy: true,
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Install the deterministic auth + org + registry mocks. The registry mock is
 * STATEFUL: the app is absent from the activated list until it is registered
 * AND activated, exactly like the real lifecycle.
 */
async function installMocks(page: Page) {
  // Authenticated as a provisioned admin. The shell resolves "me" from the
  // provider-agnostic Security API (GET /api/v1/security/session), not the
  // deprecated /api/auth/user shim.
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

  // Personal org so WorkspaceProvisioningGate opens immediately (ready).
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

  // --- Stateful app-registry contract mock ---------------------------------
  let registered = false
  let active = false

  await page.route('**/api/v1/app-registry/**', async route => {
    const req = route.request()
    const method = req.method()
    const url = new URL(req.url())
    const p = url.pathname

    const json = (status: number, body: unknown) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
      })

    // GET /apps?status=activated  → only activated apps are visible in the menu.
    if (method === 'GET' && p.endsWith('/app-registry/apps')) {
      const status = url.searchParams.get('status')
      const apps =
        active && (status === 'activated' || status == null) ? [activatedApp()] : []
      return json(200, { apps, nextCursor: null })
    }

    // POST /apps  → register (status = registered, NOT yet visible).
    if (method === 'POST' && p.endsWith('/app-registry/apps')) {
      registered = true
      return json(201, {
        ...activatedApp(),
        status: 'registered',
        isHealthy: null,
        lastSeenAt: null,
      })
    }

    // POST /apps/{slug}/activate  → activate (now visible in the menu).
    if (method === 'POST' && p.endsWith(`/app-registry/apps/${SLUG}/activate`)) {
      if (!registered) return json(409, { error: 'not registered' })
      active = true
      return json(200, activatedApp())
    }

    // GET /apps/{slug}
    if (method === 'GET' && p.endsWith(`/app-registry/apps/${SLUG}`)) {
      if (!active) return json(404, { error: 'not found' })
      return json(200, activatedApp())
    }

    return json(404, { error: `unmocked registry route: ${method} ${p}` })
  })
}

/** Seed an auth token so the shell renders authenticated. */
async function seedAuth(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('authToken', 'e2e-mock-token')
    // Pre-confirm the workspace so the provisioning gate opens without flashing
    // (READY_SESSION_KEY in WorkspaceProvisioningGate). The mocked /api/organizations
    // returning a personal org would open the gate anyway; this avoids the flash.
    sessionStorage.setItem('ff.workspaceReady', '1')
  })
}

test.describe('register → activate → load (mocked contract surface)', () => {
  test.beforeEach(async ({ page }) => {
    await seedAuth(page)
    await installMocks(page)
  })

  test('registers a FuzeMarket manifest, activates it, and it appears as "Market" then loads', async ({
    page,
  }) => {
    // [MOCKED] Authenticated shell loads at the application menu.
    await page.goto('/applications')

    // The menu page renders, with the "Add application" CTA (frame 01).
    await expect(page.getByRole('heading', { name: 'Applications' })).toBeVisible()
    const addCta = page.getByRole('button', { name: /Add application/i })
    await expect(addCta).toBeVisible()

    // Initially the activated list is empty → no "Market" yet.
    await expect(page.getByRole('heading', { name: MENU_LABEL })).toHaveCount(0)

    // [MOCKED] Open the Add-application flow.
    await addCta.click()
    await expect(page).toHaveURL(/\/applications\/new$/)
    await expect(page.getByRole('heading', { name: 'Add application' })).toBeVisible()

    // [MOCKED] Fill the FuzeMarket manifest (menuLabel "Market").
    await page.getByLabel('Slug *').fill(SLUG)
    await page.getByLabel('Menu label *').fill(MENU_LABEL)
    await page.getByLabel('Display name *').fill('Market')
    await page.getByLabel('Icon (emoji)').fill('🛒')
    await page
      .getByLabel('Remote entry URL *')
      .fill('https://market.example.com/remoteEntry.js')
    await page.getByLabel('Scope *').fill('marketApp')
    await page.getByLabel('Module *').fill('./MarketApp')

    // The live preview shows the same-origin POST endpoint (frame 02).
    await expect(page.getByText('POST /api/v1/app-registry/apps')).toBeVisible()

    // [MOCKED] Register & activate — drives POST /apps then POST /apps/market/activate.
    const registerResp = page.waitForResponse(
      r =>
        r.url().endsWith('/api/v1/app-registry/apps') &&
        r.request().method() === 'POST'
    )
    const activateResp = page.waitForResponse(
      r =>
        r.url().endsWith(`/api/v1/app-registry/apps/${SLUG}/activate`) &&
        r.request().method() === 'POST'
    )
    await page.getByRole('button', { name: /Register & activate/i }).click()
    expect((await registerResp).status()).toBe(201)
    expect((await activateResp).status()).toBe(200)

    // [MOCKED] Success card confirms it is activated and appears as "Market".
    await expect(page.getByText(`${MENU_LABEL} is now activated`)).toBeVisible()
    await expect(page.getByText('It now appears in the application menu as')).toBeVisible()

    // [MOCKED] Back on the application menu, "Market" is now an activated card.
    await page.getByRole('button', { name: 'Back to applications' }).click()
    await expect(page).toHaveURL(/\/applications$/)
    // Scope to the main content launcher card (avoid matching the top-bar
    // launcher panel, which renders the same name in another heading).
    const marketCard = page
      .locator('.main-content, main')
      .getByRole('heading', { name: MENU_LABEL })
      .first()
    await expect(marketCard).toBeVisible()

    // [MOCKED] It also appears in the side-nav "Apps" section.
    await expect(
      page.locator('.side-panel .menu-section').getByText(MENU_LABEL, { exact: true })
    ).toBeVisible()

    // [MOCKED] And in the 9-dots top-bar launcher.
    await page.locator('button.app-grid-button').click()
    await expect(page.getByText(MENU_LABEL, { exact: true }).first()).toBeVisible()
    // Close the launcher by clicking its transparent backdrop (no Esc handler).
    await page.mouse.click(2, 2)

    // [MOCKED] Loading it navigates to the portal mount /app/<slug>.
    //
    // [LIVE-ONLY] The actual Module-Federation remote MOUNTING inside the host
    // (loadFederatedAppFromManifest → real remoteEntry.js) needs the live stack
    // + a served remote; it is verified by `tests/clock-load.spec.ts` (E2E
    // workflow) and the post-prod smoke. Here we only assert the route/launch.
    await marketCard.click()
    await expect(page).toHaveURL(new RegExp(`/app/${SLUG}$`))
  })
})
