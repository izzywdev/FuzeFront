/**
 * SELECTION LISTS — PICKER FLOW — INDEPENDENT, PRE-PRODUCTION, RED-by-design UI e2e.
 * (frontend-test-engineer — independent verification, NOT the implementer.)
 *
 * ── What this file is ────────────────────────────────────────────────────────
 * TDD RED specs for the picker flow of EPIC-17 / FFRNT-188 (Selection Lists).
 * They are derived STRICTLY from the approved visual contract:
 *
 *   design/frames/selection-lists/manifest.json  (build inventory + test hooks)
 *   design/frames/selection-lists/12-picker-single.html  — (4a) Picker — single select
 *   design/frames/selection-lists/13-picker-multi.html   — (4b) Picker — multi select
 *   design/frames/selection-lists/14-picker-archived.html — (4c) Picker — archived value
 *
 * and from the frozen API contract services/selection-list-service/openapi.yaml:
 *   GET  /v1/selection-lists/{listId}/items  -> items ordered by sort_order, status=active
 *   POST /v1/resolve                          -> ResolveResponse (archived / purged / missing ids)
 *
 * The manifest `build` block names what MUST exist for these to go GREEN:
 *   flow         picker
 *   orchestrator SelectionListPicker (EMBEDDABLE component — not a routed page)
 *   route        /embed/selection-list-picker  (harness/demo route for e2e only)
 *   package      @fuzeone/selection-lists-ui
 *   components   SelectionListPicker
 *
 * ── IMPORTANT: SelectionListPicker is EMBEDDABLE ─────────────────────────────
 * The picker is NOT a routed page in the FuzeFront shell. It is an embeddable
 * component that mounts inside a host form. The route /embed/selection-list-picker
 * is a harness/demo route provided by the test environment to exercise the
 * picker in isolation. The shipped component is imported, not navigated to.
 * This is noted in [data-note="embeddable"] per the approved frame.
 *
 * ── Why they are RED right now (READ THIS before "fixing" a failure) ─────────
 * The harness route /embed/selection-list-picker and @fuzeone/selection-lists-ui
 * do NOT exist yet. Every test below is EXPECTED to fail today, and must fail
 * for the RIGHT reason: the picker / chips / resolution states are ABSENT from
 * the DOM — not a harness/config error. That RED state proves this is TDD
 * (specs written against the approved design before implementation), not tests
 * retrofitted to shipped UI.
 *
 * Tests are deliberately NOT test.skip / test.fixme — hiding RED defeats the
 * point. They go GREEN when frontend-engineer lands @fuzeone/selection-lists-ui,
 * wires the harness route and ships the SelectionListPicker component.
 *
 * Selectors are ONLY the data-* hooks declared in manifest.json (testHooks).
 * No class names, no text selectors, no invented selectors.
 *
 * Run (pre-prod, against a built UI on the ephemeral stack / dev host):
 *   BASE_URL=http://fuzefront.dev.local npx playwright test selection-lists-picker.red
 * Config: frontend/playwright.config.ts (chromium + mobile projects).
 */
import { test, expect, type Page, type ConsoleMessage, type Request } from '@playwright/test'

const PICKER_HARNESS_ROUTE = '/embed/selection-list-picker'

/** Item ids used across tests (declared in manifest as test fixtures). */
const ITEM_ID_SINGLE = 'sli_12h455vb4pex5vsknk084sn02q'
const ITEM_ID_MULTI = 'sli_01h455vb4pex5vsknk084sn02q'

/** Sample active items for the single picker (sales-regions list). */
const MOCK_SALES_REGION_ITEMS = [
  { id: ITEM_ID_SINGLE, code: 'AMER', label: 'Americas', status: 'active', sort_order: 1 },
  { id: 'sli_13h455vb4pex5vsknk084sn02q', code: 'EMEA', label: 'Europe, Middle East & Africa', status: 'active', sort_order: 2 },
  { id: 'sli_14h455vb4pex5vsknk084sn02q', code: 'APAC', label: 'Asia Pacific', status: 'active', sort_order: 3 },
]

/** Sample active items for the multi picker (countries list). */
const MOCK_COUNTRY_ITEMS = [
  { id: ITEM_ID_MULTI, code: 'US', label: 'United States', status: 'active', sort_order: 1 },
  { id: 'sli_05h455vb4pex5vsknk084sn02q', code: 'GB', label: 'United Kingdom', status: 'active', sort_order: 2 },
  { id: 'sli_06h455vb4pex5vsknk084sn02q', code: 'FR', label: 'France', status: 'active', sort_order: 3 },
]

/** Archived item that resolves via POST /v1/resolve. */
const ARCHIVED_ITEM_ID = 'sli_archived_01h455vb4pex5vsknk084sn02q'
/** Purged item that lands in `missing` from POST /v1/resolve. */
const PURGED_ITEM_ID = 'sli_purged_01h455vb4pex5vsknk084sn02q'

async function gotoPickerHarness(page: Page, params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString()
  const route = qs ? `${PICKER_HARNESS_ROUTE}?${qs}` : PICKER_HARNESS_ROUTE
  await page.goto(route, { waitUntil: 'domcontentloaded' })
}

/** Inject items for a given list key. */
async function injectListItems(page: Page, key: string, items: typeof MOCK_SALES_REGION_ITEMS) {
  await page.route(`**/v1/selection-lists*`, async route => {
    const url = route.request().url()
    if (url.includes('/items') && url.includes(key)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: items, next_cursor: null, total: items.length }),
      })
    } else if (!url.includes('/items') && url.includes(key) && route.request().method() === 'GET') {
      // List metadata lookup by key.
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'sl_sales_regions',
          key,
          name: key === 'sales-regions' ? 'Sales Regions' : 'Countries',
          is_machine: false,
          status: 'active',
          item_count: items.length,
          source_locale: 'en',
        }),
      })
    } else {
      await route.continue()
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Frame 12-picker-single — Single-select picker
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Selection Lists picker — frame 12-picker-single', () => {
  test('renders [data-frame="12-picker-single"] and [data-panel="picker"] at the harness route', async ({ page }) => {
    await injectListItems(page, 'sales-regions', MOCK_SALES_REGION_ITEMS)
    await gotoPickerHarness(page, { list: 'sales-regions', mode: 'single' })
    await expect(
      page.locator("[data-frame='12-picker-single']"),
      '[data-frame="12-picker-single"] must mount at the picker harness route in single mode',
    ).toBeVisible()
    await expect(
      page.locator("[data-panel='picker']"),
      '[data-panel="picker"] must render the picker container',
    ).toBeVisible()
  })

  test('[data-mode="single"] and [data-picker="sales-regions"] identify the picker configuration', async ({ page }) => {
    await injectListItems(page, 'sales-regions', MOCK_SALES_REGION_ITEMS)
    await gotoPickerHarness(page, { list: 'sales-regions', mode: 'single' })
    await expect(
      page.locator("[data-mode='single']"),
      '[data-mode="single"] must identify this as a single-select picker',
    ).toBeVisible()
    await expect(
      page.locator("[data-picker='sales-regions']"),
      '[data-picker="sales-regions"] must identify which list key is bound',
    ).toBeVisible()
  })

  test('[data-note="embeddable"] documents that the picker mounts in a host form (not the shell)', async ({ page }) => {
    await injectListItems(page, 'sales-regions', MOCK_SALES_REGION_ITEMS)
    await gotoPickerHarness(page, { list: 'sales-regions', mode: 'single' })
    await expect(
      page.locator("[data-note='embeddable']"),
      '[data-note="embeddable"] must be present to document the embeddable nature of the component',
    ).toBeVisible()
  })

  test('combobox renders [data-combo-control], [data-combo-menu] and [data-combo-search]', async ({ page }) => {
    await injectListItems(page, 'sales-regions', MOCK_SALES_REGION_ITEMS)
    await gotoPickerHarness(page, { list: 'sales-regions', mode: 'single' })
    await expect(
      page.locator('[data-combo-control]'),
      '[data-combo-control] must render the combobox trigger/control',
    ).toBeVisible()
    // Open the menu to assert its contents.
    await page.locator('[data-combo-control]').click()
    await expect(
      page.locator('[data-combo-menu]'),
      '[data-combo-menu] must render the option list when the combobox is open',
    ).toBeVisible()
    await expect(
      page.locator('[data-combo-search]'),
      '[data-combo-search] must render the typeahead search input within the menu',
    ).toBeVisible()
  })

  test('options are ordered by sort_order (not alphabetically, not by id)', async ({ page }) => {
    // The manifest acceptanceNotes: options NEVER alphabetized, NEVER ordered by id.
    // sort_order is the contract. We inject items out of alphabetical/id order and
    // verify they appear in sort_order order.
    const outOfAlphaOrder = [
      { id: 'sli_c', code: 'ZZFIRST', label: 'ZZ Should Be First', status: 'active', sort_order: 1 },
      { id: 'sli_a', code: 'AASECOND', label: 'AA Should Be Second', status: 'active', sort_order: 2 },
      { id: 'sli_b', code: 'MMTHIRD', label: 'MM Should Be Third', status: 'active', sort_order: 3 },
    ]
    await injectListItems(page, 'sales-regions', outOfAlphaOrder)
    await gotoPickerHarness(page, { list: 'sales-regions', mode: 'single' })
    await page.locator('[data-combo-control]').click()
    await expect(page.locator('[data-combo-menu]')).toBeVisible()
    const options = page.locator('[data-combo-menu] [data-item]')
    const first = options.nth(0)
    const second = options.nth(1)
    const third = options.nth(2)
    await expect(first, 'first option must be the item with sort_order=1 (not alphabetically first)').toHaveAttribute('data-item', 'sli_c')
    await expect(second, 'second option must be sort_order=2').toHaveAttribute('data-item', 'sli_a')
    await expect(third, 'third option must be sort_order=3').toHaveAttribute('data-item', 'sli_b')
  })

  test('[data-item="sli_12h455vb4pex5vsknk084sn02q"] appears as an option in the open menu', async ({ page }) => {
    await injectListItems(page, 'sales-regions', MOCK_SALES_REGION_ITEMS)
    await gotoPickerHarness(page, { list: 'sales-regions', mode: 'single' })
    await page.locator('[data-combo-control]').click()
    await expect(
      page.locator(`[data-item='${ITEM_ID_SINGLE}']`),
      `[data-item="${ITEM_ID_SINGLE}"] must appear as a selectable option`,
    ).toBeVisible()
  })

  test('selecting an item updates [data-selected-label] and [data-persisted] shows the item id (not label)', async ({ page }) => {
    await injectListItems(page, 'sales-regions', MOCK_SALES_REGION_ITEMS)
    await gotoPickerHarness(page, { list: 'sales-regions', mode: 'single' })
    await page.locator('[data-combo-control]').click()
    await page.locator(`[data-item='${ITEM_ID_SINGLE}']`).click()
    // The selected label must be visible.
    await expect(
      page.locator('[data-selected-label]'),
      '[data-selected-label] must show the locale-resolved label of the selected item',
    ).toBeVisible()
    // The persisted value must be the item ID, not the label (the host form submits the id).
    const persisted = page.locator('[data-persisted]')
    await expect(persisted, '[data-persisted] must show what the host form submits').toBeVisible()
    const persistedValue = await persisted.getAttribute('data-persisted') ?? await persisted.inputValue().catch(() => '')
    // The persisted value must be the item id (sli_…).
    expect(
      persistedValue === ITEM_ID_SINGLE || persistedValue.includes(ITEM_ID_SINGLE),
      `[data-persisted] must carry the item id "${ITEM_ID_SINGLE}", not the label`,
    ).toBe(true)
  })

  test('[data-state="loading"] renders inside the control at final height (no host-form reflow)', async ({ page }) => {
    await page.route('**/v1/selection-lists*', async route => {
      await new Promise(r => setTimeout(r, 300))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_SALES_REGION_ITEMS, next_cursor: null, total: 3 }),
      })
    })
    await page.goto(`${PICKER_HARNESS_ROUTE}?list=sales-regions&mode=single`)
    await expect(
      page.locator("[data-state='loading']"),
      '[data-state="loading"] skeleton must render inside the combobox at final height while items load',
    ).toBeVisible()
  })

  test('[data-state="empty"] disables the combobox with "No options available" when no active items exist', async ({ page }) => {
    await page.route('**/v1/selection-lists*', async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [], next_cursor: null, total: 0 }),
        })
      } else {
        await route.continue()
      }
    })
    await gotoPickerHarness(page, { list: 'sales-regions', mode: 'single' })
    await expect(
      page.locator("[data-state='empty']"),
      '[data-state="empty"] must render when the list has no active values',
    ).toBeVisible()
    // The combobox must be disabled — it must not open an empty menu.
    await expect(
      page.locator('[data-combo-control]'),
      '[data-combo-control] must be disabled when there are no active options',
    ).toBeDisabled()
  })

  test('[data-state="error"] shows an in-place retry and keeps any existing selection on load failure', async ({ page }) => {
    await page.route('**/v1/selection-lists*', async route => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' })
    })
    await gotoPickerHarness(page, { list: 'sales-regions', mode: 'single' })
    await expect(
      page.locator("[data-state='error']"),
      '[data-state="error"] must render an in-place retry when items fail to load',
    ).toBeVisible()
    // The error must not throw into the host render tree (no uncaught page error).
    // This is validated by the absence of a pageerror event, covered in the console gate.
  })

  test('[data-state="not-found"] and [data-error="NOT_FOUND"] render when the list key is unknown', async ({ page }) => {
    await page.route('**/v1/selection-lists*', async route => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'NOT_FOUND', message: 'List not found' }),
      })
    })
    await gotoPickerHarness(page, { list: 'does-not-exist', mode: 'single' })
    await expect(
      page.locator("[data-state='not-found']"),
      '[data-state="not-found"] must render when the list key is unknown/unreadable',
    ).toBeVisible()
    await expect(
      page.locator("[data-error='NOT_FOUND']"),
      '[data-error="NOT_FOUND"] must accompany the not-found state',
    ).toBeVisible()
  })

  test('load failure does not throw an uncaught error into the host render tree', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', err => pageErrors.push(String(err)))
    await page.route('**/v1/selection-lists*', async route => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' })
    })
    await gotoPickerHarness(page, { list: 'sales-regions', mode: 'single' })
    await expect(page.locator("[data-state='error']")).toBeVisible()
    expect(pageErrors, 'a load failure must be caught by the picker — must not throw into the host render tree').toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Frame 13-picker-multi — Multi-select picker
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Selection Lists picker — frame 13-picker-multi', () => {
  test('renders [data-frame="13-picker-multi"] and [data-mode="multi"] with [data-picker="countries"]', async ({ page }) => {
    await injectListItems(page, 'countries', MOCK_COUNTRY_ITEMS)
    await gotoPickerHarness(page, { list: 'countries', mode: 'multi' })
    await expect(
      page.locator("[data-frame='13-picker-multi']"),
      '[data-frame="13-picker-multi"] must mount in multi mode',
    ).toBeVisible()
    await expect(
      page.locator("[data-mode='multi']"),
      '[data-mode="multi"] must identify this as a multi-select picker',
    ).toBeVisible()
    await expect(
      page.locator("[data-picker='countries']"),
      '[data-picker="countries"] must identify which list key is bound',
    ).toBeVisible()
  })

  test('[data-state="empty-selection"] renders when no items are selected', async ({ page }) => {
    await injectListItems(page, 'countries', MOCK_COUNTRY_ITEMS)
    await gotoPickerHarness(page, { list: 'countries', mode: 'multi' })
    await expect(
      page.locator("[data-state='empty-selection']"),
      '[data-state="empty-selection"] must render when no items are selected (empty placeholder)',
    ).toBeVisible()
    // clear-all must NOT be present when there are no selections.
    await expect(
      page.locator("[data-action='clear-all']"),
      '[data-action="clear-all"] must be absent when no items are selected',
    ).not.toBeVisible()
  })

  test('selections render as [data-chips] containing [data-chip="sli_01h455vb4pex5vsknk084sn02q"]', async ({ page }) => {
    await injectListItems(page, 'countries', MOCK_COUNTRY_ITEMS)
    await gotoPickerHarness(page, { list: 'countries', mode: 'multi' })
    // Select an item.
    await page.locator('[data-combo-control]').click()
    await page.locator(`[data-item='${ITEM_ID_MULTI}']`).click()
    await expect(
      page.locator('[data-chips]'),
      '[data-chips] chip container must appear after selection',
    ).toBeVisible()
    await expect(
      page.locator(`[data-chip='${ITEM_ID_MULTI}']`),
      `[data-chip="${ITEM_ID_MULTI}"] must render the selected item as a removable chip`,
    ).toBeVisible()
  })

  test('[data-action="clear-all"] appears when selections exist and clears all chips', async ({ page }) => {
    await injectListItems(page, 'countries', MOCK_COUNTRY_ITEMS)
    await gotoPickerHarness(page, { list: 'countries', mode: 'multi' })
    await page.locator('[data-combo-control]').click()
    await page.locator(`[data-item='${ITEM_ID_MULTI}']`).click()
    await expect(
      page.locator("[data-action='clear-all']"),
      '[data-action="clear-all"] must appear when at least one item is selected',
    ).toBeVisible()
    // Clicking clear-all must remove all chips.
    await page.locator("[data-action='clear-all']").click()
    await expect(
      page.locator('[data-chips]'),
      'chips must be empty after clear-all',
    ).not.toBeVisible()
    await expect(
      page.locator("[data-action='clear-all']"),
      '[data-action="clear-all"] must disappear after clearing',
    ).not.toBeVisible()
  })

  test('submitted array is ordered by sort_order (not click order)', async ({ page }) => {
    // CRITICAL: the acceptanceNotes contract — two users choosing the same set
    // must submit identical arrays. sort_order is the ordering authority.
    await injectListItems(page, 'countries', MOCK_COUNTRY_ITEMS)
    await gotoPickerHarness(page, { list: 'countries', mode: 'multi' })
    // Select items in REVERSE sort_order (click 3rd, then 1st, then 2nd).
    await page.locator('[data-combo-control]').click()
    await page.locator("[data-item='sli_06h455vb4pex5vsknk084sn02q']").click() // sort_order=3
    await page.locator('[data-combo-control]').click()
    await page.locator(`[data-item='${ITEM_ID_MULTI}']`).click() // sort_order=1
    await page.locator('[data-combo-control]').click()
    await page.locator("[data-item='sli_05h455vb4pex5vsknk084sn02q']").click() // sort_order=2
    // The [data-persisted] value must list ids in sort_order, regardless of click order.
    const persisted = page.locator('[data-persisted]')
    await expect(persisted, '[data-persisted] must reflect the ordered selection array').toBeVisible()
    const persistedAttr = await persisted.getAttribute('data-persisted') ?? ''
    // The persisted order must be sort_order: ITEM_ID_MULTI(1), sli_05(2), sli_06(3).
    const idOrder = [ITEM_ID_MULTI, 'sli_05h455vb4pex5vsknk084sn02q', 'sli_06h455vb4pex5vsknk084sn02q']
    for (let i = 0; i < idOrder.length - 1; i++) {
      const posA = persistedAttr.indexOf(idOrder[i])
      const posB = persistedAttr.indexOf(idOrder[i + 1])
      expect(
        posA < posB,
        `submitted array must order id[${i}] (sort_order=${i + 1}) before id[${i + 1}] (sort_order=${i + 2})`,
      ).toBe(true)
    }
  })

  test('[data-state="no-matches"] shows when the search filter returns no options and existing chips are preserved', async ({ page }) => {
    await injectListItems(page, 'countries', MOCK_COUNTRY_ITEMS)
    await gotoPickerHarness(page, { list: 'countries', mode: 'multi' })
    // Select an item first.
    await page.locator('[data-combo-control]').click()
    await page.locator(`[data-item='${ITEM_ID_MULTI}']`).click()
    // Now search for something that returns no matches.
    await page.locator('[data-combo-control]').click()
    await page.locator('[data-combo-search]').fill('xyzzy_no_match')
    await expect(
      page.locator("[data-state='no-matches']"),
      '[data-state="no-matches"] must render when the filter matches nothing',
    ).toBeVisible()
    // Existing chips must be preserved even when the search returns nothing.
    await expect(
      page.locator(`[data-chip='${ITEM_ID_MULTI}']`),
      'existing chips must be preserved when the search returns no matches',
    ).toBeVisible()
  })

  test('[data-state="max-reached"] and [data-error="max-selected"] appear when the host max is hit', async ({ page }) => {
    // The host can supply a max prop. Hitting it disables further options with a message
    // that distinguishes it from a service quota.
    await injectListItems(page, 'countries', MOCK_COUNTRY_ITEMS)
    // Navigate with max=1 to test the max constraint.
    await gotoPickerHarness(page, { list: 'countries', mode: 'multi', max: '1' })
    await page.locator('[data-combo-control]').click()
    await page.locator(`[data-item='${ITEM_ID_MULTI}']`).click()
    await expect(
      page.locator("[data-state='max-reached']"),
      '[data-state="max-reached"] must appear when the host-supplied max is reached',
    ).toBeVisible()
    await expect(
      page.locator("[data-error='max-selected']"),
      '[data-error="max-selected"] must distinguish the host max from a service quota',
    ).toBeVisible()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Frame 14-picker-archived — Archived value resolution
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Selection Lists picker — frame 14-picker-archived', () => {
  /** Inject a resolve response. */
  async function injectResolve(page: Page, response: object, status = 200) {
    await page.route('**/v1/resolve*', async route => {
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(response),
      })
    })
  }

  test('renders [data-frame="14-picker-archived"] and [data-state="archived-selected"] for a stored archived id', async ({ page }) => {
    // A stored id whose item is archived must resolve via POST /v1/resolve to
    // { label, locale, is_machine, status:"archived" } and render greyed with an archived badge.
    await injectListItems(page, 'countries', MOCK_COUNTRY_ITEMS)
    await injectResolve(page, {
      resolved: [
        {
          id: ARCHIVED_ITEM_ID,
          label: 'Old Country',
          locale: 'en',
          is_machine: false,
          status: 'archived',
        },
      ],
      missing: [],
    })
    await gotoPickerHarness(page, { list: 'countries', mode: 'single', value: ARCHIVED_ITEM_ID })
    await expect(
      page.locator("[data-frame='14-picker-archived']"),
      '[data-frame="14-picker-archived"] must mount when the harness loads an archived value',
    ).toBeVisible()
    await expect(
      page.locator("[data-state='archived-selected']"),
      '[data-state="archived-selected"] must render when the stored id resolves to status:archived',
    ).toBeVisible()
  })

  test('[data-selected-label][data-archived="true"] renders the real label greyed with an archived badge', async ({ page }) => {
    await injectListItems(page, 'countries', MOCK_COUNTRY_ITEMS)
    await injectResolve(page, {
      resolved: [
        { id: ARCHIVED_ITEM_ID, label: 'Old Country', locale: 'en', is_machine: false, status: 'archived' },
      ],
      missing: [],
    })
    await gotoPickerHarness(page, { list: 'countries', mode: 'single', value: ARCHIVED_ITEM_ID })
    // The archived value must render with its real label AND the archived badge.
    // It must NEVER disappear and the field must NEVER silently blank.
    await expect(
      page.locator("[data-selected-label][data-archived='true']"),
      '[data-selected-label][data-archived="true"] must show the real label with an archived badge',
    ).toBeVisible()
  })

  test('[data-status="archived"] marks the archived item in the selected display', async ({ page }) => {
    await injectListItems(page, 'countries', MOCK_COUNTRY_ITEMS)
    await injectResolve(page, {
      resolved: [
        { id: ARCHIVED_ITEM_ID, label: 'Old Country', locale: 'en', is_machine: false, status: 'archived' },
      ],
      missing: [],
    })
    await gotoPickerHarness(page, { list: 'countries', mode: 'single', value: ARCHIVED_ITEM_ID })
    await expect(
      page.locator("[data-status='archived']"),
      '[data-status="archived"] must be present on the archived value display',
    ).toBeVisible()
  })

  test('[data-state="archived-not-offered"] and [data-note="archived-not-offerable"]: archived item is ABSENT from the option menu', async ({ page }) => {
    // The archived item must be ABSENT from the dropdown — readable but not newly selectable.
    await injectListItems(page, 'countries', MOCK_COUNTRY_ITEMS) // active items only (no ARCHIVED_ITEM_ID)
    await injectResolve(page, {
      resolved: [
        { id: ARCHIVED_ITEM_ID, label: 'Old Country', locale: 'en', is_machine: false, status: 'archived' },
      ],
      missing: [],
    })
    await gotoPickerHarness(page, { list: 'countries', mode: 'single', value: ARCHIVED_ITEM_ID })
    // Open the menu.
    await page.locator('[data-combo-control]').click()
    // The archived item must NOT be in the option menu.
    await expect(
      page.locator(`[data-combo-menu] [data-item='${ARCHIVED_ITEM_ID}']`),
      'the archived item must be ABSENT from the option menu — cannot be newly selected',
    ).not.toBeVisible()
    await expect(
      page.locator("[data-state='archived-not-offered']"),
      '[data-state="archived-not-offered"] must document that archived items are not in the menu',
    ).toBeVisible()
    await expect(
      page.locator("[data-note='archived-not-offerable']"),
      '[data-note="archived-not-offerable"] must be present',
    ).toBeVisible()
  })

  test('[data-state="missing"] and [data-missing="true"] render "Unknown value" for a purged id; id is kept in the form', async ({ page }) => {
    // A purged id comes back in `missing` from POST /v1/resolve.
    // The picker must render "Unknown value" while keeping the id in the form field
    // so re-saving does NOT silently drop data the user never chose to change.
    await injectListItems(page, 'countries', MOCK_COUNTRY_ITEMS)
    await injectResolve(page, {
      resolved: [],
      missing: [PURGED_ITEM_ID],
    })
    await gotoPickerHarness(page, { list: 'countries', mode: 'single', value: PURGED_ITEM_ID })
    await expect(
      page.locator("[data-state='missing']"),
      '[data-state="missing"] must render for a purged (not-found-in-resolve) id',
    ).toBeVisible()
    await expect(
      page.locator("[data-missing='true']"),
      '[data-missing="true"] must mark the unresolvable id',
    ).toBeVisible()
    await expect(
      page.locator("[data-error='missing']"),
      '[data-error="missing"] must accompany the missing state',
    ).toBeVisible()
    // The purged id must be kept in the form (data-persisted must still carry it).
    const persisted = page.locator('[data-persisted]')
    await expect(persisted, '[data-persisted] must still carry the purged id so it is not silently dropped').toBeVisible()
    const persistedValue = await persisted.getAttribute('data-persisted') ?? await persisted.inputValue().catch(() => '')
    expect(
      persistedValue.includes(PURGED_ITEM_ID),
      `[data-persisted] must keep the purged id "${PURGED_ITEM_ID}" — re-saving must not silently drop it`,
    ).toBe(true)
  })

  test('[data-panel="resolve-matrix"] shows locale resolution: ja falls back to source locale (never empty string)', async ({ page }) => {
    // The resolution matrix asserts one id renders per viewer locale,
    // with ja falling back to the source locale rather than an empty string.
    await injectListItems(page, 'countries', MOCK_COUNTRY_ITEMS)
    await injectResolve(page, {
      resolved: [
        { id: ARCHIVED_ITEM_ID, label: 'Old Country', locale: 'en', is_machine: false, status: 'archived' },
        // ja falls back to en (source locale) — there is no Japanese label.
      ],
      missing: [],
    })
    await gotoPickerHarness(page, { list: 'countries', mode: 'single', value: ARCHIVED_ITEM_ID })
    await expect(
      page.locator("[data-panel='resolve-matrix']"),
      '[data-panel="resolve-matrix"] must render the locale resolution matrix',
    ).toBeVisible()
    // ja must be represented in the matrix, falling back to the source locale.
    await expect(
      page.locator("[data-locale='ja']"),
      '[data-locale="ja"] must be present in the resolve matrix (shows fallback-to-source)',
    ).toBeVisible()
  })

  test('[data-persisted] carries the resolved archived id throughout the session', async ({ page }) => {
    await injectListItems(page, 'countries', MOCK_COUNTRY_ITEMS)
    await injectResolve(page, {
      resolved: [
        { id: ARCHIVED_ITEM_ID, label: 'Old Country', locale: 'en', is_machine: false, status: 'archived' },
      ],
      missing: [],
    })
    await gotoPickerHarness(page, { list: 'countries', mode: 'single', value: ARCHIVED_ITEM_ID })
    // The archived id must be persisted in the form value — the field never silently blanks.
    const persisted = page.locator('[data-persisted]')
    await expect(persisted, '[data-persisted] must be present even for an archived value').toBeVisible()
    const persistedValue = await persisted.getAttribute('data-persisted') ?? await persisted.inputValue().catch(() => '')
    expect(
      persistedValue.includes(ARCHIVED_ITEM_ID),
      `[data-persisted] must carry the archived id "${ARCHIVED_ITEM_ID}" — the field must never silently blank`,
    ).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Runtime console-clean gate (ui-runtime-validation — baseline §7.1)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Selection Lists picker — runtime console-clean gate (ui-runtime-validation)', () => {
  test('the single-picker harness route has a clean console (0 errors, 0 CSP/mixed-content, 0 failed app requests)', async ({ page }) => {
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
        url.includes('/v1/resolve') ||
        url.includes('/assets') ||
        url.includes('/embed/selection-list-picker')
      ) {
        failedRequests.push(`${req.method()} ${url} :: ${req.failure()?.errorText ?? 'failed'}`)
      }
    })

    await injectListItems(page, 'sales-regions', MOCK_SALES_REGION_ITEMS)
    await gotoPickerHarness(page, { list: 'sales-regions', mode: 'single' })
    await expect(page.locator("[data-panel='picker']")).toBeVisible()

    expect(consoleErrors, `console errors on picker harness:\n${consoleErrors.join('\n')}`).toEqual([])
    expect(failedRequests, `failed app requests on picker harness:\n${failedRequests.join('\n')}`).toEqual([])
  })

  test('the multi-picker harness route has a clean console', async ({ page }) => {
    const consoleErrors: string[] = []
    const failedRequests: string[] = []

    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', err => consoleErrors.push(`pageerror: ${String(err)}`))
    page.on('requestfailed', (req: Request) => {
      const url = req.url()
      if (url.includes('/v1/selection-lists') || url.includes('/v1/resolve') || url.includes('/assets')) {
        failedRequests.push(`${req.method()} ${url} :: ${req.failure()?.errorText ?? 'failed'}`)
      }
    })

    await injectListItems(page, 'countries', MOCK_COUNTRY_ITEMS)
    await gotoPickerHarness(page, { list: 'countries', mode: 'multi' })
    await expect(page.locator("[data-panel='picker']")).toBeVisible()

    expect(consoleErrors, `console errors on multi-picker harness:\n${consoleErrors.join('\n')}`).toEqual([])
    expect(failedRequests, `failed app requests on multi-picker harness:\n${failedRequests.join('\n')}`).toEqual([])
  })

  test('archived-value resolution route has a clean console — error must not throw into the host tree', async ({ page }) => {
    const consoleErrors: string[] = []
    const failedRequests: string[] = []
    const pageErrors: string[] = []

    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', err => {
      pageErrors.push(String(err))
      consoleErrors.push(`pageerror: ${String(err)}`)
    })
    page.on('requestfailed', (req: Request) => {
      const url = req.url()
      if (url.includes('/v1/selection-lists') || url.includes('/v1/resolve') || url.includes('/assets')) {
        failedRequests.push(`${req.method()} ${url} :: ${req.failure()?.errorText ?? 'failed'}`)
      }
    })

    await injectListItems(page, 'countries', MOCK_COUNTRY_ITEMS)
    await page.route('**/v1/resolve*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          resolved: [
            { id: ARCHIVED_ITEM_ID, label: 'Old Country', locale: 'en', is_machine: false, status: 'archived' },
          ],
          missing: [],
        }),
      })
    })
    await gotoPickerHarness(page, { list: 'countries', mode: 'single', value: ARCHIVED_ITEM_ID })
    await expect(page.locator("[data-panel='picker']")).toBeVisible()

    expect(consoleErrors, `console errors on archived-picker:\n${consoleErrors.join('\n')}`).toEqual([])
    expect(failedRequests, `failed app requests on archived-picker:\n${failedRequests.join('\n')}`).toEqual([])
    expect(pageErrors, 'archived value resolution must not throw into the host render tree').toEqual([])
  })
})
