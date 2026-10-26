/**
 * SELECTION LISTS — SHARED LISTS (SL9) — FLOW 5 "effective-picker" — RED-by-design UI e2e.
 * (frontend-test-engineer — independent verification, NOT the implementer.)
 *
 * Derived STRICTLY from the approved flow `effective-picker` (approved 2026-10-20) of
 * design/frames/selection-lists-shared/manifest.json:
 *
 *   09-picker-effective.html          (5a) the picker bound by KEY resolves the EFFECTIVE list: org fork vs common list,
 *                                          private / archived fork, opt-in source caption, loading / error / no list / flag OFF
 *   10-picker-stored-values.html      (5b) stored values across a fork: POST /v1/resolve -> effective_item_id redirect, the whole
 *                                          resolve outcome matrix, resolving / resolve failed, opt-in onEffectiveValue
 *   15-rtl-mobile-picker.html         (5c) 375 px, en / he / ar (RTL)
 *
 * and the frozen contract (4.1.0): `GET /v1/selection-lists?key=&include_shared=true&limit=1` (getEffectiveList),
 * `GET …/items?status=active`, `POST /v1/resolve` (`ResolvedSelectionListItem.effective_item_id`).
 * Implementation target: packages/selection-lists-ui/src/shared-lists/{core,picker}/**
 * (EffectiveListSource, useEffectiveList) wired into SelectionListPicker / SelectionListPickerHarness.
 *
 * ── HARNESS CONTRACT the frames imply but do not spell out (INFERRED — negotiate here) ─────
 * The picker is an embeddable component; the route /embed/selection-list-picker is its harness. Two host-side
 * switches have no frame-declared hook and are therefore INFERRED, each isolated in ONE clearly named spec:
 *   - `?showSource=1`  -> passes the opt-in `showSource` prop (caption). Used by SL9-PICK-010/011/012/013, 060.
 *   - `?migrate=1`     -> passes `onEffectiveValue`; the harness records every call on
 *                         `[data-migration='host-opt-in']` as `data-effective-calls` (JSON `[[stored, effective], …]`).
 *                         Used ONLY by SL9-PICK-032 (`@harness-contract-inferred`).
 * If frontend-engineer needs a different harness spelling, change those two specs (and the doc) — not the frames.
 *
 * RED today / canary / flag-OFF semantics and how this file lands: see
 * selection-lists-shared-read.red.spec.ts and docs/planning/selection-lists-shared-ui-red-specs.md.
 *
 * Run: cd frontend && BASE_URL=http://localhost:4173 npx playwright test \
 *        tests/selection-lists-shared-effective-picker.red.spec.ts --project=chromium
 */
import { test, expect, type Page } from '@playwright/test'
import {
  COMMON_ITEM_IDS,
  COMMON_PRIORITY_ID,
  FORK_ITEM_IDS,
  FORK_PRIORITY_ID,
  MOBILE_375,
  ORGS,
  addList,
  commonPriorityItems,
  commonPriorityList,
  createWorld,
  deferred,
  documentDir,
  err,
  expectNoHorizontalScroll,
  expectRuntimeClean,
  expectTouchTarget,
  failTimes,
  forkPriorityItems,
  forkPriorityList,
  hold,
  mockSharedListsSession,
  mountSelectionListApi,
  on,
  openPicker,
  panelState,
  press,
  trackRuntime,
  type Api,
  type Runtime,
  type ShellOrg,
  type World,
  type WireList,
} from './support/selection-lists-shared-e2e'

test.use({ serviceWorkers: 'block' })

let rt: Runtime
test.afterEach(() => {
  if (rt) expect(rt.pageErrors, 'never throw into the host: no uncaught exception').toEqual([])
})

interface Opts {
  flag?: boolean
  org?: ShellOrg
  /** Add the org's fork (default true for Acme). */
  fork?: boolean | Partial<WireList>
  /** Add the common list (default true). */
  common?: boolean | Partial<WireList>
  resolve?: Record<string, Record<string, unknown>>
  build?: (w: World) => void
}

async function setup(page: Page, opts: Opts = {}) {
  rt = trackRuntime(page)
  const org = await mockSharedListsSession(page, { sharedLists: opts.flag ?? true, org: opts.org ?? ORGS.acme })
  const world = createWorld(org.id)
  if (opts.fork !== false && org.id === ORGS.acme.id) {
    addList(world, forkPriorityList(typeof opts.fork === 'object' ? opts.fork : {}), forkPriorityItems(), { role: true })
  }
  if (opts.common !== false) addList(world, commonPriorityList(typeof opts.common === 'object' ? opts.common : {}), commonPriorityItems())
  for (const [id, r] of Object.entries(opts.resolve ?? {})) world.resolve.set(id, r)
  opts.build?.(world)
  const api = await mountSelectionListApi(page, world)
  return { api, world, org }
}

const lookups = (api: Api) => api.callsTo('GET', '/v1/selection-lists').filter(c => c.query.get('key') === 'priority')
const itemReads = (api: Api) => api.calls.filter(c => c.method === 'GET' && /\/items$/.test(c.path))
const picker = (page: Page) => page.locator("[data-panel='picker']")
const control = (page: Page) => page.locator('[data-combo-control]')
const menu = (page: Page) => page.locator('[data-combo-menu]')
const persisted = async (page: Page) => (await page.locator('[data-persisted]').first().getAttribute('data-persisted')) ?? ''
const open = (page: Page, params: Record<string, string> = {}) =>
  openPicker(page, { list: 'priority', mode: 'single', ...params })
const resolved = (label: string, over: Record<string, unknown> = {}) => ({ label, locale: 'en', is_machine: false, status: 'active', ...over })

// ═════════════════════════════════════════════════════════════════════════════
// Frame 09 — (5a) effective list by key
// ═════════════════════════════════════════════════════════════════════════════
test.describe('SL9 picker — frame 09-picker-effective', () => {
  test('SL9-PICK-000 canary: the approved 4.0.0 picker renders a key lookup + items from the same mocks (passes today)', async ({ page }) => {
    await setup(page, { flag: false, org: ORGS.acme, fork: { visibility: 'private' }, common: false })
    await open(page)
    await expect(control(page)).toBeVisible()
    await press(control(page), 'combo control')
    await expect(page.locator(`[data-combo-menu] [data-item='${FORK_ITEM_IDS.medium}']`)).toBeVisible()
  })

  test('SL9-PICK-001 org with an org-visible fork: ONE lookup (key + include_shared=true + limit=1), items only of THAT list, the picker renders exactly the fork (never both, never merged)', async ({ page }) => {
    const { api } = await setup(page)
    await open(page)
    await expect(page.locator("[data-panel='picker'][data-effective-source='own']")).toBeVisible()
    await press(control(page), 'combo control')
    for (const id of Object.values(FORK_ITEM_IDS)) await expect(menu(page).locator(`[data-item='${id}']`)).toBeVisible()
    expect(lookups(api), 'exactly one lookup').toHaveLength(1)
    const l = lookups(api)[0]
    expect(l.query.get('include_shared')).toBe('true')
    expect(l.query.get('limit')).toBe('1')
    expect(itemReads(api).map(c => c.path), 'items of the returned list ONLY').toEqual([`/v1/selection-lists/${FORK_PRIORITY_ID}/items`])
    expect(itemReads(api)[0].query.get('status')).toBe('active')
    await expect(menu(page).locator(`[data-item='${COMMON_ITEM_IDS.normal}']`), 'common items are never merged in').toHaveCount(0)
    await expect(menu(page)).toContainText('Medium')
    await expect(menu(page)).not.toContainText('Normal')
    expectRuntimeClean(rt)
  })

  test('SL9-PICK-002 org WITHOUT a fork: the common list is the effective one; active values only, in authored order (archived "Critical" is not offered)', async ({ page }) => {
    const { api } = await setup(page, { org: ORGS.initech })
    await open(page)
    await expect(page.locator("[data-panel='picker'][data-effective-source='platform']")).toBeVisible()
    await press(control(page), 'combo control')
    const ids = await menu(page).locator('[data-item]').evaluateAll(els => els.map(e => e.getAttribute('data-item')))
    expect(ids).toEqual([COMMON_ITEM_IDS.low, COMMON_ITEM_IDS.normal, COMMON_ITEM_IDS.high, COMMON_ITEM_IDS.urgent])
    await expect(menu(page).locator(`[data-item='${COMMON_ITEM_IDS.critical}']`)).toHaveCount(0)
    expect(itemReads(api).map(c => c.path)).toEqual([`/v1/selection-lists/${COMMON_PRIORITY_ID}/items`])
  })

  test('SL9-PICK-003 host contract unchanged: picking submits the item ID of the effective list (the common item here), not the label', async ({ page }) => {
    await setup(page, { org: ORGS.initech })
    await open(page)
    await press(control(page), 'combo control')
    await press(menu(page).locator(`[data-item='${COMMON_ITEM_IDS.normal}']`))
    await expect(page.locator('[data-selected-label]').first()).toHaveText('Normal')
    expect(await persisted(page)).toBe(COMMON_ITEM_IDS.normal)
  })

  test('SL9-PICK-003b …and with the org fork effective, the pick submits the FORK item id', async ({ page }) => {
    await setup(page)
    await open(page)
    await expect(page.locator("[data-panel='picker'][data-effective-source='own']")).toBeVisible()
    await press(control(page), 'combo control')
    await press(menu(page).locator(`[data-item='${FORK_ITEM_IDS.medium}']`))
    await expect(page.locator('[data-selected-label]').first()).toHaveText('Medium')
    expect(await persisted(page)).toBe(FORK_ITEM_IDS.medium)
  })

  test('SL9-PICK-004a the harness inspector says which list the key resolved to: the org\'s fork', async ({ page }) => {
    await setup(page)
    await open(page)
    const inspector = page.locator('[data-effective-inspector]')
    await expect(inspector).toBeVisible()
    await expect(inspector).toContainText(FORK_PRIORITY_ID)
    await expect(inspector).toContainText(COMMON_PRIORITY_ID)
    await expect(inspector).toContainText(/visibility\s*org/i)
  })

  test('SL9-PICK-004b …or the common list', async ({ page }) => {
    await setup(page, { org: ORGS.initech })
    await open(page)
    await expect(page.locator('[data-effective-inspector]')).toContainText(COMMON_PRIORITY_ID)
    await expect(page.locator('[data-effective-inspector]')).toContainText(/platform/i)
  })

  test('SL9-PICK-010 the source caption is OPT-IN: absent without showSource', async ({ page }) => {
    await setup(page)
    await open(page)
    await expect(page.locator("[data-panel='picker'][data-effective-source='own']"), 'the effective list is resolved...').toBeVisible()
    await expect(control(page)).toBeVisible()
    await expect(page.locator('[data-effective-source-caption]'), '...but end-user forms get no caption at all').toHaveCount(0)
  })

  test('SL9-PICK-011 showSource, org fork: "Your organization\'s version of the common list Priority" with the Fork badge — derived from the one list returned, NO extra request', async ({ page }) => {
    const { api } = await setup(page)
    await open(page, { showSource: '1' })
    const cap = page.locator("[data-effective-source-caption='own']")
    await expect(cap).toBeVisible()
    await expect(cap.locator("[data-badge='fork']")).toBeVisible()
    await expect(cap).toContainText(/your organization.s version/i)
    await expect(cap).toContainText(/priority/i)
    expect(lookups(api)).toHaveLength(1)
    expect(itemReads(api)).toHaveLength(1)
    expect(api.calls.filter(c => !/^\/v1\/selection-lists(\/[^/]+\/items)?$/.test(c.path)), 'no source read, no behind-source check, no resolve').toEqual([])
  })

  test('SL9-PICK-012 showSource, common list: "Common list — provided by FuzeFront" with the Common badge', async ({ page }) => {
    await setup(page, { org: ORGS.initech })
    await open(page, { showSource: '1' })
    const cap = page.locator("[data-effective-source-caption='platform']")
    await expect(cap).toBeVisible()
    await expect(cap.locator("[data-badge='common']")).toBeVisible()
    await expect(cap).toContainText(/provided by fuzefront/i)
  })

  test('SL9-PICK-013 the caption appears WITH the options, never before (loading shows one skeleton and no caption)', async ({ page }) => {
    const gate = deferred()
    const { api } = await setup(page)
    api.use(hold('GET', /\/items$/, gate.promise))
    await open(page, { showSource: '1' })
    const loading = panelState(page, 'picker', 'loading')
    await expect(loading).toBeVisible()
    await expect(page.locator("[data-panel='picker'] [data-state='loading'][aria-busy='true'], [data-panel='picker'][data-state='loading'][aria-busy='true']").first()).toBeVisible()
    await expect(page.locator('[data-effective-source-caption]')).toHaveCount(0)
    gate.resolve()
    await expect(page.locator("[data-effective-source-caption='own']")).toBeVisible()
  })

  test('SL9-PICK-014 private fork (a draft) returned to its role-holder: own source with a "Draft" caption; a member without a role gets the COMMON list', async ({ page }) => {
    await setup(page, { fork: { visibility: 'private' } })
    await open(page, { showSource: '1' })
    const cap = page.locator("[data-effective-source-caption='own']")
    await expect(cap).toBeVisible()
    await expect(cap).toContainText(/draft|only people with a role/i)
  })

  test('SL9-PICK-015 private fork the member holds no role on is invisible: the service answers the common list and the picker shows exactly that', async ({ page }) => {
    await setup(page, {
      build: w => {
        w.roles.clear()
        w.lists.set(FORK_PRIORITY_ID, { ...w.lists.get(FORK_PRIORITY_ID)!, visibility: 'private' })
      },
    })
    await open(page, { showSource: '1' })
    await expect(page.locator("[data-panel='picker'][data-effective-source='platform']")).toBeVisible()
    await expect(page.locator("[data-effective-source-caption='platform']")).toBeVisible()
  })

  test('SL9-PICK-016 fork archived ("revert to common"): falls through to the active common list; no archived caption — the picker says nothing about the ignored fork', async ({ page }) => {
    await setup(page, { fork: { status: 'archived' } })
    await open(page, { showSource: '1' })
    await expect(page.locator("[data-panel='picker'][data-effective-source='platform']")).toBeVisible()
    await expect(picker(page)).not.toContainText(/archived/i)
    await expect(page.locator("[data-effective-source-caption='platform']")).toBeVisible()
  })

  test('SL9-PICK-020 error (lookup 5xx): in-place Retry, the selection is kept, NO fallback to a different list', async ({ page }) => {
    const { api } = await setup(page)
    api.use(failTimes(1, 'GET', '/v1/selection-lists', err(500, 'INTERNAL'), c => c.query.get('key') === 'priority'))
    await open(page, { value: FORK_ITEM_IDS.medium })
    const e = panelState(page, 'picker', 'error')
    await expect(e).toBeVisible()
    await expect(page.locator("[data-error='load-failed']")).toBeVisible()
    expect(await persisted(page), 'the selected value is kept').toContain(FORK_ITEM_IDS.medium)
    expect(itemReads(api), 'a failed lookup never falls back to a second, different list').toHaveLength(0)
    await press(page.locator("[data-panel='picker'] [data-action='retry']"), 'Retry')
    await expect(control(page)).toBeVisible()
    expect(lookups(api)).toHaveLength(2)
  })

  test('SL9-PICK-021 a 403 on the lookup (developer-only caller has no catalog list permission) is the ERROR state — never "List unavailable" (4.0.0 behaviour kept; passes today)', async ({ page }) => {
    const { api } = await setup(page)
    api.use(on('GET', '/v1/selection-lists', c => (c.query.get('key') === 'priority' ? err(403, 'FORBIDDEN') : { status: 200, body: { items: [], page: { nextCursor: null, hasMore: false } } })))
    await open(page)
    await expect(panelState(page, 'picker', 'error')).toBeVisible()
    await expect(panelState(page, 'picker', 'not-found')).toHaveCount(0)
    await expect(picker(page)).not.toContainText(/list unavailable/i)
  })

  test('SL9-PICK-022 the items request failing is the same in-place error (retry re-reads items for the SAME list)', async ({ page }) => {
    const { api } = await setup(page)
    api.use(failTimes(1, 'GET', /\/items$/, err(500, 'INTERNAL')))
    await open(page)
    await expect(panelState(page, 'picker', 'error')).toBeVisible()
    await press(page.locator("[data-panel='picker'] [data-action='retry']"))
    await expect(control(page)).toBeVisible()
    expect(new Set(itemReads(api).map(c => c.path)).size, 'never a second list').toBe(1)
  })

  test('SL9-PICK-023 no effective list (200 with an empty page): "List unavailable", control disabled, nothing thrown into the host', async ({ page }) => {
    await setup(page, { fork: { status: 'archived' }, common: { status: 'archived' } })
    await open(page)
    const nf = panelState(page, 'picker', 'not-found')
    await expect(nf).toBeVisible()
    await expect(page.locator("[data-error='NOT_FOUND']")).toContainText(/list unavailable/i)
    const c = page.locator('[data-combo-control]')
    if (await c.count()) await expect(c).toBeDisabled()
  })

  test('SL9-PICK-024 flag OFF: the approved 4.0.0 lookup — no include_shared, no caption (even with showSource), common lists invisible (guard; passes today)', async ({ page }) => {
    const { api } = await setup(page, { flag: false, org: ORGS.initech })
    await open(page, { showSource: '1' })
    await expect(panelState(page, 'picker', 'not-found')).toBeVisible()
    await page.waitForTimeout(300)
    for (const c of api.callsTo('GET', '/v1/selection-lists')) expect(c.query.has('include_shared'), 'flag OFF: no include_shared').toBe(false)
    await expect(page.locator('[data-effective-source-caption], [data-effective-source], [data-badge]')).toHaveCount(0)
  })

  test('SL9-PICK-025 a11y: the control exposes aria-expanded/aria-haspopup and the menu is a listbox of options (the shared-lists work keeps the 4.0.0 contract)', async ({ page }) => {
    await setup(page)
    await open(page)
    await expect(control(page)).toHaveAttribute('aria-expanded', 'false')
    await press(control(page), 'combo control')
    await expect(control(page)).toHaveAttribute('aria-expanded', 'true')
    await expect(menu(page)).toHaveAttribute('role', 'listbox')
    await expect(page.locator("[data-panel='picker'][data-effective-source]")).toBeVisible()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Frame 10 — (5b) stored values across a fork
// ═════════════════════════════════════════════════════════════════════════════
test.describe('SL9 picker — frame 10-picker-stored-values', () => {
  const STORED = COMMON_ITEM_IDS.normal
  const redirect = { [STORED]: resolved('Medium', { effective_item_id: FORK_ITEM_IDS.medium }) }
  const resolveCalls = (api: Api) => api.callsTo('POST', '/v1/resolve')

  test('SL9-PICK-030 a stored COMMON id after the org forked: ONE resolve request; the fork\'s label is shown with NO visible change (no badge, notice, dirty marker) and the host value is NOT rewritten', async ({ page }) => {
    const { api } = await setup(page, { resolve: redirect })
    await open(page, { value: STORED })
    const label = page.locator("[data-selected-label][data-redirected='true']")
    await expect(label).toHaveText('Medium')
    await expect(page.locator("[data-panel='picker'][data-state='redirected'], [data-panel='picker'] [data-state='redirected']").first()).toBeVisible()
    expect(resolveCalls(api), 'resolve is one request').toHaveLength(1)
    expect(resolveCalls(api)[0].body.ids).toEqual([STORED])
    for (const hook of ['[data-badge]', "[role='alert']", "[role='status']", '[data-dirty]', '[data-error]']) {
      await expect(picker(page).locator(hook), `a redirected value shows no ${hook}`).toHaveCount(0)
    }
    expect(await persisted(page), 'the stored id is re-submitted unchanged').toBe(STORED)
    await press(control(page), 'combo control')
    await expect(menu(page).locator(`[data-item='${FORK_ITEM_IDS.medium}']`), 'the fork option is marked selected').toHaveAttribute('aria-selected', 'true')
    expectRuntimeClean(rt)
  })

  test('SL9-PICK-031 picking a value emits the FORK item id (as for any pick)', async ({ page }) => {
    await setup(page, { resolve: redirect })
    await open(page, { value: STORED })
    await expect(page.locator("[data-selected-label][data-redirected='true']")).toBeVisible()
    await press(control(page), 'combo control')
    await press(menu(page).locator(`[data-item='${FORK_ITEM_IDS.high}']`))
    expect(await persisted(page)).toBe(FORK_ITEM_IDS.high)
    await expect(page.locator("[data-selected-label]").first()).toHaveText('High')
  })

  test('SL9-PICK-032 @harness-contract-inferred onEffectiveValue(stored, effective): called ONCE per redirected id after a successful resolve (harness records it on [data-migration="host-opt-in"])', async ({ page }) => {
    await setup(page, { resolve: redirect })
    await open(page, { value: STORED, migrate: '1' })
    await expect(page.locator("[data-selected-label][data-redirected='true']")).toBeVisible()
    const m = page.locator("[data-migration='host-opt-in']")
    await expect(m).toBeVisible()
    await expect.poll(async () => JSON.parse((await m.getAttribute('data-effective-calls')) ?? '[]')).toEqual([[STORED, FORK_ITEM_IDS.medium]])
  })

  const OUTCOMES = [
    { id: 'private-fork', stored: COMMON_ITEM_IDS.normal, result: resolved('Normal'), label: 'Normal', redirected: false },
    { id: 'fork-item-purged', stored: COMMON_ITEM_IDS.high, result: resolved('High'), label: 'High', redirected: false },
    { id: 'common-archived-redirect', stored: COMMON_ITEM_IDS.urgent, result: resolved('Urgent', { effective_item_id: FORK_ITEM_IDS.urgent }), label: 'Urgent', redirected: true, archived: false },
    { id: 'fork-archived', stored: FORK_ITEM_IDS.blocker, result: resolved('Blocker', { status: 'archived' }), label: 'Blocker', redirected: false, archived: true, forkArchived: true },
    { id: 'common-archived', stored: COMMON_ITEM_IDS.critical, result: resolved('Critical (legacy)', { status: 'archived' }), label: 'Critical (legacy)', redirected: false, archived: true },
  ] as const
  for (const o of OUTCOMES) {
    test(`SL9-PICK-033-${o.id} resolve outcome "${o.id}": renders the returned label${'archived' in o ? (o.archived ? ' greyed + archived badge, not newly selectable' : ' with the FORK item\'s status (active)') : ''}`, async ({ page }) => {
      await setup(page, { resolve: { [o.stored]: o.result }, fork: 'forkArchived' in o ? { status: 'archived' } : undefined })
      await open(page, { value: o.stored })
      const label = page.locator('[data-selected-label]').first()
      await expect(label).toContainText(o.label)
      if (o.redirected) await expect(label).toHaveAttribute('data-redirected', 'true')
      else await expect(label).not.toHaveAttribute('data-redirected', 'true')
      if ('archived' in o && o.archived) {
        await expect(label).toHaveAttribute('data-archived', 'true')
        await expect(label).toHaveAttribute('data-status', 'archived')
        await press(control(page), 'combo control')
        await expect(menu(page).locator(`[data-item='${o.stored}']`), 'archived values are not newly selectable').toHaveCount(0)
      } else {
        await expect(label).not.toHaveAttribute('data-archived', 'true')
      }
      expect(await persisted(page)).toBe(o.stored)
    })
  }

  test('SL9-PICK-034 an id in `missing` renders "Unknown value" and STAYS in the form', async ({ page }) => {
    await setup(page)
    await open(page, { value: 'front_sli_01jfq3w8z6y5x4c3b2a1n9mzz09' })
    const missing = page.locator("[data-selected-label][data-missing='true']")
    await expect(missing).toContainText(/unknown value/i)
    expect(await persisted(page)).toBe('front_sli_01jfq3w8z6y5x4c3b2a1n9mzz09')
  })

  test('SL9-PICK-035 resolving: a skeleton, the control is NOT editable, and the stored id is never shown as a label', async ({ page }) => {
    const gate = deferred()
    const { api } = await setup(page, { resolve: redirect })
    api.use(hold('POST', '/v1/resolve', gate.promise))
    await open(page, { value: STORED })
    const r = panelState(page, 'picker', 'resolving')
    await expect(r).toBeVisible()
    await expect(page.locator("[data-panel='picker'] [data-state='resolving'][aria-busy='true'], [data-panel='picker'][data-state='resolving'][aria-busy='true'], [data-panel='picker'] [aria-busy='true']").first()).toBeVisible()
    await expect(picker(page)).not.toContainText(STORED)
    if (await control(page).count()) {
      await control(page).click({ force: true, trial: false }).catch(() => undefined)
      await expect(menu(page), 'choosing mid-resolve would race the label').toHaveCount(0)
    }
    gate.resolve()
    await expect(page.locator("[data-selected-label][data-redirected='true']")).toBeVisible()
  })

  test('SL9-PICK-036 resolve failed: in-place Retry, the stored id is untouched, onEffectiveValue is never called; retry recovers', async ({ page }) => {
    const { api } = await setup(page, { resolve: redirect })
    api.use(failTimes(1, 'POST', '/v1/resolve', err(500, 'INTERNAL')))
    await open(page, { value: STORED, migrate: '1' })
    await expect(panelState(page, 'picker', 'resolve-error')).toBeVisible()
    await expect(page.locator("[data-error='resolve-failed']")).toBeVisible()
    expect(await persisted(page), 'the stored id stays in the form untouched').toBe(STORED)
    const calls = JSON.parse((await page.locator("[data-migration='host-opt-in']").getAttribute('data-effective-calls').catch(() => '[]')) ?? '[]')
    expect(calls, 'only a successful resolve may call onEffectiveValue').toEqual([])
    await press(page.locator("[data-panel='picker'] [data-action='retry']"))
    await expect(page.locator("[data-selected-label][data-redirected='true']")).toBeVisible()
  })

  test('SL9-PICK-037 flag OFF: no redirect handling, no effective_item_id use — a stored id resolves exactly as in 4.0.0 (guard; passes today)', async ({ page }) => {
    await setup(page, { flag: false, org: ORGS.acme, fork: { visibility: 'private' }, common: false, resolve: { [FORK_ITEM_IDS.medium]: resolved('Medium', { effective_item_id: FORK_ITEM_IDS.high }) } })
    await open(page, { value: FORK_ITEM_IDS.medium })
    await expect(page.locator('[data-selected-label]').first()).toHaveText('Medium')
    await expect(page.locator("[data-redirected='true']")).toHaveCount(0)
    expect(await persisted(page)).toBe(FORK_ITEM_IDS.medium)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Frame 15 — (5c) RTL + 375 px
// ═════════════════════════════════════════════════════════════════════════════
for (const loc of [{ tag: 'en-US', dir: 'ltr' }, { tag: 'he-IL', dir: 'rtl' }, { tag: 'ar', dir: 'rtl' }] as const) {
  test.describe(`SL9 picker — frame 15-rtl-mobile-picker @375 ${loc.tag}`, () => {
    test.use({ ...MOBILE_375, locale: loc.tag })

    test(`SL9-PICK-060-${loc.tag} one lookup, one list at phone width: dir=${loc.dir}, no sideways scroll, control full field width, inline menu, options >=44px, caption wraps UNDER the control without widening the field`, async ({ page }) => {
      const { api } = await setup(page)
      await open(page, { showSource: '1' })
      await expect(page.locator("[data-panel='picker'][data-effective-source='own']")).toBeVisible()
      expect(await documentDir(page)).toBe(loc.dir)
      await expectNoHorizontalScroll(page, 'picker harness')
      const c = (await control(page).boundingBox())!
      expect(c.width, 'the picker takes the host field width').toBeGreaterThanOrEqual(280)
      expect(c.x + c.width).toBeLessThanOrEqual(376)
      const cap = (await page.locator("[data-effective-source-caption='own']").boundingBox())!
      expect(cap.y, 'caption sits under the control').toBeGreaterThanOrEqual(c.y + c.height - 1)
      expect(cap.x + cap.width, 'caption never widens the field').toBeLessThanOrEqual(c.x + c.width + 1)
      await press(control(page), 'combo control')
      const m = menu(page)
      await expect(m).toHaveAttribute('data-menu-placement', 'inline')
      const pos = await m.evaluate(n => getComputedStyle(n).position)
      expect(pos, 'inline in the flow so an overflow:hidden host cannot clip it').not.toMatch(/absolute|fixed/)
      const mb = (await m.boundingBox())!
      expect(mb.y).toBeGreaterThanOrEqual(c.y + c.height - 1)
      for (const o of await m.locator('[data-item]').all()) await expectTouchTarget(o, 'option')
      await expectTouchTarget(control(page), 'combo control')
      expect(itemReads(api), 'the phone layout never fetches a second list').toHaveLength(1)
      expect(lookups(api)).toHaveLength(1)
    })

    test(`SL9-PICK-061-${loc.tag} a redirected stored value shows no badge/notice at 375px and submits the stored id; no effective list renders "List unavailable" in place`, async ({ page }) => {
      await setup(page, { resolve: { [COMMON_ITEM_IDS.normal]: resolved('Medium', { effective_item_id: FORK_ITEM_IDS.medium }) } })
      await open(page, { value: COMMON_ITEM_IDS.normal })
      await expect(page.locator("[data-selected-label][data-redirected='true']")).toBeVisible()
      await expect(picker(page).locator('[data-badge], [role=alert], [role=status]')).toHaveCount(0)
      expect(await persisted(page)).toBe(COMMON_ITEM_IDS.normal)
      await expectNoHorizontalScroll(page)
    })

    test(`SL9-PICK-062-${loc.tag} no effective list at 375px: "List unavailable" in place, disabled, never throws`, async ({ page }) => {
      await setup(page, { fork: { status: 'archived' }, common: { status: 'archived' } })
      await open(page)
      await expect(panelState(page, 'picker', 'not-found')).toBeVisible()
      await expect(page.locator("[data-error='NOT_FOUND']")).toContainText(/list unavailable/i)
      await expectNoHorizontalScroll(page)
    })

    test(`SL9-PICK-063-${loc.tag} error state at 375px: Retry is >=44px and in place`, async ({ page }) => {
      const { api } = await setup(page)
      api.use(failTimes(1, 'GET', '/v1/selection-lists', err(500, 'INTERNAL'), c => c.query.get('key') === 'priority'))
      await open(page)
      const retry = page.locator("[data-panel='picker'] [data-action='retry']")
      await expect(retry).toBeVisible()
      await expectTouchTarget(retry, 'Retry')
    })
  })
}

