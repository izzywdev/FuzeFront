/**
 * PORTAL ADMIN CONSOLES — INDEPENDENT, PRE-PRODUCTION, RED-by-design UI e2e.
 * (frontend-test-engineer — independent verification, NOT the implementer.)
 *
 * ── What this file is ────────────────────────────────────────────────────────
 * TDD RED specs for the three flows declared in `design/frames/portal-admin-consoles/`:
 *   - master-admin-portals  (orchestrator MasterAdminPortalsFlow, route /admin/portals)
 *   - portal-console        (orchestrator PortalAdminConsoleFlow, route /portal/admin)
 *   - portal-billing        (orchestrator PortalBillingFlow, route /portal/admin/billing)
 *
 * Derived STRICTLY from the approved visual contract:
 *   design/frames/portal-admin-consoles/manifest.json     (build inventory + data-* hooks)
 *   01-portals-list.html    (a) Portals fleet
 *   02-create-portal.html   (b) Create portal
 *   03-portal-detail.html   (c) Portal detail
 *   04-master-states.html   (d) Master-admin states & fail-closed
 *   05-overview.html        (e) Portal overview
 *   06-users.html           (f) Portal-scoped users + invite
 *   07-catalog.html         (g) App catalog curation
 *   08-billing.html         (h) Billing (platform subscription + Connect + price book)
 *   09-portal-states.html   (i) Portal-admin states & fail-closed + Connect state machine
 *
 * and the epics named in the manifest: FF-EPIC-14 (the consoles themselves),
 * FF-EPIC-09 (portals), FF-EPIC-11 (portal-scoped identity/invitations),
 * FF-EPIC-12 (per-portal app catalog), FF-EPIC-15 (Stripe Connect reseller billing).
 *
 * NOTE ON FRAME-LEVEL APPROVAL: as of this spec's authoring, this manifest's
 * `manifest.approved` and each flow's `build.flows[].approved` are still `false`
 * (only `design/frames/white-label-portal/` has been approval-stamped so far).
 * The frames themselves are merged and frozen with their build inventory, and the
 * orchestrator's WAVE-1 instruction explicitly names all three flows here — these
 * specs are authored now so they are ready the moment each flow's approval lands,
 * exactly as they are ready the moment the UI lands. They do not change that gate;
 * `frontend-engineer` still waits on the per-flow approval before building.
 *
 * ── Why they are RED right now (READ THIS before "fixing" a failure) ─────────
 * None of `/admin/portals`, `/portal/admin`, `/portal/admin/users`,
 * `/portal/admin/catalog`, or `/portal/admin/billing` exist yet, and neither
 * `@fuzeone/portal-admin-ui` nor `@fuzeone/billing-ui`'s PortalBillingFlow is
 * built. Every test below is EXPECTED to fail today, and it must fail for the
 * RIGHT reason: the panel/table/dialog markers are ABSENT from the DOM — not a
 * harness/config error.
 *
 * They are deliberately NOT test.skip / test.fixme — hiding the RED would
 * defeat the entire point. They turn GREEN as frontend-engineer lands each
 * flow's route + components against this contract.
 *
 * Selectors are ONLY the data-* hooks the frames/manifest declare
 * (manifest.frames[].testHooks) — never a fixture id borrowed from the design
 * mockup's sample data (e.g. "prt_northwind"). Where a scenario needs specific
 * data (e.g. a suspended row, a slug conflict), this spec intercepts the
 * ANTICIPATED contract endpoints named in the manifest (`@fuzeone/portal-client`
 * — not frozen yet, FF-EPIC-09-S3) with its own controlled fixtures, so the
 * assertions exercise the CONTRACT the frame declares independent of real seed
 * data. The REAL, frozen endpoints this build also consumes
 * (`@fuzeone/security-client`, `@fuzeone/app-registry-client`,
 * `@fuzeone/billing-client`) are intercepted the same way for determinism.
 *
 * Run (pre-prod, against a built UI on the ephemeral stack / dev host):
 *   BASE_URL=http://fuzefront.dev.local npx playwright test tests/portal-admin-consoles.red
 * Config: frontend/playwright.config.ts (chromium + mobile projects).
 */
import { test, expect, type Page, type ConsoleMessage, type Request } from '@playwright/test'

const PORTALS_LIST_ROUTE = '**/api/v1/admin/portals'
const PORTAL_DETAIL_ROUTE = /\/api\/v1\/admin\/portals\/[^/]+$/
const PORTAL_CURRENT_ROUTE = '**/api/v1/portal/current'
const MEMBERS_ROUTE = /\/v1\/security\/tenants\/[^/]+\/members/
const APPS_ROUTE = '**/apps'
const PORTAL_CATALOG_ROUTE = '**/api/v1/portal/catalog'
const INVITATIONS_ROUTE = '**/api/v1/portal/invitations'
const CONNECT_STATUS_ROUTE = '**/api/v1/portal/connect/status'
const BILLING_SUBSCRIPTION_ROUTE = /\/api\/v1\/billing\/subscriptions\/.+/
const PRICE_BOOK_ROUTE = '**/api/v1/portal/price-book'

async function json(route: import('@playwright/test').Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function gotoPortalsList(page: Page) {
  await page.goto('/admin/portals', { waitUntil: 'domcontentloaded' })
}

async function gotoPortalDetail(page: Page, portalId = 'prt_test') {
  await page.goto(`/admin/portals/${portalId}`, { waitUntil: 'domcontentloaded' })
}

async function gotoPortalConsole(page: Page) {
  await page.goto('/portal/admin', { waitUntil: 'domcontentloaded' })
}

async function gotoUsers(page: Page) {
  await page.goto('/portal/admin/users', { waitUntil: 'domcontentloaded' })
}

async function gotoCatalog(page: Page) {
  await page.goto('/portal/admin/catalog', { waitUntil: 'domcontentloaded' })
}

async function gotoBilling(page: Page) {
  await page.goto('/portal/admin/billing', { waitUntil: 'domcontentloaded' })
}

// ─────────────────────────────────────────────────────────────────────────────
// (a) Master-admin — Portals list (01-portals-list, route /admin/portals)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Master-admin — Portals list (frame 01-portals-list)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(PORTALS_LIST_ROUTE, route =>
      json(route, {
        portals: [
          { portalId: 'prt_root', slug: 'fuzefront', name: 'FuzeFront', status: 'active', root: true, primaryDomain: 'app.fuzefront.com', plan: 'scale' },
          { portalId: 'prt_test', slug: 'test-tenant', name: 'Test Tenant', status: 'active', root: false, primaryDomain: 'portal.test-tenant.example', plan: 'pro' },
          { portalId: 'prt_suspended', slug: 'suspended-tenant', name: 'Suspended Tenant', status: 'suspended', root: false, primaryDomain: 'portal.suspended-tenant.example', plan: 'pro' },
        ],
        cursor: null,
      }),
    )
  })

  test('renders the fleet table with a create-portal action', async ({ page }) => {
    await gotoPortalsList(page)

    await expect(
      page.locator("[data-panel='portals-list']"),
      'MasterAdminPortalsFlow must mount [data-panel="portals-list"] at /admin/portals',
    ).toBeVisible()
    await expect(page.locator("[data-action='create-portal']").first()).toBeVisible()
  })

  test('each portal row exposes its status + lifecycle actions via data hooks', async ({
    page,
  }) => {
    await gotoPortalsList(page)

    const activeRow = page.locator('[data-portal-status="active"]').first()
    await expect(activeRow, 'active rows must render [data-portal-status="active"]').toBeVisible()

    const suspendedRow = page.locator('[data-portal-status="suspended"]').first()
    await expect(
      suspendedRow,
      'a suspended portal must render [data-portal-status="suspended"] and offer resume',
    ).toBeVisible()
    await expect(page.locator("[data-action='resume-portal']").first()).toBeVisible()
    await expect(page.locator("[data-action='suspend-portal']").first()).toBeVisible()
  })

  test('the root portal cannot be suspended from this row (client pre-disable guard)', async ({
    page,
  }) => {
    await gotoPortalsList(page)

    const rootRow = page.locator('[data-portal="prt_root"], [data-root="true"]').first()
    await expect(rootRow).toBeVisible()
    const suspendOnRoot = rootRow.locator("[data-action='suspend-portal']")
    await expect(
      suspendOnRoot,
      'the root-portal row Suspend control must be disabled — a self-inflicted fleet-outage guard',
    ).toBeDisabled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// (b) Master-admin — Create portal (02-create-portal, route /admin/portals/new)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Master-admin — Create portal (frame 02-create-portal)', () => {
  test('the create-portal form captures name, slug, owner email, and plan/billing mode', async ({
    page,
  }) => {
    await page.goto('/admin/portals/new', { waitUntil: 'domcontentloaded' })

    await expect(page.locator("[data-panel='create-portal']")).toBeVisible()
    await expect(page.locator("[data-input='name']")).toBeVisible()
    await expect(page.locator("[data-input='slug']")).toBeVisible()
    await expect(page.locator("[data-input='owner-email']")).toBeVisible()
    await expect(
      page.locator("[data-plan-option='reseller']"),
      'the reseller/Connect plan option is the switch that unlocks the billing console',
    ).toBeVisible()
    await expect(page.locator("[data-action='submit-create-portal']")).toBeVisible()
  })

  test('submitting POSTs PortalCreate and the new portal starts pending-invite', async ({
    page,
  }) => {
    let createBody: unknown = null
    await page.route(PORTALS_LIST_ROUTE, route => {
      if (route.request().method() === 'POST') {
        createBody = route.request().postDataJSON()
        return json(
          route,
          { portalId: 'prt_new', slug: 'new-tenant', status: 'provisioned-pending-invite' },
          201,
        )
      }
      return route.continue()
    })

    await page.goto('/admin/portals/new', { waitUntil: 'domcontentloaded' })
    await page.locator("[data-input='name']").fill('New Tenant')
    await page.locator("[data-input='slug']").fill('new-tenant')
    await page.locator("[data-input='owner-email']").fill('owner@new-tenant.example')
    await page.locator("[data-action='submit-create-portal']").click()

    await expect
      .poll(() => createBody, { message: 'POST /api/v1/admin/portals must fire with the form body' })
      .not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// (c) Master-admin — Portal detail (03-portal-detail, route /admin/portals/{id})
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Master-admin — Portal detail (frame 03-portal-detail)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(PORTAL_DETAIL_ROUTE, route =>
      json(route, {
        portalId: 'prt_test',
        name: 'Test Tenant',
        slug: 'test-tenant',
        status: 'active',
        plan: 'pro',
        stats: { users: 18, apps: 6, domains: 2 },
        domains: [
          { domain: 'portal.test-tenant.example', kind: 'custom', status: 'verified' },
          { domain: 'test-tenant.fuzefront.com', kind: 'subdomain', status: 'verified' },
        ],
      }),
    )
  })

  test('renders stat cards, branding summary, and read-only domain status', async ({ page }) => {
    await gotoPortalDetail(page)

    await expect(page.locator("[data-panel='portal-stats']")).toBeVisible()
    await expect(page.locator("[data-stat='users']")).toBeVisible()
    await expect(page.locator("[data-panel='branding-summary']")).toBeVisible()
    await expect(page.locator("[data-panel='domain-status']")).toBeVisible()
    await expect(page.locator('[data-domain-status="verified"]').first()).toBeVisible()
  })

  test('offers the suspend-portal action for a non-root portal', async ({ page }) => {
    await gotoPortalDetail(page)
    await expect(page.locator("[data-action='suspend-portal']")).toBeVisible()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// (d) Master-admin — states & fail-closed (04-master-states, route /admin/portals)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Master-admin — states & fail-closed (frame 04-master-states)', () => {
  test('loading skeleton renders while the fleet list is in flight', async ({ page }) => {
    await page.route(PORTALS_LIST_ROUTE, async route => {
      await new Promise(resolve => setTimeout(resolve, 300))
      await json(route, { portals: [], cursor: null })
    })
    await gotoPortalsList(page)

    await expect(page.locator("[data-state='loading']")).toBeVisible()
  })

  test('fresh-install empty state shows only the seeded root portal', async ({ page }) => {
    await page.route(PORTALS_LIST_ROUTE, route =>
      json(route, {
        portals: [{ portalId: 'prt_root', slug: 'fuzefront', name: 'FuzeFront', status: 'active', root: true }],
        cursor: null,
      }),
    )
    await gotoPortalsList(page)

    await expect(
      page.locator("[data-state='empty']"),
      'a fresh install has only the seeded root portal — this is a REAL empty state, not a loading artifact',
    ).toBeVisible()
    await expect(page.locator("[data-action='create-portal']").first()).toBeVisible()
  })

  test('a load failure shows the error banner with retry', async ({ page }) => {
    await page.route(PORTALS_LIST_ROUTE, route => json(route, { error: 'boom' }, 500))
    await gotoPortalsList(page)

    await expect(page.locator("[data-state='error']")).toBeVisible()
    await expect(page.locator("[data-action='retry']")).toBeVisible()
  })

  test('suspending the root portal is refused: 409 ROOT_PORTAL_PROTECTED', async ({ page }) => {
    await page.route(PORTALS_LIST_ROUTE, route =>
      json(route, {
        portals: [{ portalId: 'prt_root', slug: 'fuzefront', name: 'FuzeFront', status: 'active', root: true }],
        cursor: null,
      }),
    )
    await page.route(PORTAL_DETAIL_ROUTE, route => {
      if (route.request().method() === 'PATCH') {
        return json(route, { code: 'ROOT_PORTAL_PROTECTED', message: 'the root portal cannot be suspended' }, 409)
      }
      return route.continue()
    })

    const pageErrors: string[] = []
    page.on('pageerror', err => pageErrors.push(String(err)))

    await gotoPortalsList(page)
    const rootRow = page.locator('[data-portal="prt_root"], [data-root="true"]').first()
    // The client pre-disables the control; the server 409 is the actual guarantee
    // even if a stale client tried to submit it directly.
    await expect(rootRow.locator("[data-action='suspend-portal']")).toBeDisabled()
    expect(pageErrors).toEqual([])
  })

  test('creating a portal with a taken slug renders 409 SLUG_TAKEN inline (never a toast that loses the form)', async ({
    page,
  }) => {
    await page.route(PORTALS_LIST_ROUTE, route => {
      if (route.request().method() === 'POST') {
        return json(route, { code: 'SLUG_TAKEN', message: 'that slug is already in use' }, 409)
      }
      return route.continue()
    })

    await page.goto('/admin/portals/new', { waitUntil: 'domcontentloaded' })
    await page.locator("[data-input='name']").fill('Duplicate')
    await page.locator("[data-input='slug']").fill('test-tenant')
    await page.locator("[data-input='owner-email']").fill('owner@duplicate.example')
    await page.locator("[data-action='submit-create-portal']").click()

    await expect(page.locator("[data-error-code='SLUG_TAKEN']")).toBeVisible()
    // The form must still be present/filled — never a toast that loses the input.
    await expect(page.locator("[data-input='slug']")).toHaveValue('test-tenant')
  })

  test('a non-platform-admin gets a 403 shown in place — NEVER a sign-in redirect', async ({
    page,
  }) => {
    await page.route(PORTALS_LIST_ROUTE, route => json(route, { code: 'FORBIDDEN', message: 'platform admins only' }, 403))
    await gotoPortalsList(page)

    await expect(
      page.locator("[data-state='forbidden']"),
      'a 403 is an AUTHORIZATION denial (Permit ReBAC, platform-admin only) — rendered in place',
    ).toBeVisible()
    await expect(page.locator("[data-error-code='FORBIDDEN']")).toBeVisible()
    // The rule: never bounced to a login screen for a 403 (only a 401 re-authenticates).
    await expect(page).toHaveURL(/\/admin\/portals/)
    expect(page.url()).not.toContain('/login')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// (e) Portal-admin — Overview (05-overview, route /portal/admin)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Portal-admin — Overview (frame 05-overview)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(PORTAL_CURRENT_ROUTE, route =>
      json(route, {
        portalId: 'prt_test',
        name: 'Test Tenant',
        status: 'active',
        primaryDomain: 'portal.test-tenant.example',
        owner: 'owner@test-tenant.example',
      }),
    )
    await page.route(MEMBERS_ROUTE, route => json(route, { members: [], cursor: null }))
    await page.route(PORTAL_CATALOG_ROUTE, route => json(route, { apps: [] }))
    await page.route(CONNECT_STATUS_ROUTE, route => json(route, { status: 'active', chargesEnabled: true, payoutsEnabled: true }))
  })

  test('renders the tabbed console shell with Overview/Users/Catalog/Billing', async ({
    page,
  }) => {
    await gotoPortalConsole(page)

    await expect(page.locator("[data-panel='portal-tabs']")).toBeVisible()
    for (const tab of ['overview', 'users', 'catalog', 'billing']) {
      await expect(page.locator(`[data-tab='${tab}']`)).toBeVisible()
    }
  })

  test('renders portal-scoped overview stat cards', async ({ page }) => {
    await gotoPortalConsole(page)

    await expect(page.locator("[data-panel='overview-stats']")).toBeVisible()
    await expect(page.locator("[data-stat='users']")).toBeVisible()
  })

  test('the portal identity is resolved from the session, never a client-supplied portalId', async ({
    page,
  }) => {
    let requestedUrl = ''
    await page.route(PORTAL_CURRENT_ROUTE, route => {
      requestedUrl = route.request().url()
      return json(route, { portalId: 'prt_test', name: 'Test Tenant', status: 'active' })
    })
    await gotoPortalConsole(page)

    await expect(page.locator("[data-panel='overview-domain']")).toBeVisible()
    expect(
      requestedUrl,
      'GET /api/v1/portal/current must never carry a portalId query/path param — scoping is session-derived',
    ).not.toMatch(/portalId=/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// (f) Portal-admin — Users (06-users, route /portal/admin/users)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Portal-admin — Users (frame 06-users)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(MEMBERS_ROUTE, route =>
      json(route, {
        members: [
          { userId: 'u_self', email: 'me@test-tenant.example', role: 'portal-admin', status: 'active', self: true },
          { userId: 'u_member', email: 'member@test-tenant.example', role: 'member', status: 'active' },
          { userId: 'u_invited', email: 'invited@test-tenant.example', role: 'member', status: 'invited' },
        ],
        cursor: null,
      }),
    )
  })

  test('renders the portal-scoped members table with an invite action', async ({ page }) => {
    await gotoUsers(page)

    await expect(page.locator("[data-panel='portal-users']")).toBeVisible()
    await expect(page.locator("[data-action='invite-user']").first()).toBeVisible()
    await expect(page.locator('[data-role-pill]').first()).toBeVisible()
    await expect(page.locator('[data-user-status="invited"]').first()).toBeVisible()
  })

  test('you cannot change your own role (self-lockout guard)', async ({ page }) => {
    await gotoUsers(page)

    const selfRow = page.locator('[data-user="u_self"], [data-self="true"]').first()
    await expect(selfRow).toBeVisible()
    await expect(selfRow.locator("[data-action='change-role']")).toBeDisabled()
  })

  test('the invite dialog captures email + role and POSTs the portal-scoped invitation', async ({
    page,
  }) => {
    let inviteBody: unknown = null
    await page.route(INVITATIONS_ROUTE, route => {
      if (route.request().method() === 'POST') {
        inviteBody = route.request().postDataJSON()
        return json(route, { invitationId: 'inv_1', status: 'pending' }, 201)
      }
      return route.continue()
    })

    await gotoUsers(page)
    await page.locator("[data-action='invite-user']").first().click()
    await expect(page.locator("[data-panel='invite-user']")).toBeVisible()
    await page.locator("[data-input='email']").fill('teammate@test-tenant.example')
    await page.locator("[data-role-option='member']").click()
    await page.locator("[data-action='submit-invite']").click()

    await expect
      .poll(() => inviteBody, { message: 'POST /api/v1/portal/invitations must fire with { email, role }' })
      .not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// (g) Portal-admin — App catalog (07-catalog, route /portal/admin/catalog)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Portal-admin — App catalog (frame 07-catalog)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(PORTAL_CATALOG_ROUTE, route =>
      json(route, {
        enabled: [
          { appId: 'crm', name: 'CRM', enabled: true, order: 1 },
          { appId: 'docs', name: 'Docs', enabled: true, order: 2 },
        ],
      }),
    )
    await page.route(APPS_ROUTE, route =>
      json(route, { apps: [{ slug: 'helpdesk', name: 'Helpdesk', menuLabel: 'Helpdesk', integration: 'module-federation', icon: '🎧' }] }),
    )
  })

  test('renders the enabled-apps list with reorder controls and an add-app action', async ({
    page,
  }) => {
    await gotoCatalog(page)

    await expect(page.locator("[data-panel='catalog-enabled']")).toBeVisible()
    await expect(page.locator("[data-list='enabled-apps']")).toBeVisible()
    await expect(page.locator("[data-action='add-app']").first()).toBeVisible()
    await expect(page.locator("[data-action='move-up']").first()).toBeVisible()
    await expect(page.locator("[data-action='move-down']").first()).toBeVisible()
  })

  test('enabling an app from the catalog PUTs the per-portal enablement', async ({ page }) => {
    let enableBody: unknown = null
    await page.route(/\/api\/v1\/portal\/catalog\/.+/, route => {
      if (route.request().method() === 'PUT') {
        enableBody = route.request().postDataJSON()
        return json(route, { appId: 'helpdesk', enabled: true })
      }
      return route.continue()
    })

    await gotoCatalog(page)
    await page.locator("[data-action='add-app']").first().click()
    await expect(page.locator("[data-panel='add-app']")).toBeVisible()
    await page.locator("[data-action='enable-app']").first().click()

    await expect
      .poll(() => enableBody, { message: 'PUT /api/v1/portal/catalog/{appId} must fire with { enabled: true }' })
      .not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// (h) Portal-admin — Billing (08-billing, route /portal/admin/billing)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Portal-admin — Billing (frame 08-billing)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(CONNECT_STATUS_ROUTE, route =>
      json(route, { status: 'active', chargesEnabled: true, payoutsEnabled: true, steps: ['account', 'details', 'charges'] }),
    )
    await page.route(PRICE_BOOK_ROUTE, route =>
      json(route, { prices: [{ priceId: 'price_starter', plan: 'Starter', amount: 2900, status: 'active' }] }),
    )
    await page.route(BILLING_SUBSCRIPTION_ROUTE, route =>
      json(route, { subscriptionId: 'sub_1', status: 'active', plan: 'pro', renewsAt: '2026-08-01' }),
    )
  })

  test('renders Connect onboarding status, the price book, and the platform subscription', async ({
    page,
  }) => {
    await gotoBilling(page)

    await expect(page.locator("[data-panel='connect-status']")).toBeVisible()
    await expect(page.locator('[data-connect-status="active"]').first()).toBeVisible()
    await expect(page.locator("[data-panel='price-book']")).toBeVisible()
    await expect(page.locator("[data-panel='platform-subscription']")).toBeVisible()
    await expect(page.locator('[data-subscription-status="active"]')).toBeVisible()
  })

  test('no vendor secret is ever rendered on the billing console', async ({ page }) => {
    await gotoBilling(page)
    await expect(page.locator("[data-panel='connect-status']")).toBeVisible()
    const bodyText = await page.locator('body').innerText()
    expect(bodyText).not.toMatch(/sk_(live|test)_/)
    expect(bodyText).not.toMatch(/whsec_/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// (i) Portal-admin — states, fail-closed, and the Connect state machine (09-portal-states)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Portal-admin — states & fail-closed (frame 09-portal-states)', () => {
  test('users loading skeleton renders while the member list is in flight', async ({ page }) => {
    await page.route(MEMBERS_ROUTE, async route => {
      await new Promise(resolve => setTimeout(resolve, 300))
      await json(route, { members: [], cursor: null })
    })
    await gotoUsers(page)
    await expect(page.locator("[data-state='loading']")).toBeVisible()
  })

  test('a newly-provisioned portal shows the real "just you" empty state for users', async ({
    page,
  }) => {
    await page.route(MEMBERS_ROUTE, route =>
      json(route, { members: [{ userId: 'u_self', email: 'me@test-tenant.example', role: 'portal-admin', self: true }], cursor: null }),
    )
    await gotoUsers(page)
    await expect(page.locator("[data-state='empty']")).toBeVisible()
    await expect(page.locator("[data-action='invite-user']").first()).toBeVisible()
  })

  test('an empty catalog shows the real "no apps yet" empty state', async ({ page }) => {
    await page.route(PORTAL_CATALOG_ROUTE, route => json(route, { enabled: [] }))
    await gotoCatalog(page)
    await expect(page.locator("[data-state='empty']")).toBeVisible()
    await expect(page.locator("[data-action='add-app']").first()).toBeVisible()
  })

  test('a non-2xx load shows the generic error banner with retry', async ({ page }) => {
    await page.route(MEMBERS_ROUTE, route => json(route, { error: 'boom' }, 500))
    await gotoUsers(page)
    await expect(page.locator("[data-state='error']")).toBeVisible()
    await expect(page.locator("[data-action='retry']")).toBeVisible()
  })

  test('a suspended portal fails closed for the WHOLE console — 403, shown in place, never a redirect', async ({
    page,
  }) => {
    await page.route(PORTAL_CURRENT_ROUTE, route => json(route, { code: 'PORTAL_SUSPENDED', message: 'this portal is suspended' }, 403))
    await page.route(MEMBERS_ROUTE, route => json(route, { code: 'PORTAL_SUSPENDED' }, 403))

    await gotoPortalConsole(page)

    await expect(
      page.locator("[data-state='suspended']"),
      'a suspended portal must render [data-state="suspended"] for the whole console — never a login bounce',
    ).toBeVisible()
    await expect(page.locator("[data-error-code='PORTAL_SUSPENDED']")).toBeVisible()
    expect(page.url()).not.toContain('/login')
  })

  test('inviting into a portal you do not administer is denied 403 FORBIDDEN_PORTAL — zero cross-tenant leak', async ({
    page,
  }) => {
    await page.route(INVITATIONS_ROUTE, route => {
      if (route.request().method() === 'POST') {
        return json(route, { code: 'FORBIDDEN_PORTAL', message: "you don't administer this portal" }, 403)
      }
      return route.continue()
    })

    const pageErrors: string[] = []
    page.on('pageerror', err => pageErrors.push(String(err)))

    await gotoUsers(page)
    await page.locator("[data-action='invite-user']").first().click()
    await page.locator("[data-input='email']").fill('someone@other-portal.example')
    await page.locator("[data-action='submit-invite']").click()

    await expect(page.locator("[data-error-code='FORBIDDEN_PORTAL']")).toBeVisible()
    const bodyText = await page.locator('body').innerText()
    expect(bodyText, 'no data from another tenant may leak into this denial').not.toContain('other-portal')
    expect(pageErrors).toEqual([])
  })

  test('Connect not-started shows the onboarding entry CTA', async ({ page }) => {
    await page.route(CONNECT_STATUS_ROUTE, route => json(route, { status: 'not-started', chargesEnabled: false, payoutsEnabled: false }))
    await gotoBilling(page)
    await expect(page.locator('[data-connect-status="not-started"]')).toBeVisible()
    await expect(page.locator("[data-action='start-connect-onboarding']")).toBeVisible()
  })

  test('Connect in-progress is NEVER rendered as active (no false "active" — a money bug)', async ({
    page,
  }) => {
    await page.route(CONNECT_STATUS_ROUTE, route => json(route, { status: 'in-progress', chargesEnabled: false, payoutsEnabled: false }))
    await gotoBilling(page)
    await expect(page.locator('[data-connect-status="in-progress"]')).toBeVisible()
    await expect(page.locator('[data-connect-status="active"]')).toHaveCount(0)
  })

  test('Connect restricted shows an actionable re-onboarding banner, never a blank panel', async ({
    page,
  }) => {
    await page.route(CONNECT_STATUS_ROUTE, route => json(route, { status: 'restricted', chargesEnabled: false, payoutsEnabled: false }))
    await gotoBilling(page)
    await expect(page.locator('[data-connect-status="restricted"]')).toBeVisible()
    await expect(page.locator("[data-error-code='CONNECT_RESTRICTED']")).toBeVisible()
    await expect(page.locator("[data-action='reonboard-connect']")).toBeVisible()
  })

  test('adding a price is fail-closed while charges are not enabled: CHARGES_NOT_ENABLED', async ({
    page,
  }) => {
    await page.route(CONNECT_STATUS_ROUTE, route => json(route, { status: 'in-progress', chargesEnabled: false, payoutsEnabled: false }))
    await gotoBilling(page)

    await page.locator("[data-action='add-price']").click()
    await expect(page.locator("[data-panel='add-price']")).toBeVisible()
    await expect(page.locator("[data-error-code='CHARGES_NOT_ENABLED']")).toBeVisible()
    await expect(page.locator("[data-action='submit-price']")).toBeDisabled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Runtime console-clean gate (ui-runtime-validation) — one per route family
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Portal admin consoles — runtime console-clean gate (ui-runtime-validation)', () => {
  async function assertCleanConsole(page: Page, navigate: () => Promise<void>, presenceLocator: string) {
    const consoleErrors: string[] = []
    const failedRequests: string[] = []

    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', err => consoleErrors.push(`pageerror: ${String(err)}`))
    page.on('requestfailed', (req: Request) => {
      const url = req.url()
      if (url.includes('/api/v1/admin/portals') || url.includes('/api/v1/portal') || url.includes('/v1/security') || url.includes('/assets')) {
        failedRequests.push(`${req.method()} ${url} :: ${req.failure()?.errorText ?? 'failed'}`)
      }
    })

    await navigate()
    await expect(page.locator(presenceLocator)).toBeVisible()

    expect(consoleErrors, `console errors:\n${consoleErrors.join('\n')}`).toEqual([])
    expect(failedRequests, `failed app requests:\n${failedRequests.join('\n')}`).toEqual([])
  }

  test('master-admin portals list has a clean console', async ({ page }) => {
    await page.route(PORTALS_LIST_ROUTE, route => json(route, { portals: [], cursor: null }))
    await assertCleanConsole(page, () => gotoPortalsList(page), "[data-panel='portals-list']")
  })

  test('portal-admin overview has a clean console', async ({ page }) => {
    await page.route(PORTAL_CURRENT_ROUTE, route => json(route, { portalId: 'prt_test', name: 'Test Tenant', status: 'active' }))
    await page.route(MEMBERS_ROUTE, route => json(route, { members: [], cursor: null }))
    await page.route(PORTAL_CATALOG_ROUTE, route => json(route, { enabled: [] }))
    await page.route(CONNECT_STATUS_ROUTE, route => json(route, { status: 'active', chargesEnabled: true, payoutsEnabled: true }))
    await assertCleanConsole(page, () => gotoPortalConsole(page), "[data-panel='portal-tabs']")
  })

  test('portal-admin billing has a clean console', async ({ page }) => {
    await page.route(CONNECT_STATUS_ROUTE, route => json(route, { status: 'active', chargesEnabled: true, payoutsEnabled: true }))
    await page.route(PRICE_BOOK_ROUTE, route => json(route, { prices: [] }))
    await page.route(BILLING_SUBSCRIPTION_ROUTE, route => json(route, { subscriptionId: 'sub_1', status: 'active', plan: 'pro' }))
    await assertCleanConsole(page, () => gotoBilling(page), "[data-panel='connect-status']")
  })
})
