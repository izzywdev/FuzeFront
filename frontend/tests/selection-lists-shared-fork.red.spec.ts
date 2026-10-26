/**
 * SELECTION LISTS — SHARED LISTS (SL9) — FLOW 2 "fork" — RED-by-design UI e2e.
 * (frontend-test-engineer — independent verification, NOT the implementer.)
 *
 * Derived STRICTLY from the approved flow `fork` (approved 2026-10-20) of
 * design/frames/selection-lists-shared/manifest.json:
 *
 *   04-fork-required.html       (2a) 409 fork_required vs 403 / 404, banner + CTA
 *   05-fork-dialog.html         (2b) ForkListDialog: summary, visibility choice, no-sync, quota preview, submitting
 *   06-fork-results.html        (2c) every answer to POST …/fork and to the "Restore" PATCH
 *   12-rtl-mobile-fork.html     (2d) the dialog as a BottomSheet at 375 px, en / he / ar
 *
 * and the frozen contract services/selection-list-service/openapi.yaml (4.1.0)
 * (`forkSelectionList`, `Error.reason`, `Error.source_list_id`, `Error.fork_url`).
 * Implementation target: packages/selection-lists-ui/src/shared-lists/{core,fork}/**
 * (ForkListFlow, ForkToEditButton, ForkRequiredBanner, ForkListDialog, ForkResultNotice).
 *
 * RED today: the fork banner/CTA/dialog/results do not exist, so specs asserting them fail
 * with "element(s) not found" on a frame hook. "canary" and "flag OFF" specs pass today and
 * must keep passing (see selection-lists-shared-read.red.spec.ts for the full explanation).
 * Nothing is skipped / fixme'd. How the file lands and how the implementation PR flips it
 * on: docs/planning/selection-lists-shared-ui-red-specs.md.
 *
 * Run: cd frontend && BASE_URL=http://localhost:4173 npx playwright test \
 *        tests/selection-lists-shared-fork.red.spec.ts --project=chromium
 */
import { test, expect, type Page } from '@playwright/test'
import {
  COMMON_PRIORITY_ID,
  FORK_PRIORITY_ID,
  MOBILE_375_SHORT,
  ORGS,
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
  forkPriorityItems,
  forkPriorityList,
  hold,
  json,
  mockSharedListsSession,
  mountSelectionListApi,
  on,
  openRoute,
  press,
  spaNavigate,
  trackRuntime,
  type Api,
  type ApiHandler,
  type ApiReply,
  type Runtime,
  type ShellOrg,
  type World,
  type WireList,
} from './support/selection-lists-shared-e2e'

test.use({ serviceWorkers: 'block' })

const INDEX = '/settings/selection-lists'
const detail = (id: string) => `${INDEX}/${id}`
const FORK_PATH = `/v1/selection-lists/${COMMON_PRIORITY_ID}/fork`

let rt: Runtime
test.afterEach(() => {
  if (rt) expect(rt.pageErrors, 'no uncaught exception may reach the page').toEqual([])
})

async function setup(page: Page, opts: { flag?: boolean; org?: ShellOrg; build?: (w: World) => void } = {}) {
  rt = trackRuntime(page)
  const org = await mockSharedListsSession(page, { sharedLists: opts.flag ?? true, org: opts.org ?? ORGS.globex })
  const world = createWorld(org.id)
  addList(world, commonPriorityList(), commonPriorityItems())
  opts.build?.(world)
  const api = await mountSelectionListApi(page, world)
  return { api, world, org }
}

/** Globex's own fork of Priority as the service would return it after a fork. */
const globexFork = (over: Partial<WireList> = {}) =>
  forkPriorityList({ organization_id: ORGS.globex.id, ...over })

/** POST …/fork handler that "creates" the fork in the world and answers 201. */
const forkCreates = (status = 201, over: Partial<WireList> = {}): ApiHandler =>
  on('POST', FORK_PATH, (_c, world) => {
    const fork = globexFork(over)
    addList(world, fork, forkPriorityItems(), { role: true })
    return json(status, fork)
  })

const forkCalls = (api: Api) => api.callsTo('POST', /\/fork$/)

async function openDialog(page: Page) {
  await openRoute(page, detail(COMMON_PRIORITY_ID))
  await press(page.locator("[data-action='fork-to-edit']"), 'ForkToEditButton')
  await expect(page.locator("[data-dialog='fork']")).toBeVisible()
}

const dialog = (page: Page) => page.locator("[data-dialog='fork']")
const confirm = (page: Page) => page.locator("[data-dialog='fork'] [data-action='confirm-fork']")
const cancel = (page: Page) => page.locator("[data-dialog='fork'] [data-action='cancel']")

// ═════════════════════════════════════════════════════════════════════════════
// Frame 04 — (2a) 409 fork_required vs 403
// ═════════════════════════════════════════════════════════════════════════════
const SRC = COMMON_PRIORITY_ID
const WORKBENCH = `${detail(COMMON_PRIORITY_ID)}/translations/fr`
const MUTATION = /^\/v1\/selection-lists\/[^/]+\/(items|translations)/

const forkRequired = (over: Record<string, unknown> = {}): ApiReply =>
  err(409, 'CONFLICT', { reason: 'fork_required', source_list_id: SRC, fork_url: `/v1/selection-lists/${SRC}/fork`, ...over })

/**
 * Stale-bookmark scenario of frame 04: the French workbench of a common list; Save is refused.
 *
 * The editor is genuinely STALE: the page was opened (or bookmarked) when the list's editability was
 * unknown/true, so the list metadata carries NO `editable`/`visibility` hint (4.0.0 shape) and the 4.0.0
 * editor renders its inputs. A fresh read of the same list with `editable: false` renders the READ-ONLY
 * locale view instead (SL9-READ-033: no inputs, no Save) — the two states are mutually exclusive, so the
 * refusal specs must not model a current read-only list and then demand an editable input.
 */
async function saveRefused(page: Page, reply: ApiReply, opts: { flag?: boolean; build?: (w: World) => void } = {}) {
  const ctx = await setup(page, {
    flag: opts.flag,
    build: w => {
      addList(w, commonPriorityList({ editable: undefined, visibility: undefined }), commonPriorityItems())
      opts.build?.(w)
    },
  })
  ctx.api.use(on('PUT', MUTATION, () => reply))
  await openRoute(page, WORKBENCH)
  const input = page.locator("[data-translation-input='item']").first().locator('input, textarea').first()
  await expect(input, 'the 4.0.0 workbench loads').toBeVisible()
  await input.fill('Moyenne')
  await page.locator("[data-action='save-row']").first().click()
  return { ...ctx, input }
}

test.describe('SL9 fork — frame 04-fork-required', () => {
  test('SL9-FORK-000 canary: the 4.0.0 French workbench renders from the same mocks (passes today)', async ({ page }) => {
    // A STALE editor (no editable/visibility hint) — a current `editable:false` list renders the read-only view (SL9-READ-033).
    await setup(page, { build: w => addList(w, commonPriorityList({ editable: undefined, visibility: undefined }), commonPriorityItems()) })
    await openRoute(page, WORKBENCH)
    await expect(page.locator("[data-translation-input='item']").first()).toBeVisible()
  })

  test('SL9-FORK-001 409 CONFLICT reason=fork_required: banner with "Fork to edit…" bound to the body, the typed text is kept, nothing is auto-forked', async ({ page }) => {
    const { api, input } = await saveRefused(page, forkRequired())
    const banner = page.locator("[data-error='CONFLICT'][data-reason='fork_required']")
    await expect(banner).toBeVisible()
    await expect(banner).toHaveAttribute('role', 'alert')
    await expect(banner).toContainText(/common list/i)
    await expect(banner.locator("[data-action='fork-to-edit']")).toBeVisible()
    await expect(banner.locator("[data-action='back-to-list']")).toBeVisible()
    const url = await banner.locator('[data-fork-url]').first().getAttribute('data-fork-url')
    expect(url, 'fork_url is relative and same-origin').toBe(`/v1/selection-lists/${SRC}/fork`)
    await expect(input, 'the input keeps the typed text').toHaveValue('Moyenne')
    await expect(page.locator("[data-unsaved='true']").first()).toBeVisible()
    await page.waitForTimeout(300)
    expect(forkCalls(api), 'a refusal never auto-forks').toHaveLength(0)
  })

  test('SL9-FORK-002 the CTA forks error.source_list_id — NOT the id in the page URL', async ({ page }) => {
    const OTHER = 'front_sl_01jf8k2m3n4p5q6r7s8t9v0wso'
    const { api } = await saveRefused(page, forkRequired({ source_list_id: OTHER, fork_url: `/v1/selection-lists/${OTHER}/fork` }), {
      build: w => addList(w, commonPriorityList({ id: OTHER }), commonPriorityItems().map(i => ({ ...i, list_id: OTHER }))),
    })
    api.use(on('POST', `/v1/selection-lists/${OTHER}/fork`, () => json(201, globexFork({ id: 'front_sl_01jfq3w8z6y5x4c3b2a1n9m8z9' }))))
    await press(page.locator("[data-error][data-reason='fork_required'] [data-action='fork-to-edit']"))
    await press(confirm(page), 'confirm fork')
    await expect.poll(() => forkCalls(api).map(c => c.path)).toEqual([`/v1/selection-lists/${OTHER}/fork`])
  })

  test('SL9-FORK-003 an ABSOLUTE fork_url is ignored in favour of forkList(sourceListId): same-origin API base, nothing leaves the origin', async ({ page }) => {
    const hosts: string[] = []
    page.on('request', r => hosts.push(new URL(r.url()).host))
    const { api } = await saveRefused(page, forkRequired({ fork_url: `https://evil.example/v1/selection-lists/${SRC}/fork` }))
    api.use(forkCreates())
    await press(page.locator("[data-error][data-reason='fork_required'] [data-action='fork-to-edit']"))
    await press(confirm(page), 'confirm fork')
    await expect.poll(() => forkCalls(api).length).toBe(1)
    expect(forkCalls(api)[0].url.startsWith(`${new URL(page.url()).origin}/api/v1/selection-lists/`), 'same-origin API base').toBe(true)
    expect(hosts.filter(h => /evil\.example/.test(h)), 'the body-supplied absolute URL is never requested').toEqual([])
    expect(rt.crossOriginApi).toEqual([])
  })

  for (const [n, reply] of [['a-no-reason', err(409, 'CONFLICT')], ['b-unknown-reason', err(409, 'CONFLICT', { reason: 'some_future_reason' })]] as const) {
    test(`SL9-FORK-004${n} a CONFLICT with no/unknown reason is the ordinary 4.0.0 conflict — no fork banner, no Fork CTA (guard; passes today)`, async ({ page }) => {
      const { input } = await saveRefused(page, reply)
      await page.waitForTimeout(400)
      await expect(page.locator("[data-reason='fork_required']")).toHaveCount(0)
      await expect(page.locator("[data-action='fork-to-edit']")).toHaveCount(0)
      await expect(input, 'typed text still kept').toHaveValue('Moyenne')
    })
  }

  test('SL9-FORK-005 403 FORBIDDEN on a common list (no create): explanation, NO Fork CTA, the typed text is kept', async ({ page }) => {
    const { input } = await saveRefused(page, err(403, 'FORBIDDEN'))
    const banner = page.locator("[data-error='FORBIDDEN'][data-case='common-no-create']")
    await expect(banner).toBeVisible()
    await expect(banner).toHaveAttribute('role', 'alert')
    await expect(banner).toContainText(/can.t (create|fork)|ask someone/i)
    await expect(page.locator("[data-action='fork-to-edit']")).toHaveCount(0)
    await expect(input).toHaveValue('Moyenne')
  })

  test('SL9-FORK-006 access management on a common list is a 403: "managed by the platform" — never forkable', async ({ page }) => {
    const { api } = await setup(page)
    api.world.access.set(COMMON_PRIORITY_ID, err(403, 'FORBIDDEN'))
    await openRoute(page, `${detail(COMMON_PRIORITY_ID)}/access`)
    const e = page.locator("[data-error='FORBIDDEN'][data-case='common-access']")
    await expect(e).toBeVisible()
    await expect(e).toContainText(/managed by the platform/i)
    await expect(page.locator("[data-action='fork-to-edit']")).toHaveCount(0)
  })

  test('SL9-FORK-007 404 NOT_FOUND on a mutation: "List not found", no Fork CTA', async ({ page }) => {
    await saveRefused(page, err(404, 'NOT_FOUND'))
    const e = page.locator("[data-error='NOT_FOUND']")
    await expect(e.first()).toBeVisible()
    await expect(e.first()).toContainText(/list not found/i)
    await expect(page.locator("[data-action='fork-to-edit']")).toHaveCount(0)
  })

  test('SL9-FORK-008 the banner renders next to the refused control — value editor (add value)', async ({ page }) => {
    const { api } = await setup(page, { build: w => addList(w, commonPriorityList({ editable: undefined, visibility: undefined }), commonPriorityItems()) })
    api.use(on('POST', MUTATION, () => forkRequired()))
    await openRoute(page, detail(COMMON_PRIORITY_ID))
    await press(page.locator("[data-action='add-value']"))
    await page.locator("[data-field='code']").fill('BLOCKER')
    await page.locator("[data-field='label']").fill('Blocker')
    await page.locator("[data-action='save-value']").click()
    await expect(page.locator("[data-modal='add-value'] [data-reason='fork_required'], [data-panel='value-editor'] [data-reason='fork_required']").first()).toBeVisible()
    await expect(page.locator("[data-action='fork-to-edit']").first()).toBeVisible()
  })

  test('SL9-FORK-009 …reorder: the failed order is restored and the banner sits by the value list', async ({ page }) => {
    const { api } = await setup(page, { build: w => addList(w, commonPriorityList({ editable: undefined, visibility: undefined }), commonPriorityItems().filter(i => i.status === 'active')) })
    api.use(on('PUT', /\/items\/reorder$/, () => forkRequired()))
    await openRoute(page, detail(COMMON_PRIORITY_ID))
    const handle = page.locator('[data-drag-handle]').first()
    await expect(handle).toBeVisible()
    await handle.focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Space')
    await expect(page.locator("[data-reason='fork_required']").first()).toBeVisible()
    await expect(page.locator("[data-action='fork-to-edit']").first()).toBeVisible()
  })

  test('SL9-FORK-010 …translation auto-fill', async ({ page }) => {
    const { api } = await setup(page, { build: w => addList(w, commonPriorityList({ editable: undefined, visibility: undefined }), commonPriorityItems()) })
    api.use(
      on('GET', /\/translations$/, () => json(200, { locales: [
        { locale: 'en', is_source: true, translated: 5, total: 5, machine_count: 0, stale_count: 0 },
        { locale: 'es', is_source: false, translated: 0, total: 5, machine_count: 0, stale_count: 0 },
      ] })),
      on('POST', /\/translations\/es\/autofill$/, () => forkRequired()),
    )
    await openRoute(page, `${detail(COMMON_PRIORITY_ID)}/translations`)
    await press(page.locator("[data-locale='es'] [data-action='autofill']"))
    await press(page.locator("[data-action='confirm-autofill']"))
    await expect(page.locator("[data-reason='fork_required']").first()).toBeVisible()
    await expect(page.locator("[data-action='fork-to-edit']").first()).toBeVisible()
  })

  test('SL9-FORK-011 flag OFF: a stray reason=fork_required never renders the banner or the CTA (guard; passes today)', async ({ page }) => {
    const { input } = await saveRefused(page, forkRequired(), { flag: false })
    await page.waitForTimeout(400)
    await expect(page.locator("[data-reason='fork_required']")).toHaveCount(0)
    await expect(page.locator("[data-action='fork-to-edit']")).toHaveCount(0)
    await expect(input).toHaveValue('Moyenne')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Frame 05 — (2b) fork dialog
// ═════════════════════════════════════════════════════════════════════════════
test.describe('SL9 fork — frame 05-fork-dialog', () => {
  test('SL9-FORK-020 dialog: accessible modal naming the list and the org; summary facts (key kept, copied counts, replaces the common list); presentation=modal on desktop', async ({ page }) => {
    await setup(page)
    await openDialog(page)
    const d = dialog(page)
    await expect(d).toHaveAttribute('role', 'dialog')
    await expect(d).toHaveAttribute('aria-modal', 'true')
    await expect(page.getByRole('dialog', { name: /fork.*priority.*globex freight/i })).toBeVisible()
    await expect(d).toHaveAttribute('data-state', 'idle')
    await expect(d).toHaveAttribute('data-presentation', 'modal')
    const summary = d.locator('[data-fork-summary]')
    await expect(summary).toBeVisible()
    await expect(summary.locator("[data-fork-key='priority']")).toHaveText('priority')
    await expect(d.locator('[data-fork-copied]')).toContainText(/5 values.*4 active.*1 archived/i)
    await expect(d.locator('[data-fork-shadows]')).toContainText(/forms in globex freight/i)
    await expect(d.locator("[data-note='no-sync']")).toBeVisible()
    expectRuntimeClean(rt)
  })

  test('SL9-FORK-021 visibility is a RadioCardGroup of EXACTLY org (default, checked) and private — never a platform option; focus starts on the selected option', async ({ page }) => {
    await setup(page)
    await openDialog(page)
    const group = dialog(page).locator("[data-control='fork-visibility']")
    await expect(group).toHaveAttribute('role', 'radiogroup')
    await expect(group.locator('[role=radio]')).toHaveCount(2)
    await expect(group.locator('[data-visibility-option]')).toHaveCount(2)
    await expect(group.locator("[data-visibility-option='platform']")).toHaveCount(0)
    await expect(group.locator("[data-visibility-option='org'][aria-checked='true']")).toBeVisible()
    await expect(group.locator("[data-visibility-option='private'][aria-checked='false']")).toBeVisible()
    await expect(group.locator("[data-visibility-option='org']"), 'initial focus is on the selected option').toBeFocused()
    await expect(group.locator("[data-visibility-option='org']")).toHaveAttribute('tabindex', '0')
    await expect(group.locator("[data-visibility-option='private']")).toHaveAttribute('tabindex', '-1')
  })

  test('SL9-FORK-022 keyboard: ArrowDown moves the choice to private (roving tabindex); confirming sends {visibility:"private"}', async ({ page }) => {
    const { api } = await setup(page)
    api.use(forkCreates(201, { visibility: 'private' }))
    await openDialog(page)
    await page.keyboard.press('ArrowDown')
    const group = dialog(page).locator("[data-control='fork-visibility']")
    await expect(group.locator("[data-visibility-option='private']")).toHaveAttribute('aria-checked', 'true')
    await expect(group.locator("[data-visibility-option='org']")).toHaveAttribute('aria-checked', 'false')
    await expect(group.locator("[data-visibility-option='private']")).toBeFocused()
    await press(confirm(page))
    await expect.poll(() => forkCalls(api).length).toBe(1)
    expect(forkCalls(api)[0].body).toEqual({ visibility: 'private' })
  })

  test('SL9-FORK-023 focus is trapped (Tab / Shift+Tab never leave the dialog); Esc closes while idle and returns focus to the CTA; Cancel closes without a request', async ({ page }) => {
    const { api } = await setup(page)
    await openDialog(page)
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab')
      expect(await page.evaluate(() => !!document.activeElement?.closest("[data-dialog='fork']")), `Tab #${i + 1} stays inside`).toBe(true)
    }
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Shift+Tab')
      expect(await page.evaluate(() => !!document.activeElement?.closest("[data-dialog='fork']"))).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
    await expect(page.locator("[data-action='fork-to-edit']"), 'focus returns to the trigger').toBeFocused()
    await press(page.locator("[data-action='fork-to-edit']"))
    await press(cancel(page), 'Cancel')
    await expect(dialog(page)).toHaveCount(0)
    expect(forkCalls(api)).toHaveLength(0)
  })

  test('SL9-FORK-024a quota preview "37 → 38 of 100" renders when GET /quota succeeds', async ({ page }) => {
    await setup(page)
    await openDialog(page)
    const q = dialog(page).locator("[data-quota-preview='org_lists']")
    await expect(q).toBeVisible()
    await expect(q).toContainText(/37.*38.*100/)
    await expect(q.locator('[role=meter]')).toHaveAttribute('aria-valuenow', '38')
  })

  test('SL9-FORK-024b a 403 on GET /quota (an editor lacks read_quota) makes the preview ABSENT — not an error', async ({ page }) => {
    const { api } = await setup(page)
    api.world.quota = err(403, 'FORBIDDEN')
    await openDialog(page)
    await expect(dialog(page).locator("[data-note='no-sync']")).toBeVisible()
    await expect(dialog(page).locator('[data-quota-preview]')).toHaveCount(0)
    await expect(dialog(page).locator("[role='alert']")).toHaveCount(0)
  })

  test('SL9-FORK-025 the request is POST …/{sourceId}/fork with body {visibility} ONLY — never id, key or name', async ({ page }) => {
    const { api } = await setup(page)
    api.use(forkCreates())
    await openDialog(page)
    await press(confirm(page))
    await expect.poll(() => forkCalls(api).length).toBe(1)
    expect(forkCalls(api)[0].path).toBe(FORK_PATH)
    expect(forkCalls(api)[0].body).toEqual({ visibility: 'org' })
    expect(Object.keys(forkCalls(api)[0].body)).toEqual(['visibility'])
  })

  test('SL9-FORK-026 submitting: options locked, dialog not dismissible (Esc, scrim), BOTH buttons carry native `disabled`, and a second activation can never send a second request', async ({ page }) => {
    const gate = deferred()
    const { api } = await setup(page)
    api.use(hold('POST', FORK_PATH, gate.promise), forkCreates())
    await openDialog(page)
    await press(confirm(page))
    const d = page.locator("[data-dialog='fork'][data-state='submitting']")
    await expect(d).toBeVisible()
    await expect(d).toHaveAttribute('aria-busy', 'true')
    await expect(d.locator("[data-action='confirm-fork'][disabled]")).toBeVisible()
    await expect(d.locator("[data-action='cancel'][disabled]")).toBeVisible()
    await expect(d.locator("[data-visibility-option][aria-disabled='true']").first(), 'options are locked while in flight').toBeVisible()
    await page.keyboard.press('Escape')
    await page.mouse.click(4, 4)
    await expect(d, 'a dialog that closes and then creates a list anyway is a surprise').toBeVisible()
    await confirm(page).evaluate(el => (el as HTMLButtonElement).click())
    await confirm(page).evaluate(el => (el as HTMLButtonElement).click())
    gate.resolve()
    await expect(page).toHaveURL(new RegExp(`${FORK_PRIORITY_ID}$`))
    expect(forkCalls(api), 'exactly one request').toHaveLength(1)
  })

  test('SL9-FORK-027 no client-side size pre-check: Confirm stays enabled for a huge source (the 5000 cap comes only from the service)', async ({ page }) => {
    await setup(page, { build: w => addList(w, commonPriorityList({ item_count: 6000 }), commonPriorityItems()) })
    await openDialog(page)
    await expect(confirm(page)).toBeEnabled()
    await expect(dialog(page).locator("[data-case='fork-size-cap']")).toHaveCount(0)
  })

  test('SL9-FORK-028 flag OFF: no Fork CTA and the dialog is never mounted (guard; passes today)', async ({ page }) => {
    await setup(page, { flag: false })
    await openRoute(page, detail(COMMON_PRIORITY_ID))
    await page.waitForTimeout(500)
    await expect(page.locator("[data-action='fork-to-edit']")).toHaveCount(0)
    await expect(page.locator("[data-dialog='fork']")).toHaveCount(0)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Frame 06 — (2c) fork results
// ═════════════════════════════════════════════════════════════════════════════
test.describe('SL9 fork — frame 06-fork-results (success)', () => {
  test('SL9-FORK-030 201 Created: navigates to the new fork, toast "Forked", provenance lands in "comparison unavailable" (never "up to date")', async ({ page }) => {
    const { api } = await setup(page)
    api.use(forkCreates(201))
    await openDialog(page)
    await press(confirm(page))
    await expect(page).toHaveURL(new RegExp(`${INDEX}/${FORK_PRIORITY_ID}$`))
    const toast = page.locator("[data-toast='forked'][data-result='created']")
    await expect(toast).toBeVisible()
    await expect(toast).toHaveAttribute('role', 'status')
    await expect(page.locator("[data-panel='fork-provenance'][data-behind-state='unknown']")).toBeVisible()
    await expect(page.locator("[data-behind-state='up-to-date']")).toHaveCount(0)
    await expect(page.locator("[data-action='add-value']"), 'the fork is an ordinary editable list').toBeVisible()
    expectRuntimeClean(rt, { allowHttpErrors: true })
  })

  test('SL9-FORK-031 after a 201 the index cache is refreshed: the common Priority leaves "Common lists" and the fork appears under "Your organization"', async ({ page }) => {
    const { api } = await setup(page)
    api.use(forkCreates(201))
    await openRoute(page, INDEX)
    await expect(page.locator("[data-panel='list-index'] [data-list='priority'][data-source='platform']")).toBeVisible()
    await spaNavigate(page, detail(COMMON_PRIORITY_ID))
    await press(page.locator("[data-action='fork-to-edit']"))
    await press(confirm(page))
    await expect(page).toHaveURL(new RegExp(`${FORK_PRIORITY_ID}$`))
    await spaNavigate(page, INDEX)
    await expect(page.locator("[data-panel='list-index'] [data-list='priority'][data-source='own']")).toBeVisible()
    await expect(page.locator("[data-panel='list-index'] [data-list='priority'][data-source='platform']")).toHaveCount(0)
  })

  test('SL9-FORK-032 201 for a private draft: "Draft fork created" toast variant', async ({ page }) => {
    const { api } = await setup(page)
    api.use(forkCreates(201, { visibility: 'private' }))
    await openDialog(page)
    await page.keyboard.press('ArrowDown')
    await press(confirm(page))
    await expect(page.locator("[data-result='created-private']")).toBeVisible()
    await expect(page.locator("[data-result='created-private']")).toContainText(/draft/i)
  })

  test('SL9-FORK-033 200 OK (existing fork): navigates to it with an INFO notice — not an error (no alert role, no retry)', async ({ page }) => {
    const { api } = await setup(page)
    api.use(forkCreates(200))
    await openDialog(page)
    await press(confirm(page))
    await expect(page).toHaveURL(new RegExp(`${FORK_PRIORITY_ID}$`))
    const note = page.locator("[data-result='existing']")
    await expect(note).toBeVisible()
    await expect(note).toHaveAttribute('role', 'status')
    await expect(note).toContainText(/existing version/i)
    await expect(page.locator('[data-error]')).toHaveCount(0)
  })
})

test.describe('SL9 fork — frame 06-fork-results (200 existing, archived → Restore)', () => {
  const archivedFork = (over: Partial<WireList> = {}) => globexFork({ status: 'archived', ...over })
  const forkExistingArchived = (over: Partial<WireList> = {}): ApiHandler =>
    on('POST', FORK_PATH, (_c, world) => {
      const f = archivedFork(over)
      addList(world, f, forkPriorityItems(), { role: true })
      return json(200, f)
    })
  const restorePath = `/v1/selection-lists/${FORK_PRIORITY_ID}`

  async function toArchivedFork(page: Page, over: Partial<WireList> = {}) {
    const ctx = await setup(page)
    ctx.api.use(forkExistingArchived(over))
    await openDialog(page)
    await press(confirm(page))
    await expect(page).toHaveURL(new RegExp(`${FORK_PRIORITY_ID}$`))
    return ctx
  }

  test('SL9-FORK-034 archived existing fork: warning notice + "Restore your version"; while restoring the button carries native disabled; success activates it', async ({ page }) => {
    const gate = deferred()
    const { api } = await toArchivedFork(page)
    const note = page.locator("[data-result='existing-archived']")
    await expect(note).toBeVisible()
    await expect(note).toHaveAttribute('role', 'status')
    api.use(hold('PATCH', restorePath, gate.promise), on('PATCH', restorePath, (_c, w) => {
      const f = { ...w.lists.get(FORK_PRIORITY_ID)!, status: 'active' as const }
      w.lists.set(FORK_PRIORITY_ID, f)
      return json(200, f)
    }))
    await press(page.locator("[data-action='restore-fork']"))
    await expect(page.locator("[data-state='restoring'] [data-action='restore-fork'][disabled]")).toBeVisible()
    gate.resolve()
    await expect(page.locator("[data-action='restore-fork']")).toHaveCount(0)
    const patch = api.callsTo('PATCH', restorePath)
    expect(patch).toHaveLength(1)
    expect(patch[0].body).toEqual({ status: 'active' })
  })

  test('SL9-FORK-035 "Restore" renders ONLY when the fork is editable', async ({ page }) => {
    await toArchivedFork(page, { editable: false })
    await expect(page.locator("[data-result='existing-archived']")).toBeVisible()
    await expect(page.locator("[data-action='restore-fork']")).toHaveCount(0)
  })

  const RESTORE_REFUSALS = [
    { name: 'org_lists', reply: err(403, 'QUOTA_EXCEEDED', { scope: 'org_lists', limit: 100, current: 100 }), sel: "[data-case='restore-quota'][data-error='QUOTA_EXCEEDED'][data-quota-scope='org_lists']", text: /100/ },
    { name: 'user_lists', reply: err(403, 'QUOTA_EXCEEDED', { scope: 'user_lists', limit: 25, current: 25 }), sel: "[data-case='restore-quota'] [data-quota-scope='user_lists'], [data-case='restore-quota'][data-quota-scope='user_lists']", text: /25/, notYou: true },
    { name: 'unknown scope', reply: err(403, 'QUOTA_EXCEEDED', { scope: 'something_new', limit: 1, current: 1 }), sel: "[data-case='restore-quota']", text: /a limit was reached/i },
    { name: 'FORBIDDEN', reply: err(403, 'FORBIDDEN'), sel: "[data-case='restore-forbidden'][data-error='FORBIDDEN']", text: /permission/i },
  ] as const
  for (const r of RESTORE_REFUSALS) {
    test(`SL9-FORK-036-${r.name.replace(' ', '-')} restore refused (403 ${r.name}): branched on code, scope copy with numbers, and the fork stays archived`, async ({ page }) => {
      const { api } = await toArchivedFork(page)
      api.use(on('PATCH', restorePath, () => r.reply))
      await press(page.locator("[data-action='restore-fork']"))
      const e = page.locator(r.sel).first()
      await expect(e).toBeVisible()
      await expect(e).toContainText(r.text)
      if ('notYou' in r) await expect(e, 'user_lists counts the fork\'s CREATOR, never "you"').not.toContainText(/\byou('ve|r)?\b/i)
      await expect(page.locator("[data-action='restore-fork']"), 'still archived, can retry').toBeVisible()
    })
  }
})

test.describe('SL9 fork — frame 06-fork-results (refusals inside the dialog)', () => {
  interface Case { id: string; reply: ApiReply; sel: string; text?: RegExp; notText?: RegExp; dialogResult?: string }
  const CASES: Case[] = [
    { id: 'fork_exists', reply: err(409, 'CONFLICT', { reason: 'fork_exists' }), sel: "[data-error='CONFLICT'][data-reason='fork_exists']", text: /private draft|can.t see|owner/i, notText: /\badmin(istrator)?\b/i },
    { id: 'fork_not_applicable', reply: err(409, 'CONFLICT', { reason: 'fork_not_applicable' }), sel: "[data-reason='fork_not_applicable']", text: /already belongs to your organization/i },
    // frame 06: `data-result='key-conflict'` is on the DIALOG itself; the alert is its child (data-error=CONFLICT).
    { id: 'key-taken', reply: err(409, 'CONFLICT'), sel: "[data-error='CONFLICT']", dialogResult: 'key-conflict', text: /already has a list with the key.*priority/i },
    { id: 'key-taken-unknown-reason', reply: err(409, 'CONFLICT', { reason: 'some_future_reason' }), sel: "[data-error='CONFLICT']", dialogResult: 'key-conflict', text: /already has a list with the key/i },
    { id: 'quota-org_lists', reply: err(403, 'QUOTA_EXCEEDED', { scope: 'org_lists', limit: 100, current: 100 }), sel: "[data-error='QUOTA_EXCEEDED'][data-quota-scope='org_lists']", text: /100/ },
    { id: 'quota-user_lists', reply: err(403, 'QUOTA_EXCEEDED', { scope: 'user_lists', limit: 25, current: 25 }), sel: "[data-error='QUOTA_EXCEEDED'] [data-quota-scope='user_lists'], [data-quota-scope='user_lists']", text: /25/ },
    { id: 'quota-list_items', reply: err(403, 'QUOTA_EXCEEDED', { scope: 'list_items', limit: 250, current: 312 }), sel: "[data-error='QUOTA_EXCEEDED'] [data-quota-scope='list_items'], [data-quota-scope='list_items']", text: /312.*250|250.*312/ },
    { id: 'quota-unknown-scope', reply: err(403, 'QUOTA_EXCEEDED', { scope: 'something_new', limit: 1, current: 1 }), sel: "[data-error='QUOTA_EXCEEDED']", text: /a limit was reached/i },
    { id: 'size-cap', reply: err(400, 'VALIDATION_ERROR'), sel: "[data-error='VALIDATION_ERROR'][data-case='fork-size-cap']", text: /too large to fork.*5,?000/is },
    { id: 'forbidden', reply: err(403, 'FORBIDDEN'), sel: "[data-error='FORBIDDEN'][data-case='fork-no-create']", text: /can.t fork lists/i },
    { id: 'not-found', reply: err(404, 'NOT_FOUND'), sel: "[data-error='NOT_FOUND']", dialogResult: 'not-found', text: /no longer available/i },
  ]
  for (const c of CASES) {
    test(`SL9-FORK-040-${c.id} refusal renders inside the OPEN dialog; nothing navigates; the dialog is not retryable unless it is the network case`, async ({ page }) => {
      const { api } = await setup(page)
      api.use(on('POST', FORK_PATH, () => c.reply))
      await openDialog(page)
      await press(confirm(page))
      if (c.dialogResult) await expect(dialog(page), `the dialog itself carries data-result=${c.dialogResult}`).toHaveAttribute('data-result', c.dialogResult)
      const banner = dialog(page).locator(c.sel).first()
      await expect(banner).toBeVisible()
      await expect(dialog(page).getByRole('alert').first(), 'the refusal is announced as an alert').toBeVisible()
      if (c.text) await expect(dialog(page)).toContainText(c.text)
      if (c.notText) await expect(banner).not.toContainText(c.notText)
      await expect(dialog(page), 'refusals never close the dialog').toBeVisible()
      expect(new URL(page.url()).pathname, 'nothing navigates').toBe(detail(COMMON_PRIORITY_ID))
      await expect(dialog(page).locator("[data-action='retry']"), 'a refusal is not retryable').toHaveCount(0)
    })
  }

  test('SL9-FORK-041 fork_exists carries no id: the dialog invents no link to the hidden fork', async ({ page }) => {
    const { api } = await setup(page)
    api.use(on('POST', FORK_PATH, () => err(409, 'CONFLICT', { reason: 'fork_exists' })))
    await openDialog(page)
    await press(confirm(page))
    const banner = dialog(page).locator("[data-reason='fork_exists']")
    await expect(banner).toBeVisible()
    await expect(banner.locator('a')).toHaveCount(0)
  })

  test('SL9-FORK-042 key-taken 409 (no reason) names no list and does no lookup: no link to it, no extra list reads', async ({ page }) => {
    const { api } = await setup(page)
    api.use(on('POST', FORK_PATH, () => err(409, 'CONFLICT')))
    await openDialog(page)
    const before = api.calls.filter(c => c.method === 'GET').length
    await press(confirm(page))
    await expect(dialog(page)).toHaveAttribute('data-result', 'key-conflict')
    await expect(dialog(page).locator("[data-error='CONFLICT']")).toBeVisible()
    await expect(dialog(page).locator("a:not([data-action='close'])")).toHaveCount(0)
    await page.waitForTimeout(400)
    expect(api.calls.filter(c => c.method === 'GET').length, 'no lookup after the refusal').toBe(before)
  })

  test('SL9-FORK-043 fork_not_applicable: the detail reloads when the dialog is closed', async ({ page }) => {
    const { api } = await setup(page)
    api.use(on('POST', FORK_PATH, () => err(409, 'CONFLICT', { reason: 'fork_not_applicable' })))
    await openDialog(page)
    await press(confirm(page))
    await expect(dialog(page).locator("[data-reason='fork_not_applicable']")).toBeVisible()
    const reads = () => api.callsTo('GET', `/v1/selection-lists/${COMMON_PRIORITY_ID}`).length
    const before = reads()
    await press(dialog(page).locator("[data-action='close']"))
    await expect.poll(reads).toBeGreaterThan(before)
  })

  test('SL9-FORK-044 the 5000-value cap renders ONLY from the service 400 (Confirm was enabled before it)', async ({ page }) => {
    const { api } = await setup(page)
    api.use(on('POST', FORK_PATH, () => err(400, 'VALIDATION_ERROR')))
    await openDialog(page)
    await expect(confirm(page)).toBeEnabled()
    await expect(page.locator("[data-case='fork-size-cap']")).toHaveCount(0)
    await press(confirm(page))
    await expect(page.locator("[data-case='fork-size-cap']")).toBeVisible()
  })

  test('SL9-FORK-045 403 FORBIDDEN: after closing, the detail replaces its Fork CTA with the explanation for the rest of the session', async ({ page }) => {
    const { api } = await setup(page)
    api.use(on('POST', FORK_PATH, () => err(403, 'FORBIDDEN')))
    await openDialog(page)
    await press(confirm(page))
    await expect(dialog(page).locator("[data-case='fork-no-create']")).toBeVisible()
    await press(dialog(page).locator("[data-action='close']"))
    await expect(dialog(page)).toHaveCount(0)
    await expect(page.locator("[data-action='fork-to-edit']")).toHaveCount(0)
    await expect(page.locator("[data-case='fork-no-create']")).toBeVisible()
  })

  test('SL9-FORK-046 network failure: "couldn\'t confirm", Try again re-sends the SAME body and an idempotent 200 navigates to the existing fork', async ({ page }) => {
    const { api } = await setup(page)
    let n = 0
    api.use(on('POST', FORK_PATH, (_c, world) => {
      n += 1
      if (n === 1) return { abort: true }
      const f = globexFork()
      addList(world, f, forkPriorityItems(), { role: true })
      return json(200, f)
    }))
    await openDialog(page)
    await press(confirm(page))
    const net = dialog(page).locator("[data-error='network']")
    await expect(net).toBeVisible()
    await expect(net).toContainText(/couldn.t confirm/i)
    await press(dialog(page).locator("[data-action='retry']"), 'Try again')
    await expect(page).toHaveURL(new RegExp(`${FORK_PRIORITY_ID}$`))
    expect(forkCalls(api).map(c => c.body)).toEqual([{ visibility: 'org' }, { visibility: 'org' }])
  })

  test('SL9-FORK-047 a 5xx is the same "outcome unknown" state as a network failure (retryable)', async ({ page }) => {
    const { api } = await setup(page)
    api.use(on('POST', FORK_PATH, () => err(502, 'INTERNAL')))
    await openDialog(page)
    await press(confirm(page))
    await expect(dialog(page).locator("[data-error='network']")).toBeVisible()
    await expect(dialog(page).locator("[data-action='retry']")).toBeVisible()
    await expect(dialog(page).locator("[data-action='close']")).toBeVisible()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Frame 12 — (2d) RTL + 375 px: the dialog is a BottomSheet
// ═════════════════════════════════════════════════════════════════════════════
const LOCALES = [
  { tag: 'en-US', dir: 'ltr' },
  { tag: 'he-IL', dir: 'rtl' },
  { tag: 'ar', dir: 'rtl' },
] as const

for (const loc of LOCALES) {
  test.describe(`SL9 fork — frame 12-rtl-mobile-fork @375x667 ${loc.tag}`, () => {
    test.use({ ...MOBILE_375_SHORT, locale: loc.tag })

    test(`SL9-FORK-050-${loc.tag} below 40em the dialog is a bottom sheet: dir=${loc.dir}, choice + no-sync note + both actions visible WITHOUT scrolling, actions stacked with the primary last and full-width, targets >=44px`, async ({ page }) => {
      await setup(page)
      await openDialog(page)
      const sheet = page.locator("[data-dialog='fork'][data-presentation='bottom-sheet']")
      await expect(sheet).toBeVisible()
      await expect(page.locator("[data-dialog='fork'][data-presentation='modal']")).toHaveCount(0)
      expect(await documentDir(page)).toBe(loc.dir)
      await expectInViewport(page, sheet.locator("[data-control='fork-visibility']"), 'visibility choice')
      await expectInViewport(page, sheet.locator("[data-note='no-sync']"), 'no-sync note')
      await expectInViewport(page, sheet.locator("[data-action='cancel']"), 'Cancel')
      await expectInViewport(page, sheet.locator("[data-action='confirm-fork']"), 'Fork list')
      const c = (await sheet.locator("[data-action='cancel']").boundingBox())!
      const f = (await sheet.locator("[data-action='confirm-fork']").boundingBox())!
      expect(f.y, 'primary action is bottom-most (nearest the thumb) — vertical stacking, same in RTL').toBeGreaterThan(c.y)
      expect(f.width, 'primary action is full width').toBeGreaterThanOrEqual(375 * 0.7)
      await expectTouchTarget(sheet.locator("[data-action='confirm-fork']"), 'Fork list')
      await expectTouchTarget(sheet.locator("[data-action='cancel']"), 'Cancel')
      await expectTouchTarget(sheet.locator("[data-visibility-option='org']"), 'org option')
      await expectTouchTarget(sheet.locator("[data-visibility-option='private']"), 'private option')
      await expect(sheet).toHaveAttribute('role', 'dialog')
      await expectLtrIsland(page, 'priority', 'fork key')
      await expect(sheet.locator("[data-visibility-option='org'][aria-checked='true']")).toBeVisible()
    })

    test(`SL9-FORK-051-${loc.tag} the sheet dismisses by scrim / Esc ONLY while idle — never while submitting`, async ({ page }) => {
      const gate = deferred()
      const { api } = await setup(page)
      api.use(hold('POST', FORK_PATH, gate.promise), forkCreates())
      await openDialog(page)
      const sheet = page.locator("[data-dialog='fork'][data-presentation='bottom-sheet']")
      await page.mouse.click(187, 20)
      await expect(sheet, 'scrim dismisses while idle').toHaveCount(0)
      await press(page.locator("[data-action='fork-to-edit']"))
      await press(confirm(page))
      await expect(page.locator("[data-dialog='fork'][data-state='submitting']")).toBeVisible()
      await page.mouse.click(187, 20)
      await page.keyboard.press('Escape')
      await expect(page.locator("[data-dialog='fork']"), 'never dismissable while submitting').toBeVisible()
      gate.resolve()
      await expect(page).toHaveURL(new RegExp(`${FORK_PRIORITY_ID}$`))
    })
  })
}
