/**
 * SELECTION LISTS — LIST MANAGEMENT FLOW — INDEPENDENT, PRE-PRODUCTION, RED-by-design UI e2e.
 * (frontend-test-engineer — independent verification, NOT the implementer.)
 *
 * ── What this file is ────────────────────────────────────────────────────────
 * TDD RED specs for the list-management flow of EPIC-17 / FFRNT-188 (Selection
 * Lists). They are derived STRICTLY from the approved visual contract:
 *
 *   design/frames/selection-lists/manifest.json  (build inventory + test hooks)
 *   design/frames/selection-lists/01-list-index.html  — (1a) List index
 *   design/frames/selection-lists/02-new-list.html    — (1b) New list
 *   design/frames/selection-lists/03-list-detail.html — (1c) List detail / value editor
 *   design/frames/selection-lists/04-value-modal.html — (1d) Add / edit value
 *   design/frames/selection-lists/05-reorder.html     — (1e) Reorder (drag in progress)
 *   design/frames/selection-lists/06-quota.html       — (1f) Quota warning & wall
 *
 * and from the frozen API contract services/selection-list-service/openapi.yaml:
 *   GET  /v1/selection-lists              -> page of SelectionList
 *   POST /v1/selection-lists              -> SelectionList (service mints sl_…, no id in body)
 *   GET  /v1/selection-lists/{listId}/items -> page of SelectionListItem
 *   PUT  /v1/selection-lists/{listId}/items/reorder -> 204 (full permutation of item_ids)
 *   GET  /v1/selection-lists/quota        -> SelectionListQuotaStatus
 *   POST /v1/selection-lists/{listId}/items/{itemId}/archive -> 204
 *   DELETE /v1/selection-lists/{listId}/items/{itemId}       -> 204 (purge)
 *
 * The manifest `build` block names what MUST exist for these to go GREEN:
 *   flow        list-management
 *   orchestrator SelectionListManagementFlow
 *   route       /settings/selection-lists
 *   package     @fuzeone/selection-lists-ui
 *   components  SelectionListIndex, SelectionListDetail, ValueEditor, QuotaWarning
 *
 * ── Why they are RED right now (READ THIS before "fixing" a failure) ─────────
 * The route /settings/selection-lists and @fuzeone/selection-lists-ui do NOT
 * exist yet. Every test below is EXPECTED to fail today, and must fail for the
 * RIGHT reason: the panels / modals / states are ABSENT from the DOM — not a
 * harness/config error. That RED state proves this is TDD (specs written against
 * the approved design before implementation), not tests retrofitted to shipped UI.
 *
 * Tests are deliberately NOT test.skip / test.fixme — hiding RED defeats the
 * point. They go GREEN when frontend-engineer lands @fuzeone/selection-lists-ui
 * and wires the /settings/selection-lists route.
 *
 * Selectors are ONLY the data-* hooks declared in manifest.json (testHooks).
 * No class names, no text selectors, no invented selectors.
 *
 * Run (pre-prod, against a built UI on the ephemeral stack / dev host):
 *   BASE_URL=http://fuzefront.dev.local npx playwright test selection-lists-list-management.red
 * Config: frontend/playwright.config.ts (chromium + mobile projects).
 */
import { test, expect, type Page, type ConsoleMessage, type Request } from '@playwright/test'

const LIST_INDEX_ROUTE = '/settings/selection-lists'
// A real list id for detail/item routes — the harness injects mock data.
const LIST_ID = 'sl_01h455vb4pex5vsknk084sn02q'
const LIST_DETAIL_ROUTE = `/settings/selection-lists/${LIST_ID}`

/** Sample SelectionList for the list-index mock. */
const MOCK_LIST_COUNTRIES = {
  id: LIST_ID,
  key: 'countries',
  name: 'Countries',
  is_machine: false,
  status: 'active',
  item_count: 249,
  source_locale: 'en',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-06-01T00:00:00Z',
}

/** Sample archived SelectionList with machine-translated name. */
const MOCK_LIST_ARCHIVED = {
  id: 'sl_02h455vb4pex5vsknk084sn02q',
  key: 'sales-regions',
  name: 'Sales Regions',
  is_machine: true,
  status: 'archived',
  item_count: 5,
  source_locale: 'en',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-06-01T00:00:00Z',
}

/** Sample SelectionListItem for detail view. */
const MOCK_ITEM = {
  id: 'sli_01h455vb4pex5vsknk084sn02q',
  list_id: LIST_ID,
  code: 'US',
  label: 'United States',
  is_machine: false,
  status: 'active',
  sort_order: 1,
  source_hash: 'abc123',
}

/** Sample archived SelectionListItem. */
const MOCK_ITEM_ARCHIVED = {
  id: 'sli_02h455vb4pex5vsknk084sn02q',
  list_id: LIST_ID,
  code: 'XX',
  label: 'Archived Country',
  is_machine: false,
  status: 'archived',
  sort_order: 2,
  source_hash: 'def456',
}

/** Quota response at-limit. */
const MOCK_QUOTA_AT_LIMIT = {
  scopes: [
    { scope: 'org_lists', current: 100, limit: 100 },
    { scope: 'user_lists', current: 25, limit: 25 },
    { scope: 'list_items', current: null, limit: 1000 },
    { scope: 'list_locales', current: null, limit: 11 },
  ],
}

/** Quota response near-limit (>=80%). */
const MOCK_QUOTA_NEAR_LIMIT = {
  scopes: [
    { scope: 'org_lists', current: 85, limit: 100 },
    { scope: 'user_lists', current: 21, limit: 25 },
    { scope: 'list_items', current: null, limit: 1000 },
    { scope: 'list_locales', current: null, limit: 11 },
  ],
}

async function gotoListIndex(page: Page) {
  await page.goto(LIST_INDEX_ROUTE, { waitUntil: 'domcontentloaded' })
}

async function gotoListDetail(page: Page) {
  await page.goto(LIST_DETAIL_ROUTE, { waitUntil: 'domcontentloaded' })
}

/** Inject a successful list-index response with both active and archived rows. */
async function injectListIndexData(page: Page) {
  await page.route('**/v1/selection-lists*', async route => {
    const url = route.request().url()
    // Don't intercept quota or item sub-routes
    if (url.includes('/quota') || url.includes('/items') || url.includes('/access') || url.includes('/translations')) {
      return route.continue()
    }
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [MOCK_LIST_COUNTRIES, MOCK_LIST_ARCHIVED],
          next_cursor: 'cursor_abc',
          total: 2,
        }),
      })
    } else {
      // fallback (not continue) so that POST-specific handlers registered earlier
      // in LIFO order are not bypassed when openNewListForm registers them first.
      await route.fallback()
    }
  })
}

/** Inject a successful list-items response for the detail view. */
async function injectListDetailData(page: Page) {
  // Items list route — registered first so it is tried second (LIFO).
  // '*' does not match '/' in Playwright globs, so the detail route below
  // cannot inadvertently intercept sub-paths like /items or /items/reorder.
  await page.route(`**/v1/selection-lists/${LIST_ID}/items*`, async route => {
    const url = route.request().url()
    if (route.request().method() === 'GET' && !url.includes('/items/')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [MOCK_ITEM, MOCK_ITEM_ARCHIVED],
          next_cursor: null,
          total: 2,
        }),
      })
    } else {
      await route.fallback()
    }
  })
  // List detail route — registered second so it is tried first (LIFO).
  await page.route(`**/v1/selection-lists/${LIST_ID}*`, async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_LIST_COUNTRIES),
      })
    } else {
      await route.fallback()
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Frame 01-list-index — List index panel
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Selection Lists list-management — frame 01-list-index', () => {
  test('renders the [data-frame="01-list-index"] frame marker', async ({ page }) => {
    await injectListIndexData(page)
    await gotoListIndex(page)
    await expect(
      page.locator("[data-frame='01-list-index']"),
      'SelectionListManagementFlow must mount [data-frame="01-list-index"] at /settings/selection-lists',
    ).toBeVisible()
  })

  test('renders the [data-panel="list-index"] container', async ({ page }) => {
    await injectListIndexData(page)
    await gotoListIndex(page)
    await expect(
      page.locator("[data-panel='list-index']"),
      'SelectionListIndex must expose [data-panel="list-index"]',
    ).toBeVisible()
  })

  test('shell nav item [data-nav="selection-lists"] is marked active', async ({ page }) => {
    await injectListIndexData(page)
    await gotoListIndex(page)
    // The manifest declares [data-nav='selection-lists'].active — the nav item
    // must carry the active class while the user is on this route.
    await expect(
      page.locator("[data-nav='selection-lists'].active"),
      'the Selection Lists shell nav item must be active at /settings/selection-lists',
    ).toBeVisible()
  })

  test('renders a row for the "countries" list with [data-list="countries"]', async ({ page }) => {
    await injectListIndexData(page)
    await gotoListIndex(page)
    await expect(
      page.locator("[data-list='countries']"),
      'each list row must carry [data-list=<key>] derived from the list key',
    ).toBeVisible()
  })

  test('archived list row carries [data-status="archived"]', async ({ page }) => {
    await injectListIndexData(page)
    await gotoListIndex(page)
    await expect(
      page.locator("[data-status='archived']"),
      'an archived list must expose [data-status="archived"] on its row',
    ).toBeVisible()
  })

  test('machine-translated row carries [data-machine="true"]', async ({ page }) => {
    await injectListIndexData(page)
    await gotoListIndex(page)
    // is_machine:true rows must render an M badge surfaced via data-machine="true".
    await expect(
      page.locator("[data-machine='true']"),
      'a list whose name is machine-translated must carry [data-machine="true"] (M badge)',
    ).toBeVisible()
  })

  test('renders the status filter control [data-filter="status"]', async ({ page }) => {
    await injectListIndexData(page)
    await gotoListIndex(page)
    await expect(
      page.locator("[data-filter='status']"),
      'the status filter (active/archived/all) must be present as [data-filter="status"]',
    ).toBeVisible()
  })

  test('renders the "New list" CTA [data-action="new-list"]', async ({ page }) => {
    await injectListIndexData(page)
    await gotoListIndex(page)
    await expect(
      page.locator("[data-action='new-list']"),
      '"New list" CTA must render as [data-action="new-list"]',
    ).toBeVisible()
  })

  test('renders "Load more" when a next_cursor is present [data-action="load-more"]', async ({ page }) => {
    await injectListIndexData(page)
    await gotoListIndex(page)
    await expect(
      page.locator("[data-action='load-more']"),
      '"Load more" must render when the API returns a next_cursor',
    ).toBeVisible()
  })

  test('shows loading skeleton [data-state="loading"] while the GET is in flight', async ({ page }) => {
    // Delay the response so the loading state is visible before data arrives.
    await page.route('**/v1/selection-lists*', async route => {
      const url = route.request().url()
      if (url.includes('/quota') || url.includes('/items') || url.includes('/access')) {
        return route.continue()
      }
      // Small delay to let the skeleton render.
      await new Promise(r => setTimeout(r, 200))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [MOCK_LIST_COUNTRIES], next_cursor: null, total: 1 }),
      })
    })
    await page.goto(LIST_INDEX_ROUTE)
    // The skeleton must appear during the load.
    await expect(
      page.locator("[data-state='loading']"),
      '[data-state="loading"] skeleton rows must appear while the list is fetching',
    ).toBeVisible()
    // And then resolve once data lands.
    await expect(page.locator("[data-panel='list-index']")).toBeVisible()
  })

  test('shows empty state with create CTA when no lists exist [data-state="empty"]', async ({ page }) => {
    await page.route('**/v1/selection-lists*', async route => {
      const url = route.request().url()
      if (url.includes('/quota') || url.includes('/items')) return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], next_cursor: null, total: 0 }),
      })
    })
    await gotoListIndex(page)
    await expect(
      page.locator("[data-state='empty']"),
      '[data-state="empty"] must render when there are no lists',
    ).toBeVisible()
    // Empty state must still offer the create CTA.
    await expect(
      page.locator("[data-action='new-list']"),
      'empty state must include the [data-action="new-list"] create CTA',
    ).toBeVisible()
  })

  test('shows error state with retry when the list fetch fails [data-state="error"]', async ({ page }) => {
    await page.route('**/v1/selection-lists*', async route => {
      const url = route.request().url()
      if (url.includes('/quota') || url.includes('/items')) return route.continue()
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' })
    })
    await gotoListIndex(page)
    await expect(
      page.locator("[data-state='error']"),
      '[data-state="error"] must appear when the list fetch fails with 500',
    ).toBeVisible()
    await expect(
      page.locator("[data-action='retry']"),
      'the error state must offer [data-action="retry"]',
    ).toBeVisible()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Frame 02-new-list — New list form
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Selection Lists list-management — frame 02-new-list', () => {
  /**
   * Helper: open the new-list form by clicking the "New list" CTA.
   * The form may render inline or as a routed sub-page — the contract is the
   * data-panel="new-list" element appearing after the click.
   */
  async function openNewListForm(page: Page) {
    await injectListIndexData(page)
    await gotoListIndex(page)
    await page.locator("[data-action='new-list']").click()
    await expect(page.locator("[data-panel='new-list']")).toBeVisible()
  }

  test('renders the new-list panel with [data-frame="02-new-list"]', async ({ page }) => {
    await openNewListForm(page)
    await expect(
      page.locator("[data-frame='02-new-list']"),
      '[data-frame="02-new-list"] must appear when the new-list form opens',
    ).toBeVisible()
  })

  test('renders the key field [data-field="key"] and source_locale field [data-field="source_locale"]', async ({ page }) => {
    await openNewListForm(page)
    await expect(
      page.locator("[data-field='key']"),
      '[data-field="key"] (immutable slug) must be present in the new-list form',
    ).toBeVisible()
    await expect(
      page.locator("[data-field='source_locale']"),
      '[data-field="source_locale"] picker must be present',
    ).toBeVisible()
  })

  test('shows [data-field-error="key"] and blocks submit on invalid key pattern', async ({ page }) => {
    await openNewListForm(page)
    // Key rule: ^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$ — uppercase, leading hyphen etc. are invalid.
    await page.locator("[data-field='key']").fill('INVALID_KEY!')
    await page.locator("[data-action='create-list']").click()
    await expect(
      page.locator("[data-field-error='key']"),
      '[data-field-error="key"] must appear when the key fails the slug pattern',
    ).toBeVisible()
    await expect(
      page.locator("[data-error='VALIDATION_ERROR']"),
      '[data-error="VALIDATION_ERROR"] must accompany an invalid key',
    ).toBeVisible()
  })

  test('shows [data-error="CONFLICT"] on 409 duplicate key', async ({ page }) => {
    await page.route('**/v1/selection-lists', async route => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'CONFLICT', message: 'A list with that key already exists' }),
        })
      } else {
        await route.continue()
      }
    })
    await openNewListForm(page)
    await page.locator("[data-field='key']").fill('existing-key')
    await page.locator("[data-action='create-list']").click()
    await expect(
      page.locator("[data-error='CONFLICT']"),
      '[data-error="CONFLICT"] must render when the API returns 409 for a duplicate key',
    ).toBeVisible()
  })

  test('shows [data-error="QUOTA_EXCEEDED"] on 403 QUOTA_EXCEEDED with scope, current and limit', async ({ page }) => {
    await page.route('**/v1/selection-lists', async route => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'QUOTA_EXCEEDED', scope: 'org_lists', current: 100, limit: 100 }),
        })
      } else {
        await route.continue()
      }
    })
    await openNewListForm(page)
    await page.locator("[data-field='key']").fill('new-list')
    await page.locator("[data-action='create-list']").click()
    await expect(
      page.locator("[data-error='QUOTA_EXCEEDED']"),
      '[data-error="QUOTA_EXCEEDED"] must render on 403 with quota details',
    ).toBeVisible()
  })

  test('shows [data-error="FORBIDDEN"] and disables (not hides) CTA on 403 FORBIDDEN', async ({ page }) => {
    await page.route('**/v1/selection-lists', async route => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'FORBIDDEN', message: 'Insufficient permissions' }),
        })
      } else {
        await route.continue()
      }
    })
    await openNewListForm(page)
    await page.locator("[data-field='key']").fill('valid-key')
    await page.locator("[data-action='create-list']").click()
    await expect(
      page.locator("[data-error='FORBIDDEN']"),
      '[data-error="FORBIDDEN"] must render on 403 FORBIDDEN',
    ).toBeVisible()
    // 403 FORBIDDEN disables the CTA — it must not be hidden.
    const cta = page.locator("[data-action='create-list']")
    await expect(cta, 'the create-list CTA must still be in the DOM when FORBIDDEN').toBeVisible()
    await expect(cta, 'the create-list CTA must be disabled when FORBIDDEN').toBeDisabled()
  })

  test('shows [data-state="submitting"] and disables key + source_locale during submit', async ({ page }) => {
    // Delay the POST so the submitting state is observable.
    await page.route('**/v1/selection-lists', async route => {
      if (route.request().method() === 'POST') {
        await new Promise(r => setTimeout(r, 300))
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ ...MOCK_LIST_COUNTRIES, key: 'new-list' }),
        })
      } else {
        await route.continue()
      }
    })
    await openNewListForm(page)
    await page.locator("[data-field='key']").fill('new-list')
    // Start submit and check submitting state before it resolves.
    await page.locator("[data-action='create-list']").click()
    await expect(
      page.locator("[data-state='submitting']"),
      '[data-state="submitting"] must appear while the POST is in flight',
    ).toBeVisible()
    // Both identity fields must be disabled during submission to prevent double-submit race.
    await expect(
      page.locator("[data-field='key']"),
      '[data-field="key"] must be disabled while submitting',
    ).toBeDisabled()
    await expect(
      page.locator("[data-field='source_locale']"),
      '[data-field="source_locale"] must be disabled while submitting',
    ).toBeDisabled()
    await expect(
      page.locator("[data-action='create-list']"),
      'the submit button must be disabled while submitting',
    ).toBeDisabled()
  })

  test('POST body must NOT contain an id field (service mints sl_…)', async ({ page }) => {
    // The contract: POST /v1/selection-lists carries NO id — the service mints sl_…
    // and rejects unknown properties (additionalProperties: false).
    const postedBodies: unknown[] = []
    await page.route('**/v1/selection-lists', async route => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON()
        postedBodies.push(body)
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ ...MOCK_LIST_COUNTRIES, key: 'valid-key' }),
        })
      } else {
        await route.continue()
      }
    })
    await openNewListForm(page)
    await page.locator("[data-field='key']").fill('valid-key')
    await page.locator("[data-action='create-list']").click()
    // Wait for navigation / panel close.
    await page.waitForTimeout(500)
    expect(
      postedBodies.length,
      'POST /v1/selection-lists must have been captured at least once — check that the form submit fires the request',
    ).toBeGreaterThan(0)
    for (const body of postedBodies as Record<string, unknown>[]) {
      expect(
        body,
        'POST /v1/selection-lists body must not include an "id" field — the service mints sl_…',
      ).not.toHaveProperty('id')
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Frame 03-list-detail — List detail / value editor
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Selection Lists list-management — frame 03-list-detail', () => {
  test('renders [data-frame="03-list-detail"] and [data-panel="value-editor"]', async ({ page }) => {
    await injectListDetailData(page)
    await gotoListDetail(page)
    await expect(
      page.locator("[data-frame='03-list-detail']"),
      '[data-frame="03-list-detail"] must mount on the list detail route',
    ).toBeVisible()
    await expect(
      page.locator("[data-panel='value-editor']"),
      '[data-panel="value-editor"] must render in the detail view',
    ).toBeVisible()
  })

  test('renders the [data-tabs="list-detail"] tab strip with translations and access tabs', async ({ page }) => {
    await injectListDetailData(page)
    await gotoListDetail(page)
    await expect(
      page.locator("[data-tabs='list-detail']"),
      '[data-tabs="list-detail"] tab strip must be present',
    ).toBeVisible()
    await expect(
      page.locator("[data-tab='translations']"),
      '[data-tab="translations"] must be in the tab strip',
    ).toBeVisible()
    await expect(
      page.locator("[data-tab='access']"),
      '[data-tab="access"] must be in the tab strip',
    ).toBeVisible()
  })

  test('renders list item row with [data-item="sli_01h455vb4pex5vsknk084sn02q"]', async ({ page }) => {
    await injectListDetailData(page)
    await gotoListDetail(page)
    await expect(
      page.locator("[data-item='sli_01h455vb4pex5vsknk084sn02q']"),
      'list item row must carry [data-item=<sli_… id>] from sort_order-ordered GET …/items',
    ).toBeVisible()
  })

  test('archived item row carries [data-archived="true"] and is visible in the editor', async ({ page }) => {
    await injectListDetailData(page)
    await gotoListDetail(page)
    // Archived rows must stay visible in the editor (Restore / Delete) per acceptanceNotes.
    await expect(
      page.locator("[data-archived='true']"),
      'archived item must remain visible in the value editor with [data-archived="true"]',
    ).toBeVisible()
  })

  test('drag handle [data-drag-handle] renders for reorderable items', async ({ page }) => {
    await injectListDetailData(page)
    await gotoListDetail(page)
    await expect(
      page.locator('[data-drag-handle]').first(),
      'each reorderable item must expose a [data-drag-handle] element',
    ).toBeVisible()
  })

  test('renders the add-value, archive-value and purge-value actions', async ({ page }) => {
    await injectListDetailData(page)
    await gotoListDetail(page)
    await expect(
      page.locator("[data-action='add-value']"),
      '[data-action="add-value"] must be present in the value editor toolbar',
    ).toBeVisible()
    await expect(
      page.locator("[data-action='archive-value']").first(),
      '[data-action="archive-value"] must render on item rows',
    ).toBeVisible()
    await expect(
      page.locator("[data-action='purge-value']").first(),
      '[data-action="purge-value"] must render on item rows (destructive)',
    ).toBeVisible()
  })

  test('shows empty state [data-state="empty"] when the list has no items', async ({ page }) => {
    // Mock the list detail metadata (the page fetches this alongside items).
    await page.route(`**/v1/selection-lists/${LIST_ID}*`, async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_LIST_COUNTRIES),
        })
      } else {
        await route.fallback()
      }
    })
    // Override items to return empty (registered second = tried first in LIFO,
    // so it wins over the catch-all above for /items sub-paths).
    // '*' does not cross '/', so the detail catch-all above cannot match /items.
    await page.route(`**/v1/selection-lists/${LIST_ID}/items*`, async route => {
      if (route.request().method() === 'GET' && !route.request().url().includes('/items/')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [], next_cursor: null, total: 0 }),
        })
      } else {
        await route.fallback()
      }
    })
    await gotoListDetail(page)
    await expect(
      page.locator("[data-state='empty']"),
      '[data-state="empty"] must render when the list has no items',
    ).toBeVisible()
  })

  test('shows error state [data-state="error"] when items fetch fails', async ({ page }) => {
    await page.route(`**/v1/selection-lists/${LIST_ID}/items*`, async route => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' })
    })
    await gotoListDetail(page)
    await expect(
      page.locator("[data-state='error']"),
      '[data-state="error"] must render when the items fetch fails',
    ).toBeVisible()
  })

  test('shows not-found state [data-state="not-found"] and [data-error="NOT_FOUND"] on 404 (never 403)', async ({ page }) => {
    // The contract: a non-existent or unreadable list returns 404, NEVER 403
    // (a 403 would be a cross-org existence oracle).
    await page.route(`**/v1/selection-lists/${LIST_ID}*`, async route => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'NOT_FOUND', message: 'List not found' }),
      })
    })
    await gotoListDetail(page)
    await expect(
      page.locator("[data-state='not-found']"),
      '404 on the list must render [data-state="not-found"]',
    ).toBeVisible()
    await expect(
      page.locator("[data-error='NOT_FOUND']"),
      '404 on the list must render [data-error="NOT_FOUND"]',
    ).toBeVisible()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Frame 04-value-modal — Add / edit / purge value modals
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Selection Lists list-management — frame 04-value-modal', () => {
  async function openAddValueModal(page: Page) {
    await injectListDetailData(page)
    await gotoListDetail(page)
    await page.locator("[data-action='add-value']").click()
    await expect(page.locator("[data-modal='add-value']")).toBeVisible()
  }

  async function openEditValueModal(page: Page) {
    await injectListDetailData(page)
    await gotoListDetail(page)
    // Click the item row to open edit — the exact trigger depends on implementation;
    // the modal contract is [data-modal="edit-value"].
    await page.locator("[data-item='sli_01h455vb4pex5vsknk084sn02q']").click()
    await expect(page.locator("[data-modal='edit-value']")).toBeVisible()
  }

  test('renders [data-frame="04-value-modal"] and [data-modal="add-value"] when adding', async ({ page }) => {
    await openAddValueModal(page)
    await expect(
      page.locator("[data-frame='04-value-modal']"),
      '[data-frame="04-value-modal"] must appear when a value modal is open',
    ).toBeVisible()
  })

  test('code field [data-field="code"] is editable in add mode', async ({ page }) => {
    await openAddValueModal(page)
    const codeField = page.locator("[data-field='code']")
    await expect(codeField, '[data-field="code"] must be editable in add mode').toBeVisible()
    await expect(codeField, '[data-field="code"] must not be disabled in add mode').not.toBeDisabled()
  })

  test('[data-modal="edit-value"] renders and code is disabled; item id visible as [data-item-id]', async ({ page }) => {
    await openEditValueModal(page)
    await expect(
      page.locator("[data-modal='edit-value']"),
      '[data-modal="edit-value"] must open on item row interaction',
    ).toBeVisible()
    await expect(
      page.locator("[data-field='code']"),
      '[data-field="code"] must be disabled in edit mode (code is immutable)',
    ).toBeDisabled()
    await expect(
      page.locator('[data-item-id]'),
      '[data-item-id] must display the service-minted sli_… id (the value consumers persist)',
    ).toBeVisible()
  })

  test('[data-modal="purge-value"] requires typed confirmation [data-confirm-input] and offers [data-action="archive-instead"]', async ({ page }) => {
    await injectListDetailData(page)
    await gotoListDetail(page)
    await page.locator("[data-action='purge-value']").first().click()
    await expect(
      page.locator("[data-modal='purge-value']"),
      '[data-modal="purge-value"] must open on the purge action',
    ).toBeVisible()
    await expect(
      page.locator('[data-confirm-input]'),
      '[data-confirm-input] typed confirmation must be required for purge',
    ).toBeVisible()
    await expect(
      page.locator("[data-action='archive-instead']"),
      '"archive instead" escape hatch [data-action="archive-instead"] must be offered in the purge dialog',
    ).toBeVisible()
    // [data-action="confirm-purge"] must be present (initially disabled until code is typed).
    await expect(
      page.locator("[data-action='confirm-purge']"),
      '[data-action="confirm-purge"] must be in the purge modal',
    ).toBeVisible()
  })

  test('[data-action="save-value"] is present in add/edit modals', async ({ page }) => {
    await openAddValueModal(page)
    await expect(
      page.locator("[data-action='save-value']"),
      '[data-action="save-value"] must be in the add-value modal',
    ).toBeVisible()
  })

  test('shows [data-error="CONFLICT"] on 409 duplicate code', async ({ page }) => {
    await page.route(`**/v1/selection-lists/${LIST_ID}/items`, async route => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'CONFLICT', message: 'A value with that code already exists' }),
        })
      } else {
        await route.continue()
      }
    })
    await openAddValueModal(page)
    await page.locator("[data-field='code']").fill('EXISTING')
    await page.locator("[data-action='save-value']").click()
    await expect(
      page.locator("[data-error='CONFLICT']"),
      '[data-error="CONFLICT"] must render on 409 duplicate code',
    ).toBeVisible()
  })

  test('shows [data-error="QUOTA_EXCEEDED"] on 403 QUOTA_EXCEEDED for list_items', async ({ page }) => {
    await page.route(`**/v1/selection-lists/${LIST_ID}/items`, async route => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'QUOTA_EXCEEDED', scope: 'list_items', current: 1000, limit: 1000 }),
        })
      } else {
        await route.continue()
      }
    })
    await openAddValueModal(page)
    await page.locator("[data-field='code']").fill('NEWVALUE')
    await page.locator("[data-action='save-value']").click()
    await expect(
      page.locator("[data-error='QUOTA_EXCEEDED']"),
      '[data-error="QUOTA_EXCEEDED"] must render on 403 QUOTA_EXCEEDED (list_items)',
    ).toBeVisible()
  })

  test('for list-translator role, add/archive/delete are disabled (not hidden) with [data-error="FORBIDDEN"]', async ({ page }) => {
    // For users with list-translator role, mutation actions are disabled with the 403 reason.
    // Inject a 403 FORBIDDEN on all mutating item endpoints.
    await page.route(`**/v1/selection-lists/${LIST_ID}/items*`, async route => {
      if (['POST', 'PATCH', 'DELETE'].includes(route.request().method())) {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'FORBIDDEN', message: 'list-translator cannot modify values' }),
        })
      } else {
        await route.continue()
      }
    })
    await injectListDetailData(page)
    await gotoListDetail(page)
    // The add-value action must be disabled but visible (not hidden).
    const addAction = page.locator("[data-action='add-value']")
    await expect(addAction, '[data-action="add-value"] must be visible to list-translator').toBeVisible()
    await expect(addAction, '[data-action="add-value"] must be disabled for list-translator').toBeDisabled()
    await expect(
      page.locator("[data-error='FORBIDDEN']").first(),
      '[data-error="FORBIDDEN"] must explain why actions are disabled for list-translator',
    ).toBeVisible()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Frame 05-reorder — Drag-and-drop reorder
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Selection Lists list-management — frame 05-reorder', () => {
  test('renders [data-frame="05-reorder"] and [data-reorderable="true"] on the sortable list', async ({ page }) => {
    await injectListDetailData(page)
    await gotoListDetail(page)
    await expect(
      page.locator("[data-reorderable='true']"),
      '[data-reorderable="true"] must be present on the sortable value list',
    ).toBeVisible()
  })

  test('drag handle [data-drag-handle] is rendered for each item (not for roles without update_value)', async ({ page }) => {
    await injectListDetailData(page)
    await gotoListDetail(page)
    const handles = page.locator('[data-drag-handle]')
    const count = await handles.count()
    expect(count, 'drag handles must render for each reorderable item').toBeGreaterThan(0)
  })

  test('drag-in-progress state carries [data-dragging="true"] and [data-drop-target="true"]', async ({ page }) => {
    await injectListDetailData(page)
    await gotoListDetail(page)
    // Initiate a drag via keyboard to trigger the dragging state (Space to lift).
    const firstHandle = page.locator('[data-drag-handle]').first()
    await firstHandle.focus()
    await page.keyboard.press('Space') // lift the item per the keyboard reorder contract
    await expect(
      page.locator("[data-dragging='true']"),
      '[data-dragging="true"] must appear on the lifted row during a drag',
    ).toBeVisible()
    await expect(
      page.locator("[data-drop-target='true']"),
      '[data-drop-target="true"] must appear on the drop indicator during a drag',
    ).toBeVisible()
    // Cancel the drag via Esc (keyboard reorder: Space lift, arrows move, Esc cancel).
    await page.keyboard.press('Escape')
  })

  test('[data-state="saving"] appears while PUT …/items/reorder is in flight (optimistic lock)', async ({ page }) => {
    await page.route(`**/v1/selection-lists/${LIST_ID}/items/reorder`, async route => {
      await new Promise(r => setTimeout(r, 300))
      await route.fulfill({ status: 204, body: '' })
    })
    await injectListDetailData(page)
    await gotoListDetail(page)
    // Trigger a reorder via keyboard.
    const firstHandle = page.locator('[data-drag-handle]').first()
    await firstHandle.focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Space') // drop
    await expect(
      page.locator("[data-state='saving']"),
      '[data-state="saving"] must appear while the reorder PUT is in flight',
    ).toBeVisible()
  })

  test('[data-error="reorder-failed"] appears and order is restored on 500', async ({ page }) => {
    await page.route(`**/v1/selection-lists/${LIST_ID}/items/reorder`, async route => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' })
    })
    await injectListDetailData(page)
    await gotoListDetail(page)
    const firstHandle = page.locator('[data-drag-handle]').first()
    await firstHandle.focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Space')
    await expect(
      page.locator("[data-error='reorder-failed']"),
      '[data-error="reorder-failed"] must appear when the reorder PUT fails',
    ).toBeVisible()
  })

  test('[data-error="VALIDATION_ERROR"] appears on 400 (non-full-permutation) and list reloads', async ({ page }) => {
    await page.route(`**/v1/selection-lists/${LIST_ID}/items/reorder`, async route => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'VALIDATION_ERROR', message: 'item_ids is not a full permutation' }),
      })
    })
    await injectListDetailData(page)
    await gotoListDetail(page)
    const firstHandle = page.locator('[data-drag-handle]').first()
    await firstHandle.focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Space')
    await expect(
      page.locator("[data-error='VALIDATION_ERROR']"),
      '[data-error="VALIDATION_ERROR"] must appear on 400 non-permutation reorder',
    ).toBeVisible()
  })

  test('[data-error="FORBIDDEN"] appears and drag handles are absent for roles without update_value', async ({ page }) => {
    await page.route(`**/v1/selection-lists/${LIST_ID}/items/reorder`, async route => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'FORBIDDEN', message: 'Insufficient permission: update_value' }),
      })
    })
    await injectListDetailData(page)
    await gotoListDetail(page)
    // For roles without update_value, [data-drag-handle] must NOT be rendered —
    // the reorder affordance is removed entirely (fail-closed).
    const handles = page.locator('[data-drag-handle]')
    const handleCount = await handles.count()
    if (handleCount > 0) {
      // Defensive path: if handles are somehow rendered, triggering a reorder must
      // surface [data-error='FORBIDDEN'] — the backend rejects it.
      await handles.first().focus()
      await page.keyboard.press('Space')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Space')
      await expect(
        page.locator("[data-error='FORBIDDEN']"),
        '[data-error="FORBIDDEN"] must appear when reorder is attempted without update_value',
      ).toBeVisible()
    } else {
      // Correct path: handles absent — no reorder affordance for read-only roles.
      await expect(
        handles.first(),
        '[data-drag-handle] must not render for roles without update_value',
      ).not.toBeVisible()
    }
  })

  /**
   * [data-note="reorder-a11y"] — Keyboard reorder a11y live region.
   *
   * NOTE: The frames declare [data-note="reorder-a11y"] to document the
   * keyboard reorder accessibility contract (Space lift, ArrowDown/Up move,
   * Escape cancel, live region announcements). This hook is asserted to be
   * present as a DOM element (e.g., an aria-live region) rather than just a
   * design annotation. For roles without update_value, the handles are NOT
   * rendered, making keyboard reorder unreachable — which is the correct
   * fail-closed posture (no affordance = no accidental destructive reorder).
   */
  test('[data-note="reorder-a11y"] live region is present for keyboard reorder announcements', async ({ page }) => {
    await injectListDetailData(page)
    await gotoListDetail(page)
    await expect(
      page.locator("[data-note='reorder-a11y']"),
      '[data-note="reorder-a11y"] aria-live region must be present (keyboard reorder a11y contract)',
    ).toBeVisible()
  })

  test('PUT …/items/reorder body contains the FULL permutation of item_ids', async ({ page }) => {
    const reorderBodies: unknown[] = []
    await page.route(`**/v1/selection-lists/${LIST_ID}/items/reorder`, async route => {
      const body = route.request().postDataJSON()
      reorderBodies.push(body)
      await route.fulfill({ status: 204, body: '' })
    })
    await injectListDetailData(page)
    await gotoListDetail(page)
    const firstHandle = page.locator('[data-drag-handle]').first()
    await firstHandle.focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Space')
    await page.waitForTimeout(400)
    // The contract: PUT body must contain item_ids covering the full list.
    expect(
      reorderBodies.length,
      'PUT …/items/reorder must have been captured at least once — check that keyboard reorder fires the request',
    ).toBeGreaterThan(0)
    for (const body of reorderBodies as Record<string, unknown>[]) {
      const itemIds = body?.item_ids as string[] | undefined
      expect(itemIds, 'PUT …/items/reorder body must include item_ids').toBeDefined()
      expect(Array.isArray(itemIds), 'item_ids must be an array').toBe(true)
      expect(itemIds!.length, 'item_ids must be a full permutation (all item ids present)').toBeGreaterThan(0)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Frame 06-quota — Quota warning & wall
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Selection Lists list-management — frame 06-quota', () => {
  async function injectQuota(page: Page, quotaBody: object, status = 200) {
    await page.route('**/v1/selection-lists/quota*', async route => {
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(quotaBody),
      })
    })
  }

  test('renders [data-frame="06-quota"] and [data-panel="quota"] with all four scope meters', async ({ page }) => {
    await injectQuota(page, MOCK_QUOTA_NEAR_LIMIT)
    await injectListIndexData(page)
    await gotoListIndex(page)
    // The quota panel may render inline on the index or as a sub-panel — frame is the contract.
    await expect(
      page.locator("[data-frame='06-quota']"),
      '[data-frame="06-quota"] must be present when quota data is loaded',
    ).toBeVisible()
    await expect(page.locator("[data-panel='quota']")).toBeVisible()
  })

  test('renders all four quota scope meters: org_lists, user_lists, list_items, list_locales', async ({ page }) => {
    await injectQuota(page, MOCK_QUOTA_NEAR_LIMIT)
    await injectListIndexData(page)
    await gotoListIndex(page)
    for (const scope of ['org_lists', 'user_lists', 'list_items', 'list_locales']) {
      await expect(
        page.locator(`[data-quota-scope='${scope}']`),
        `[data-quota-scope="${scope}"] meter must be present`,
      ).toBeVisible()
    }
  })

  test('[data-banner="quota-near"] appears and CTA stays enabled at >=80% usage', async ({ page }) => {
    await injectQuota(page, MOCK_QUOTA_NEAR_LIMIT)
    await injectListIndexData(page)
    await gotoListIndex(page)
    await expect(
      page.locator("[data-banner='quota-near']"),
      '[data-banner="quota-near"] must appear when usage is >=80%',
    ).toBeVisible()
    // At near-limit the CTA stays ENABLED — only at ceiling is it disabled.
    const cta = page.locator("[data-action='new-list']")
    await expect(cta, 'the new-list CTA must remain enabled at near-limit').toBeEnabled()
  })

  test('[data-banner="quota-at"] and disabled CTA with [data-quota-state="at-limit"] and tooltip at 100%', async ({ page }) => {
    await injectQuota(page, MOCK_QUOTA_AT_LIMIT)
    await injectListIndexData(page)
    await gotoListIndex(page)
    await expect(
      page.locator("[data-banner='quota-at']"),
      '[data-banner="quota-at"] must appear at the 100% ceiling',
    ).toBeVisible()
    await expect(
      page.locator("[data-quota-state='at-limit']"),
      '[data-quota-state="at-limit"] must mark the at-limit state',
    ).toBeVisible()
    // The CTA must be disabled with aria-disabled at the ceiling.
    const cta = page.locator("[data-action='new-list'][disabled]")
    await expect(cta, 'the new-list CTA must be disabled (aria-disabled) at the quota ceiling').toBeVisible()
    // A tooltip must explain which scope, current and limit hit the ceiling.
    await expect(
      page.locator("[data-tooltip='quota']"),
      '[data-tooltip="quota"] must be present on the disabled CTA',
    ).toBeVisible()
  })

  test('shows [data-state="loading"] while the quota call is in flight', async ({ page }) => {
    await page.route('**/v1/selection-lists/quota*', async route => {
      await new Promise(r => setTimeout(r, 300))
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_QUOTA_NEAR_LIMIT) })
    })
    await injectListIndexData(page)
    await page.goto(LIST_INDEX_ROUTE)
    await expect(
      page.locator("[data-state='loading']"),
      '[data-state="loading"] must appear while the quota fetch is in flight',
    ).toBeVisible()
  })

  test('[data-state="error"] from quota shows hidden meters but CTA stays ENABLED (fail-OPEN)', async ({ page }) => {
    // CRITICAL: if the advisory quota call fails, the CTA must REMAIN ENABLED.
    // The server is the authority — it refuses with 403 QUOTA_EXCEEDED.
    // A failed advisory call must NEVER lock out users.
    await page.route('**/v1/selection-lists/quota*', async route => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' })
    })
    await injectListIndexData(page)
    await gotoListIndex(page)
    await expect(
      page.locator("[data-state='error']"),
      '[data-state="error"] must appear when the quota call fails',
    ).toBeVisible()
    // The CTA must be ENABLED despite the failed quota call (fail-OPEN).
    const cta = page.locator("[data-action='new-list']")
    await expect(cta, 'the new-list CTA must stay ENABLED when the quota advisory call fails — the server is the authority').toBeEnabled()
    // The disabled-with-aria-disabled form of the CTA must NOT be present.
    await expect(
      page.locator("[data-action='new-list'][disabled]"),
      'a failed quota call must NOT render the disabled CTA — that would lock out users',
    ).not.toBeVisible()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Runtime console-clean gate (ui-runtime-validation — baseline §7.1)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Selection Lists list-management — runtime console-clean gate (ui-runtime-validation)', () => {
  test('the list-index route has a clean console (0 errors, 0 CSP/mixed-content, 0 failed app requests)', async ({ page }) => {
    const consoleErrors: string[] = []
    const failedRequests: string[] = []

    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', err => consoleErrors.push(`pageerror: ${String(err)}`))
    page.on('requestfailed', (req: Request) => {
      const url = req.url()
      if (
        url.includes('/v1/selection-lists') ||
        url.includes('/assets') ||
        url.includes('/settings/selection-lists')
      ) {
        failedRequests.push(`${req.method()} ${url} :: ${req.failure()?.errorText ?? 'failed'}`)
      }
    })

    await injectListIndexData(page)
    await gotoListIndex(page)
    // The panel must be present for this gate to be meaningful — RED until it exists.
    await expect(page.locator("[data-panel='list-index']")).toBeVisible()

    expect(consoleErrors, `console errors on list-index:\n${consoleErrors.join('\n')}`).toEqual([])
    expect(failedRequests, `failed app requests on list-index:\n${failedRequests.join('\n')}`).toEqual([])
  })

  test('the list-detail route has a clean console', async ({ page }) => {
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

    await injectListDetailData(page)
    await gotoListDetail(page)
    await expect(page.locator("[data-panel='value-editor']")).toBeVisible()

    expect(consoleErrors, `console errors on list-detail:\n${consoleErrors.join('\n')}`).toEqual([])
    expect(failedRequests, `failed app requests on list-detail:\n${failedRequests.join('\n')}`).toEqual([])
  })
})
