/**
 * SELECTION LISTS — SHARED LISTS (SL9) — FLOW 4 "visibility" — RED-by-design UI e2e.
 * (frontend-test-engineer — independent verification, NOT the implementer.)
 *
 * Derived STRICTLY from the approved flow `visibility` (approved 2026-10-20) of
 * design/frames/selection-lists-shared/manifest.json:
 *
 *   08-visibility-control.html       (4a) VisibilityControl at the top of the Access tab: private <-> organization,
 *                                         org -> private confirm, saving/saved/403, read-only, loading/error,
 *                                         platform-operator-only "Every organization" with typed-key confirmation,
 *                                         locked common list, 409 visibility_locked, 403 publish, flag OFF
 *   14-rtl-mobile-visibility.html    (4b) 375 px, en / he / ar (RTL): radio cards, bottom-sheet confirmations
 *
 * and the frozen contract (4.1.0): `PATCH /v1/selection-lists/{listId} {visibility}`, `GET …/access`
 * (decides editable vs read-only: manage_access is OBSERVED, never guessed), `409 reason=visibility_locked`.
 * Implementation target: packages/selection-lists-ui/src/shared-lists/{core,visibility}/**
 * (VisibilityControl, PublishPlatformConfirm).
 *
 * ── Fixture assumption (one place to change if the host wires it differently) ──────────
 * "platform ONLY when the shell's active organization is the platform organization AND the list's
 * organization_id is that org". The shell mock marks the active org `type: 'platform'` and makes its
 * id equal the list's wire `organization_id` (ORGS.platform in support/selection-lists-shared-e2e.ts).
 *
 * RED today / canary / flag-OFF semantics and how this file lands: see
 * selection-lists-shared-read.red.spec.ts and docs/planning/selection-lists-shared-ui-red-specs.md.
 *
 * Run: cd frontend && BASE_URL=http://localhost:4173 npx playwright test \
 *        tests/selection-lists-shared-visibility.red.spec.ts --project=chromium
 */
import { test, expect, type Page } from '@playwright/test'
import {
  FORK_PRIORITY_ID,
  MOBILE_375,
  ORGS,
  TICKET_CHANNEL_ID,
  WAREHOUSE_ZONES_ID,
  addList,
  createWorld,
  deferred,
  documentDir,
  err,
  expectInViewport,
  expectRuntimeClean,
  expectTouchTarget,
  failTimes,
  forkPriorityItems,
  forkPriorityList,
  hold,
  json,
  makeList,
  mockSharedListsSession,
  mountSelectionListApi,
  on,
  openRoute,
  press,
  trackRuntime,
  type Api,
  type Runtime,
  type ShellOrg,
  type WireList,
} from './support/selection-lists-shared-e2e'

test.use({ serviceWorkers: 'block' })

const access = (id: string) => `/settings/selection-lists/${id}/access`
const patchPath = (id: string) => `/v1/selection-lists/${id}`

let rt: Runtime
test.afterEach(() => {
  if (rt) expect(rt.pageErrors, 'no uncaught exception may reach the page').toEqual([])
})

const GRANTS = [
  { user_id: 'usr_01h455vb4pex5vsknk084sn02q', role: 'list-owner', granted_by: 'usr_99h455vb4pex5vsknk084sn02q', granted_at: '2026-09-02T09:14:00Z', is_sole_owner: true },
  { user_id: 'usr_02h455vb4pex5vsknk084sn02q', role: 'list-editor', granted_by: 'usr_01h455vb4pex5vsknk084sn02q', granted_at: '2026-09-03T09:14:00Z', is_sole_owner: false },
]

interface Opts {
  flag?: boolean
  org?: ShellOrg
  list?: WireList
  /** `owner` = GET …/access answers 200 (manage_access observed); `member` = 403. */
  role?: 'owner' | 'member'
}

/** The default subject is Acme's org-visible FORK of Priority, viewed by its owner. */
async function setup(page: Page, opts: Opts = {}) {
  rt = trackRuntime(page)
  const org = await mockSharedListsSession(page, { sharedLists: opts.flag ?? true, org: opts.org ?? ORGS.acme })
  const world = createWorld(org.id)
  const list = opts.list ?? forkPriorityList()
  addList(world, list, forkPriorityItems(), { role: true })
  world.access.set(list.id, (opts.role ?? 'owner') === 'owner' ? json(200, GRANTS) : err(403, 'FORBIDDEN'))
  const api = await mountSelectionListApi(page, world)
  // PATCH visibility: applies it and answers the updated list (a service that accepted the change).
  api.use(on('PATCH', patchPath(list.id), (call, w) => {
    const next = { ...w.lists.get(list.id)!, visibility: call.body?.visibility }
    w.lists.set(list.id, next)
    return json(200, next)
  }))
  return { api, world, list }
}

const platformList = (over: Partial<WireList> = {}) =>
  makeList({ id: TICKET_CHANNEL_ID, key: 'ticket-channel', name: 'Ticket channel', organization_id: ORGS.platform.id, visibility: 'org', editable: true, forked_from: null, ...over })

const control = (page: Page) => page.locator("[data-panel='visibility-control']")
const radios = (page: Page) => page.locator("[data-control='visibility']")
const opt = (page: Page, v: string) => page.locator(`[data-control='visibility'] [data-visibility-option='${v}']`)
const patches = (api: Api, id = FORK_PRIORITY_ID) => api.callsTo('PATCH', patchPath(id))

test.describe('SL9 visibility — frame 08-visibility-control', () => {
  test('SL9-VIS-000 canary: the approved 4.0.0 Access panel renders from the same mocks (passes today)', async ({ page }) => {
    await setup(page, { flag: false })
    await openRoute(page, access(FORK_PRIORITY_ID))
    await expect(page.locator("[data-panel='access']")).toBeVisible()
  })

  test('SL9-VIS-001 canary: with the platform organization active the shell exchanges an org token for it (proves the platform-operator fixture is wired; passes today)', async ({ page }) => {
    await setup(page, { flag: false, org: ORGS.platform, list: platformList() })
    const exchanged = page.waitForRequest(r => r.url().includes(`/api/organizations/${ORGS.platform.id}/session-token`))
    await openRoute(page, access(TICKET_CHANNEL_ID))
    await exchanged
    await expect(page.locator("[data-panel='access']")).toBeVisible()
  })

  test('SL9-VIS-010 control sits at the TOP of the Access tab, above the 4.0.0 roster; options private + org only; org checked and holds the single tab stop; no platform option for a customer org (not even disabled)', async ({ page }) => {
    await setup(page)
    await openRoute(page, access(FORK_PRIORITY_ID))
    await expect(control(page)).toBeVisible()
    await expect(radios(page)).toHaveAttribute('role', 'radiogroup')
    await expect(page.getByRole('radiogroup', { name: /who can see this list/i })).toBeVisible()
    await expect(radios(page).locator('[role=radio]')).toHaveCount(2)
    await expect(opt(page, 'org')).toHaveAttribute('aria-checked', 'true')
    await expect(opt(page, 'org')).toHaveAttribute('tabindex', '0')
    await expect(opt(page, 'private')).toHaveAttribute('aria-checked', 'false')
    await expect(opt(page, 'private')).toHaveAttribute('tabindex', '-1')
    await expect(page.locator("[data-visibility-option='platform']")).toHaveCount(0)
    const c = (await control(page).boundingBox())!
    const r = (await page.locator("[data-panel='access']").boundingBox())!
    expect(c.y, 'VisibilityControl is above the roster').toBeLessThan(r.y)
    expectRuntimeClean(rt)
  })

  test('SL9-VIS-011 Private -> Organization saves DIRECTLY (no confirm): PATCH {visibility:"org"} then a "can now see" toast', async ({ page }) => {
    const { api } = await setup(page, { list: forkPriorityList({ visibility: 'private' }) })
    await openRoute(page, access(FORK_PRIORITY_ID))
    await expect(opt(page, 'private')).toHaveAttribute('aria-checked', 'true')
    await press(opt(page, 'org'))
    await expect(page.locator('[data-confirm]')).toHaveCount(0)
    await expect.poll(() => patches(api).length).toBe(1)
    expect(patches(api)[0].body).toEqual({ visibility: 'org' })
    const toast = page.locator("[data-result='visibility-saved']")
    await expect(toast).toBeVisible()
    await expect(toast).toHaveAttribute('role', 'status')
    await expect(toast).toContainText(/everyone in acme logistics can now see/i)
    await expect(opt(page, 'org')).toHaveAttribute('aria-checked', 'true')
  })

  test('SL9-VIS-012 Organization -> Private on a FORK: alertdialog with the fork-specific consequences (forms / stored-common / stored-fork); Cancel and Esc change nothing', async ({ page }) => {
    const { api } = await setup(page)
    await openRoute(page, access(FORK_PRIORITY_ID))
    await press(opt(page, 'private'))
    const c = page.locator("[data-confirm='visibility-to-private']")
    await expect(c).toBeVisible()
    await expect(c).toHaveAttribute('role', 'alertdialog')
    await expect(c.locator("[data-consequence='forms']")).toContainText(/common.*list.*if one is active.*list unavailable/is)
    await expect(c.locator("[data-consequence='stored-common']")).toContainText(/common labels/i)
    await expect(c.locator("[data-consequence='stored-fork']")).toContainText(/fork.s labels/i)
    await expect(c).toContainText(/nothing is deleted/i)
    await press(c.locator("[data-action='cancel']"))
    await expect(c).toHaveCount(0)
    await expect(opt(page, 'org')).toHaveAttribute('aria-checked', 'true')
    await press(opt(page, 'private'))
    await page.keyboard.press('Escape')
    await expect(c).toHaveCount(0)
    expect(patches(api), 'nothing was sent').toHaveLength(0)
  })

  test('SL9-VIS-013 the fork-specific consequence lines render ONLY when forked_from is set', async ({ page }) => {
    await setup(page, { list: makeList({ id: WAREHOUSE_ZONES_ID, key: 'warehouse-zones', name: 'Warehouse zones', organization_id: ORGS.acme.id, visibility: 'org', editable: true, forked_from: null }) })
    await openRoute(page, access(WAREHOUSE_ZONES_ID))
    await press(opt(page, 'private'))
    const c = page.locator("[data-confirm='visibility-to-private']")
    await expect(c).toBeVisible()
    for (const k of ['forms', 'stored-common', 'stored-fork']) await expect(c.locator(`[data-consequence='${k}']`)).toHaveCount(0)
  })

  test('SL9-VIS-014 confirming sends PATCH {visibility:"private"}; while saving the options are locked and the confirm is natively disabled; then the saved toast', async ({ page }) => {
    const gate = deferred()
    const { api } = await setup(page)
    api.use(hold('PATCH', patchPath(FORK_PRIORITY_ID), gate.promise))
    await openRoute(page, access(FORK_PRIORITY_ID))
    await press(opt(page, 'private'))
    await press(page.locator("[data-confirm='visibility-to-private'] [data-action='confirm-visibility']"))
    const saving = page.locator("[data-panel='visibility-control'][data-state='saving'], [data-state='saving']").first()
    await expect(saving).toBeVisible()
    await expect(saving).toHaveAttribute('aria-busy', 'true')
    await expect(page.locator("[data-confirm='visibility-to-private'] [data-action='confirm-visibility'][disabled]")).toBeVisible()
    await expect(page.locator("[data-visibility-option][aria-disabled='true']").first(), 'options are locked until the service answers').toBeVisible()
    gate.resolve()
    await expect(page.locator("[data-result='visibility-saved']")).toContainText(/is now private/i)
    await expect(opt(page, 'private')).toHaveAttribute('aria-checked', 'true')
    expect(patches(api)).toHaveLength(1)
    expect(patches(api)[0].body).toEqual({ visibility: 'private' })
  })

  test('SL9-VIS-015 403 on save: the previous setting is restored and "only the list\'s owner can change who sees it" is shown', async ({ page }) => {
    const { api } = await setup(page)
    api.use(on('PATCH', patchPath(FORK_PRIORITY_ID), () => err(403, 'FORBIDDEN')))
    await openRoute(page, access(FORK_PRIORITY_ID))
    await press(opt(page, 'private'))
    await press(page.locator("[data-confirm='visibility-to-private'] [data-action='confirm-visibility']"))
    const e = page.locator("[data-error='FORBIDDEN'][data-case='visibility-not-owner']")
    await expect(e).toBeVisible()
    await expect(e).toHaveAttribute('role', 'alert')
    await expect(e).toContainText(/only the list.s owner can change who sees it/i)
    await expect(opt(page, 'org'), 'previous value restored').toHaveAttribute('aria-checked', 'true')
  })

  test('SL9-VIS-016 non-owner (GET …/access = 403): a read-only STATEMENT, not a disabled form', async ({ page }) => {
    const { api } = await setup(page, { role: 'member' })
    await openRoute(page, access(FORK_PRIORITY_ID))
    const ro = page.locator("[data-panel='visibility-control'][data-state='read-only'], [data-panel='visibility-control'] [data-state='read-only']").first()
    await expect(ro).toBeVisible()
    await expect(ro).toContainText(/everyone in acme logistics/i)
    await expect(ro).toContainText(/only the list.s owner can change this/i)
    await expect(radios(page), 'no radio group at all').toHaveCount(0)
    await expect(page.locator('[data-visibility-option]')).toHaveCount(0)
    expect(patches(api)).toHaveLength(0)
  })

  test('SL9-VIS-017a loading: a skeleton (aria-busy) and NO guessed editability; then the control', async ({ page }) => {
    const gate = deferred()
    const { api } = await setup(page)
    api.use(hold('GET', `/v1/selection-lists/${FORK_PRIORITY_ID}/access`, gate.promise))
    await openRoute(page, access(FORK_PRIORITY_ID))
    const loading = page.locator("[data-panel='visibility-control'][data-state='loading']")
    await expect(loading).toBeVisible()
    await expect(loading).toHaveAttribute('aria-busy', 'true')
    await expect(radios(page), 'never guess editability while loading').toHaveCount(0)
    gate.resolve()
    await expect(radios(page)).toBeVisible()
  })

  test('SL9-VIS-017b error: "Couldn\'t load access settings", Retry re-reads …/access', async ({ page }) => {
    const { api } = await setup(page)
    api.use(failTimes(1, 'GET', `/v1/selection-lists/${FORK_PRIORITY_ID}/access`, err(500, 'INTERNAL')))
    await openRoute(page, access(FORK_PRIORITY_ID))
    const e = page.locator("[data-panel='visibility-control'][data-state='error']")
    await expect(e).toBeVisible()
    await expect(e).toContainText(/couldn.t load access settings/i)
    await press(e.locator("[data-action='retry']"))
    await expect(radios(page)).toBeVisible()
  })

  test('SL9-VIS-018 a11y: Space on a focused option activates it (opens the confirm); the confirm is reachable and closable by keyboard', async ({ page }) => {
    await setup(page)
    await openRoute(page, access(FORK_PRIORITY_ID))
    await expect(opt(page, 'private')).toBeVisible()
    await opt(page, 'private').focus()
    await page.keyboard.press('Space')
    await expect(page.locator("[data-confirm='visibility-to-private']")).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator("[data-confirm='visibility-to-private']")).toHaveCount(0)
    await expect(opt(page, 'org'), 'focus returns to the control').toBeFocused()
  })

  test('SL9-VIS-019 flag OFF: no visibility control — the Access tab is the 4.0.0 panel only (guard; passes today)', async ({ page }) => {
    await setup(page, { flag: false })
    await openRoute(page, access(FORK_PRIORITY_ID))
    await expect(page.locator("[data-panel='access']")).toBeVisible()
    await expect(control(page)).toHaveCount(0)
    await expect(radios(page)).toHaveCount(0)
    await expect(page.locator('[data-visibility-option]')).toHaveCount(0)
  })
})

// ── Platform operators only: publishing a common list ───────────────────────
test.describe('SL9 visibility — frame 08 (platform operator: publish a common list)', () => {
  const key = (page: Page) => page.locator("[data-confirm='publish-platform'] [data-confirm-input='key']")
  const publish = (page: Page) => page.locator("[data-confirm='publish-platform'] [data-action='confirm-publish']")
  const confirmBox = (page: Page) => page.locator("[data-confirm='publish-platform']")

  async function openPublish(page: Page, o: Opts = {}) {
    const ctx = await setup(page, { org: ORGS.platform, list: platformList(), ...o })
    await openRoute(page, access(TICKET_CHANNEL_ID))
    await press(opt(page, 'platform'), '"Every organization" option')
    await expect(confirmBox(page)).toBeVisible()
    return ctx
  }

  test('SL9-VIS-020a the third option "Every organization" renders for the platform org\'s own list (active org = platform org)', async ({ page }) => {
    await setup(page, { org: ORGS.platform, list: platformList() })
    await openRoute(page, access(TICKET_CHANNEL_ID))
    await expect(radios(page)).toBeVisible()
    await expect(page.locator("[data-scope='platform-org'] [data-visibility-option='org'][aria-checked='true']")).toBeVisible()
    await expect(opt(page, 'platform')).toBeVisible()
    await expect(opt(page, 'platform')).toContainText(/every organization/i)
  })

  test('SL9-VIS-020b …but NOT for another org\'s list, even when the platform org is active (absent, not disabled)', async ({ page }) => {
    await setup(page, { org: ORGS.platform, list: platformList({ organization_id: ORGS.acme.id }) })
    await openRoute(page, access(TICKET_CHANNEL_ID))
    await expect(radios(page)).toBeVisible()
    await expect(page.locator("[data-visibility-option='platform']")).toHaveCount(0)
  })

  test('SL9-VIS-021 choosing it marks the option PENDING (not checked), keeps Organization checked + focusable, and opens the typed-key confirmation, which states the irreversibility', async ({ page }) => {
    await openPublish(page)
    await expect(page.locator("[data-visibility-option='platform'][data-pending='true'][aria-checked='false']")).toBeVisible()
    await expect(opt(page, 'org')).toHaveAttribute('aria-checked', 'true')
    await expect(opt(page, 'org')).toHaveAttribute('tabindex', '0')
    await expect(confirmBox(page)).toHaveAttribute('role', 'alertdialog')
    await expect(confirmBox(page)).toContainText(/ticket channel/i)
    await expect(confirmBox(page)).toContainText(/can never become private|can.t be undone|never be(come)? private/i)
    await expect(confirmBox(page).getByText('ticket-channel').first(), 'the key to type is shown').toBeVisible()
  })

  test('SL9-VIS-022 the key input opens EMPTY (never pre-filled), autocomplete + spellcheck off; Publish is natively disabled until the value equals the key EXACTLY (case-sensitive, untrimmed)', async ({ page }) => {
    await openPublish(page)
    await expect(confirmBox(page)).toHaveAttribute('data-confirm-state', 'empty')
    await expect(key(page)).toHaveValue('')
    await expect(key(page)).toHaveAttribute('autocomplete', 'off')
    await expect(key(page)).toHaveAttribute('spellcheck', 'false')
    await expect(page.locator("[data-confirm-state='empty'] [data-action='confirm-publish'][disabled]")).toBeVisible()
    for (const wrong of ['ticket', 'Ticket-Channel', 'ticket-channel ', ' ticket-channel', 'ticket-channe1']) {
      await key(page).fill(wrong)
      await expect(publish(page), `"${wrong}" must not enable Publish`).toBeDisabled()
    }
    await key(page).fill('ticket-channel')
    await expect(page.locator("[data-confirm-state='matched'] [data-action='confirm-publish']:not([disabled])")).toBeVisible()
    await key(page).fill('ticket-channe')
    await expect(publish(page), 'any later mismatch disables it again').toBeDisabled()
  })

  test('SL9-VIS-023 publishing sends PATCH {visibility:"platform"} only; while in flight EVERY control is natively disabled and Esc does not close; success turns the control into the locked statement', async ({ page }) => {
    const gate = deferred()
    const { api } = await openPublish(page)
    api.use(hold('PATCH', patchPath(TICKET_CHANNEL_ID), gate.promise))
    await key(page).fill('ticket-channel')
    await press(publish(page))
    const busy = page.locator("[data-confirm='publish-platform'][data-confirm-state='publishing']")
    await expect(busy).toBeVisible()
    await expect(busy.locator("[data-confirm-input='key'][disabled]")).toBeVisible()
    await expect(busy.locator("[data-action='cancel'][disabled]")).toBeVisible()
    await expect(busy.locator("[data-action='confirm-publish'][disabled]")).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(busy).toBeVisible()
    gate.resolve()
    await expect(page.locator("[data-panel='visibility-control'][data-state='locked']")).toBeVisible()
    await expect(radios(page)).toHaveCount(0)
    expect(patches(api, TICKET_CHANNEL_ID)).toHaveLength(1)
    expect(patches(api, TICKET_CHANNEL_ID)[0].body).toEqual({ visibility: 'platform' })
  })

  test('SL9-VIS-024 Cancel and Esc clear the pending mark and leave Organization selected; nothing is sent', async ({ page }) => {
    const { api } = await openPublish(page)
    await press(confirmBox(page).locator("[data-action='cancel']"))
    await expect(confirmBox(page)).toHaveCount(0)
    await expect(page.locator("[data-visibility-option='platform'][data-pending='true']")).toHaveCount(0)
    await expect(opt(page, 'org')).toHaveAttribute('aria-checked', 'true')
    await press(opt(page, 'platform'))
    await page.keyboard.press('Escape')
    await expect(confirmBox(page)).toHaveCount(0)
    await expect(page.locator("[data-visibility-option][data-pending='true']")).toHaveCount(0)
    expect(patches(api, TICKET_CHANNEL_ID)).toHaveLength(0)
  })

  test('SL9-VIS-025 403 on publish: "You can\'t publish common lists", the pending mark is cleared, visibility unchanged', async ({ page }) => {
    const { api } = await openPublish(page)
    api.use(on('PATCH', patchPath(TICKET_CHANNEL_ID), () => err(403, 'FORBIDDEN')))
    await key(page).fill('ticket-channel')
    await press(publish(page))
    const e = page.locator("[data-error='FORBIDDEN'][data-case='publish-forbidden']")
    await expect(e).toBeVisible()
    await expect(e).toContainText(/can.t publish common lists/i)
    await expect(page.locator("[data-visibility-option][data-pending='true']")).toHaveCount(0)
    await expect(opt(page, 'org')).toHaveAttribute('aria-checked', 'true')
  })

  test('SL9-VIS-026 a common (platform) list is LOCKED: a statement, no radio group, "archive it" as the only retirement', async ({ page }) => {
    await setup(page, { org: ORGS.platform, list: platformList({ visibility: 'platform' }) })
    await openRoute(page, access(TICKET_CHANNEL_ID))
    const locked = page.locator("[data-panel='visibility-control'][data-state='locked']")
    await expect(locked).toBeVisible()
    await expect(locked).toHaveAttribute('data-visibility', 'platform')
    await expect(locked).toContainText(/locked/i)
    await expect(locked).toContainText(/archive/i)
    await expect(radios(page)).toHaveCount(0)
    await expect(page.locator("[data-visibility-option]")).toHaveCount(0)
  })

  test('SL9-VIS-027 a stale demotion answered 409 reason=visibility_locked: explanation + the list is reloaded (nothing changed)', async ({ page }) => {
    const { api } = await setup(page, { org: ORGS.platform, list: platformList() })
    api.use(on('PATCH', patchPath(TICKET_CHANNEL_ID), (_c, w) => {
      w.lists.set(TICKET_CHANNEL_ID, { ...w.lists.get(TICKET_CHANNEL_ID)!, visibility: 'platform' })
      return err(409, 'CONFLICT', { reason: 'visibility_locked' })
    }))
    await openRoute(page, access(TICKET_CHANNEL_ID))
    await press(opt(page, 'private'))
    const reads = () => api.callsTo('GET', `/v1/selection-lists/${TICKET_CHANNEL_ID}`).length
    const before = reads()
    await press(page.locator("[data-confirm='visibility-to-private'] [data-action='confirm-visibility']"))
    const e = page.locator("[data-error='CONFLICT'][data-reason='visibility_locked']")
    await expect(e).toBeVisible()
    await expect(e).toContainText(/can.t be made private/i)
    await expect.poll(reads).toBeGreaterThan(before)
    await expect(page.locator("[data-panel='visibility-control'][data-state='locked']")).toBeVisible()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Frame 14 — (4b) RTL + 375 px
// ═════════════════════════════════════════════════════════════════════════════
for (const loc of [{ tag: 'en-US', dir: 'ltr' }, { tag: 'he-IL', dir: 'rtl' }, { tag: 'ar', dir: 'rtl' }] as const) {
  test.describe(`SL9 visibility — frame 14-rtl-mobile-visibility @375 ${loc.tag}`, () => {
    test.use({ ...MOBILE_375, locale: loc.tag })

    test(`SL9-VIS-030-${loc.tag} options are full-width RADIO CARDS >=44px; dir=${loc.dir}; the control never scrolls sideways; customer orgs never see "Every organization"`, async ({ page }) => {
      await setup(page)
      await openRoute(page, access(FORK_PRIORITY_ID))
      await expect(radios(page)).toBeVisible()
      expect(await documentDir(page)).toBe(loc.dir)
      for (const v of ['private', 'org']) {
        await expectTouchTarget(opt(page, v), `${v} card`)
        expect((await opt(page, v).boundingBox())!.width, `${v} card is full width`).toBeGreaterThanOrEqual(375 * 0.7)
        await expectInViewport(page, opt(page, v), `${v} card`)
      }
      await expect(page.locator("[data-visibility-option='platform']")).toHaveCount(0)
      const m = await control(page).evaluate(n => ({ sw: n.scrollWidth, cw: n.clientWidth }))
      expect(m.sw).toBeLessThanOrEqual(m.cw + 1)
    })

    test(`SL9-VIS-031-${loc.tag} Organization -> Private opens a BottomSheet (alertdialog) with the fork consequences; Cancel holds initial focus; actions stacked full-width`, async ({ page }) => {
      await setup(page)
      await openRoute(page, access(FORK_PRIORITY_ID))
      await press(opt(page, 'private'))
      const sheet = page.locator("[data-confirm='visibility-to-private'][data-presentation='bottom-sheet']")
      await expect(sheet).toBeVisible()
      await expect(sheet).toHaveAttribute('role', 'alertdialog')
      await expect(sheet.locator("[data-consequence='stored-fork']")).toBeVisible()
      await expect(sheet.locator("[data-action='cancel']")).toBeFocused()
      await expect(sheet.locator("[data-initial-focus='true']")).toBeVisible()
      const c = (await sheet.locator("[data-action='cancel']").boundingBox())!
      const o = (await sheet.locator("[data-action='confirm-visibility']").boundingBox())!
      expect(o.y).toBeGreaterThan(c.y)
      expect(o.width).toBeGreaterThanOrEqual(300)
      await expectTouchTarget(sheet.locator("[data-action='confirm-visibility']"), 'Make private')
    })

    test(`SL9-VIS-032-${loc.tag} read-only is a statement (not a disabled form) at 375px`, async ({ page }) => {
      await setup(page, { role: 'member' })
      await openRoute(page, access(FORK_PRIORITY_ID))
      await expect(page.locator("[data-panel='visibility-control'][data-state='read-only'], [data-panel='visibility-control'] [data-state='read-only']").first()).toBeVisible()
      await expect(radios(page)).toHaveCount(0)
    })

    test(`SL9-VIS-033-${loc.tag} states at 375px: loading skeleton, error Retry >=44px`, async ({ page }) => {
      const { api } = await setup(page)
      api.use(failTimes(1, 'GET', `/v1/selection-lists/${FORK_PRIORITY_ID}/access`, err(500, 'INTERNAL')))
      await openRoute(page, access(FORK_PRIORITY_ID))
      const retry = page.locator("[data-panel='visibility-control'][data-state='error'] [data-action='retry']")
      await expect(retry).toBeVisible()
      await expectTouchTarget(retry, 'Retry')
    })

    test(`SL9-VIS-034-${loc.tag} platform publish is a BottomSheet: key input is dir=ltr, monospaced, autocapitalize/autocorrect/spellcheck off; Publish enables only on an exact match; both actions disable while publishing`, async ({ page }) => {
      const gate = deferred()
      const { api } = await setup(page, { org: ORGS.platform, list: platformList() })
      api.use(hold('PATCH', patchPath(TICKET_CHANNEL_ID), gate.promise))
      await openRoute(page, access(TICKET_CHANNEL_ID))
      await press(opt(page, 'platform'))
      const sheet = page.locator("[data-confirm='publish-platform'][data-presentation='bottom-sheet']")
      await expect(sheet).toBeVisible()
      const input = sheet.locator("[data-confirm-input='key']")
      await expect(input).toHaveAttribute('dir', 'ltr')
      await expect(input).toHaveAttribute('autocapitalize', 'off')
      await expect(input).toHaveAttribute('autocorrect', 'off')
      await expect(input).toHaveAttribute('spellcheck', 'false')
      expect(await input.evaluate(n => getComputedStyle(n).fontFamily)).toMatch(/mono|courier|consolas/i)
      await expect(sheet.locator("[data-action='confirm-publish']")).toBeDisabled()
      await input.fill('ticket-channel')
      await expect(sheet.locator("[data-action='confirm-publish']")).toBeEnabled()
      await press(sheet.locator("[data-action='confirm-publish']"))
      await expect(page.locator("[data-confirm='publish-platform'][data-confirm-state='publishing']")).toBeVisible()
      await expect(sheet.locator("[data-action='cancel']")).toBeDisabled()
      await expect(sheet.locator("[data-action='confirm-publish']")).toBeDisabled()
      gate.resolve()
    })
  })
}
