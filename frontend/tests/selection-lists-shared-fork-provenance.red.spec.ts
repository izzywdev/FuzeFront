/**
 * SELECTION LISTS — SHARED LISTS (SL9) — FLOW 3 "fork-provenance" — RED-by-design UI e2e.
 * (frontend-test-engineer — independent verification, NOT the implementer.)
 *
 * Derived STRICTLY from the approved flow `fork-provenance` (approved 2026-10-20) of
 * design/frames/selection-lists-shared/manifest.json:
 *
 *   07-fork-detail.html            (3a) provenance card, "behind source" states, "Copied from",
 *                                       revert-to-common / archive-fork gating + confirmations, 403
 *   13-rtl-mobile-provenance.html  (3b) 375 px, en / he (RTL), bottom-sheet confirmations
 *
 * and the frozen contract (4.2.0): `SelectionList.forked_from` / `.revision`, `SelectionListItem.origin_item_id`,
 * `POST /v1/selection-lists/{listId}/archive`.
 * Implementation target: packages/selection-lists-ui/src/shared-lists/{core,provenance}/**
 * (ForkProvenancePanel, BehindSourceIndicator, RevertToCommonConfirm).
 *
 * ── CONTRACT DEPENDENCY (manifest.build.flows[fork-provenance].contractDependency) ────────
 * "behind" / "up-to-date" need `SelectionList.revision` — read-only, additive, in contract 4.2.0 (optional until the
 * implementation ships). The service does not emit it yet, so against the real service only "comparison unavailable"
 * (PROV-003) is reachable today; PROV-004 / PROV-005 mock the source response WITH `revision` (what 4.2.0 documents), and
 * stay valid when the service starts to emit it. Every other spec is independent of the dependency.
 *
 * RED today / canary / flag-OFF semantics and how this file lands: see
 * selection-lists-shared-read.red.spec.ts and docs/planning/selection-lists-shared-ui-red-specs.md.
 *
 * Run: cd frontend && BASE_URL=http://localhost:4173 npx playwright test \
 *        tests/selection-lists-shared-fork-provenance.red.spec.ts --project=chromium
 */
import { test, expect, type Page } from '@playwright/test'
import {
  COMMON_PRIORITY_ID,
  FORK_ITEM_IDS,
  FORK_PRIORITY_ID,
  COMMON_ITEM_IDS,
  MOBILE_375,
  ORGS,
  addList,
  commonPriorityItems,
  commonPriorityList,
  createWorld,
  deferred,
  documentDir,
  err,
  fault,
  expectInViewport,
  expectRuntimeClean,
  expectTouchTarget,
  failTimes,
  forkPriorityItems,
  forkPriorityList,
  hold,
  mockSharedListsSession,
  mountSelectionListApi,
  on,
  openRoute,
  press,
  trackRuntime,
  type Api,
  type Runtime,
  type WireList,
} from './support/selection-lists-shared-e2e'

test.use({ serviceWorkers: 'block' })

const detail = (id: string) => `/settings/selection-lists/${id}`
const ARCHIVE = `/v1/selection-lists/${FORK_PRIORITY_ID}/archive`

let rt: Runtime
test.afterEach(() => {
  if (rt) expect(rt.pageErrors, 'no uncaught exception may reach the page').toEqual([])
})

type Source = 'active' | 'archived' | 'gone' | { revision: number }

async function setup(page: Page, opts: { flag?: boolean; source?: Source; fork?: Partial<WireList> } = {}) {
  rt = trackRuntime(page)
  const org = await mockSharedListsSession(page, { sharedLists: opts.flag ?? true, org: ORGS.acme })
  const world = createWorld(org.id)
  addList(world, forkPriorityList(opts.fork), forkPriorityItems(), { role: true })
  const source = opts.source ?? 'active'
  if (source !== 'gone') {
    const over: Partial<WireList> =
      source === 'archived' ? { status: 'archived' } : typeof source === 'object' ? { revision: source.revision } : {}
    // The source changed after forking: updated_at is later than forked_at. A UI that guessed
    // "behind/up to date" from timestamps would be wrong in both directions.
    addList(world, commonPriorityList({ updated_at: '2026-10-01T00:00:00Z', ...over }), commonPriorityItems())
  }
  const api = await mountSelectionListApi(page, world)
  api.use(on('POST', ARCHIVE, (_c, w) => {
    w.lists.set(FORK_PRIORITY_ID, { ...w.lists.get(FORK_PRIORITY_ID)!, status: 'archived' })
    return { status: 204 }
  }))
  return { api, world }
}

const panel = (page: Page) => page.locator("[data-panel='fork-provenance']")
/**
 * Frame 07's main card puts `data-behind-state` on the status line INSIDE the panel; its state gallery and
 * frame 13 put it on the panel itself. Accept both; read the recorded facts from `panel()`.
 */
const behind = (page: Page, state: string) =>
  page.locator(`[data-panel='fork-provenance'][data-behind-state='${state}'], [data-panel='fork-provenance'] [data-behind-state='${state}']`).first()
const sourceReads = (api: Api) => api.callsTo('GET', `/v1/selection-lists/${COMMON_PRIORITY_ID}`)
const revert = (page: Page) => page.locator("[data-action='revert-to-common']")
const archiveFork = (page: Page) => page.locator("[data-action='archive-fork']")

test.describe('SL9 provenance — frame 07-fork-detail', () => {
  test('SL9-PROV-000 canary: a fork is an ordinary editable list in the 4.0.0 detail (passes today)', async ({ page }) => {
    await setup(page, { flag: false })
    await openRoute(page, detail(FORK_PRIORITY_ID))
    await expect(page.locator("[data-panel='value-editor']")).toBeVisible()
    await expect(page.locator("[data-action='add-value']")).toBeVisible()
  })

  test('SL9-PROV-001 provenance facts render immediately from forked_from: source link, forked-at, copied revision; fork/org badges; no Fork CTA on a fork', async ({ page }) => {
    await setup(page)
    await openRoute(page, detail(FORK_PRIORITY_ID))
    await expect(panel(page)).toBeVisible()
    await expect(panel(page).locator("[data-forked-revision='7']")).toHaveText('7')
    await expect(panel(page)).toContainText(/2026/)
    const link = panel(page).locator("[data-action='view-source']").first()
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('href', new RegExp(`/settings/selection-lists/${COMMON_PRIORITY_ID}$`))
    await expect(page.locator("[data-badge='fork']").first()).toBeVisible()
    await expect(page.locator("[data-editable='true']").first()).toBeVisible()
    await expect(page.locator("[data-visibility='org']").first()).toBeVisible()
    await expect(page.locator("[data-action='fork-to-edit']"), 'no Fork CTA on a fork').toHaveCount(0)
    await expect(page.locator("[data-action='add-value']"), 'the fork is edited with the 4.0.0 editor').toBeVisible()
    expectRuntimeClean(rt)
  })

  test('SL9-PROV-002 checking: the facts and the value editor never wait for the comparison; neither revert nor archive-fork is offered until the read answers', async ({ page }) => {
    const gate = deferred()
    const { api } = await setup(page)
    api.use(hold('GET', `/v1/selection-lists/${COMMON_PRIORITY_ID}`, gate.promise))
    await openRoute(page, detail(FORK_PRIORITY_ID))
    const p = behind(page, 'checking')
    await expect(p).toBeVisible()
    await expect(panel(page)).toHaveAttribute('aria-busy', 'true')
    await expect(panel(page).locator("[data-forked-revision='7']")).toBeVisible()
    await expect(page.locator(`[data-item='${FORK_ITEM_IDS.low}']`), 'the editor does not wait').toBeVisible()
    await expect(revert(page)).toHaveCount(0)
    await expect(archiveFork(page)).toHaveCount(0)
    gate.resolve()
    await expect(behind(page, 'unknown')).toBeVisible()
  })

  test('SL9-PROV-003 comparison unavailable (what the service answers until it emits `revision`): source returns no revision; never inferred from updated_at', async ({ page }) => {
    await setup(page)
    await openRoute(page, detail(FORK_PRIORITY_ID))
    const p = behind(page, 'unknown')
    await expect(p).toBeVisible()
    await expect(panel(page)).toContainText(/copied version 7/i)
    await expect(panel(page)).toContainText(/not tracked/i)
    await expect(page.locator("[data-behind-state='behind'], [data-behind-state='up-to-date']")).toHaveCount(0)
  })

  test('SL9-PROV-004 behind: source revision 9 > copied 7 — informational only, no merge/sync action', async ({ page }) => {
    await setup(page, { source: { revision: 9 } })
    await openRoute(page, detail(FORK_PRIORITY_ID))
    const p = behind(page, 'behind')
    await expect(p).toBeVisible()
    await expect(panel(page).locator("[data-source-revision='9']")).toHaveText('9')
    await expect(panel(page).locator("[data-forked-revision='7']")).toHaveText('7')
    await expect(panel(page)).toContainText(/common list has changed since you forked/i)
    await expect(p.getByRole('button', { name: /merge|sync|update|pull/i })).toHaveCount(0)
  })

  test('SL9-PROV-005 up to date: source revision = copied revision', async ({ page }) => {
    await setup(page, { source: { revision: 7 } })
    await openRoute(page, detail(FORK_PRIORITY_ID))
    const p = behind(page, 'up-to-date')
    await expect(p).toBeVisible()
    await expect(panel(page)).toContainText(/same version as the common list/i)
  })

  test('SL9-PROV-006 source archived: "retired", no error colour, source link kept', async ({ page }) => {
    await setup(page, { source: 'archived' })
    await openRoute(page, detail(FORK_PRIORITY_ID))
    const p = behind(page, 'source-archived')
    await expect(p).toBeVisible()
    await expect(panel(page)).toContainText(/retired|archived/i)
    await expect(panel(page)).toContainText(/your fork is unaffected/i)
  })

  test('SL9-PROV-007 source gone (404: purged OR unreadable): "no longer available", NO link, NO alert/error colour', async ({ page }) => {
    await setup(page, { source: 'gone' })
    await openRoute(page, detail(FORK_PRIORITY_ID))
    const p = behind(page, 'source-gone')
    await expect(p).toBeVisible()
    await expect(panel(page)).toContainText(/no longer available/i)
    await expect(panel(page).locator("[data-action='view-source']")).toHaveCount(0)
    await expect(panel(page).locator('a')).toHaveCount(0)
    await expect(panel(page).locator("[role='alert']")).toHaveCount(0)
  })

  test('SL9-PROV-008 check failed (5xx / network): "Couldn\'t check", Retry re-runs the read', async ({ page }) => {
    const { api } = await setup(page)
    api.use(failTimes(1, 'GET', `/v1/selection-lists/${COMMON_PRIORITY_ID}`, fault(503)))
    await openRoute(page, detail(FORK_PRIORITY_ID))
    const p = behind(page, 'error')
    await expect(p).toBeVisible()
    await expect(panel(page)).toContainText(/couldn.t check/i)
    await expect(revert(page)).toHaveCount(0)
    await expect(archiveFork(page)).toHaveCount(0)
    const before = sourceReads(api).length
    await press(panel(page).locator("[data-action='retry']"), 'Retry')
    await expect.poll(() => sourceReads(api).length).toBeGreaterThan(before)
    await expect(behind(page, 'unknown')).toBeVisible()
  })

  test('SL9-PROV-009 "Copied from" maps origin_item_id to the loaded source items; null origin = added in the fork', async ({ page }) => {
    await setup(page)
    await openRoute(page, detail(FORK_PRIORITY_ID))
    const low = page.locator(`[data-item='${FORK_ITEM_IDS.low}'][data-origin-item='${COMMON_ITEM_IDS.low}']`)
    await expect(low).toBeVisible()
    await expect(low).toContainText(/common.*low/i)
    // Acme relabelled NORMAL "Medium"; the code stays and the provenance names the common label.
    const medium = page.locator(`[data-item='${FORK_ITEM_IDS.medium}'][data-origin-item='${COMMON_ITEM_IDS.normal}']`)
    await expect(medium).toContainText(/medium/i)
    await expect(medium).toContainText(/normal/i)
    const blocker = page.locator(`[data-item='${FORK_ITEM_IDS.blocker}'][data-origin-item='none']`)
    await expect(blocker).toBeVisible()
    await expect(blocker).toContainText(/added/i)
    await expect(page.getByRole('columnheader', { name: /copied from/i })).toBeVisible()
  })

  test('SL9-PROV-010 when the source is unavailable the column says "copied" without a label', async ({ page }) => {
    await setup(page, { source: 'gone' })
    await openRoute(page, detail(FORK_PRIORITY_ID))
    const low = page.locator(`[data-item='${FORK_ITEM_IDS.low}'][data-origin-item='${COMMON_ITEM_IDS.low}']`)
    await expect(low).toBeVisible()
    await expect(low).toContainText(/copied/i)
    await expect(low).not.toContainText(/common.{0,3}low/i)
  })

  const GATES: Array<{ name: string; source: Source; action: 'revert' | 'archive-fork'; gate: string }> = [
    { name: 'source active (comparison unavailable)', source: 'active', action: 'revert', gate: 'source-active' },
    { name: 'source active, behind @needs-contract-revision', source: { revision: 9 }, action: 'revert', gate: 'source-active' },
    { name: 'source archived', source: 'archived', action: 'archive-fork', gate: 'source-unavailable' },
    { name: 'source gone (404)', source: 'gone', action: 'archive-fork', gate: 'source-unavailable' },
  ]
  for (const g of GATES) {
    test(`SL9-PROV-011 header action follows the provenance read: ${g.name} -> ${g.action}`, async ({ page }) => {
      await setup(page, { source: g.source })
      await openRoute(page, detail(FORK_PRIORITY_ID))
      const wanted = g.action === 'revert' ? revert(page) : archiveFork(page)
      const other = g.action === 'revert' ? archiveFork(page) : revert(page)
      await expect(wanted).toBeVisible()
      // The frames put the gate marker on the action itself (07 "revert", 13) OR on the action's wrapper
      // (07 "Header action — source archived or gone": `<div class="sl-head__actions" data-revert-gate=…>`
      // around `<a data-action="archive-fork">`). Accept the nearest of the two.
      await expect(wanted.locator('xpath=ancestor-or-self::*[@data-revert-gate][1]'), `revert gate marker on the action or its wrapper`).toHaveAttribute('data-revert-gate', g.gate)
      await expect(other).toHaveCount(0)
      if (g.action === 'archive-fork') {
        await expect(page.getByRole('button', { name: /revert/i }), 'the word "revert" never appears when no active common list was read').toHaveCount(0)
        await expect(page.getByRole('link', { name: /revert/i })).toHaveCount(0)
      }
    })
  }

  test('SL9-PROV-012 revert confirm (source active): alertdialog, three consequences, Cancel holds focus, Esc closes while idle; confirming archives the fork (native disabled in flight)', async ({ page }) => {
    const gate = deferred()
    const { api } = await setup(page)
    await openRoute(page, detail(FORK_PRIORITY_ID))
    await press(revert(page), 'Revert to common list…')
    const c = page.locator("[data-confirm='revert-to-common']")
    await expect(c).toBeVisible()
    await expect(c).toHaveAttribute('role', 'alertdialog')
    await expect(page.getByRole('alertdialog', { name: /revert .* to the common priority list/i })).toBeVisible()
    await expect(c).toContainText(/archived.*not deleted/i)
    await expect(c).toContainText(/forms go back to the common list/i)
    await expect(c).toContainText(/not applied to the common list/i)
    await expect(c.locator("[data-action='cancel']"), 'the safe action holds initial focus').toBeFocused()
    await page.keyboard.press('Escape')
    await expect(c).toHaveCount(0)
    expect(api.callsTo('POST', ARCHIVE)).toHaveLength(0)

    await press(revert(page))
    api.use(hold('POST', ARCHIVE, gate.promise))
    await press(c.locator("[data-action='confirm-revert']"))
    await expect(c.locator("[data-action='confirm-revert'][disabled]")).toBeVisible()
    gate.resolve()
    await expect(c).toHaveCount(0)
    expect(api.callsTo('POST', ARCHIVE)).toHaveLength(1)
  })

  test('SL9-PROV-013 revert refused with 403 (not the owner): "Only the list\'s owner can archive it", nothing changed', async ({ page }) => {
    const { api } = await setup(page)
    api.use(on('POST', ARCHIVE, () => err(403, 'FORBIDDEN')))
    await openRoute(page, detail(FORK_PRIORITY_ID))
    await press(revert(page))
    await press(page.locator("[data-confirm='revert-to-common'] [data-action='confirm-revert']"))
    const e = page.locator("[data-error='FORBIDDEN'][data-case='revert-not-owner']")
    await expect(e).toBeVisible()
    await expect(e).toHaveAttribute('role', 'alert')
    await expect(e).toContainText(/only the list.s owner can archive it/i)
    await expect(page.locator("[data-action='add-value']"), 'the fork is still editable (not archived)').toBeVisible()
  })

  test('SL9-PROV-014 archive-fork, source ARCHIVED: states outright that forms show "List unavailable"; Cancel ("Keep using this list") holds focus; confirming archives', async ({ page }) => {
    const { api } = await setup(page, { source: 'archived' })
    await openRoute(page, detail(FORK_PRIORITY_ID))
    await press(archiveFork(page))
    const c = page.locator("[data-confirm='archive-fork-no-common'][data-case='revert-unavailable'][data-source-state='archived']")
    await expect(c).toBeVisible()
    await expect(c).toHaveAttribute('role', 'alertdialog')
    await expect(c.locator("[data-consequence='no-effective-list']")).toContainText(/no common list to go back to.*list unavailable/is)
    await expect(c).not.toContainText(/revert/i)
    await expect(c.locator("[data-action='cancel']")).toBeFocused()
    await press(c.locator("[data-action='confirm-archive-fork']"))
    await expect.poll(() => api.callsTo('POST', ARCHIVE).length).toBe(1)
  })

  test('SL9-PROV-015 archive-fork, source GONE (404): CONDITIONAL copy ("if no active common list…"), never claims every form becomes unavailable', async ({ page }) => {
    await setup(page, { source: 'gone' })
    await openRoute(page, detail(FORK_PRIORITY_ID))
    await press(archiveFork(page))
    const c = page.locator("[data-confirm='archive-fork-source-unknown'][data-case='revert-unavailable'][data-source-state='gone']")
    await expect(c).toBeVisible()
    await expect(c.locator("[data-consequence='conditional-no-effective-list']")).toContainText(/if no active common priority list is available/i)
    await expect(c.locator("[data-consequence='no-effective-list']")).toHaveCount(0)
    await expect(c).not.toContainText(/revert/i)
    await expect(c.locator("[data-action='cancel']")).toBeFocused()
  })

  test('SL9-PROV-016 archive-fork refused with 403 shows the owner-only message too', async ({ page }) => {
    const { api } = await setup(page, { source: 'archived' })
    api.use(on('POST', ARCHIVE, () => err(403, 'FORBIDDEN')))
    await openRoute(page, detail(FORK_PRIORITY_ID))
    await press(archiveFork(page))
    await press(page.locator("[data-confirm='archive-fork-no-common'] [data-action='confirm-archive-fork']"))
    await expect(page.locator("[data-error='FORBIDDEN'][data-case='revert-not-owner']")).toContainText(/only the list.s owner/i)
  })

  test('SL9-PROV-017 "Change who can see it" leads to the Access tab', async ({ page }) => {
    await setup(page)
    await openRoute(page, detail(FORK_PRIORITY_ID))
    await press(page.locator("[data-action='change-visibility']"))
    await expect(page).toHaveURL(new RegExp(`${FORK_PRIORITY_ID}/access$`))
  })

  test('SL9-PROV-018 flag OFF: no provenance, badges, "Copied from" column, revert/archive-fork, and the source is never read (guard; passes today)', async ({ page }) => {
    const { api } = await setup(page, { flag: false })
    await openRoute(page, detail(FORK_PRIORITY_ID))
    await expect(page.locator("[data-panel='value-editor']")).toBeVisible()
    for (const hook of ["[data-panel='fork-provenance']", '[data-badge]', '[data-origin-item]', "[data-action='revert-to-common']", "[data-action='archive-fork']", '[data-visibility]']) {
      await expect(page.locator(hook), `${hook} must be absent while the flag is OFF`).toHaveCount(0)
    }
    await expect(page.getByRole('columnheader', { name: /copied from/i })).toHaveCount(0)
    expect(sourceReads(api), 'no provenance read while OFF').toHaveLength(0)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Frame 13 — (3b) RTL + 375 px
// ═════════════════════════════════════════════════════════════════════════════
for (const loc of [{ tag: 'en-US', dir: 'ltr' }, { tag: 'he-IL', dir: 'rtl' }] as const) {
  test.describe(`SL9 provenance — frame 13-rtl-mobile-provenance @375 ${loc.tag}`, () => {
    test.use({ ...MOBILE_375, locale: loc.tag })

    test(`SL9-PROV-020-${loc.tag} fork detail at 375px: dir=${loc.dir}; the card stacks, "View common list" and the gated header action are full-width >=44px; facts are bidi-isolated`, async ({ page }) => {
      await setup(page)
      await openRoute(page, detail(FORK_PRIORITY_ID))
      expect(await documentDir(page)).toBe(loc.dir)
      await expect(panel(page)).toBeVisible()
      await expectInViewport(page, panel(page), 'provenance card')
      const card = await panel(page).evaluate(n => ({ sw: n.scrollWidth, cw: n.clientWidth }))
      expect(card.sw, 'the card never scrolls sideways').toBeLessThanOrEqual(card.cw + 1)
      const view = panel(page).locator("a[data-action='view-source'], button[data-action='view-source']").last()
      await expectTouchTarget(view, 'View common list')
      // Full-width = it spans the card's CONTENT box (frame 13 at 375: the card is inset, so the link is 273 px of a 307 px card,
      // not 300 px of the viewport). Measured from the rendered card instead of a viewport constant.
      const cardInner = await panel(page).evaluate(n => {
        const s = getComputedStyle(n)
        return n.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight)
      })
      expect((await view.boundingBox())!.width, 'View common list spans the card content box').toBeGreaterThanOrEqual(cardInner - 1)
      await expectTouchTarget(revert(page), 'Revert to common list')
      expect((await revert(page).boundingBox())!.width, 'header action is full-width').toBeGreaterThanOrEqual(300)
      const bidi = await panel(page).locator('[data-forked-revision]').evaluate(n => getComputedStyle(n).unicodeBidi)
      expect(bidi, 'revision numbers are bidi-isolated').toMatch(/isolate/)
    })

    test(`SL9-PROV-021-${loc.tag} the revert confirmation is a BottomSheet (alertdialog): safe action holds initial focus, actions stacked full-width with the destructive one last, swipe/scrim only while idle`, async ({ page }) => {
      const gate = deferred()
      const { api } = await setup(page)
      await openRoute(page, detail(FORK_PRIORITY_ID))
      await press(revert(page))
      const sheet = page.locator("[data-confirm='revert-to-common'][data-presentation='bottom-sheet']")
      await expect(sheet).toBeVisible()
      await expect(sheet).toHaveAttribute('role', 'alertdialog')
      const cancel = sheet.locator("[data-action='cancel']")
      const ok = sheet.locator("[data-action='confirm-revert']")
      await expect(cancel).toBeFocused()
      await expect(sheet.locator("[data-initial-focus='true']")).toBeVisible()
      const c = (await cancel.boundingBox())!
      const o = (await ok.boundingBox())!
      expect(o.y, 'destructive action is last (bottom-most)').toBeGreaterThan(c.y)
      expect(o.width).toBeGreaterThanOrEqual(300)
      await expectTouchTarget(ok, 'Archive and revert')
      await expectTouchTarget(cancel, 'Cancel')
      await expectInViewport(page, ok, 'Archive and revert')
      await page.mouse.click(187, 20)
      await expect(sheet, 'scrim dismisses while idle').toHaveCount(0)

      await press(revert(page))
      api.use(hold('POST', ARCHIVE, gate.promise))
      await press(sheet.locator("[data-action='confirm-revert']"))
      await page.mouse.click(187, 20)
      await expect(sheet, 'never dismissable while the request is in flight').toBeVisible()
      gate.resolve()
    })

    test(`SL9-PROV-022-${loc.tag} source ARCHIVED: "Archive fork…" opens the no-common-list sheet carrying the consequence text`, async ({ page }) => {
      await setup(page, { source: 'archived' })
      await openRoute(page, detail(FORK_PRIORITY_ID))
      await press(archiveFork(page))
      const sheet = page.locator("[data-confirm='archive-fork-no-common'][data-presentation='bottom-sheet']")
      await expect(sheet).toBeVisible()
      await expect(sheet.locator("[data-consequence='no-effective-list']")).toBeVisible()
      await expect(sheet.locator("[data-initial-focus='true']")).toBeFocused()
      await expectInViewport(page, sheet.locator("[data-action='confirm-archive-fork']"), 'Archive anyway')
    })

    test(`SL9-PROV-023a-${loc.tag} source gone at 375px: the full-width "Archive fork…" is >=44px and no link is offered`, async ({ page }) => {
      await setup(page, { source: 'gone' })
      await openRoute(page, detail(FORK_PRIORITY_ID))
      await expect(behind(page, 'source-gone')).toBeVisible()
      await expectTouchTarget(archiveFork(page), 'Archive fork…')
      await expect(panel(page).locator('a')).toHaveCount(0)
    })

    test(`SL9-PROV-023b-${loc.tag} check failed at 375px: Retry is >=44px`, async ({ page }) => {
      const { api } = await setup(page)
      api.use(failTimes(1, 'GET', `/v1/selection-lists/${COMMON_PRIORITY_ID}`, fault(503)))
      await openRoute(page, detail(FORK_PRIORITY_ID))
      await expect(behind(page, 'error')).toBeVisible()
      const retry = panel(page).locator("[data-action='retry']")
      await expect(retry).toBeVisible()
      await expectTouchTarget(retry, 'Retry')
    })
  })
}
