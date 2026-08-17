/**
 * CONFIGURATION MANAGEMENT CONSOLE — INDEPENDENT, PRE-PRODUCTION, RED-by-design UI e2e.
 * (frontend-test-engineer — independent verification, NOT the implementer.) FFRNT-281 / FF-EPIC-19-S2.
 *
 * ── What this file is ────────────────────────────────────────────────────────
 * TDD RED specs for the approved Configuration Management Console design
 * (design/frames/config-management/manifest.json, FFRNT-280 — 9 frames across 3
 * independently-approvable flows). Derived STRICTLY from:
 *
 *   design/frames/config-management/manifest.json           (build inventory + testHooks)
 *   design/frames/config-management/01-settings-editor.html      (a) /config
 *   design/frames/config-management/02-provenance-and-lock.html  (b) /config
 *   design/frames/config-management/03-editor-states.html        (c) /config
 *   design/frames/config-management/04-save-conflict.html        (d) /config
 *   design/frames/config-management/05-key-catalog.html          (e) /admin/config/catalog
 *   design/frames/config-management/06-key-definition.html       (f) /admin/config/catalog/:key
 *   design/frames/config-management/07-catalog-states.html       (g) /admin/config/catalog
 *   design/frames/config-management/08-secret-input.html         (h) /config (secret keys)
 *   design/frames/config-management/09-audit-history.html        (i) /admin/config/keys/:key/history
 *
 * and from the frozen API contract services/config-service/openapi.yaml:
 *   GET  /v1/namespaces                          -> PagedNamespaces
 *   GET  /v1/namespaces/{namespace}/keys          -> PagedKeyDefinitions (isHidden omitted unless
 *                                                    includeHidden=true AND caller is a platform admin)
 *   GET  /v1/namespaces/{namespace}/keys/{key}    -> KeyDefinition (hidden keys 404, same as absent)
 *   GET  /v1/config                               -> EffectiveConfig (hidden keys ABSENT entirely)
 *   PUT  /v1/config                               -> ConfigWriteResult; ALL-OR-NOTHING; 409
 *                                                    LOCKED_BY_ANCESTOR / VERSION_CONFLICT; 422 SCOPE_NOT_ALLOWED
 * plus two endpoints the frames COMMISSION but the frozen contract does not yet
 * define (manifest `contract.anticipatedEndpoints`, FF-EPIC-18-S1/S2/S3) —
 * exercised below exactly as the manifest names them, never invented paths:
 *   POST /v1/config/secrets/reveal                -> reveal-once secret value
 *   GET  /v1/config/history                       -> append-only audit trail; revert REPLAYS PUT /v1/config
 *
 * The manifest `build` block names what MUST exist for these to go GREEN:
 *   flows      settings-editor -> ConfigSettingsEditorFlow  (/config)
 *              key-catalog     -> ConfigKeyCatalogFlow      (/admin/config/catalog)
 *              secret-audit    -> ConfigSecretAuditFlow     (/admin/config/keys/:key/history)
 *   package    @fuzefront/config-ui (ConfigConsoleShell + the ~65 sibling components in
 *              manifest.build.components — ProvenanceBadge, ResetValueMenu, VersionConflictResolver,
 *              KeyCatalogTable, ResolutionChainView, SecretValueField, AuditHistoryTable, …)
 *
 * ── Why they are RED right now (READ THIS before "fixing" a failure) ─────────
 * None of /config, /admin/config/catalog or /admin/config/keys/:key/history render
 * anything today: frontend/src/App.tsx has no route for any of the three, and no
 * @fuzefront/config-ui import exists anywhere in frontend/src. Every test below is
 * EXPECTED to fail today, and it must fail for the RIGHT reason: the shell / rows /
 * dialogs are ABSENT from the DOM — not a harness/config error. That RED state is
 * the proof this is TDD (specs written against the approved contract BEFORE the
 * implementation), not tests retrofitted to a shipped UI.
 *
 * They are deliberately NOT test.skip / test.fixme — hiding the RED would defeat
 * the entire point. They turn GREEN when frontend-engineer lands @fuzefront/config-ui
 * and wires all three routes, behind the `fuzefront.config.management-console` /
 * `fuzefront.config.key-catalog` / `fuzefront.config.secrets-audit` flags.
 *
 * Selectors are ONLY the data-* hooks design/frames/config-management/manifest.json
 * declares per frame (`testHooks`). No invented selectors. `[data-frame=...]` itself
 * is a design-artifact wrapper (present only in the static HTML frames, used for frame
 * navigation in the review site) and is deliberately NOT asserted here, matching the
 * precedent in connected-accounts.red.spec.ts / account-security-hub.red.spec.ts.
 *
 * ── A known shipped-behaviour gap this suite encodes rather than papers over ──
 * services/config-service/src/routes/config-read.routes.ts `buildScopeChain` returns
 * ONLY `[platform, <the queried scope>]` today — never the full
 * `default -> platform -> portal -> org -> user` chain the frames illustrate with a
 * named "portal Acme Portal" ancestor. FF-EPIC-10's context-resolution middleware
 * (which portal an org belongs to, which org a user belongs to) is unbuilt, so an
 * org-scope `GET /v1/config` can only ever resolve `source` / `lockedBy` to
 * `platform` or the queried scope itself — never an intermediate portal or user tier.
 * `resolveEffectiveConfig` (services/config-service/src/resolver/resolve.ts) confirms
 * this: `fallbackSource` is always `chain[0]`, and the lock scan / precedence scan
 * only ever walk the two-element chain the route builds.
 *
 * Fixtures below therefore use `platform` — never `portal` — as the ancestor in the
 * locked / inherited scenarios: that is what `resolveEffectiveConfig` can actually
 * produce for an org-scope read today. They still assert the LOAD-BEARING contract —
 * an ancestor is NAMED (scopeType + scopeId, never a bare id) with its `lockReason`,
 * never a generic denial — without asserting a 4-tier chain that cannot resolve today.
 *
 * Relatedly, `resolveEffectiveConfig`'s own doc-comment flags that the wire
 * `EffectiveConfigEntry` has no `default`-vs-"explicitly-set-equal-to-default"
 * discriminant (no `hasOverride` field on the schema) — `source` alone cannot
 * distinguish "never set anywhere" from "set at platform, coincidentally equal to
 * the default". The `[data-provenance='default']` tests below therefore assert only
 * what the contract actually promises — the default's own value is real, in force,
 * and must not read as empty/unset — not that the UI can prove nothing was ever
 * written at platform scope.
 *
 * The `06-key-definition` resolution-chain view is the frame most dependent on the
 * full chain. Its `platform` and `org` (queried scope) steps ARE independently
 * resolvable today and are asserted in full; the `portal` / `user` steps are NOT
 * independently resolvable via a single `GET /v1/config` call (querying at
 * `scopeType=user` still only builds `[platform, user]`, silently SKIPPING any org
 * override in between) so this suite does not assert real backend values render at
 * those steps — a flagged gap (FF-EPIC-10), not a silent pass.
 *
 * Run (pre-prod, against a built UI on the ephemeral stack / dev host):
 *   BASE_URL=http://fuzefront.dev.local npx playwright test config-management.red
 * Config: frontend/playwright.config.ts (chromium + mobile projects).
 */
import { test, expect, type Page, type ConsoleMessage, type Request as PWRequest } from '@playwright/test'

// ── Routes (manifest.build.flows[].route) ───────────────────────────────────
const EDITOR_ROUTE = '/config'
const CATALOG_ROUTE = '/admin/config/catalog'
const catalogKeyRoute = (key: string) => `/admin/config/catalog/${key}`
const historyRoute = (key: string) => `/admin/config/keys/${key}/history`

const NAMESPACE = 'notifications'
// buildScopeChain-achievable ancestor: platform (see header note above).
const PLATFORM_SCOPE = { scopeType: 'platform', scopeId: null }
const ORG_SCOPE = { scopeType: 'org', scopeId: 'org_acme01' }

// ── Path matchers ────────────────────────────────────────────────────────────
// Same-origin base is `/api/config` (openapi.yaml `servers`); matching the
// trailing `/v1/...` path segment is base-prefix-agnostic and collision-free
// (namespaces-list vs namespace-keys vs key-definition are disjoint regexes).
const PATH = {
  config: /\/v1\/config$/,
  configHistory: /\/v1\/config\/history$/,
  secretsReveal: /\/v1\/config\/secrets\/reveal$/,
  namespaces: /\/v1\/namespaces$/,
  keysList: /\/v1\/namespaces\/[^/]+\/keys$/,
  keyDefinition: /\/v1\/namespaces\/[^/]+\/keys\/[^/]+$/,
}

function pathMatches(re: RegExp) {
  return (url: string) => re.test(new URL(url).pathname)
}

/** Registers a route that only answers the given method; other methods pass through unmocked. */
async function mockJson(
  page: Page,
  re: RegExp,
  method: string,
  responder: (req: PWRequest) => { status: number; body: unknown; headers?: Record<string, string> },
) {
  await page.route(pathMatches(re), async route => {
    if (route.request().method() !== method) return route.continue()
    const { status, body, headers } = responder(route.request())
    await route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) })
  })
}

// ── Fixture builders (openapi.yaml component schemas, literally) ───────────
function keyDef(over: Record<string, unknown> & { key: string }) {
  return {
    id: `ckd_${over.key.replace(/[^a-z0-9]/gi, '').toLowerCase().padEnd(26, '0').slice(0, 26)}`,
    displayName: over.key,
    description: null,
    helpUrl: null,
    category: null,
    sortOrder: 0,
    tags: [],
    schema: null,
    enumValues: null,
    isSystem: false,
    isHidden: false,
    isSecret: false,
    isReadonly: false,
    precedence: 'most-specific-wins',
    requiresRestart: false,
    deprecatedAt: null,
    replacedBy: null,
    ...over,
  }
}

function entry(over: Record<string, unknown> & { key: string; definition: unknown }) {
  return {
    locked: false,
    lockedBy: null,
    lockReason: null,
    editable: true,
    warning: null,
    ...over,
  }
}

function effectiveConfig(entries: unknown[], over: { version?: string; scope?: unknown } = {}) {
  return {
    namespace: NAMESPACE,
    scope: over.scope ?? ORG_SCOPE,
    version: over.version ?? 'v-8814',
    entries,
  }
}

function errorBody(code: string, message: string, extra: Record<string, unknown> = {}) {
  return { code, message, lockedBy: null, currentVersion: null, details: null, ...extra }
}

function paged<T>(items: T[]) {
  return { items, pageInfo: { hasNextPage: false, nextCursor: null } }
}

// ── Navigation helpers ────────────────────────────────────────────────────────
async function gotoEditor(page: Page) {
  await page.goto(EDITOR_ROUTE, { waitUntil: 'domcontentloaded' })
}
async function gotoCatalog(page: Page) {
  await page.goto(CATALOG_ROUTE, { waitUntil: 'domcontentloaded' })
}
async function gotoKeyDefinition(page: Page, key: string) {
  await page.goto(catalogKeyRoute(key), { waitUntil: 'domcontentloaded' })
}
async function gotoHistory(page: Page, key: string) {
  await page.goto(historyRoute(key), { waitUntil: 'domcontentloaded' })
}


// ══════════════════════════════════════════════════════════════════════════
// Flow 1 — settings-editor (/config)
// ══════════════════════════════════════════════════════════════════════════

test.describe('Settings editor — populated render & provenance (frame 01-settings-editor)', () => {
  function sixEntryFixture() {
    const digestFrequency = keyDef({
      key: 'notifications.digest.frequency',
      displayName: 'Digest frequency',
      valueType: 'enum',
      enumValues: ['hourly', 'daily', 'weekly'],
      defaultValue: 'daily',
      allowedScopes: ['platform', 'portal', 'org', 'user'],
      category: 'Delivery',
    })
    const digestEnabled = keyDef({
      key: 'notifications.digest.enabled',
      displayName: 'Batch notifications',
      valueType: 'boolean',
      defaultValue: true,
      allowedScopes: ['platform', 'portal', 'org', 'user'],
      category: 'Delivery',
    })
    const channelSms = keyDef({
      key: 'notifications.channel.sms',
      displayName: 'SMS channel',
      valueType: 'boolean',
      defaultValue: false,
      allowedScopes: ['platform', 'portal', 'org', 'user'],
      category: 'Delivery',
    })
    const retryBackoff = keyDef({
      key: 'notifications.retry.backoff',
      displayName: 'Retry backoff',
      valueType: 'duration',
      defaultValue: 'PT10M',
      allowedScopes: ['platform', 'portal', 'org', 'user'],
      requiresRestart: true,
      category: 'Limits',
    })
    const retryMaxAttempts = keyDef({
      key: 'notifications.retry.maxAttempts',
      displayName: 'Max delivery attempts',
      valueType: 'number',
      defaultValue: 5,
      allowedScopes: ['platform', 'portal', 'org', 'user'],
      category: 'Limits',
    })
    const providerApiKey = keyDef({
      key: 'notifications.provider.apiKey',
      displayName: 'Provider API key',
      valueType: 'secret',
      isSecret: true,
      defaultValue: null,
      allowedScopes: ['platform', 'portal'],
      category: 'Credentials',
    })

    return effectiveConfig(
      [
        entry({
          key: 'notifications.digest.frequency',
          value: 'daily',
          source: ORG_SCOPE,
          definition: digestFrequency,
        }),
        entry({
          key: 'notifications.digest.enabled',
          value: true,
          source: PLATFORM_SCOPE,
          definition: digestEnabled,
        }),
        entry({
          key: 'notifications.channel.sms',
          value: false,
          source: PLATFORM_SCOPE,
          locked: true,
          lockedBy: PLATFORM_SCOPE,
          lockReason: 'SMS is disabled tenant-wide pending carrier review.',
          editable: false,
          definition: channelSms,
        }),
        entry({
          key: 'notifications.retry.backoff',
          value: 'PT5M',
          source: ORG_SCOPE,
          definition: retryBackoff,
        }),
        entry({
          key: 'notifications.retry.maxAttempts',
          value: 5,
          source: PLATFORM_SCOPE,
          definition: retryMaxAttempts,
        }),
        entry({
          key: 'notifications.provider.apiKey',
          value: null,
          isSet: true,
          source: ORG_SCOPE,
          definition: providerApiKey,
        }),
      ],
      { version: 'v-8814' },
    )
  }

  test('mounts the settings editor at /config with scope switcher, namespace, version and form', async ({ page }) => {
    await mockJson(page, PATH.config, 'GET', () => ({ status: 200, body: sixEntryFixture() }))
    await gotoEditor(page)

    await expect(page.locator('[data-scope-switcher]'), 'ScopeSwitcher must render').toBeVisible()
    await expect(page.locator('[data-namespace-picker]'), 'NamespacePicker must render').toBeVisible()
    await expect(page.locator('[data-config-version]'), 'the ETag/version must be shown').toBeVisible()
    await expect(page.locator('[data-settings-form]'), 'SettingsEditorForm must render').toBeVisible()
  })

  test('the scope being edited is marked aria-current in the scope chain', async ({ page }) => {
    await mockJson(page, PATH.config, 'GET', () => ({ status: 200, body: sixEntryFixture() }))
    await gotoEditor(page)
    await expect(
      page.locator("[data-scope-step='org'][aria-current='true']"),
      'the edited scope (org) must be aria-current in the ScopeChainStep breadcrumb',
    ).toBeVisible()
  })

  test('every row renders exactly one provenance badge, never a bare value', async ({ page }) => {
    await mockJson(page, PATH.config, 'GET', () => ({ status: 200, body: sixEntryFixture() }))
    await gotoEditor(page)

    const cases: Array<[string, string]> = [
      ['notifications.digest.frequency', 'set'],
      ['notifications.digest.enabled', 'inherited'],
      ['notifications.channel.sms', 'locked'],
      ['notifications.retry.backoff', 'set'],
      ['notifications.retry.maxAttempts', 'default'],
      ['notifications.provider.apiKey', 'set'],
    ]
    for (const [key, provenance] of cases) {
      const badge = page.locator(`[data-entry='${key}'] [data-provenance='${provenance}']`)
      await expect(badge, `${key} must render exactly the '${provenance}' ProvenanceBadge`).toBeVisible()
    }
    // Exactly one provenance badge per row — never zero, never two competing badges.
    await expect(page.locator('[data-settings-form] [data-provenance]')).toHaveCount(6)
  })

  test('the locked row names the ancestor from lockedBy and shows lockReason verbatim', async ({ page }) => {
    await mockJson(page, PATH.config, 'GET', () => ({ status: 200, body: sixEntryFixture() }))
    await gotoEditor(page)

    const lockLine = page.locator("[data-entry='notifications.channel.sms'] [data-locked-by]")
    await expect(lockLine, 'LockedByAncestorNotice must render [data-locked-by] naming the ancestor').toBeVisible()
    await expect(lockLine).toContainText('platform')
    await expect(
      lockLine,
      'lockReason must be shown verbatim, never a generic "you cannot edit this"',
    ).toContainText('SMS is disabled tenant-wide pending carrier review.')
  })

  test('a requiresRestart key shows the restart notice inline, not only after saving', async ({ page }) => {
    await mockJson(page, PATH.config, 'GET', () => ({ status: 200, body: sixEntryFixture() }))
    await gotoEditor(page)
    await expect(
      page.locator("[data-requires-restart='notifications.retry.backoff']"),
      'RequiresRestartNotice must render inline for a requiresRestart:true key even before it is edited',
    ).toBeVisible()
  })

  test('the secret row shows a mask and Replace only — never a value, never a show-toggle', async ({ page }) => {
    await mockJson(page, PATH.config, 'GET', () => ({ status: 200, body: sixEntryFixture() }))
    await gotoEditor(page)

    const secretRow = page.locator("[data-entry='notifications.provider.apiKey']")
    await expect(secretRow.locator("[data-secret-mask='notifications.provider.apiKey']")).toBeVisible()
    // value is always null on the wire for an isSecret key — there must be no
    // rendered input carrying a real value, and no reveal/show toggle on this row.
    await expect(secretRow.locator('input[type="text"], input:not([type])')).toHaveCount(0)
    await expect(secretRow.getByText(/show|reveal/i)).toHaveCount(0)
  })

  test('Save is ONE atomic PUT carrying expectedVersion from the displayed ETag', async ({ page }) => {
    await mockJson(page, PATH.config, 'GET', () => ({ status: 200, body: sixEntryFixture() }))
    let putBody: any = null
    await page.route(pathMatches(PATH.config), async route => {
      if (route.request().method() !== 'PUT') return route.continue()
      putBody = route.request().postDataJSON()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          namespace: NAMESPACE,
          scope: ORG_SCOPE,
          version: 'v-8815',
          applied: ['notifications.retry.maxAttempts'],
        }),
      })
    })
    await gotoEditor(page)

    await page.locator("[data-value-input='notifications.retry.maxAttempts']").fill('7')
    await expect(
      page.locator('[data-dirty-count]'),
      'DirtyChangeCounter must reflect exactly the 1 edited row',
    ).toHaveText('1')

    await page.locator('[data-save-reason]').fill('bump the retry ceiling')
    await page.locator('[data-save-submit]').click()

    await expect.poll(() => putBody !== null, { message: 'PUT /v1/config must fire on Save' }).toBe(true)
    expect(putBody.namespace).toBe(NAMESPACE)
    expect(putBody.scope).toEqual(ORG_SCOPE)
    expect(putBody.expectedVersion, 'expectedVersion must be the ETag shown in the scope bar (v-8814)').toBe(
      'v-8814',
    )
    expect(putBody.operations, 'a single edited row must produce exactly one operation — the batch is atomic').toHaveLength(
      1,
    )
    expect(putBody.operations[0]).toMatchObject({ key: 'notifications.retry.maxAttempts', op: 'set', value: 7 })
  })
})

test.describe('Settings editor — provenance, lock & unset-vs-pin (frame 02-provenance-and-lock)', () => {
  function stateFixture() {
    const digestFrequency = keyDef({
      key: 'notifications.digest.frequency',
      valueType: 'enum',
      enumValues: ['hourly', 'daily', 'weekly'],
      defaultValue: 'daily',
      allowedScopes: ['platform', 'portal', 'org', 'user'],
    })
    const digestEnabled = keyDef({
      key: 'notifications.digest.enabled',
      valueType: 'boolean',
      defaultValue: true,
      allowedScopes: ['platform', 'portal', 'org', 'user'],
    })
    const channelSms = keyDef({
      key: 'notifications.channel.sms',
      valueType: 'boolean',
      defaultValue: false,
      allowedScopes: ['platform', 'portal', 'org', 'user'],
    })
    const engineId = keyDef({
      key: 'notifications.engine.id',
      valueType: 'string',
      defaultValue: 'fuze-dispatch-v3',
      allowedScopes: ['platform'],
      isSystem: true,
      isReadonly: true,
    })
    const senderDomain = keyDef({
      key: 'notifications.sender.domain',
      valueType: 'url',
      defaultValue: 'mail.fuzefront.com',
      allowedScopes: ['platform', 'portal'],
    })
    const maxAttempts = keyDef({
      key: 'notifications.retry.maxAttempts',
      valueType: 'number',
      defaultValue: 5,
      allowedScopes: ['platform', 'portal', 'org', 'user'],
    })

    return {
      digestFrequency,
      digestEnabled,
      channelSms,
      engineId,
      senderDomain,
      maxAttempts,
      config: effectiveConfig(
        [
          // A: set-here
          entry({ key: 'notifications.digest.frequency', value: 'daily', source: ORG_SCOPE, definition: digestFrequency }),
          // B: inherited, not locked (achievable ancestor: platform — see header note)
          entry({ key: 'notifications.digest.enabled', value: true, source: PLATFORM_SCOPE, definition: digestEnabled }),
          // C: locked-by-ancestor
          entry({
            key: 'notifications.channel.sms',
            value: false,
            source: PLATFORM_SCOPE,
            locked: true,
            lockedBy: PLATFORM_SCOPE,
            lockReason: 'SMS is disabled tenant-wide pending carrier review.',
            editable: false,
            definition: channelSms,
          }),
          // D: isReadonly — nobody can change it anywhere, no ancestor to name
          entry({
            key: 'notifications.engine.id',
            value: 'fuze-dispatch-v3',
            source: PLATFORM_SCOPE,
            editable: false,
            definition: engineId,
          }),
          // E: scope-not-allowed at org (allowedScopes excludes org)
          entry({
            key: 'notifications.sender.domain',
            value: 'mail.acme-portal.com',
            source: PLATFORM_SCOPE,
            editable: false,
            definition: senderDomain,
          }),
          // F: default — never set anywhere
          entry({ key: 'notifications.retry.maxAttempts', value: 5, source: PLATFORM_SCOPE, definition: maxAttempts }),
        ],
        { version: 'v-9100' },
      ),
    }
  }

  test('set-here (A): editable and offers the Reset menu', async ({ page }) => {
    const fx = stateFixture()
    await mockJson(page, PATH.config, 'GET', () => ({ status: 200, body: fx.config }))
    await gotoEditor(page)
    await expect(page.locator("[data-entry='notifications.digest.frequency'] [data-provenance='set']")).toBeVisible()
    await expect(page.locator("[data-reset-menu='notifications.digest.frequency']")).toBeVisible()
  })

  test('inherited (B): editable, ancestor named, not locked', async ({ page }) => {
    const fx = stateFixture()
    await mockJson(page, PATH.config, 'GET', () => ({ status: 200, body: fx.config }))
    await gotoEditor(page)
    const row = page.locator("[data-entry='notifications.digest.enabled']")
    await expect(row.locator("[data-provenance='inherited']")).toBeVisible()
    await expect(row.locator('[data-locked-by]'), 'inherited-but-not-locked must not carry a lock notice').toHaveCount(0)
  })

  test('locked-by-ancestor (C): NAMES the ancestor and lockReason — a generic denial fails this test', async ({
    page,
  }) => {
    const fx = stateFixture()
    await mockJson(page, PATH.config, 'GET', () => ({ status: 200, body: fx.config }))
    await gotoEditor(page)
    const row = page.locator("[data-entry='notifications.channel.sms']")
    await expect(row.locator("[data-provenance='locked']")).toBeVisible()
    const lockNote = row.locator('[data-locked-by]')
    await expect(lockNote).toContainText('platform')
    await expect(lockNote).toContainText('SMS is disabled tenant-wide pending carrier review.')
    // The input itself is disabled — a courtesy; the server is the real boundary.
    await expect(row.locator("[data-value-input='notifications.channel.sms']")).toBeDisabled()
  })

  test('readonly (D): disabled everywhere, but distinct from a lock — no ancestor to name', async ({ page }) => {
    const fx = stateFixture()
    await mockJson(page, PATH.config, 'GET', () => ({ status: 200, body: fx.config }))
    await gotoEditor(page)
    const row = page.locator("[data-entry='notifications.engine.id']")
    await expect(row.locator("[data-value-input='notifications.engine.id']")).toBeDisabled()
    await expect(row.locator('[data-locked-by]'), 'readonly must not be misrendered as a lock').toHaveCount(0)
  })

  test('scope-not-allowed (E): NO enabled input — never a control that only fails on save', async ({ page }) => {
    const fx = stateFixture()
    await mockJson(page, PATH.config, 'GET', () => ({ status: 200, body: fx.config }))
    await gotoEditor(page)
    const row = page.locator("[data-entry='notifications.sender.domain']")
    await expect(row.locator("[data-value-input='notifications.sender.domain']")).toBeDisabled()
    await expect(row.locator("[data-error-code='SCOPE_NOT_ALLOWED']")).toBeVisible()
  })

  test('default (F): the value is real and in force — must not read as empty/unset', async ({ page }) => {
    const fx = stateFixture()
    await mockJson(page, PATH.config, 'GET', () => ({ status: 200, body: fx.config }))
    await gotoEditor(page)
    const row = page.locator("[data-entry='notifications.retry.maxAttempts']")
    await expect(row.locator("[data-provenance='default']")).toBeVisible()
    const badgeText = (await row.locator("[data-provenance='default']").innerText()).toLowerCase()
    expect(badgeText, 'the default provenance badge must not read as empty/unset').not.toMatch(/\bunset\b|\bempty\b/)
    await expect(row.locator("[data-value-input='notifications.retry.maxAttempts']")).toHaveValue('5')
  })

  test('unset vs pin-the-parent-value: two operations, never collapsed into one control', async ({ page }) => {
    const fx = stateFixture()
    await mockJson(page, PATH.config, 'GET', () => ({ status: 200, body: fx.config }))
    await gotoEditor(page)

    await page.locator("[data-reset-menu='notifications.digest.frequency']").click()
    const menu = page.locator("[data-inherit-menu='notifications.digest.frequency']")
    await expect(menu, 'ResetValueMenu must open with two DISTINCT operations').toBeVisible()
    await expect(menu.locator("[data-op='unset']"), 'UnsetOperationOption must be present').toBeVisible()
    await expect(menu.locator("[data-op='pin-parent']"), 'PinParentValueOption must be present').toBeVisible()
    await expect(page.locator("[data-note='unset-vs-pin']")).toBeVisible()
  })

  test('choosing "unset" emits { op: "unset" } with NO value field', async ({ page }) => {
    const fx = stateFixture()
    await mockJson(page, PATH.config, 'GET', () => ({ status: 200, body: fx.config }))
    let putBody: any = null
    await page.route(pathMatches(PATH.config), async route => {
      if (route.request().method() !== 'PUT') return route.continue()
      putBody = route.request().postDataJSON()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ namespace: NAMESPACE, scope: ORG_SCOPE, version: 'v-9101', applied: ['notifications.digest.frequency'] }),
      })
    })
    await gotoEditor(page)

    await page.locator("[data-reset-menu='notifications.digest.frequency']").click()
    await page.locator("[data-inherit-menu='notifications.digest.frequency'] [data-op='unset']").click()
    await page.locator('[data-save-submit]').click()

    await expect.poll(() => putBody !== null).toBe(true)
    expect(putBody.operations).toEqual([{ key: 'notifications.digest.frequency', op: 'unset' }])
  })

  test('choosing "pin the parent value" emits { op: "set", value } — stops tracking the parent', async ({ page }) => {
    const fx = stateFixture()
    await mockJson(page, PATH.config, 'GET', () => ({ status: 200, body: fx.config }))
    let putBody: any = null
    await page.route(pathMatches(PATH.config), async route => {
      if (route.request().method() !== 'PUT') return route.continue()
      putBody = route.request().postDataJSON()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ namespace: NAMESPACE, scope: ORG_SCOPE, version: 'v-9101', applied: ['notifications.digest.frequency'] }),
      })
    })
    await gotoEditor(page)

    await page.locator("[data-reset-menu='notifications.digest.frequency']").click()
    await page.locator("[data-inherit-menu='notifications.digest.frequency'] [data-op='pin-parent']").click()
    await page.locator('[data-save-submit]').click()

    await expect.poll(() => putBody !== null).toBe(true)
    expect(
      putBody.operations,
      'pin-parent must be a "set" carrying the CURRENT parent value — never the same payload as unset',
    ).toEqual([{ key: 'notifications.digest.frequency', op: 'set', value: 'daily' }])
  })
})

test.describe('Settings editor — states: loading, empty, error, hidden-absent (frame 03-editor-states)', () => {
  test('loading: shows the skeleton, then resolves to the form', async ({ page }) => {
    await page.route(pathMatches(PATH.config), async route => {
      if (route.request().method() !== 'GET') return route.continue()
      await new Promise(resolve => setTimeout(resolve, 300))
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(effectiveConfig([])),
      })
    })
    await gotoEditor(page)
    const loading = page.locator("[data-state='loading'][data-loading][aria-busy='true']")
    await expect(loading, 'ConfigSkeleton must render aria-busy while loading').toBeVisible()
    await expect(page.locator('[data-settings-form]')).toBeVisible()
    await expect(loading).toBeHidden()
  })

  test('empty-namespace: a legitimate 200 with entries:[] — distinct from an error, offers namespace switching', async ({
    page,
  }) => {
    await mockJson(page, PATH.config, 'GET', () => ({ status: 200, body: effectiveConfig([]) }))
    await gotoEditor(page)
    await expect(page.locator("[data-state='empty-namespace'][data-empty='namespace']")).toBeVisible()
    await expect(page.locator("[data-error-code]"), 'empty is NOT an error state').toHaveCount(0)
    await expect(page.locator("[data-action='switch-namespace']")).toBeVisible()
  })

  test('load-error: retryable, and NEVER presents an editable form (no safe expectedVersion to send)', async ({
    page,
  }) => {
    await mockJson(page, PATH.config, 'GET', () => ({ status: 502, body: errorBody('VALIDATION_ERROR', 'boom') }))
    await gotoEditor(page)
    await expect(page.locator("[data-state='load-error'][data-error-code='LOAD_FAILED']")).toBeVisible()
    await expect(page.locator("[data-action='retry']")).toBeVisible()
    await expect(
      page.locator('[data-settings-form]'),
      'a load error must never present an editable form with no baseline expectedVersion',
    ).toHaveCount(0)
  })

  test('hidden keys are ABSENT from the network payload, not filtered client-side (the load-bearing case)', async ({
    page,
  }) => {
    const digestFrequency = keyDef({
      key: 'notifications.digest.frequency',
      valueType: 'enum',
      enumValues: ['hourly', 'daily', 'weekly'],
      defaultValue: 'daily',
      allowedScopes: ['platform', 'portal', 'org', 'user'],
    })
    const retryBackoff = keyDef({
      key: 'notifications.retry.backoff',
      valueType: 'duration',
      defaultValue: 'PT10M',
      allowedScopes: ['platform', 'portal', 'org', 'user'],
    })
    // Contract-compliant: EffectiveConfig.entries never includes an isHidden key
    // (openapi.yaml getEffectiveConfig: "Keys marked isHidden are absent from the
    // response entirely"). This is what the real service actually sends.
    const compliantConfig = effectiveConfig([
      entry({ key: 'notifications.digest.frequency', value: 'daily', source: ORG_SCOPE, definition: digestFrequency }),
      entry({ key: 'notifications.retry.backoff', value: 'PT5M', source: ORG_SCOPE, definition: retryBackoff }),
    ])

    let keysListHits = 0
    let configGetHits = 0
    await page.route(pathMatches(PATH.config), async route => {
      if (route.request().method() !== 'GET') return route.continue()
      configGetHits += 1
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(compliantConfig) })
    })
    await page.route(pathMatches(PATH.keysList), async route => {
      // The editor has no legitimate reason to call the admin catalog endpoint —
      // doing so would be the tell-tale of "fetch everything, filter client-side".
      keysListHits += 1
      return route.continue()
    })

    const networkResponse = page.waitForResponse(res => pathMatches(PATH.config)(res.url()) && res.request().method() === 'GET')
    await gotoEditor(page)
    const response = await networkResponse
    const responseJson = await response.json()

    // Network-payload assertion (not a DOM-only one): the number of rows the
    // editor renders must equal exactly what GET /v1/config actually returned —
    // catching a build that over-fetches (includeHidden) and hides with CSS.
    await expect(page.locator('[data-settings-form] [data-entry]')).toHaveCount(responseJson.entries.length)
    expect(configGetHits, 'GET /v1/config must be called exactly once to render this route').toBe(1)
    expect(
      keysListHits,
      'the settings editor must NEVER call the admin catalog endpoint (the only endpoint that can return isHidden keys)',
    ).toBe(0)

    // Hidden key names must never surface anywhere in the rendered page, in any form.
    const bodyText = await page.locator('body').innerText()
    expect(bodyText).not.toContain('notifications.internal.shardKey')
    expect(bodyText).not.toContain('notifications.internal.debugSink')
  })

  test('forbidden-scope: every entry editable:false — read-only, and the save bar is ABSENT entirely', async ({
    page,
  }) => {
    const digestFrequency = keyDef({
      key: 'notifications.digest.frequency',
      valueType: 'enum',
      enumValues: ['hourly', 'daily', 'weekly'],
      defaultValue: 'daily',
      allowedScopes: ['platform', 'portal', 'org', 'user'],
    })
    const digestEnabled = keyDef({
      key: 'notifications.digest.enabled',
      valueType: 'boolean',
      defaultValue: true,
      allowedScopes: ['platform', 'portal', 'org', 'user'],
    })
    const readOnlyConfig = effectiveConfig([
      entry({
        key: 'notifications.digest.frequency',
        value: 'daily',
        source: ORG_SCOPE,
        editable: false,
        definition: digestFrequency,
      }),
      entry({
        key: 'notifications.digest.enabled',
        value: true,
        source: PLATFORM_SCOPE,
        editable: false,
        definition: digestEnabled,
      }),
    ])
    await mockJson(page, PATH.config, 'GET', () => ({ status: 200, body: readOnlyConfig }))
    await gotoEditor(page)

    await expect(page.locator("[data-state='forbidden-scope']")).toBeVisible()
    await expect(page.locator("[data-error-code='FORBIDDEN']")).toBeVisible()
    await expect(page.locator('[data-readonly-notice]')).toBeVisible()
    await expect(page.locator("[data-value-input='notifications.digest.frequency']")).toBeDisabled()
    await expect(
      page.locator('[data-save-bar]'),
      'a read-only scope must render NO save bar — never inputs plus a Save button that only 403s',
    ).toHaveCount(0)
  })
})

test.describe('Settings editor — save failures (frame 04-save-conflict)', () => {
  const CONFLICT_KEY = 'notifications.digest.frequency'

  function baseFixture() {
    const def = keyDef({
      key: CONFLICT_KEY,
      valueType: 'enum',
      enumValues: ['hourly', 'daily', 'weekly'],
      defaultValue: 'daily',
      allowedScopes: ['platform', 'portal', 'org', 'user'],
    })
    return {
      def,
      config: effectiveConfig([entry({ key: CONFLICT_KEY, value: 'daily', source: ORG_SCOPE, definition: def })]),
    }
  }

  test('VERSION_CONFLICT: re-read-and-merge — NO blind Retry, NO force-save/overwrite control', async ({ page }) => {
    const fx = baseFixture()
    await mockJson(page, PATH.config, 'GET', () => ({ status: 200, body: fx.config }))
    const putCalls: any[] = []
    await page.route(pathMatches(PATH.config), async route => {
      if (route.request().method() !== 'PUT') return route.continue()
      const body = route.request().postDataJSON()
      putCalls.push(body)
      if (putCalls.length === 1) {
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify(
            errorBody('VERSION_CONFLICT', 'The resolved view moved since you loaded it.', { currentVersion: 'v-8817' }),
          ),
        })
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ namespace: NAMESPACE, scope: ORG_SCOPE, version: 'v-8818', applied: [CONFLICT_KEY] }),
      })
    })
    await gotoEditor(page)

    // Edit the value first so the fixture's PUT mock actually observes a change
    // (matches the other save-failure tests below, which click Save directly).
    await expect(page.locator(`[data-value-input='${CONFLICT_KEY}']`), 'the value input must render before it can be edited').toBeVisible()
    await page.locator(`[data-value-input='${CONFLICT_KEY}']`).selectOption('weekly')
    await page.locator('[data-save-submit]').click()

    const conflictPanel = page.locator("[data-state='version-conflict']")
    await expect(conflictPanel).toBeVisible()
    await expect(conflictPanel.locator("[data-error-code='VERSION_CONFLICT']")).toBeVisible()
    await expect(conflictPanel).toContainText(/nothing was saved/i)

    // Never a blind retry, never a force/overwrite affordance — the only way to
    // make a blind retry succeed is dropping expectedVersion, destroying the edit.
    await expect(conflictPanel.locator("[data-action='retry']"), 'no blind Retry inside the conflict view').toHaveCount(0)
    await expect(conflictPanel.getByText(/force save|overwrite/i), 'no force-save/overwrite affordance').toHaveCount(0)

    await expect(conflictPanel.locator('[data-conflict-table]')).toBeVisible()
    const row = conflictPanel.locator(`[data-conflict-row='${CONFLICT_KEY}']`)
    await expect(row.locator("[data-keep='theirs']")).toBeVisible()
    await expect(row.locator("[data-keep='yours']")).toBeVisible()
    await expect(conflictPanel.locator('[data-conflict-count]')).toBeVisible()

    await row.locator("[data-keep='yours']").click()
    await conflictPanel.locator("[data-action='save-merged']").click()

    await expect.poll(() => putCalls.length).toBe(2)
    expect(
      putCalls[1].expectedVersion,
      'the retried save must carry the FRESH currentVersion from the 409, never the stale one blindly resent',
    ).toBe('v-8817')
  })

  test('VALIDATION_ERROR: per-field, names what WAS allowed, nothing saved, Save disabled', async ({ page }) => {
    const fx = baseFixture()
    await mockJson(page, PATH.config, 'GET', () => ({ status: 200, body: fx.config }))
    await mockJson(page, PATH.config, 'PUT', () => ({
      status: 400,
      body: errorBody('VALIDATION_ERROR', 'Nothing was saved — 1 value is invalid.', {
        details: [
          {
            key: CONFLICT_KEY,
            field: 'value',
            message: 'Not one of the permitted values.',
            allowedValues: ['hourly', 'daily', 'weekly'],
          },
        ],
      }),
    }))
    await gotoEditor(page)

    await page.locator("[data-save-submit]").click()

    await expect(page.locator("[data-state='validation-error'][data-error-code='VALIDATION_ERROR']")).toBeVisible()
    const fieldError = page.locator(`[data-field-error='${CONFLICT_KEY}']`)
    await expect(fieldError, 'FieldValidationError renders against the offending input') .toBeVisible()
    await expect(fieldError).toContainText(/hourly/i)
    await expect(fieldError).toContainText(/daily/i)
    await expect(fieldError).toContainText(/weekly/i)
    await expect(page.getByText(/nothing was saved/i)).toBeVisible()
    await expect(page.locator('[data-save-submit]')).toBeDisabled()
  })

  test('LOCKED_BY_ANCESTOR mid-edit: the row locks in place, names the new owner, offers to drop the change', async ({
    page,
  }) => {
    const fx = baseFixture()
    await mockJson(page, PATH.config, 'GET', () => ({ status: 200, body: fx.config }))
    await mockJson(page, PATH.config, 'PUT', () => ({
      status: 409,
      body: errorBody('LOCKED_BY_ANCESTOR', '1 setting is now locked by an ancestor — nothing was saved.', {
        lockedBy: PLATFORM_SCOPE,
      }),
    }))
    await gotoEditor(page)
    await page.locator('[data-save-submit]').click()

    const panel = page.locator("[data-state='locked-on-save'][data-error-code='LOCKED_BY_ANCESTOR']")
    await expect(panel).toBeVisible()
    await expect(panel).toContainText(/nothing was saved/i)
    const row = page.locator(`[data-entry='${CONFLICT_KEY}']`)
    await expect(row.locator("[data-provenance='locked']")).toBeVisible()
    await expect(row.locator('[data-locked-by]')).toContainText('platform')
    await expect(row.locator("[data-action='drop-change']")).toBeVisible()
  })

  test('stale-value: shows BOTH the default now in force AND the orphaned stored value', async ({ page }) => {
    const def = keyDef({
      key: CONFLICT_KEY,
      valueType: 'enum',
      enumValues: ['hourly', 'daily', 'weekly'],
      defaultValue: 'daily',
      allowedScopes: ['platform', 'portal', 'org', 'user'],
    })
    const staleConfig = effectiveConfig([
      entry({
        key: CONFLICT_KEY,
        value: 'daily', // the default now in force
        source: ORG_SCOPE,
        warning:
          'stored value no longer satisfies its definition; showing the default. Your saved value "fortnightly" is no longer permitted.',
        definition: def,
      }),
    ])
    await mockJson(page, PATH.config, 'GET', () => ({ status: 200, body: staleConfig }))
    await gotoEditor(page)

    const row = page.locator(`[data-entry='${CONFLICT_KEY}']`)
    await expect(row.locator("[data-provenance='stale']")).toBeVisible()
    await expect(row.locator(`[data-value-input='${CONFLICT_KEY}']`)).toHaveValue('daily')
    const warning = row.locator("[data-warning='stale-definition']")
    await expect(warning, 'the warning must name the orphaned stored value, not just the new default').toContainText(
      'fortnightly',
    )
    await expect(warning).toContainText('daily')
  })
})

// ══════════════════════════════════════════════════════════════════════════
// Flow 2 — key-catalog (/admin/config/catalog)
// ══════════════════════════════════════════════════════════════════════════

test.describe('Key catalog — render (frame 05-key-catalog)', () => {
  function catalogFixture() {
    return paged([
      keyDef({
        key: 'notifications.digest.frequency',
        valueType: 'enum',
        enumValues: ['hourly', 'daily', 'weekly'],
        defaultValue: 'daily',
        allowedScopes: ['platform', 'portal', 'org', 'user'],
      }),
      keyDef({
        key: 'notifications.provider.apiKey',
        valueType: 'secret',
        isSecret: true,
        defaultValue: null,
        allowedScopes: ['platform', 'portal'],
      }),
      keyDef({
        key: 'notifications.digest.window',
        valueType: 'duration',
        defaultValue: 'PT24H',
        allowedScopes: ['platform', 'portal', 'org'],
        deprecatedAt: '2026-06-01T00:00:00.000Z',
        replacedBy: 'notifications.digest.frequency',
      }),
      keyDef({
        key: 'notifications.internal.shardKey',
        valueType: 'string',
        defaultValue: 'shard-a',
        allowedScopes: ['platform'],
        isSystem: true,
        isHidden: true,
      }),
      keyDef({
        key: 'notifications.internal.debugSink',
        valueType: 'url',
        defaultValue: null,
        allowedScopes: ['platform'],
        isSystem: true,
        isHidden: true,
      }),
    ])
  }

  test('lists KeyDefinition rows: valueType, allowedScopes, flags and default', async ({ page }) => {
    let requestedUrl = ''
    await page.route(pathMatches(PATH.keysList), async route => {
      requestedUrl = route.request().url()
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(catalogFixture()) })
    })
    await gotoCatalog(page)

    await expect(page.locator('[data-catalog-table]')).toBeVisible()
    await expect(page.locator("[data-catalog-row='notifications.digest.frequency']")).toBeVisible()
    // Reaching this table at all requires the platform-admin includeHidden request.
    expect(new URL(requestedUrl).searchParams.get('includeHidden')).toBe('true')
  })

  test('hidden rows appear HERE — and only here — flagged as hidden', async ({ page }) => {
    await mockJson(page, PATH.keysList, 'GET', () => ({ status: 200, body: catalogFixture() }))
    await gotoCatalog(page)
    const hiddenRow = page.locator("[data-catalog-row='notifications.internal.shardKey'][data-hidden-key='true']")
    await expect(hiddenRow).toBeVisible()
  })

  test('a deprecated key is flagged, and still shows its (still-resolving) default', async ({ page }) => {
    await mockJson(page, PATH.keysList, 'GET', () => ({ status: 200, body: catalogFixture() }))
    await gotoCatalog(page)
    await expect(page.locator("[data-catalog-row='notifications.digest.window'][data-deprecated='true']")).toBeVisible()
  })

  test('a secret key never shows a default value in the catalog table', async ({ page }) => {
    await mockJson(page, PATH.keysList, 'GET', () => ({ status: 200, body: catalogFixture() }))
    await gotoCatalog(page)
    const row = page.locator("[data-catalog-row='notifications.provider.apiKey']")
    await expect(row).toBeVisible()
    await expect(row, 'a secret KeyDefinition.defaultValue must never render as a shown value').not.toContainText(
      /^null$/,
    )
  })

  test('[data-open-definition] links to the definition detail route for that key', async ({ page }) => {
    await mockJson(page, PATH.keysList, 'GET', () => ({ status: 200, body: catalogFixture() }))
    await gotoCatalog(page)
    const link = page.locator("[data-open-definition='notifications.digest.frequency']")
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('href', new RegExp(catalogKeyRoute('notifications.digest.frequency')))
  })
})

test.describe('Key catalog — definition & resolution chain (frame 06-key-definition)', () => {
  const KEY = 'notifications.digest.frequency'

  test('renders the KeyDefinition facts table', async ({ page }) => {
    const def = keyDef({
      key: KEY,
      displayName: 'Digest frequency',
      valueType: 'enum',
      enumValues: ['hourly', 'daily', 'weekly'],
      defaultValue: 'daily',
      allowedScopes: ['platform', 'portal', 'org', 'user'],
      requiresRestart: true,
    })
    await mockJson(page, PATH.keyDefinition, 'GET', () => ({ status: 200, body: def }))
    await mockJson(page, PATH.config, 'GET', () => ({
      status: 200,
      body: effectiveConfig([entry({ key: KEY, value: 'daily', source: ORG_SCOPE, definition: def })]),
    }))
    await gotoKeyDefinition(page, KEY)

    await expect(page.locator('[data-definition-facts]')).toBeVisible()
    await expect(page.locator('[data-definition-facts]')).toContainText('daily')
    await expect(page.locator('[data-definition-facts]')).toContainText('most-specific-wins')
  })

  test('resolution chain: the two tiers achievable today — platform and the queried scope (org) — resolve and the winner is marked', async ({
    page,
  }) => {
    // The `portal` and `user` steps are NOT independently resolvable from a single
    // GET /v1/config call today (buildScopeChain gap — see header note) and are
    // deliberately not asserted here.
    const def = keyDef({
      key: KEY,
      valueType: 'enum',
      enumValues: ['hourly', 'daily', 'weekly'],
      defaultValue: 'daily',
      allowedScopes: ['platform', 'portal', 'org', 'user'],
    })
    await mockJson(page, PATH.keyDefinition, 'GET', () => ({ status: 200, body: def }))
    await mockJson(page, PATH.config, 'GET', () => ({
      status: 200,
      body: effectiveConfig([entry({ key: KEY, value: 'daily', source: ORG_SCOPE, definition: def })]),
    }))
    await gotoKeyDefinition(page, KEY)

    const chain = page.locator('[data-resolution-chain]')
    await expect(chain).toBeVisible()
    await expect(chain.locator("[data-chain-step='platform']")).toBeVisible()
    await expect(chain.locator("[data-chain-step='org'][data-chain-effective='true']")).toBeVisible()
  })

  test('no-divergence: a key with no overrides anywhere gets a designed answer, not an empty table', async ({
    page,
  }) => {
    const KEY2 = 'notifications.retry.maxAttempts'
    const def = keyDef({ key: KEY2, valueType: 'number', defaultValue: 5, allowedScopes: ['platform', 'portal', 'org', 'user'] })
    await mockJson(page, PATH.keyDefinition, 'GET', () => ({ status: 200, body: def }))
    await mockJson(page, PATH.config, 'GET', () => ({
      status: 200,
      body: effectiveConfig([entry({ key: KEY2, value: 5, source: PLATFORM_SCOPE, definition: def })]),
    }))
    await gotoKeyDefinition(page, KEY2)

    await expect(page.locator(`[data-no-divergence='${KEY2}']`)).toBeVisible()
    await expect(page.locator("[data-state='no-divergence']")).toContainText(/no overrides/i)
  })

  test('a lock terminates the chain: scopes beneath it render UNREACHABLE, not merely "no override"', async ({
    page,
  }) => {
    const KEY3 = 'notifications.channel.sms'
    const def = keyDef({ key: KEY3, valueType: 'boolean', defaultValue: false, allowedScopes: ['platform', 'portal', 'org', 'user'] })
    await mockJson(page, PATH.keyDefinition, 'GET', () => ({ status: 200, body: def }))
    await mockJson(page, PATH.config, 'GET', () => ({
      status: 200,
      body: effectiveConfig([
        entry({
          key: KEY3,
          value: false,
          source: PLATFORM_SCOPE,
          locked: true,
          lockedBy: PLATFORM_SCOPE,
          lockReason: 'SMS is disabled tenant-wide pending carrier review.',
          editable: false,
          definition: def,
        }),
      ]),
    }))
    await gotoKeyDefinition(page, KEY3)

    const chain = page.locator('[data-resolution-chain]')
    await expect(chain.locator("[data-chain-step='platform'][data-chain-locked='true']")).toBeVisible()
    await expect(
      chain.locator("[data-chain-step='org'][data-chain-blocked='true']"),
      'scopes beneath the lock must render as UNREACHABLE (LOCKED_BY_ANCESTOR), never as a plain "no override"',
    ).toBeVisible()
  })

  test('links onward to the audit history for this key', async ({ page }) => {
    const def = keyDef({ key: KEY, valueType: 'enum', enumValues: ['hourly', 'daily', 'weekly'], defaultValue: 'daily', allowedScopes: ['platform', 'portal', 'org', 'user'] })
    await mockJson(page, PATH.keyDefinition, 'GET', () => ({ status: 200, body: def }))
    await mockJson(page, PATH.config, 'GET', () => ({
      status: 200,
      body: effectiveConfig([entry({ key: KEY, value: 'daily', source: ORG_SCOPE, definition: def })]),
    }))
    await gotoKeyDefinition(page, KEY)
    const historyLink = page.locator('[data-open-history]')
    await expect(historyLink).toBeVisible()
    await expect(historyLink).toHaveAttribute('href', new RegExp(historyRoute(KEY)))
  })
})

test.describe('Key catalog — states (frame 07-catalog-states)', () => {
  test('loading resolves to the table', async ({ page }) => {
    await page.route(pathMatches(PATH.keysList), async route => {
      if (route.request().method() !== 'GET') return route.continue()
      await new Promise(resolve => setTimeout(resolve, 300))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(paged([])) })
    })
    await gotoCatalog(page)
    await expect(page.locator("[data-state='loading'][data-loading]")).toBeVisible()
  })

  test('empty-namespaces: a setup state, not a failure — action is documentation, not retry', async ({ page }) => {
    await mockJson(page, PATH.namespaces, 'GET', () => ({ status: 200, body: paged([]) }))
    await gotoCatalog(page)
    await expect(page.locator("[data-state='empty-namespaces'][data-empty='namespaces']")).toBeVisible()
    await expect(page.locator("[data-action='open-docs']")).toBeVisible()
    await expect(page.locator("[data-action='retry']")).toHaveCount(0)
  })

  test('empty-keys: the namespace is real but declares no keys — names the app', async ({ page }) => {
    await mockJson(page, PATH.namespaces, 'GET', () => ({
      status: 200,
      body: paged([{ id: 'cns_01h455vb4pex5vsknk084sn02q', namespace: 'reporting', displayName: 'Reporting', description: null, ownerAppId: null, createdAt: '2026-01-01T00:00:00.000Z' }]),
    }))
    await mockJson(page, PATH.keysList, 'GET', () => ({ status: 200, body: paged([]) }))
    await gotoCatalog(page)
    const empty = page.locator("[data-state='empty-keys'][data-empty='keys']")
    await expect(empty).toBeVisible()
    await expect(empty).toContainText('reporting')
  })

  test('no-results: the underlying list is NOT empty — the search/filter excluded everything, offers clear', async ({
    page,
  }) => {
    await mockJson(page, PATH.keysList, 'GET', req => {
      const url = new URL(req.url())
      if (url.searchParams.get('search') === 'webhook') {
        return { status: 200, body: paged([]) }
      }
      return {
        status: 200,
        body: paged([
          keyDef({ key: 'notifications.digest.frequency', valueType: 'enum', enumValues: ['hourly', 'daily'], defaultValue: 'daily', allowedScopes: ['platform', 'org'] }),
        ]),
      }
    })
    await gotoCatalog(page)
    await page.locator('[data-catalog-search]').fill('webhook')
    await expect(page.locator("[data-state='no-results'][data-empty='no-results']")).toBeVisible()
    await expect(page.locator("[data-action='clear-filters']")).toBeVisible()
  })

  test('load-error: retryable', async ({ page }) => {
    await mockJson(page, PATH.keysList, 'GET', () => ({ status: 502, body: errorBody('VALIDATION_ERROR', 'boom') }))
    await gotoCatalog(page)
    await expect(page.locator("[data-state='load-error'][data-error-code='LOAD_FAILED']")).toBeVisible()
    await expect(page.locator("[data-action='retry']")).toBeVisible()
  })

  test('forbidden: NO definition data reaches the browser at all — the load-bearing disclosure guard', async ({
    page,
  }) => {
    let keysListHits = 0
    let sawHiddenKeyInAnyResponse = false
    await page.route(pathMatches(PATH.keysList), async route => {
      keysListHits += 1
      const body = errorBody('FORBIDDEN', 'Viewing key definitions requires a platform administrator grant.')
      const text = JSON.stringify(body)
      if (text.includes('isHidden')) sawHiddenKeyInAnyResponse = true
      return route.fulfill({ status: 403, contentType: 'application/json', body: text })
    })
    await gotoCatalog(page)

    await expect(page.locator("[data-state='forbidden'][data-error-code='FORBIDDEN']")).toBeVisible()
    await expect(page.locator("[data-action='back-to-editor']")).toBeVisible()

    // No table, no rows, no rendered definitions at all — a greyed-out table
    // with the rows still in the DOM is the disclosure this test exists to catch.
    await expect(page.locator('[data-catalog-table]')).toHaveCount(0)
    await expect(page.locator('[data-catalog-row]')).toHaveCount(0)

    expect(keysListHits, 'exactly one refused request — no silent retry with different params').toBe(1)
    expect(sawHiddenKeyInAnyResponse).toBe(false)
    const bodyText = await page.locator('body').innerText()
    expect(bodyText).not.toContain('notifications.internal.shardKey')
  })
})

// ══════════════════════════════════════════════════════════════════════════
// Flow 3 — secret-audit (secret field on /config, history on /admin/config/keys/:key/history)
// ══════════════════════════════════════════════════════════════════════════

test.describe('Secret values (frame 08-secret-input)', () => {
  const SECRET_KEY = 'notifications.provider.apiKey'
  function secretDef(overrides: Record<string, unknown> = {}) {
    return keyDef({ key: SECRET_KEY, valueType: 'secret', isSecret: true, defaultValue: null, allowedScopes: ['platform', 'portal'], ...overrides })
  }

  test('secret-unset: says "No value set" — never an empty mask that claims a credential exists', async ({
    page,
  }) => {
    const def = secretDef()
    await mockJson(page, PATH.config, 'GET', () => ({
      status: 200,
      body: effectiveConfig([entry({ key: SECRET_KEY, value: null, isSet: false, source: PLATFORM_SCOPE, definition: def })]),
    }))
    await gotoEditor(page)
    const row = page.locator(`[data-entry='${SECRET_KEY}']`)
    await expect(row.locator("[data-secret-state='unset']")).toBeVisible()
    await expect(row.locator("[data-secret-state='unset']")).toContainText(/no value set/i)
    await expect(row.locator(`[data-secret-mask='${SECRET_KEY}']`), 'unset must NOT render a mask').toHaveCount(0)
    await expect(row.locator("[data-action='set-secret']")).toBeVisible()
  })

  test('secret-set: masked, unreadable — no show/reveal toggle on the field itself', async ({ page }) => {
    const def = secretDef()
    await mockJson(page, PATH.config, 'GET', () => ({
      status: 200,
      body: effectiveConfig([entry({ key: SECRET_KEY, value: null, isSet: true, source: ORG_SCOPE, definition: def })]),
    }))
    await gotoEditor(page)
    const row = page.locator(`[data-entry='${SECRET_KEY}']`)
    await expect(row.locator("[data-secret-state='set']")).toBeVisible()
    await expect(row.locator(`[data-secret-mask='${SECRET_KEY}']`)).toBeVisible()
    await expect(row.locator("[data-action='replace-secret']")).toBeVisible()
    // No show/reveal toggle directly on this row — reveal is a separate, gated operation (frame D).
    await expect(row.getByText(/^show$|^reveal$/i)).toHaveCount(0)
  })

  test('secret-replacing: starts EMPTY, Save disabled until typed, Cancel restores the mask unchanged', async ({
    page,
  }) => {
    const def = secretDef()
    await mockJson(page, PATH.config, 'GET', () => ({
      status: 200,
      body: effectiveConfig([entry({ key: SECRET_KEY, value: null, isSet: true, source: ORG_SCOPE, definition: def })]),
    }))
    await gotoEditor(page)
    const row = page.locator(`[data-entry='${SECRET_KEY}']`)
    await row.locator("[data-action='replace-secret']").click()

    const input = row.locator(`[data-secret-input='${SECRET_KEY}']`)
    await expect(input).toBeVisible()
    await expect(input, 'the replace field starts EMPTY — nothing to pre-fill it with').toHaveValue('')
    await expect(row.locator("[data-action='save-secret']")).toBeDisabled()

    await input.fill('sk_live_new_credential')
    await expect(row.locator("[data-action='save-secret']")).toBeEnabled()

    await row.locator("[data-action='cancel-replace']").click()
    await expect(row.locator("[data-secret-state='set']"), 'cancel restores the mask, changes nothing').toBeVisible()
  })

  test('reveal-once: separately authorized (reason required), shown exactly once, no re-open', async ({ page }) => {
    const def = secretDef()
    await mockJson(page, PATH.config, 'GET', () => ({
      status: 200,
      body: effectiveConfig([entry({ key: SECRET_KEY, value: null, isSet: true, source: ORG_SCOPE, definition: def })]),
    }))
    let revealCalls = 0
    await mockJson(page, PATH.secretsReveal, 'POST', () => {
      revealCalls += 1
      return { status: 200, body: { key: SECRET_KEY, value: `EXAMPLE-PLACEHOLDER-${revealCalls}` } }
    })
    await gotoEditor(page)
    const row = page.locator(`[data-entry='${SECRET_KEY}']`)

    await row.locator("[data-action='reveal-secret']").click()
    await expect(page.locator('[data-reveal-confirm]')).toBeVisible()
    await expect(page.locator('[data-action="confirm-reveal"]'), 'reveal must be blocked until a reason is given').toBeDisabled()
    await page.locator('[data-reveal-reason]').fill('rotating provider credentials')
    await page.locator("[data-action='confirm-reveal']").click()

    await expect.poll(() => revealCalls).toBe(1)
    const revealed = page.locator('[data-revealed-value]')
    await expect(revealed).toBeVisible()
    await expect(revealed.locator('[data-secret-plaintext]')).toContainText('EXAMPLE-PLACEHOLDER-1')

    await revealed.locator("[data-action='dismiss-reveal']").click()
    await expect(revealed, 'once dismissed, the value cannot be re-shown without a new authorization').toBeHidden()

    // Looking again is a NEW authorization — a second POST, a second audit entry.
    await row.locator("[data-action='reveal-secret']").click()
    await page.locator('[data-reveal-reason]').fill('checking it again')
    await page.locator("[data-action='confirm-reveal']").click()
    await expect.poll(() => revealCalls, { message: 'a second reveal must be a second, independently-audited POST' }).toBe(2)
  })

  test('SECRET_UNAVAILABLE: NOT presented as unset — Replace stays available, Reveal does not', async ({ page }) => {
    const def = secretDef()
    await mockJson(page, PATH.config, 'GET', () => ({
      status: 200,
      body: effectiveConfig([entry({ key: SECRET_KEY, value: null, isSet: true, source: ORG_SCOPE, warning: 'SECRET_UNAVAILABLE: encryption key unavailable', definition: def })]),
    }))
    await gotoEditor(page)
    const row = page.locator(`[data-entry='${SECRET_KEY}']`)
    await expect(row.locator("[data-secret-state='unavailable']")).toBeVisible()
    await expect(row.locator("[data-error-code='SECRET_UNAVAILABLE']")).toBeVisible()
    const rowText = (await row.innerText()).toLowerCase()
    expect(rowText, 'must never be presented as "not set" — that would invite overwriting a working credential').not.toMatch(
      /no value set/,
    )
    await expect(row.locator("[data-action='replace-secret']")).toBeVisible()
    await expect(row.locator("[data-action='reveal-secret']")).toBeDisabled()
  })

  test('reveal-forbidden: may replace but not reveal, shown in place — never a dead button that only 403s', async ({
    page,
  }) => {
    const def = secretDef()
    await mockJson(page, PATH.config, 'GET', () => ({
      status: 200,
      body: effectiveConfig([entry({ key: SECRET_KEY, value: null, isSet: true, source: ORG_SCOPE, definition: def })]),
    }))
    // Reveal is gated by a SEPARATE grant from write — simulate a caller who can
    // set but not reveal by asserting the UI never offers an enabled reveal.
    await gotoEditor(page)
    const row = page.locator(`[data-entry='${SECRET_KEY}']`)
    await expect(row.locator("[data-action='replace-secret']")).toBeVisible()
    const revealBtn = row.locator("[data-action='reveal-secret']")
    if (await revealBtn.count()) {
      await expect(revealBtn, 'reveal must be disabled, never an enabled control that only fails on click').toBeDisabled()
    }
  })
})

test.describe('Audit history & revert (frame 09-audit-history)', () => {
  const AUDIT_KEY = 'notifications.digest.frequency'

  function timelineFixture() {
    return {
      key: AUDIT_KEY,
      namespace: NAMESPACE,
      scope: ORG_SCOPE,
      entries: [
        {
          id: 5,
          op: 'set',
          value: 'daily',
          previousValue: 'weekly',
          actor: { scopeType: 'user', scopeId: 'usr_arivera' },
          scope: ORG_SCOPE,
          reason: 'reverting the EU rollout, too slow for support',
          createdAt: '2026-08-09T14:22:00.000Z',
          revertOf: null,
        },
        {
          id: 4,
          op: 'set',
          value: 'weekly',
          previousValue: 'hourly',
          actor: { scopeType: 'user', scopeId: 'usr_jokafor' },
          scope: ORG_SCOPE,
          reason: 'restoring the value from 2026-07-02',
          createdAt: '2026-08-02T09:05:00.000Z',
          revertOf: 2,
        },
        {
          id: 2,
          op: 'unset',
          value: null,
          previousValue: 'hourly',
          actor: { scopeType: 'user', scopeId: 'usr_arivera' },
          scope: ORG_SCOPE,
          reason: 'tracking the portal default again',
          createdAt: '2026-07-19T11:12:00.000Z',
          revertOf: null,
        },
      ],
    }
  }

  test('renders the append-only timeline with actor, scope, reason and operation', async ({ page }) => {
    await mockJson(page, PATH.configHistory, 'GET', () => ({ status: 200, body: timelineFixture() }))
    await gotoHistory(page, AUDIT_KEY)

    await expect(page.locator('[data-audit-timeline]')).toBeVisible()
    await expect(page.locator("[data-audit-entry='5'][data-audit-op='set']")).toBeVisible()
    await expect(page.locator("[data-audit-entry='4'][data-audit-op='set'][data-audit-revert-of='2']")).toBeVisible()
    await expect(page.locator("[data-audit-entry='2'][data-audit-op='unset']")).toBeVisible()
    await expect(page.locator("[data-note='revert-semantics']")).toBeVisible()
  })

  test('revert REPLAYS as a new PUT /v1/config — never a dedicated endpoint, never a delete', async ({ page }) => {
    await mockJson(page, PATH.configHistory, 'GET', () => ({ status: 200, body: timelineFixture() }))
    let putBody: any = null
    let sawNonStandardRevertEndpoint = false
    await page.route('**/*', async route => {
      const url = route.request().url()
      if (/\/revert(\/|$|\?)/.test(new URL(url).pathname) && !/\/v1\/config$/.test(new URL(url).pathname)) {
        sawNonStandardRevertEndpoint = true
      }
      return route.continue()
    })
    await page.route(pathMatches(PATH.config), async route => {
      if (route.request().method() !== 'PUT') return route.continue()
      putBody = route.request().postDataJSON()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ namespace: NAMESPACE, scope: ORG_SCOPE, version: 'v-9200', applied: [AUDIT_KEY] }),
      })
    })
    await gotoHistory(page, AUDIT_KEY)

    await page.locator("[data-audit-entry='5'] [data-action='revert-to']").click()
    const confirm = page.locator("[data-state='revert-confirm']")
    await expect(confirm).toBeVisible()
    await expect(confirm.locator('[data-revert-confirm]')).toBeVisible()
    await page.locator('[data-revert-reason]').fill('undo the digest rollback')
    await page.locator("[data-action='confirm-revert']").click()

    await expect.poll(() => putBody !== null, { message: 'revert must go through PUT /v1/config' }).toBe(true)
    expect(sawNonStandardRevertEndpoint, 'there must be no dedicated /revert endpoint').toBe(false)
    expect(putBody.operations[0].key).toBe(AUDIT_KEY)
  })

  test('reverting to an "unset" entry replays the UNSET, not the value it resolved to at the time', async ({
    page,
  }) => {
    await mockJson(page, PATH.configHistory, 'GET', () => ({ status: 200, body: timelineFixture() }))
    let putBody: any = null
    await page.route(pathMatches(PATH.config), async route => {
      if (route.request().method() !== 'PUT') return route.continue()
      putBody = route.request().postDataJSON()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ namespace: NAMESPACE, scope: ORG_SCOPE, version: 'v-9201', applied: [AUDIT_KEY] }),
      })
    })
    await gotoHistory(page, AUDIT_KEY)

    await page.locator("[data-audit-entry='2'] [data-action='revert-to']").click()
    await page.locator('[data-revert-reason]').fill('restore inheritance')
    await page.locator("[data-action='confirm-revert']").click()

    await expect.poll(() => putBody !== null).toBe(true)
    expect(
      putBody.operations[0],
      'reverting to an unset row must replay { op: "unset" }, never a "set" carrying the value it happened to resolve to',
    ).toEqual({ key: AUDIT_KEY, op: 'unset' })
  })

  test('a secret key\'s history is redacted on BOTH sides, and "Revert to this" is ABSENT (not disabled)', async ({
    page,
  }) => {
    const SECRET_AUDIT_KEY = 'notifications.provider.apiKey'
    await mockJson(page, PATH.configHistory, 'GET', () => ({
      status: 200,
      body: {
        key: SECRET_AUDIT_KEY,
        namespace: NAMESPACE,
        scope: { scopeType: 'portal', scopeId: 'portal_acme01' },
        entries: [
          {
            id: 2,
            op: 'set',
            redacted: true,
            actor: { scopeType: 'user', scopeId: 'usr_jokafor' },
            scope: { scopeType: 'portal', scopeId: 'portal_acme01' },
            reason: 'quarterly rotation',
            createdAt: '2026-07-14T13:50:00.000Z',
          },
        ],
      },
    }))
    await gotoHistory(page, SECRET_AUDIT_KEY)

    const row = page.locator("[data-audit-entry='2']")
    await expect(page.locator("[data-state='secret-redacted']")).toBeVisible()
    await expect(row.locator('[data-redacted]')).toBeVisible()
    const rowText = (await row.innerText()).toLowerCase()
    expect(rowText, 'no plaintext value must ever appear in a secret key\'s history row').not.toMatch(/sk_live|api[_-]?key\s*[:=]/)
    await expect(
      row.locator("[data-action='revert-to']"),
      '"Revert to this" must be ABSENT for a secret row — there is no plaintext to revert to',
    ).toHaveCount(0)
  })

  test('empty-history: never changed here, not an error — names where the value DOES come from', async ({ page }) => {
    const KEY2 = 'notifications.retry.maxAttempts'
    await mockJson(page, PATH.configHistory, 'GET', () => ({
      status: 200,
      body: { key: KEY2, namespace: NAMESPACE, scope: ORG_SCOPE, entries: [] },
    }))
    await gotoHistory(page, KEY2)
    const empty = page.locator("[data-state='empty-history'][data-empty='history']")
    await expect(empty).toBeVisible()
    await expect(empty).toContainText(/5/)
    await expect(page.locator("[data-error-code]"), 'empty history is not an error').toHaveCount(0)
  })

  test('load-error (retryable, record intact) is distinct from forbidden (no retry, a decision)', async ({ page }) => {
    await mockJson(page, PATH.configHistory, 'GET', () => ({ status: 502, body: errorBody('VALIDATION_ERROR', 'boom') }))
    await gotoHistory(page, AUDIT_KEY)
    await expect(page.locator("[data-state='history-error'][data-error-code='LOAD_FAILED']")).toBeVisible()
    await expect(page.locator("[data-action='retry']")).toBeVisible()
  })

  test('forbidden offers NO retry — a compliance reviewer must never wonder if the trail was lost', async ({
    page,
  }) => {
    await mockJson(page, PATH.configHistory, 'GET', () => ({
      status: 403,
      body: errorBody('FORBIDDEN', 'Reading configuration history requires an audit grant.'),
    }))
    await gotoHistory(page, AUDIT_KEY)
    const forbidden = page.locator("[data-error-code='FORBIDDEN']")
    await expect(forbidden).toBeVisible()
    await expect(
      forbidden.locator("xpath=ancestor-or-self::*[1]").locator("[data-action='retry']"),
      'FORBIDDEN is a decision, not a failure — it must offer no retry',
    ).toHaveCount(0)
  })
})

// ══════════════════════════════════════════════════════════════════════════
// Runtime console-clean gate (ui-runtime-validation, baseline §7.1)
// ══════════════════════════════════════════════════════════════════════════

test.describe('Configuration console — runtime console-clean gate (ui-runtime-validation)', () => {
  function trackConsole(page: Page) {
    const consoleErrors: string[] = []
    const failedRequests: string[] = []
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', err => consoleErrors.push(`pageerror: ${String(err)}`))
    page.on('requestfailed', (req: PWRequest) => {
      const url = req.url()
      if (url.includes('/v1/config') || url.includes('/v1/namespaces') || url.includes('/assets') || url.includes('/admin/config')) {
        failedRequests.push(`${req.method()} ${url} :: ${req.failure()?.errorText ?? 'failed'}`)
      }
    })
    return { consoleErrors, failedRequests }
  }

  test('settings editor (/config): clean console — 0 errors, 0 CSP/mixed-content, 0 failed app requests', async ({
    page,
  }) => {
    const { consoleErrors, failedRequests } = trackConsole(page)
    const def = keyDef({
      key: 'notifications.digest.frequency',
      valueType: 'enum',
      enumValues: ['hourly', 'daily', 'weekly'],
      defaultValue: 'daily',
      allowedScopes: ['platform', 'portal', 'org', 'user'],
    })
    await mockJson(page, PATH.config, 'GET', () => ({
      status: 200,
      body: effectiveConfig([entry({ key: 'notifications.digest.frequency', value: 'daily', source: ORG_SCOPE, definition: def })]),
    }))
    await gotoEditor(page)
    await expect(page.locator('[data-settings-form]')).toBeVisible()

    expect(consoleErrors, `console errors on /config:\n${consoleErrors.join('\n')}`).toEqual([])
    expect(failedRequests, `failed app requests on /config:\n${failedRequests.join('\n')}`).toEqual([])
  })

  test('key catalog (/admin/config/catalog): clean console', async ({ page }) => {
    const { consoleErrors, failedRequests } = trackConsole(page)
    await mockJson(page, PATH.keysList, 'GET', () => ({
      status: 200,
      body: paged([
        keyDef({
          key: 'notifications.digest.frequency',
          valueType: 'enum',
          enumValues: ['hourly', 'daily', 'weekly'],
          defaultValue: 'daily',
          allowedScopes: ['platform', 'portal', 'org', 'user'],
        }),
      ]),
    }))
    await gotoCatalog(page)
    await expect(page.locator('[data-catalog-table]')).toBeVisible()

    expect(consoleErrors, `console errors on /admin/config/catalog:\n${consoleErrors.join('\n')}`).toEqual([])
    expect(failedRequests, `failed app requests on /admin/config/catalog:\n${failedRequests.join('\n')}`).toEqual([])
  })

  test('audit history (/admin/config/keys/:key/history): clean console', async ({ page }) => {
    const { consoleErrors, failedRequests } = trackConsole(page)
    const KEY = 'notifications.digest.frequency'
    await mockJson(page, PATH.configHistory, 'GET', () => ({
      status: 200,
      body: {
        key: KEY,
        namespace: NAMESPACE,
        scope: ORG_SCOPE,
        entries: [
          {
            id: 1,
            op: 'set',
            value: 'daily',
            previousValue: null,
            actor: { scopeType: 'user', scopeId: 'usr_jokafor' },
            scope: ORG_SCOPE,
            reason: 'aligning with EU digest policy',
            createdAt: '2026-07-02T08:31:00.000Z',
            revertOf: null,
          },
        ],
      },
    }))
    await gotoHistory(page, KEY)
    await expect(page.locator('[data-audit-timeline]')).toBeVisible()

    expect(consoleErrors, `console errors on the history route:\n${consoleErrors.join('\n')}`).toEqual([])
    expect(failedRequests, `failed app requests on the history route:\n${failedRequests.join('\n')}`).toEqual([])
  })
})
