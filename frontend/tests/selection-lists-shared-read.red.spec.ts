/**
 * SELECTION LISTS — SHARED LISTS (SL9) — FLOW 1 "shared-read" — RED-by-design UI e2e.
 * (frontend-test-engineer — independent verification, NOT the implementer.)
 *
 * ── What this file is ────────────────────────────────────────────────────────
 * TDD RED specs for the approved flow `shared-read` (approved 2026-10-20) of
 * `design/frames/selection-lists-shared/manifest.json`, derived STRICTLY from:
 *
 *   01-shared-index.html       (1a) list index with include_shared (grouping, shadow note, filters, states)
 *   02-common-detail.html      (1b) common list — read-only detail, single Fork CTA
 *   03-readonly-states.html    (1c) org read-only notice, shadowed notice, read-only translations, states
 *   11-rtl-mobile-detail.html  (1d) 375 px, en / he / ar (RTL)
 *
 * and the frozen contract services/selection-list-service/openapi.yaml (4.1.0). The
 * implementation target is packages/selection-lists-ui/src/shared-lists/{core,browse}/**
 * (build.components: VisibilityBadge, ForkBadge, EditableHint, SharedListsToggle,
 * VisibilityFilter, ListSourceGroups, ReadOnlyListNotice), behind the release flag
 * `fuzefront.selection-lists.shared-lists` (default OFF).
 *
 * ── Why most of these are RED today (READ THIS before "fixing" a failure) ────
 * None of the shared-lists UI exists yet. Every spec that asserts new UI is EXPECTED to
 * fail with "element(s) not found" on a frame hook (`[data-control='include-shared']`,
 * `[data-badge='common']`, `[data-action='fork-to-edit']`, ...) — NOT with a setup error.
 * That is the proof this is TDD, not tests retrofitted to a shipped UI. They are
 * deliberately NOT test.skip / test.fixme / quarantined.
 *
 * Two kinds of spec in here pass today and MUST keep passing:
 *   - SL9-READ-00x "canary" specs: the same mocks/session render the approved 4.0.0
 *     index/detail. They prove the harness is wired, so the RED failures are real.
 *   - "flag OFF" specs: absence assertions (the shared-lists UI must not leak when the
 *     flag is OFF). They guard the implementation against leaking UI; they cannot be RED.
 *
 * ── How they go GREEN / how this file lands ──────────────────────────────────
 * File name is `*.red.spec.ts` — the repo's convention for TDD-red specs
 * (skill microservice-readiness; precedent frontend/tests/*.red.spec.ts). The required
 * `selection-list-service-e2e` job lists its spec files explicitly, so a `.red.spec.ts`
 * is not part of any required check. The implementation PR for this flow flips it:
 *   git mv frontend/tests/selection-lists-shared-read.red.spec.ts \
 *          frontend/tests/selection-lists-shared-read.spec.ts
 * and adds the new name to the `Run selection-list e2e specs` list in
 * .github/workflows/ci.yml (job selection-list-service-e2e). See
 * docs/planning/selection-lists-shared-ui-red-specs.md.
 *
 * Selectors are the frames' data-* hooks (manifest testHooks) and ARIA roles. No class
 * names. `[data-frame=...]` is deliberately NOT used: the 4.0.0 components the shared
 * flows extend keep their own approved frame ids.
 *
 * Run (against `vite preview` of a production build, as CI does):
 *   cd frontend && BASE_URL=http://localhost:4173 npx playwright test \
 *     tests/selection-lists-shared-read.red.spec.ts --project=chromium
 */
import { test, expect, type Page } from '@playwright/test'
import {
  COMMON_ITEM_IDS,
  COMMON_PRIORITY_ID,
  FORK_PRIORITY_ID,
  LEAD_SOURCES_ID,
  MOBILE_375,
  ORGS,
  WAREHOUSE_ZONES_ID,
  WORK_STATUS_ID,
  YES_NO_ID,
  addList,
  commonPriorityItems,
  commonPriorityList,
  createWorld,
  deferred,
  documentDir,
  err,
  expectInViewport,
  expectLtrIsland,
  expectRuntimeClean,
  expectTouchTarget,
  failTimes,
  forkPriorityItems,
  forkPriorityList,
  hold,
  makeItem,
  makeList,
  mockSharedListsSession,
  mountSelectionListApi,
  openRoute,
  panelState,
  press,
  spaNavigate,
  trackRuntime,
  type Api,
  type Runtime,
  type ShellOrg,
  type World,
} from './support/selection-lists-shared-e2e'

// The Workbox service worker would bypass page.route() mocks once it claims the page.
test.use({ serviceWorkers: 'block' })

const INDEX = '/settings/selection-lists'
const detail = (id: string) => `${INDEX}/${id}`

let rt: Runtime
// "Never throw into the host" applies to every spec, red or green.
test.afterEach(() => {
  if (rt) expect(rt.pageErrors, 'no uncaught exception may reach the page').toEqual([])
})

async function setup(page: Page, opts: { flag?: boolean; org?: ShellOrg; build?: (w: World) => void } = {}) {
  rt = trackRuntime(page)
  const org = await mockSharedListsSession(page, { sharedLists: opts.flag ?? true, org: opts.org ?? ORGS.acme })
  const world = createWorld(org.id)
  opts.build?.(world)
  const api = await mountSelectionListApi(page, world)
  return { api, world, org }
}

/** Acme's index: its fork of Priority (shadows the common one), an org list it cannot edit, a private list, and the common lists. */
function acmeIndex(w: World) {
  addList(w, forkPriorityList(), forkPriorityItems(), { role: true })
  addList(
    w,
    makeList({ id: LEAD_SOURCES_ID, key: 'lead-sources', name: 'Lead sources', organization_id: ORGS.acme.id, visibility: 'org', editable: false, item_count: 3, forked_from: null }),
  )
  addList(
    w,
    makeList({ id: WAREHOUSE_ZONES_ID, key: 'warehouse-zones', name: 'Warehouse zones', organization_id: ORGS.acme.id, visibility: 'private', editable: true, item_count: 12, forked_from: null }),
    [],
    { role: true },
  )
  addList(w, commonPriorityList(), commonPriorityItems())
  addList(w, makeList({ id: YES_NO_ID, key: 'yes-no', name: 'Yes / No', organization_id: ORGS.platform.id, visibility: 'platform', editable: false, item_count: 2, forked_from: null }))
  addList(w, makeList({ id: WORK_STATUS_ID, key: 'work-status', name: 'Work status', organization_id: ORGS.platform.id, visibility: 'platform', editable: false, item_count: 6, forked_from: null }))
}

const indexCalls = (api: Api) => api.callsTo('GET', '/v1/selection-lists').filter(c => !c.query.get('key'))
const lastIndexCall = (api: Api) => indexCalls(api).at(-1)
const row = (page: Page, key: string, source?: string) =>
  page.locator(`[data-panel='list-index'] [data-list='${key}']${source ? `[data-source='${source}']` : ''}`)
const toggle = (page: Page) => page.locator("[data-control='include-shared']")

// ═════════════════════════════════════════════════════════════════════════════
// Frame 01 — (1a) shared index
// ═════════════════════════════════════════════════════════════════════════════
test.describe('SL9 shared-read — frame 01-shared-index', () => {
  test('SL9-READ-001 canary: the same session + mocks render the approved 4.0.0 index (passes today)', async ({ page }) => {
    await setup(page, { build: acmeIndex })
    await openRoute(page, INDEX)
    await expect(page.locator("[data-panel='list-index']")).toBeVisible()
    await expect(row(page, 'warehouse-zones')).toBeVisible()
  })

  test('SL9-READ-002 flag ON: the index requests include_shared=true with NO visibility param, and the switch is ON', async ({ page }) => {
    const { api } = await setup(page, { build: acmeIndex })
    await openRoute(page, INDEX)
    await expect(toggle(page), 'SharedListsToggle must render while the flag is ON').toBeVisible()
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'true')
    await expect.poll(() => lastIndexCall(api)?.query.get('include_shared')).toBe('true')
    expect(lastIndexCall(api)!.query.has('visibility'), 'default request carries no visibility param').toBe(false)
    expectRuntimeClean(rt)
  })

  test('SL9-READ-003 rows are grouped client-side: "Your organization" (organization_id = active org) then "Common lists" (visibility = platform)', async ({ page }) => {
    await setup(page, { build: acmeIndex })
    await openRoute(page, INDEX)
    await expect(page.locator("[data-group='own']")).toBeVisible()
    await expect(page.locator("[data-group='common']")).toBeVisible()
    const owner = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll("[data-panel='list-index'] [data-group], [data-panel='list-index'] [data-list]"))
      let group = ''
      return nodes.map(n => {
        if (n.hasAttribute('data-group')) {
          group = n.getAttribute('data-group') as string
          return null
        }
        return `${n.getAttribute('data-list')}:${n.getAttribute('data-source')}:${group}`
      }).filter(Boolean)
    })
    expect(owner).toEqual(expect.arrayContaining([
      'priority:own:own',
      'lead-sources:own:own',
      'warehouse-zones:own:own',
      'yes-no:platform:common',
      'work-status:platform:common',
    ]))
    // The group header precedes its rows.
    await expect(page.locator("[data-group='own']")).toContainText(/your organization/i)
    await expect(page.locator("[data-group='common']")).toContainText(/common lists/i)
  })

  test('SL9-READ-004 per-row markers: Common badge, Fork badge, visibility from `visibility` (absent => private), "Your access" only when `editable` is present', async ({ page }) => {
    await setup(page, {
      build: w => {
        acmeIndex(w)
        // A 4.0.0-shaped row: no visibility, no forked_from, no editable.
        addList(w, makeList({ id: 'front_sl_01j9qk7m2x4c8e6g0h3n5r7tce', key: 'legacy-codes', name: 'Legacy codes', organization_id: ORGS.acme.id }), [], { role: true })
      },
    })
    await openRoute(page, INDEX)
    await expect(row(page, 'priority', 'own').locator("[data-badge='fork']"), 'a fork row carries ForkBadge').toBeVisible()
    await expect(row(page, 'priority', 'own').locator("[data-visibility='org']")).toBeVisible()
    await expect(row(page, 'priority', 'own').locator("[data-editable='true']")).toBeVisible()
    await expect(row(page, 'lead-sources').locator("[data-editable='false']"), 'editable=false => read-only marker').toBeVisible()
    await expect(row(page, 'yes-no').locator("[data-badge='common']"), 'a platform row carries the Common badge').toBeVisible()
    await expect(row(page, 'yes-no').locator("[data-visibility='platform']")).toBeVisible()
    await expect(row(page, 'warehouse-zones').locator("[data-visibility='private']")).toBeVisible()
    // Absent visibility => private; absent editable => NO marker at all (unknown is never read as false).
    const legacy = row(page, 'legacy-codes')
    await expect(legacy.locator("[data-visibility='private']")).toBeVisible()
    await expect(legacy.locator('[data-editable]'), 'absent `editable` renders no access marker').toHaveCount(0)
    await expect(legacy.locator('[data-badge]'), 'a plain private list carries no Common/Fork badge').toHaveCount(0)
    await expect(page.getByRole('columnheader', { name: /^visibility$/i })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: /your access/i })).toBeVisible()
  })

  test('SL9-READ-005 shadow note is SOURCE-NEUTRAL: names the fork key, never claims a common list is "hidden"/"replaced", and the shadowed common list is not re-added', async ({ page }) => {
    await setup(page, { build: acmeIndex })
    await openRoute(page, INDEX)
    const note = page.locator("[data-shadow-note='priority']")
    await expect(note).toBeVisible()
    await expect(note).toContainText(/priority/)
    await expect(note).toContainText(/is your organization.s fork; a common list with the same key is not listed here/i)
    await expect(note).not.toContainText(/hidden|replaced/i)
    await expect(row(page, 'priority', 'platform'), 'the service omitted common Priority; the UI must not re-add it').toHaveCount(0)
  })

  test('SL9-READ-006 no shadow note without a loaded fork row (note is driven by a row with forked_from set)', async ({ page }) => {
    await setup(page, {
      build: w => {
        addList(w, makeList({ id: LEAD_SOURCES_ID, key: 'lead-sources', name: 'Lead sources', organization_id: ORGS.acme.id, visibility: 'org', editable: false, forked_from: null }))
        addList(w, makeList({ id: YES_NO_ID, key: 'yes-no', name: 'Yes / No', organization_id: ORGS.platform.id, visibility: 'platform', editable: false, forked_from: null }))
      },
    })
    await openRoute(page, INDEX)
    await expect(row(page, 'yes-no')).toBeVisible()
    await expect(page.locator('[data-shadow-note]')).toHaveCount(0)
  })

  test('SL9-READ-007 "Load more" sends page.nextCursor and appends into the groups', async ({ page }) => {
    const { api } = await setup(page, { build: w => { acmeIndex(w); w.pageSize = 3 } })
    await openRoute(page, INDEX)
    await expect(page.locator("[data-action='load-more']")).toBeVisible()
    await expect(row(page, 'yes-no')).toHaveCount(0)
    await press(page.locator("[data-action='load-more']"))
    await expect(row(page, 'yes-no', 'platform')).toBeVisible()
    await expect(row(page, 'priority', 'own'), 'rows of page 1 are kept').toBeVisible()
    await expect(page.locator("[data-group='common']")).toBeVisible()
    expect(lastIndexCall(api)!.query.get('cursor'), 'the cursor from page.nextCursor is echoed back').toBe('3')
    expect(lastIndexCall(api)!.query.get('include_shared')).toBe('true')
  })

  test('SL9-READ-008 visibility filter (Common) sends include_shared=true&visibility=platform, drops grouping and reveals the shadowed common list without claiming replacement', async ({ page }) => {
    const { api } = await setup(page, { build: acmeIndex })
    await openRoute(page, INDEX)
    const filter = page.locator("[data-filter='visibility']")
    await expect(filter, 'VisibilityFilter renders while the switch is ON').toBeVisible()
    await expect(filter.locator("[data-visibility-filter='any']")).toHaveAttribute('aria-pressed', 'true')
    await press(filter.locator("[data-visibility-filter='platform']"))
    await expect.poll(() => lastIndexCall(api)?.query.get('visibility')).toBe('platform')
    expect(lastIndexCall(api)!.query.get('include_shared')).toBe('true')
    await expect(row(page, 'priority', 'platform'), 'shadowing is off: the common Priority reappears').toBeVisible()
    await expect(row(page, 'yes-no')).toBeVisible()
    await expect(page.locator('[data-group]'), 'no grouping: the filter already is the group').toHaveCount(0)
    await expect(page.locator('[data-shadow-note]'), 'a filtered page never claims which common lists are replaced').toHaveCount(0)
  })

  for (const v of ['private', 'org'] as const) {
    test(`SL9-READ-009${v === 'org' ? 'b' : 'a'} visibility filter "${v}" sends include_shared=true&visibility=${v}`, async ({ page }) => {
      const { api } = await setup(page, { build: acmeIndex })
      await openRoute(page, INDEX)
      await press(page.locator(`[data-visibility-filter='${v}']`))
      await expect.poll(() => lastIndexCall(api)?.query.get('visibility')).toBe(v)
      expect(lastIndexCall(api)!.query.get('include_shared')).toBe('true')
    })
  }

  test('SL9-READ-010 switch OFF: filter is ABSENT (not disabled), reset to Any, request carries NEITHER include_shared nor visibility; ON again restores the filter at Any', async ({ page }) => {
    const { api } = await setup(page, { build: acmeIndex })
    await openRoute(page, INDEX)
    await press(page.locator("[data-visibility-filter='org']"))
    await expect.poll(() => lastIndexCall(api)?.query.get('visibility')).toBe('org')

    await press(toggle(page))
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'false')
    await expect(page.locator("[data-toolbar='list-index'][data-include-shared='false']")).toBeVisible()
    await expect(page.locator("[data-filter='visibility']"), 'absent, not disabled').toHaveCount(0)
    await expect.poll(() => lastIndexCall(api)?.query.has('include_shared')).toBe(false)
    expect(lastIndexCall(api)!.query.has('visibility'), 'visibility is reset and not sent').toBe(false)
    await expect(row(page, 'yes-no'), 'common lists need include_shared, so they are gone').toHaveCount(0)
    await expect(page.locator('[data-group]')).toHaveCount(0)

    await press(toggle(page))
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator("[data-visibility-filter='any']"), 'a filter choice is never carried across the switch').toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => lastIndexCall(api)?.query.get('include_shared')).toBe('true')
    expect(lastIndexCall(api)!.query.has('visibility')).toBe(false)
  })

  test('SL9-READ-011 a11y: the switch is role=switch with a name and toggles by keyboard; the visibility filter is a labelled group of toggle buttons', async ({ page }) => {
    await setup(page, { build: acmeIndex })
    await openRoute(page, INDEX)
    const sw = page.getByRole('switch', { name: /include common lists/i })
    await expect(sw).toBeVisible()
    await sw.focus()
    await page.keyboard.press('Space')
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    await page.keyboard.press('Space')
    await expect(sw).toHaveAttribute('aria-checked', 'true')
    const group = page.getByRole('group', { name: /visibility/i })
    await expect(group).toBeVisible()
    await expect(group.locator('[aria-pressed]')).toHaveCount(4)
  })

  test('SL9-READ-012 loading: skeleton rows, group headers appear WITH the rows and never before', async ({ page }) => {
    const gate = deferred()
    const { api } = await setup(page, { build: acmeIndex })
    api.use(hold('GET', '/v1/selection-lists', gate.promise))
    await openRoute(page, INDEX)
    await expect(panelState(page, 'list-index', 'loading')).toBeVisible()
    await expect(page.locator("[data-panel='list-index'] [aria-busy='true'], [data-panel='list-index'][aria-busy='true']").first()).toBeVisible()
    await expect(page.locator('[data-group]'), 'no empty "Common lists" header while loading').toHaveCount(0)
    gate.resolve()
    await expect(page.locator("[data-group='common']")).toBeVisible()
  })

  test('SL9-READ-013 error: retry, toggle and filters keep their values, nothing is changed', async ({ page }) => {
    const { api } = await setup(page, { build: acmeIndex })
    await openRoute(page, INDEX)
    await expect(row(page, 'yes-no')).toBeVisible()
    api.use(failTimes(1, 'GET', '/v1/selection-lists', err(500, 'INTERNAL')))
    await press(page.locator("[data-visibility-filter='org']"))
    const errState = panelState(page, 'list-index', 'error')
    await expect(errState).toBeVisible()
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator("[data-visibility-filter='org']")).toHaveAttribute('aria-pressed', 'true')
    const before = lastIndexCall(api)!.query.toString()
    await press(page.locator("[data-panel='list-index'] [data-action='retry']"))
    await expect.poll(() => indexCalls(api).length).toBeGreaterThan(2)
    expect(lastIndexCall(api)!.query.toString(), 'retry re-sends the same filters').toBe(before)
    await expect(row(page, 'lead-sources')).toBeVisible()
  })

  test('SL9-READ-014 empty (switch ON, nothing readable): "No lists yet" with the create CTA', async ({ page }) => {
    await setup(page)
    await openRoute(page, INDEX)
    const empty = panelState(page, 'list-index', 'empty')
    await expect(empty).toBeVisible()
    await expect(empty).toContainText(/no lists yet/i)
    await expect(empty, 'frame 01 copy: no common lists are published').toContainText(/no common lists are published/i)
    await expect(page.locator("[data-panel='list-index'] [data-action='new-list']").first()).toBeVisible()
  })

  test('SL9-READ-015 empty (switch OFF, no roles): offers "Include common lists" and turning it on re-requests with include_shared=true', async ({ page }) => {
    const { api } = await setup(page, {
      build: w => {
        addList(w, makeList({ id: YES_NO_ID, key: 'yes-no', name: 'Yes / No', organization_id: ORGS.platform.id, visibility: 'platform', editable: false, forked_from: null }))
      },
    })
    await openRoute(page, INDEX)
    await expect(row(page, 'yes-no')).toBeVisible()
    await press(toggle(page))
    const empty = panelState(page, 'list-index', 'empty-shared-off')
    await expect(empty).toBeVisible()
    await expect(empty).toContainText(/no lists you have a role on/i)
    await press(page.locator("[data-action='enable-include-shared']"))
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'true')
    await expect.poll(() => lastIndexCall(api)?.query.get('include_shared')).toBe('true')
    await expect(row(page, 'yes-no')).toBeVisible()
  })

  test('SL9-READ-016 flag OFF: the approved 4.0.0 index — no switch, no filter, no groups, no badges, no Visibility / Your-access columns, neither param ever sent (guard; passes today)', async ({ page }) => {
    const { api } = await setup(page, { flag: false, build: acmeIndex })
    await openRoute(page, INDEX)
    await expect(row(page, 'warehouse-zones'), '4.0.0 index renders').toBeVisible()
    for (const hook of ["[data-control='include-shared']", "[data-filter='visibility']", '[data-group]', '[data-badge]', '[data-visibility]', '[data-editable]', '[data-shadow-note]', "[data-state='flag-off']:not([data-panel])"]) {
      await expect(page.locator(hook), `${hook} must be absent while the flag is OFF`).toHaveCount(0)
    }
    await expect(page.getByRole('columnheader', { name: /^visibility$|your access/i })).toHaveCount(0)
    expect(indexCalls(api).length).toBeGreaterThan(0)
    for (const c of indexCalls(api)) {
      expect(c.query.has('include_shared'), 'flag OFF: no include_shared').toBe(false)
      expect(c.query.has('visibility'), 'flag OFF: no visibility').toBe(false)
    }
  })

  test('SL9-READ-017 console-clean gate: the ready index (flag ON) renders with 0 console errors, 0 uncaught exceptions, same-origin API', async ({ page }) => {
    await setup(page, { build: acmeIndex })
    await openRoute(page, INDEX)
    await expect(page.locator("[data-group='common']")).toBeVisible()
    expectRuntimeClean(rt)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Frame 02 — (1b) common list, read-only detail
// ═════════════════════════════════════════════════════════════════════════════
function globexCommonDetail(w: World) {
  addList(w, commonPriorityList(), commonPriorityItems())
}

test.describe('SL9 shared-read — frame 02-common-detail', () => {
  test('SL9-READ-020 canary: the 4.0.0 detail renders from the same mocks (passes today)', async ({ page }) => {
    await setup(page, {
      flag: false,
      org: ORGS.acme,
      build: w => addList(w, makeList({ id: WAREHOUSE_ZONES_ID, key: 'warehouse-zones', name: 'Warehouse zones', organization_id: ORGS.acme.id, visibility: 'private', editable: true }), [makeItem({ id: 'front_sli_01j9qk7m2x4c8e6g0h3n5r7tz1', list_id: WAREHOUSE_ZONES_ID, code: 'A', label: 'Zone A' })], { role: true }),
    })
    await openRoute(page, detail(WAREHOUSE_ZONES_ID))
    await expect(page.locator("[data-panel='value-editor']")).toBeVisible()
  })

  test('SL9-READ-021 common list detail: Common badge, "Read-only for you", platform notice, owner facts, read-only value table with archived value badged', async ({ page }) => {
    const { api } = await setup(page, { org: ORGS.globex, build: globexCommonDetail })
    await openRoute(page, detail(COMMON_PRIORITY_ID))
    await expect(page.locator("[data-badge='common']").first()).toBeVisible()
    await expect(page.locator("[data-visibility='platform']").first()).toBeVisible()
    await expect(page.locator("[data-editable='false']").first()).toContainText(/read-only/i)
    const notice = page.locator("[data-readonly-notice='platform']")
    await expect(notice).toBeVisible()
    await expect(notice).toHaveAttribute('role', 'note')
    await expect(notice).toContainText(/fork/i)
    await expect(page.locator("[data-owner-org='platform']")).toBeVisible()
    await expect(page.locator("[data-panel='value-table'][data-readonly='true']")).toBeVisible()
    for (const id of [COMMON_ITEM_IDS.low, COMMON_ITEM_IDS.normal, COMMON_ITEM_IDS.high, COMMON_ITEM_IDS.urgent]) {
      await expect(page.locator(`[data-item='${id}']`)).toBeVisible()
    }
    const archived = page.locator(`[data-item='${COMMON_ITEM_IDS.critical}'][data-archived='true']`)
    await expect(archived, 'archived values are listed and badged so stored values can be recognised').toBeVisible()
    await expect(archived).toContainText(/archived/i)
    expect(api.callsTo('GET', `/v1/selection-lists/${COMMON_PRIORITY_ID}/items`).some(c => c.query.get('status') === 'all'), 'values are read with status=all').toBe(true)
    expectRuntimeClean(rt)
  })

  test('SL9-READ-022 read-only means ABSENT, not disabled: no add value, drag handles, edit/archive/delete, Access tab — and GET …/access is never called', async ({ page }) => {
    const { api } = await setup(page, { org: ORGS.globex, build: globexCommonDetail })
    await openRoute(page, detail(COMMON_PRIORITY_ID))
    await expect(page.locator("[data-panel='value-table'][data-readonly='true']")).toBeVisible()
    await expect(page.locator("[data-action='fork-to-edit']")).toBeVisible()
    for (const hook of ["[data-action='add-value']", '[data-drag-handle]', "[data-action='archive-value']", "[data-action='purge-value']", "[data-tab='access']"]) {
      await expect(page.locator(hook), `${hook} must not render on a read-only common list`).toHaveCount(0)
    }
    await expect(page.getByRole('button', { name: /^edit$/i })).toHaveCount(0)
    await expect(page.locator("[data-tab='translations']")).toBeVisible()
    expect(api.callsTo('GET', `/v1/selection-lists/${COMMON_PRIORITY_ID}/access`), 'a reader cannot see a roster: never requested').toHaveLength(0)
  })

  test('SL9-READ-023 the ONE action is "Fork to edit…": rendered only when the effective-list lookup (key=…&include_shared=true&limit=1) returns THIS list', async ({ page }) => {
    const { api } = await setup(page, { org: ORGS.globex, build: globexCommonDetail })
    await openRoute(page, detail(COMMON_PRIORITY_ID))
    await expect(page.locator("[data-action='fork-to-edit']")).toBeVisible()
    await expect(page.locator("[data-action='fork-to-edit']")).toContainText(/fork to edit/i)
    const lookup = api.callsTo('GET', '/v1/selection-lists').find(c => c.query.get('key') === 'priority')
    expect(lookup, 'getEffectiveList(key) is asked once').toBeDefined()
    expect(lookup!.query.get('include_shared')).toBe('true')
    expect(lookup!.query.get('limit')).toBe('1')
  })

  test('SL9-READ-024 no Fork CTA, notice or badge guess while the effective-list answer is pending; a failed lookup renders the plain notice, NO CTA, and a quiet retry', async ({ page }) => {
    const gate = deferred()
    const { api } = await setup(page, { org: ORGS.globex, build: globexCommonDetail })
    api.use(hold('GET', '/v1/selection-lists', gate.promise, c => c.query.get('key') === 'priority'))
    await openRoute(page, detail(COMMON_PRIORITY_ID))
    await expect(panelState(page, 'value-table', 'loading').or(page.locator("[data-panel='value-table']")).first()).toBeVisible()
    await page.waitForTimeout(300)
    await expect(page.locator("[data-action='fork-to-edit']"), 'a control that flashes and disappears reads as a bug').toHaveCount(0)
    gate.resolve()
    await expect(page.locator("[data-action='fork-to-edit']")).toBeVisible()
  })

  test('SL9-READ-025 effective-list lookup failure: plain common-list notice without a Fork CTA plus a quiet Retry that restores the CTA', async ({ page }) => {
    const { api } = await setup(page, { org: ORGS.globex, build: globexCommonDetail })
    api.use(failTimes(1, 'GET', '/v1/selection-lists', err(500, 'INTERNAL'), c => c.query.get('key') === 'priority'))
    await openRoute(page, detail(COMMON_PRIORITY_ID))
    await expect(page.locator("[data-readonly-notice='platform']")).toBeVisible()
    await expect(page.locator("[data-action='fork-to-edit']"), 'never offer Fork on a guess').toHaveCount(0)
    await press(page.locator("[data-readonly-notice='platform'] [data-action='retry'], [data-action='retry']").first())
    await expect(page.locator("[data-action='fork-to-edit']")).toBeVisible()
  })

  test('SL9-READ-026 `editable` absent (service still on 4.0.0 behaviour): no read-only marker, no notice, no Fork CTA — the 4.0.0 affordances stay', async ({ page }) => {
    await setup(page, {
      org: ORGS.globex,
      build: w => addList(w, commonPriorityList({ editable: undefined, visibility: undefined }), commonPriorityItems()),
    })
    await openRoute(page, detail(COMMON_PRIORITY_ID))
    await expect(panelState(page, 'value-table', 'editable-unknown')).toBeVisible()
    await expect(page.locator("[data-editable='false'], [data-editable='true']")).toHaveCount(0)
    await expect(page.locator('[data-readonly-notice]')).toHaveCount(0)
    await expect(page.locator("[data-action='fork-to-edit']")).toHaveCount(0)
    await expect(page.locator("[data-action='add-value']"), 'absence is unknown, never false: the 4.0.0 affordances render').toBeVisible()
  })

  test('SL9-READ-027 a11y: the notice is a note landmark, the tab list exposes Values/Translations with aria-selected, the Fork CTA is reachable by keyboard', async ({ page }) => {
    await setup(page, { org: ORGS.globex, build: globexCommonDetail })
    await openRoute(page, detail(COMMON_PRIORITY_ID))
    await expect(page.getByRole('note').filter({ hasText: /common list/i }).first()).toBeVisible()
    await expect(page.getByRole('tab', { name: /values/i })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tab', { name: /translations/i })).toHaveAttribute('aria-selected', 'false')
    await page.locator("[data-action='fork-to-edit']").focus()
    await expect(page.locator("[data-action='fork-to-edit']")).toBeFocused()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Frame 03 — (1c) read-only states
// ═════════════════════════════════════════════════════════════════════════════
const leadSources = (over: Partial<ReturnType<typeof makeList>> = {}) =>
  makeList({ id: LEAD_SOURCES_ID, key: 'lead-sources', name: 'Lead sources', organization_id: ORGS.acme.id, visibility: 'org', editable: false, forked_from: null, item_count: 3, ...over })
const leadItems = () => [
  makeItem({ id: 'front_sli_01j9qk7m2x4c8e6g0h3n5r7tc1', list_id: LEAD_SOURCES_ID, code: 'REF', label: 'Referral', sort_order: 1 }),
  makeItem({ id: 'front_sli_01j9qk7m2x4c8e6g0h3n5r7tc2', list_id: LEAD_SOURCES_ID, code: 'EVENT', label: 'Trade show', sort_order: 2 }),
  makeItem({ id: 'front_sli_01j9qk7m2x4c8e6g0h3n5r7tc3', list_id: LEAD_SOURCES_ID, code: 'WEB', label: 'Inbound web', sort_order: 3 }),
]

test.describe('SL9 shared-read — frame 03-readonly-states', () => {
  const HINTS = [
    { kind: 'user', created_by: 'usr_01h455vb4pex5vsknk084sn0aa', text: /created by a user, not set up automatically/i },
    { kind: 'system', created_by: 'system:selection-list-service', text: /set up automatically for your organization/i },
    { kind: 'deleted-user', created_by: '[deleted-user]', text: /creator.s account has been deleted/i },
  ] as const

  for (const h of HINTS) {
    test(`SL9-READ-030-${h.kind} org list read-only: ReadOnlyListNotice(org) + owner hint decided offline from created_by (${h.kind}); no raw id, no directory lookup, no Fork CTA`, async ({ page }) => {
      const directory: string[] = []
      page.on('request', r => {
        if (/\/(users|members|directory|search)\b/i.test(new URL(r.url()).pathname) && !/\/api\/v1\/selection-lists/.test(r.url())) directory.push(r.url())
      })
      await setup(page, { build: w => addList(w, leadSources({ created_by: h.created_by }), leadItems()) })
      await openRoute(page, detail(LEAD_SOURCES_ID))
      await expect(page.locator("[data-visibility='org']").first()).toBeVisible()
      await expect(page.locator("[data-editable='false']").first()).toBeVisible()
      const notice = page.locator("[data-readonly-notice='org']")
      await expect(notice).toBeVisible()
      const hint = page.locator(`[data-owner-hint][data-created-by-kind='${h.kind}']`)
      await expect(hint).toBeVisible()
      await expect(hint).toContainText(h.text)
      const body = await page.locator('body').innerText()
      expect(body, 'the raw AuthorPrincipal is never rendered').not.toContain(h.created_by)
      expect(directory, 'no user/directory lookup is performed for the hint').toEqual([])
      await expect(page.locator("[data-action='fork-to-edit']"), 'fork_not_applicable: never offered on an own-org list').toHaveCount(0)
      await expect(page.getByRole('button', { name: /request access/i })).toHaveCount(0)
      await expect(page.getByRole('link', { name: /request access/i })).toHaveCount(0)
    })
  }

  test('SL9-READ-031 a common list the org already replaced: shadowed notice with "Open your version" -> the fork; NO Fork CTA', async ({ page }) => {
    await setup(page, {
      org: ORGS.acme,
      build: w => {
        addList(w, forkPriorityList(), forkPriorityItems(), { role: true })
        addList(w, commonPriorityList(), commonPriorityItems())
      },
    })
    await openRoute(page, detail(COMMON_PRIORITY_ID))
    const notice = page.locator("[data-readonly-notice='shadowed']")
    await expect(notice).toBeVisible()
    await expect(notice).toContainText(/uses its own version of this list/i)
    await expect(page.locator("[data-action='fork-to-edit']")).toHaveCount(0)
    const open = page.locator("[data-action='open-own-version']")
    await expect(open).toBeVisible()
    await open.click()
    await expect(page).toHaveURL(new RegExp(`${FORK_PRIORITY_ID}$`))
  })

  test('SL9-READ-032 read-only translations tab: locale index without Edit / Auto-fill / Add language; translated locales link to the read-only view, the source locale does not; M badge kept', async ({ page }) => {
    await setup(page, { org: ORGS.globex, build: globexCommonDetail })
    await openRoute(page, detail(COMMON_PRIORITY_ID))
    await press(page.locator("[data-tab='translations']"))
    const index = page.locator("[data-panel='locale-index'][data-readonly='true']")
    await expect(index).toBeVisible()
    await expect(index.locator("[data-locale='en']")).toBeVisible()
    await expect(index.locator("[data-locale-link='en']"), 'the source locale has no link — its text is the Values tab').toHaveCount(0)
    await expect(index.locator("[data-action='open-locale-readonly'][data-locale-link='fr']")).toBeVisible()
    await expect(index.locator("[data-action='open-locale-readonly'][data-locale-link='he']")).toBeVisible()
    await expect(index.locator("[data-machine='true']").first(), 'machine text keeps its M badge').toBeVisible()
    for (const hook of ["[data-action='start-translation']", "[data-action='autofill']", "[data-action='add-language']"]) {
      await expect(page.locator(hook)).toHaveCount(0)
    }
    await expect(page.getByRole('button', { name: /edit|auto-?fill|add language/i })).toHaveCount(0)
  })

  test('SL9-READ-033 read-only locale view (/translations/:locale): plain text target column — no inputs, Save, Save all, Mark reviewed, Auto-fill; M badge kept; Hebrew target cell is dir=rtl', async ({ page }) => {
    await setup(page, { org: ORGS.globex, build: globexCommonDetail })
    await openRoute(page, `${detail(COMMON_PRIORITY_ID)}/translations`)
    await press(page.locator("[data-action='open-locale-readonly'][data-locale-link='fr']"))
    await expect(page).toHaveURL(new RegExp(`/settings/selection-lists/${COMMON_PRIORITY_ID}/translations/fr$`))
    const view = page.locator("[data-panel='locale-editor'][data-readonly='true'][data-locale-view='fr']")
    await expect(view).toBeVisible()
    await expect(view.locator('input, textarea')).toHaveCount(0)
    for (const hook of ["[data-action='save-row']", "[data-action='save-all']", "[data-action='mark-reviewed']", "[data-action='autofill']"]) {
      await expect(page.locator(hook)).toHaveCount(0)
    }
    await expect(view.locator("[data-machine='true']").first()).toBeVisible()
    await expect(view).toContainText('Basse')

    await spaNavigate(page, `${detail(COMMON_PRIORITY_ID)}/translations/he`)
    const heView = page.locator("[data-panel='locale-editor'][data-readonly='true'][data-locale-view='he']")
    await expect(heView).toBeVisible()
    await expect(heView.locator("[dir='rtl']").first(), 'per-cell dir=rtl exactly as in the editor').toBeVisible()
  })

  test('SL9-READ-034 loading: no badge, notice or CTA until the list (and the effective-list answer) is known', async ({ page }) => {
    const gate = deferred()
    const { api } = await setup(page, { org: ORGS.globex, build: globexCommonDetail })
    api.use(hold('GET', `/v1/selection-lists/${COMMON_PRIORITY_ID}`, gate.promise))
    await openRoute(page, detail(COMMON_PRIORITY_ID))
    await expect(panelState(page, 'value-table', 'loading')).toBeVisible()
    await expect(page.locator("[data-panel='value-table'] [aria-busy='true'], [data-panel='value-table'][aria-busy='true']").first()).toBeVisible()
    for (const hook of ["[data-badge='common']", '[data-readonly-notice]', "[data-action='fork-to-edit']", "[data-action='add-value']", '[data-editable]']) {
      await expect(page.locator(hook), `${hook} must wait for the list — never guess "editable"`).toHaveCount(0)
    }
    gate.resolve()
    await expect(page.locator("[data-badge='common']").first()).toBeVisible()
  })

  test('SL9-READ-035 empty: "No values to pick from", and NO add CTA for a read-only viewer', async ({ page }) => {
    await setup(page, { org: ORGS.globex, build: w => addList(w, commonPriorityList({ item_count: 0 }), []) })
    await openRoute(page, detail(COMMON_PRIORITY_ID))
    const empty = panelState(page, 'value-table', 'empty')
    await expect(empty).toBeVisible()
    await expect(empty).toContainText(/no values to pick from/i)
    await expect(page.locator("[data-action='add-value']")).toHaveCount(0)
  })

  test('SL9-READ-036 values error: Retry in place; the badge and notice (from the list, which loaded) are kept', async ({ page }) => {
    const { api } = await setup(page, { org: ORGS.globex, build: globexCommonDetail })
    api.use(failTimes(1, 'GET', `/v1/selection-lists/${COMMON_PRIORITY_ID}/items`, err(500, 'INTERNAL')))
    await openRoute(page, detail(COMMON_PRIORITY_ID))
    await expect(panelState(page, 'value-table', 'error')).toBeVisible()
    await expect(page.locator("[data-badge='common']").first()).toBeVisible()
    await expect(page.locator("[data-readonly-notice='platform']")).toBeVisible()
    await press(page.locator("[data-panel='value-table'] [data-action='retry']"))
    await expect(page.locator(`[data-item='${COMMON_ITEM_IDS.low}']`)).toBeVisible()
  })

  test('SL9-READ-037 404 (another org\'s list, or no shared read): "List not found" — never a 403 / permission message', async ({ page }) => {
    await setup(page, { org: ORGS.globex })
    await openRoute(page, detail(COMMON_PRIORITY_ID))
    const nf = panelState(page, 'value-table', 'not-found')
    await expect(nf).toBeVisible()
    await expect(page.locator("[data-error='NOT_FOUND']")).toContainText(/list not found/i)
    await expect(page.locator('body')).not.toContainText(/forbidden|403|permission/i)
  })

  test('SL9-READ-038 flag OFF detail: approved 4.0.0 detail — no badge, notice, Fork CTA, effective-list lookup; 4.1.0 shapes from the service are ignored (guard; passes today)', async ({ page }) => {
    const { api } = await setup(page, {
      flag: false,
      org: ORGS.acme,
      build: w =>
        addList(
          w,
          makeList({ id: WAREHOUSE_ZONES_ID, key: 'warehouse-zones', name: 'Warehouse zones', organization_id: ORGS.acme.id, visibility: 'private', forked_from: null, editable: false }),
          [makeItem({ id: 'front_sli_01j9qk7m2x4c8e6g0h3n5r7tz1', list_id: WAREHOUSE_ZONES_ID, code: 'A', label: 'Zone A' })],
          { role: true },
        ),
    })
    await openRoute(page, detail(WAREHOUSE_ZONES_ID))
    await expect(page.locator("[data-panel='value-editor']")).toBeVisible()
    for (const hook of ['[data-badge]', '[data-readonly-notice]', "[data-action='fork-to-edit']", '[data-visibility]', "[data-editable='false']"]) {
      await expect(page.locator(hook), `${hook} must be absent while the flag is OFF`).toHaveCount(0)
    }
    await expect(page.locator("[data-action='add-value']"), 'editable=false from the service is ignored while OFF').toBeVisible()
    expect(api.callsTo('GET', '/v1/selection-lists').filter(c => c.query.get('key') || c.query.get('include_shared')), 'no effective-list lookup while OFF').toHaveLength(0)
  })

  test('SL9-READ-039 flag OFF: a member without a role gets the 4.0.0 404 for an org-visible list', async ({ page }) => {
    await setup(page, { flag: false, org: ORGS.acme })
    await openRoute(page, detail(LEAD_SOURCES_ID))
    await expect(page.locator("[data-error='NOT_FOUND']")).toBeVisible()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Frame 11 — (1d) RTL + 375 px
// ═════════════════════════════════════════════════════════════════════════════
const LOCALES = [
  { tag: 'en-US', dir: 'ltr', low: 'Low' },
  { tag: 'he-IL', dir: 'rtl', low: 'נמוכה' },
  { tag: 'ar', dir: 'rtl', low: 'منخفضة' },
] as const

for (const loc of LOCALES) {
  test.describe(`SL9 shared-read — frame 11-rtl-mobile-detail @375 ${loc.tag}`, () => {
    test.use({ ...MOBILE_375, locale: loc.tag })

    test(`SL9-READ-040-${loc.tag} common detail at 375px: dir=${loc.dir}, Fork CTA inside the viewport, full-width, >=44px, above the notice; item-id column dropped; codes/keys are LTR islands; labels in the requested locale`, async ({ page }) => {
      await setup(page, { org: ORGS.globex, build: globexCommonDetail })
      await openRoute(page, detail(COMMON_PRIORITY_ID))
      const cta = page.locator("[data-action='fork-to-edit']")
      await expect(cta).toBeVisible()
      expect(await documentDir(page)).toBe(loc.dir)
      await expectInViewport(page, cta, 'Fork CTA')
      await expectTouchTarget(cta, 'Fork CTA')
      const ctaBox = (await cta.boundingBox())!
      expect(ctaBox.width, 'primary action is full-width at <= 40em').toBeGreaterThanOrEqual(375 * 0.7)
      const noticeBox = (await page.locator("[data-readonly-notice='platform']").boundingBox())!
      expect(ctaBox.y, 'the CTA sits above the notice on a phone').toBeLessThan(noticeBox.y)
      await expect(page.getByRole('columnheader', { name: /item id/i }), 'id column dropped at <= 40em').toHaveCount(0)
      await expect(page.getByText(loc.low, { exact: true }).first(), 'labels come from the service in the requested locale').toBeVisible()
      await expectLtrIsland(page, 'LOW', 'item code')
      await expectLtrIsland(page, 'priority', 'list key')
      await expect(page.locator("[data-badge='common']").first()).toBeVisible()
      for (const t of await page.locator('[data-tab]').all()) await expectTouchTarget(t, 'tab')
      const root = await page.evaluate(() => {
        const p = document.querySelector("[data-panel='value-table']") as HTMLElement | null
        return p ? { sw: p.scrollWidth, cw: p.clientWidth } : null
      })
      expect(root, 'value table panel exists').not.toBeNull()
      expect(root!.sw, 'the value table never scrolls sideways at 375px').toBeLessThanOrEqual(root!.cw + 1)
    })
  })
}
