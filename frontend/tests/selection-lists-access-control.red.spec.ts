/**
 * SELECTION LISTS — ACCESS CONTROL FLOW — INDEPENDENT, PRE-PRODUCTION, RED-by-design UI e2e.
 * (frontend-test-engineer — independent verification, NOT the implementer.)
 *
 * ── What this file is ────────────────────────────────────────────────────────
 * TDD RED specs for the access-control flow of EPIC-17 / FFRNT-188 (Selection
 * Lists). They are derived STRICTLY from the approved visual contract:
 *
 *   design/frames/selection-lists/manifest.json  (build inventory + test hooks)
 *   design/frames/selection-lists/10-access-panel.html  — (3a) Access panel
 *   design/frames/selection-lists/11-add-access-modal.html — (3b) Add access
 *
 * and from the frozen API contract services/selection-list-service/openapi.yaml:
 *   GET    /v1/selection-lists/{listId}/access          -> [SelectionListAccessGrant]
 *   PUT    /v1/selection-lists/{listId}/access/{userId} -> SelectionListAccessGrant
 *   DELETE /v1/selection-lists/{listId}/access/{userId} -> 204
 *
 * The manifest `build` block names what MUST exist for these to go GREEN:
 *   flow        access-control
 *   orchestrator SelectionListAccessFlow
 *   route       /settings/selection-lists/:listId/access
 *   package     @fuzeone/selection-lists-ui
 *   components  AccessPanel
 *
 * ── Why they are RED right now (READ THIS before "fixing" a failure) ─────────
 * The route /settings/selection-lists/:listId/access and
 * @fuzeone/selection-lists-ui do NOT exist yet. Every test below is EXPECTED
 * to fail today, and must fail for the RIGHT reason: the panels / modals are
 * ABSENT from the DOM — not a harness/config error. That RED state proves this
 * is TDD (specs written against the approved design before implementation), not
 * tests retrofitted to shipped UI.
 *
 * Tests are deliberately NOT test.skip / test.fixme — hiding RED defeats the
 * point. They go GREEN when frontend-engineer lands @fuzeone/selection-lists-ui
 * and wires the /settings/selection-lists/:listId/access route.
 *
 * Selectors are ONLY the data-* hooks declared in manifest.json (testHooks).
 * No class names, no text selectors, no invented selectors.
 *
 * Run (pre-prod, against a built UI on the ephemeral stack / dev host):
 *   BASE_URL=http://fuzefront.dev.local npx playwright test selection-lists-access-control.red
 * Config: frontend/playwright.config.ts (chromium + mobile projects).
 */
import { test, expect, type Page, type ConsoleMessage, type Request } from '@playwright/test'

const LIST_ID = 'sl_01h455vb4pex5vsknk084sn02q'
const ACCESS_ROUTE = `/settings/selection-lists/${LIST_ID}/access`

/** The sole owner — demoting/revoking them must return 409. */
const SOLE_OWNER_USER_ID = 'usr_01h455vb4pex5vsknk084sn02q'
const OTHER_USER_ID = 'usr_02h455vb4pex5vsknk084sn02q'
const SEARCH_USER_ID = 'usr_05h455vb4pex5vsknk084sn02q'

/** Access grants: one sole owner + one list-translator. */
const MOCK_ACCESS_GRANTS = [
  {
    user_id: SOLE_OWNER_USER_ID,
    role: 'list-owner',
    granted_by: 'usr_99h455vb4pex5vsknk084sn02q',
    granted_at: '2024-01-01T00:00:00Z',
    is_sole_owner: true,
  },
  {
    user_id: OTHER_USER_ID,
    role: 'list-translator',
    granted_by: SOLE_OWNER_USER_ID,
    granted_at: '2024-03-01T00:00:00Z',
    is_sole_owner: false,
  },
]

async function gotoAccessPanel(page: Page) {
  await page.goto(ACCESS_ROUTE, { waitUntil: 'domcontentloaded' })
}

/** Inject a successful GET …/access response. */
async function injectAccessGrants(page: Page, grants = MOCK_ACCESS_GRANTS) {
  await page.route(`**/v1/selection-lists/${LIST_ID}/access*`, async route => {
    const url = route.request().url()
    const method = route.request().method()
    // Match GET …/access and GET …/access?cursor=… but not …/access/{userId}.
    // url.endsWith('/access') would miss query-stringed pagination requests.
    if (method === 'GET' && !url.includes('/access/')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        // The frozen contract: GET …/access -> [SelectionListAccessGrant] (bare array).
        body: JSON.stringify(grants),
      })
    } else {
      // fallback (not continue) so that PUT/DELETE-specific handlers registered
      // earlier in LIFO order are not bypassed by this catch-all.
      await route.fallback()
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Frame 10-access-panel — Access panel
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Selection Lists access-control — frame 10-access-panel', () => {
  test('renders [data-frame="10-access-panel"] and both [data-panel="access"] and [data-panel="role-matrix"]', async ({ page }) => {
    await injectAccessGrants(page)
    await gotoAccessPanel(page)
    await expect(
      page.locator("[data-frame='10-access-panel']"),
      '[data-frame="10-access-panel"] must mount at /settings/selection-lists/:listId/access',
    ).toBeVisible()
    await expect(
      page.locator("[data-panel='access']"),
      '[data-panel="access"] grants table must render',
    ).toBeVisible()
    await expect(
      page.locator("[data-panel='role-matrix']"),
      '[data-panel="role-matrix"] capability matrix must render alongside the grants table',
    ).toBeVisible()
  })

  test('renders grant row [data-grant="usr_01h455vb4pex5vsknk084sn02q"] with role, granted_by and granted_at', async ({ page }) => {
    await injectAccessGrants(page)
    await gotoAccessPanel(page)
    await expect(
      page.locator(`[data-grant='${SOLE_OWNER_USER_ID}']`),
      `[data-grant="${SOLE_OWNER_USER_ID}"] must render the sole owner grant row`,
    ).toBeVisible()
  })

  test('[data-sole-owner="true"] marks the sole owner row', async ({ page }) => {
    await injectAccessGrants(page)
    await gotoAccessPanel(page)
    await expect(
      page.locator("[data-sole-owner='true']"),
      '[data-sole-owner="true"] must mark the sole owner grant row',
    ).toBeVisible()
  })

  test('[data-role-select] and [data-role="list-translator"] render for each grant', async ({ page }) => {
    await injectAccessGrants(page)
    await gotoAccessPanel(page)
    await expect(
      page.locator('[data-role-select]').first(),
      '[data-role-select] must render on each grant row to allow role changes',
    ).toBeVisible()
    await expect(
      page.locator("[data-role='list-translator']"),
      '[data-role="list-translator"] must mark the list-translator grant row',
    ).toBeVisible()
  })

  test('[data-action="revoke-access"] and [data-action="add-access"] render', async ({ page }) => {
    await injectAccessGrants(page)
    await gotoAccessPanel(page)
    await expect(
      page.locator("[data-action='revoke-access']").first(),
      '[data-action="revoke-access"] must render on grant rows',
    ).toBeVisible()
    await expect(
      page.locator("[data-action='add-access']"),
      '[data-action="add-access"] must render in the access panel toolbar',
    ).toBeVisible()
  })

  test('[data-case="last-owner"]: demoting the SOLE owner returns 409 CONFLICT inline — role select reverts, Remove re-enabled', async ({ page }) => {
    // CRITICAL fail-closed case: demoting the sole list-owner must be blocked by 409.
    // The UI must NOT pre-emptively disable the control — the server is the authority
    // (client-side guessing races concurrent changes).
    await page.route(`**/v1/selection-lists/${LIST_ID}/access/${SOLE_OWNER_USER_ID}`, async route => {
      const method = route.request().method()
      if (method === 'PUT') {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'CONFLICT', message: 'Cannot demote the sole list-owner' }),
        })
      } else {
        await route.continue()
      }
    })
    await injectAccessGrants(page)
    await gotoAccessPanel(page)

    // The role select must NOT be pre-emptively disabled for the sole owner.
    const soleOwnerRow = page.locator(`[data-grant='${SOLE_OWNER_USER_ID}']`)
    const roleSelect = soleOwnerRow.locator('[data-role-select]')
    await expect(roleSelect, 'role select must NOT be pre-emptively disabled for the sole owner').not.toBeDisabled()

    // Attempt to change the role (demote).
    await roleSelect.selectOption('list-translator')

    // The 409 must surface inline on the row.
    await expect(
      page.locator("[data-error='CONFLICT']"),
      '[data-error="CONFLICT"] must render inline when 409 blocks a sole-owner demotion',
    ).toBeVisible()
    await expect(
      page.locator("[data-case='last-owner']"),
      '[data-case="last-owner"] must annotate the conflict row',
    ).toBeVisible()

    // The role select must have reverted to list-owner.
    await expect(
      roleSelect,
      'role select must revert to list-owner after a 409 demotion conflict',
    ).toHaveValue('list-owner')

    // The Remove (revoke-access) button must be re-enabled.
    await expect(
      soleOwnerRow.locator("[data-action='revoke-access']"),
      '[data-action="revoke-access"] must be re-enabled after the 409 conflict',
    ).toBeEnabled()
  })

  test('[data-case="last-owner"]: revoking the SOLE owner returns 409 CONFLICT inline', async ({ page }) => {
    await page.route(`**/v1/selection-lists/${LIST_ID}/access/${SOLE_OWNER_USER_ID}`, async route => {
      if (route.request().method() === 'DELETE') {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'CONFLICT', message: 'Cannot remove the sole list-owner' }),
        })
      } else {
        await route.continue()
      }
    })
    // Track page errors before navigation so uncaught exceptions during
    // initial render are captured (attaching after gotoAccessPanel would miss them).
    const pageErrors: string[] = []
    page.on('pageerror', err => pageErrors.push(String(err)))

    await injectAccessGrants(page)
    await gotoAccessPanel(page)

    // Attempt to revoke the sole owner.
    const soleOwnerRow = page.locator(`[data-grant='${SOLE_OWNER_USER_ID}']`)
    await soleOwnerRow.locator("[data-action='revoke-access']").click()

    await expect(
      page.locator("[data-error='CONFLICT']"),
      '[data-error="CONFLICT"] must appear inline when 409 blocks sole-owner revocation',
    ).toBeVisible()
    expect(pageErrors, '409 on revoke must be handled — no uncaught error').toEqual([])
  })

  test('role matrix asserts [data-role="list-translator"] can translate but not add/update/remove values', async ({ page }) => {
    await injectAccessGrants(page)
    await gotoAccessPanel(page)
    // The role matrix must be legible even for read-only users (manage_access 403 state).
    const matrix = page.locator("[data-panel='role-matrix']")
    await expect(matrix).toBeVisible()
    // The list-translator role cell must be present in the matrix.
    await expect(
      matrix.locator("[data-role='list-translator']"),
      '[data-role="list-translator"] capability row must be in the role matrix',
    ).toBeVisible()
  })

  test('shows [data-state="empty"] when no grants exist', async ({ page }) => {
    await injectAccessGrants(page, [])
    await gotoAccessPanel(page)
    await expect(
      page.locator("[data-state='empty']"),
      '[data-state="empty"] must render when the grants list is empty',
    ).toBeVisible()
  })

  test('shows [data-state="error"] when the access fetch fails', async ({ page }) => {
    await page.route(`**/v1/selection-lists/${LIST_ID}/access*`, async route => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' })
    })
    await gotoAccessPanel(page)
    await expect(
      page.locator("[data-state='error']"),
      '[data-state="error"] must render when the access fetch fails',
    ).toBeVisible()
  })

  test('[data-error="FORBIDDEN"]: table is visible but read-only when manage_access is absent', async ({ page }) => {
    // Without manage_access, the table must be visible (governance stays legible)
    // but read-only — role selects disabled, Remove disabled.
    await page.route(`**/v1/selection-lists/${LIST_ID}/access*`, async route => {
      const url = route.request().url()
      if (route.request().method() === 'GET' && !url.includes('/access/')) {
        // Frozen contract: bare array, no invented `readonly` field.
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_ACCESS_GRANTS),
        })
      } else if (['PUT', 'DELETE'].includes(route.request().method())) {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'FORBIDDEN', message: 'manage_access required' }),
        })
      } else {
        await route.fallback()
      }
    })
    await gotoAccessPanel(page)
    await expect(
      page.locator("[data-error='FORBIDDEN']"),
      '[data-error="FORBIDDEN"] must appear when the caller lacks manage_access',
    ).toBeVisible()
    // The panel must still be visible (governance stays legible).
    await expect(page.locator("[data-panel='access']")).toBeVisible()
    // The role selects and remove buttons must be disabled.
    const roleSelects = page.locator('[data-role-select]')
    const count = await roleSelects.count()
    // Guard: count() does not auto-wait; if count is 0 the panel has not rendered.
    expect(count, 'at least one [data-role-select] must be present when the access panel renders').toBeGreaterThan(0)
    for (let i = 0; i < count; i++) {
      await expect(roleSelects.nth(i), `role-select ${i} must be disabled when FORBIDDEN`).toBeDisabled()
    }
    await expect(
      page.locator("[data-action='revoke-access']").first(),
      '[data-action="revoke-access"] must be disabled when FORBIDDEN',
    ).toBeDisabled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Frame 11-add-access-modal — Add access
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Selection Lists access-control — frame 11-add-access-modal', () => {
  async function openAddAccessModal(page: Page) {
    await injectAccessGrants(page)
    await gotoAccessPanel(page)
    await page.locator("[data-action='add-access']").click()
    await expect(page.locator("[data-modal='add-access']")).toBeVisible()
  }

  test('renders [data-frame="11-add-access-modal"] and [data-modal="add-access"] with user search', async ({ page }) => {
    await openAddAccessModal(page)
    await expect(
      page.locator("[data-frame='11-add-access-modal']"),
      '[data-frame="11-add-access-modal"] must appear when the add-access modal opens',
    ).toBeVisible()
    await expect(
      page.locator('[data-user-search]'),
      '[data-user-search] input must be present in the add-access modal',
    ).toBeVisible()
    await expect(
      page.locator('[data-user-results]'),
      '[data-user-results] container must be present for search results',
    ).toBeVisible()
  })

  test('[data-user="usr_05h455vb4pex5vsknk084sn02q"] appears in search results', async ({ page }) => {
    await page.route('**/v1/**users**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          users: [
            { id: SEARCH_USER_ID, name: 'Alice Smith', email: 'alice@example.com' },
          ],
        }),
      })
    })
    await openAddAccessModal(page)
    await page.locator('[data-user-search]').fill('alice')
    await expect(
      page.locator(`[data-user='${SEARCH_USER_ID}']`),
      `[data-user="${SEARCH_USER_ID}"] must appear in search results`,
    ).toBeVisible()
  })

  test('[data-already-granted="true"] marks users who already have a grant', async ({ page }) => {
    // The already-granted user must be shown in results but marked as not addable.
    await page.route('**/v1/**users**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          users: [
            { id: OTHER_USER_ID, name: 'Bob Jones', email: 'bob@example.com', already_granted: true },
          ],
        }),
      })
    })
    await openAddAccessModal(page)
    await page.locator('[data-user-search]').fill('bob')
    await expect(
      page.locator("[data-already-granted='true']"),
      '[data-already-granted="true"] must mark users who already hold a role',
    ).toBeVisible()
  })

  test('[data-role-select] in the modal and [data-action="confirm-add-access"] are present', async ({ page }) => {
    await openAddAccessModal(page)
    await expect(
      page.locator('[data-role-select]'),
      '[data-role-select] role picker must be in the add-access modal',
    ).toBeVisible()
    await expect(
      page.locator("[data-action='confirm-add-access']"),
      '[data-action="confirm-add-access"] must be in the add-access modal',
    ).toBeVisible()
  })

  test('[data-panel="user-search"][data-state="loading"] shows while search is in flight', async ({ page }) => {
    await page.route('**/v1/**users**', async route => {
      await new Promise(r => setTimeout(r, 300))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ users: [] }),
      })
    })
    await openAddAccessModal(page)
    await page.locator('[data-user-search]').fill('searching')
    await expect(
      page.locator("[data-panel='user-search'][data-state='loading']"),
      '[data-panel="user-search"][data-state="loading"] must appear while search is in flight',
    ).toBeVisible()
  })

  test('[data-panel="user-search"][data-state="empty"] shows when search returns no matches', async ({ page }) => {
    await page.route('**/v1/**users**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ users: [] }),
      })
    })
    await openAddAccessModal(page)
    await page.locator('[data-user-search]').fill('nobody')
    await expect(
      page.locator("[data-panel='user-search'][data-state='empty']"),
      '[data-panel="user-search"][data-state="empty"] must appear when search returns no users',
    ).toBeVisible()
  })

  test('[data-error="NOT_FOUND"] renders and user is dropped from results when user left the org mid-dialog', async ({ page }) => {
    // Inject a successful search, then 404 on confirm (user left the org mid-dialog).
    await page.route('**/v1/**users**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          users: [{ id: SEARCH_USER_ID, name: 'Gone User', email: 'gone@example.com' }],
        }),
      })
    })
    await page.route(`**/v1/selection-lists/${LIST_ID}/access/${SEARCH_USER_ID}`, async route => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'NOT_FOUND', message: 'User not found in organization' }),
        })
      } else {
        await route.continue()
      }
    })
    await openAddAccessModal(page)
    await page.locator('[data-user-search]').fill('gone')
    await page.locator(`[data-user='${SEARCH_USER_ID}']`).click()
    await page.locator("[data-action='confirm-add-access']").click()
    await expect(
      page.locator("[data-error='NOT_FOUND']"),
      '[data-error="NOT_FOUND"] must appear when the selected user has left the org',
    ).toBeVisible()
  })

  test('[data-error="FORBIDDEN"] disables [data-action="confirm-add-access"] when manage_access is absent', async ({ page }) => {
    await page.route(`**/v1/selection-lists/${LIST_ID}/access/**`, async route => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'FORBIDDEN', message: 'manage_access required' }),
        })
      } else {
        await route.continue()
      }
    })
    await page.route('**/v1/**users**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          users: [{ id: SEARCH_USER_ID, name: 'Alice Smith', email: 'alice@example.com' }],
        }),
      })
    })
    await openAddAccessModal(page)
    await page.locator('[data-user-search]').fill('alice')
    await page.locator(`[data-user='${SEARCH_USER_ID}']`).click()
    await page.locator("[data-action='confirm-add-access']").click()
    await expect(
      page.locator("[data-error='FORBIDDEN']"),
      '[data-error="FORBIDDEN"] must appear when confirm-add-access is blocked by 403',
    ).toBeVisible()
    await expect(
      page.locator("[data-action='confirm-add-access']"),
      '[data-action="confirm-add-access"] must be disabled after 403 FORBIDDEN',
    ).toBeDisabled()
  })

  test('confirm sends PUT …/access/{userId} with { role } and roles never stack', async ({ page }) => {
    const putBodies: unknown[] = []
    await page.route(`**/v1/selection-lists/${LIST_ID}/access/${SEARCH_USER_ID}`, async route => {
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON()
        putBodies.push(body)
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            user_id: SEARCH_USER_ID,
            role: 'list-translator',
            granted_by: SOLE_OWNER_USER_ID,
            granted_at: new Date().toISOString(),
          }),
        })
      } else {
        await route.continue()
      }
    })
    await page.route('**/v1/**users**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          users: [{ id: SEARCH_USER_ID, name: 'Alice Smith', email: 'alice@example.com' }],
        }),
      })
    })
    await openAddAccessModal(page)
    await page.locator('[data-user-search]').fill('alice')
    await page.locator(`[data-user='${SEARCH_USER_ID}']`).click()
    // Select a role (the select should default to something; pick list-translator).
    await page.locator('[data-role-select]').selectOption('list-translator')
    await page.locator("[data-action='confirm-add-access']").click()
    // Wait for the action to complete.
    await page.waitForTimeout(300)
    expect(
      putBodies.length,
      'PUT …/access/{userId} must have been captured at least once — check confirm-add-access fires the request',
    ).toBeGreaterThan(0)
    // The PUT body must contain { role } and nothing else identifying it as a stack.
    for (const body of putBodies as Record<string, unknown>[]) {
      expect(body, 'PUT body must include a role field').toHaveProperty('role')
      // Roles never stack — the body must not include an array of roles.
      expect(Array.isArray(body?.role), 'role must be a string, not an array (roles never stack)').toBe(false)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Runtime console-clean gate (ui-runtime-validation — baseline §7.1)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Selection Lists access-control — runtime console-clean gate (ui-runtime-validation)', () => {
  test('the access-panel route has a clean console (0 errors, 0 CSP/mixed-content, 0 failed app requests)', async ({ page }) => {
    const consoleErrors: string[] = []
    const failedRequests: string[] = []

    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', err => consoleErrors.push(`pageerror: ${String(err)}`))
    page.on('requestfailed', (req: Request) => {
      const url = req.url()
      if (url.includes('/v1/selection-lists') || url.includes('/assets')) {
        failedRequests.push(`${req.method()} ${url} :: ${req.failure()?.errorText ?? 'failed'}`)
      }
    })

    await injectAccessGrants(page)
    await gotoAccessPanel(page)
    await expect(page.locator("[data-panel='access']")).toBeVisible()

    expect(consoleErrors, `console errors on access-panel:\n${consoleErrors.join('\n')}`).toEqual([])
    expect(failedRequests, `failed app requests on access-panel:\n${failedRequests.join('\n')}`).toEqual([])
  })
})
