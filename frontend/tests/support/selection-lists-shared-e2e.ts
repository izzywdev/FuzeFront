/**
 * Selection Lists — SHARED LISTS (SL9) e2e support: a contract-faithful, network-layer
 * stand-in for selection-list-service 4.1.0 plus the shell/session wiring the five
 * `selection-lists-shared-*.red.spec.ts` files share.
 *
 * Everything here is deterministic and backend-less (the `selection-list-service-e2e`
 * CI job serves a static `vite preview` build with no backend): the shell's
 * session/flags/org endpoints are mocked by `selection-lists-e2e-session.ts` (reused,
 * not forked) and the service is mocked here at the network layer with
 * `page.route`. The mock follows the FROZEN contract
 * `services/selection-list-service/openapi.yaml` (4.1.0):
 *
 *   - page envelope `{ items, page: { nextCursor, hasMore, total } }`
 *   - GET /v1/selection-lists: `include_shared`, `visibility`, `key`, `status`, `limit`,
 *     `cursor` — INCLUDING the service's own semantics for shadowing (a platform list
 *     whose key is shadowed by the caller's own readable active list is omitted unless
 *     a `visibility` filter is given) and for the effective-list lookup
 *     (`key` + `include_shared=true` -> a page of at most one row).
 *   - Error body `{ code, message, reason?, source_list_id?, fork_url?, scope?, limit?, current? }`
 *
 * The mock never decides anything the UI must decide: it only answers what the
 * service would. Tests override single endpoints with `api.use(on(...))`.
 *
 * Nothing in here is implementation-specific: no import from packages/selection-lists-ui.
 */
import { expect, type ConsoleMessage, type Locator, type Page, type Route } from '@playwright/test'
import {
  gotoFlagGatedRoute,
  isShellHarnessNoise,
  mockAuthenticatedSelectionListsSession,
  stubExternalFonts,
} from './selection-lists-e2e-session'

export { gotoFlagGatedRoute, stubExternalFonts }

// ── Flags ────────────────────────────────────────────────────────────────────

/** The release flag under test (default OFF). */
export const SHARED_LISTS_FLAG = 'fuzefront.selection-lists.shared-lists'
/** The parent flag that gates the whole selection-lists UI (stays ON in every spec). */
export const SERVICE_FLAG = 'fuzefront.selection-lists.service'

// ── Organizations (shell side) ───────────────────────────────────────────────

export interface ShellOrg {
  id: string
  name: string
  slug: string
  type: 'organization' | 'platform'
  user_role: string
}

/**
 * Wire (TypeID) organization ids. The shell's mocked organization id IS the wire id
 * (as in the existing selection-lists harness), so `list.organization_id === activeOrg.id`
 * is the comparison the frames describe ("the list's organization_id is the active org").
 */
export const ORGS = {
  platform: { id: 'org_01h455vb4pex5vsknk084sn00p', name: 'FuzeFront platform', slug: 'fuzefront-platform', type: 'platform', user_role: 'admin' },
  globex: { id: 'org_01h455vb4pex5vsknk084sn01g', name: 'Globex Freight', slug: 'globex-freight', type: 'organization', user_role: 'member' },
  acme: { id: 'org_01h455vb4pex5vsknk084sn02a', name: 'Acme Logistics', slug: 'acme-logistics', type: 'organization', user_role: 'admin' },
  initech: { id: 'org_01h455vb4pex5vsknk084sn03i', name: 'Initech', slug: 'initech', type: 'organization', user_role: 'member' },
} as const satisfies Record<string, ShellOrg>

/**
 * Session for the shared-lists specs: the existing selection-lists session mock
 * (token, /api/v1/security/session, app-registry, traces, fonts) with the flag map and
 * the active organization overridden. `sharedLists` is the flag under test.
 *
 * Routes registered later win in Playwright, so these overrides supersede the base
 * helper's hard-coded flag map and organization.
 */
export async function mockSharedListsSession(
  page: Page,
  opts: { sharedLists: boolean; org?: ShellOrg } = { sharedLists: true },
): Promise<ShellOrg> {
  const org = opts.org ?? ORGS.acme
  await mockAuthenticatedSelectionListsSession(page)
  await page.route('**/api/flags', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ flags: { [SERVICE_FLAG]: true, [SHARED_LISTS_FLAG]: opts.sharedLists } }),
    }),
  )
  await page.route('**/api/organizations', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ organizations: [org] }),
    }),
  )
  await page.route(`**/api/organizations/${org.id}/session-token`, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ token: 'e2e-shared-lists-org-token', tokenType: 'Bearer', expiresIn: 900, organizationId: org.id }),
    }),
  )
  // Shell background reads the base harness does not answer (the preview server's SPA
  // fallback would return HTML and the shell surfaces "Unexpected token '<'" as a toast
  // that overlays the page under test). Answered with their empty/zero shapes.
  const emptyJson = (body: unknown) => (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route('**/api/v1/security/session/workspaces', emptyJson({ workspaces: [] }))
  await page.route('**/api/v1/notifications/unread-count*', emptyJson({ unread: 0 }))
  await page.route('**/chat-api/chat/conversations*', emptyJson([]))
  return org
}

// ── Wire fixtures (selection-list-service 4.1.0) ─────────────────────────────

export interface WireForkedFrom {
  list_id: string
  organization_id: string
  revision: number
  forked_at: string
}

export interface WireList {
  id: string
  organization_id: string
  key: string
  source_locale: string
  status: 'active' | 'archived'
  name: string
  description?: string | null
  resolved_locale: string
  is_machine: boolean
  item_count?: number
  seed: null
  visibility?: 'private' | 'org' | 'platform'
  forked_from?: WireForkedFrom | null
  editable?: boolean
  created_by: string
  created_at: string
  updated_at: string
  /** Not wire: per-locale names the mock substitutes when the request asks for that locale. */
  _names?: Record<string, string>
  /** Not wire: SelectionList.revision (NOT in contract 4.1.0 — see the fork-provenance spec). */
  revision?: number
}

export interface WireItem {
  id: string
  list_id: string
  code: string
  sort_order: number
  status: 'active' | 'archived'
  label: string
  resolved_locale: string
  is_machine: boolean
  seed: null
  origin_item_id?: string | null
  created_by: string
  created_at: string
  updated_at: string
  /** Not wire: per-locale labels the mock substitutes when the request asks for that locale. */
  _labels?: Record<string, string>
}

const T0 = '2026-08-28T10:00:00Z'

export function makeList(over: Partial<WireList> & Pick<WireList, 'id' | 'key' | 'organization_id'>): WireList {
  return {
    source_locale: 'en',
    status: 'active',
    name: over.key,
    resolved_locale: 'en',
    is_machine: false,
    seed: null,
    created_by: 'usr_01h455vb4pex5vsknk084sn0aa',
    created_at: T0,
    updated_at: T0,
    ...over,
  }
}

export function makeItem(over: Partial<WireItem> & Pick<WireItem, 'id' | 'list_id' | 'code' | 'label'>): WireItem {
  return {
    sort_order: 1,
    status: 'active',
    resolved_locale: 'en',
    is_machine: false,
    seed: null,
    created_by: 'usr_01h455vb4pex5vsknk084sn0aa',
    created_at: T0,
    updated_at: T0,
    ...over,
  }
}

// Ids are taken from the approved frames so a reviewer can grep a hook value to a fixture.
export const COMMON_PRIORITY_ID = 'front_sl_01jf8k2m3n4p5q6r7s8t9v0w1x'
export const FORK_PRIORITY_ID = 'front_sl_01jfq3w8z6y5x4c3b2a1n9m8k7'
export const LEAD_SOURCES_ID = 'front_sl_01j9qk7m2x4c8e6g0h3n5r7tcc'
export const WAREHOUSE_ZONES_ID = 'front_sl_01j9qk7m2x4c8e6g0h3n5r7tcd'
export const YES_NO_ID = 'front_sl_01jf8k2m3n4p5q6r7s8t9v0wy1'
export const WORK_STATUS_ID = 'front_sl_01jf8k2m3n4p5q6r7s8t9v0ws1'
export const TICKET_CHANNEL_ID = 'front_sl_01jf8k2m3n4p5q6r7s8t9v0wtc'

/** The common Priority list's items (wa5 is archived). */
export const COMMON_ITEM_IDS = {
  low: 'front_sli_01jf8k2m3n4p5q6r7s8t9v0wa1',
  normal: 'front_sli_01jf8k2m3n4p5q6r7s8t9v0wa2',
  high: 'front_sli_01jf8k2m3n4p5q6r7s8t9v0wa3',
  urgent: 'front_sli_01jf8k2m3n4p5q6r7s8t9v0wa4',
  critical: 'front_sli_01jf8k2m3n4p5q6r7s8t9v0wa5',
} as const

/** The Acme fork of Priority (b6 is added in the fork: origin null). */
export const FORK_ITEM_IDS = {
  low: 'front_sli_01jfq3w8z6y5x4c3b2a1n9m8b1',
  medium: 'front_sli_01jfq3w8z6y5x4c3b2a1n9m8b2',
  high: 'front_sli_01jfq3w8z6y5x4c3b2a1n9m8b3',
  urgent: 'front_sli_01jfq3w8z6y5x4c3b2a1n9m8b4',
  blocker: 'front_sli_01jfq3w8z6y5x4c3b2a1n9m8b6',
} as const

export function commonPriorityList(over: Partial<WireList> = {}): WireList {
  return makeList({
    id: COMMON_PRIORITY_ID,
    key: 'priority',
    name: 'Priority',
    organization_id: ORGS.platform.id,
    visibility: 'platform',
    forked_from: null,
    editable: false,
    item_count: 4,
    created_by: 'system:selection-list-service',
    _names: { he: 'עדיפות', ar: 'الأولوية' },
    ...over,
  })
}

export function commonPriorityItems(): WireItem[] {
  const L = COMMON_PRIORITY_ID
  return [
    makeItem({ id: COMMON_ITEM_IDS.low, list_id: L, code: 'LOW', label: 'Low', sort_order: 1, _labels: { he: 'נמוכה', ar: 'منخفضة' } }),
    makeItem({ id: COMMON_ITEM_IDS.normal, list_id: L, code: 'NORMAL', label: 'Normal', sort_order: 2, _labels: { he: 'רגילה', ar: 'عادية' } }),
    makeItem({ id: COMMON_ITEM_IDS.high, list_id: L, code: 'HIGH', label: 'High', sort_order: 3, _labels: { he: 'גבוהה', ar: 'عالية' } }),
    makeItem({ id: COMMON_ITEM_IDS.urgent, list_id: L, code: 'URGENT', label: 'Urgent', sort_order: 4, _labels: { he: 'דחופה', ar: 'عاجلة' } }),
    makeItem({ id: COMMON_ITEM_IDS.critical, list_id: L, code: 'CRITICAL', label: 'Critical (legacy)', sort_order: 5, status: 'archived', _labels: { he: 'קריטית (ישן)', ar: 'حرجة (قديمة)' } }),
  ]
}

export function forkPriorityList(over: Partial<WireList> = {}): WireList {
  return makeList({
    id: FORK_PRIORITY_ID,
    key: 'priority',
    name: 'Priority',
    organization_id: ORGS.acme.id,
    visibility: 'org',
    forked_from: {
      list_id: COMMON_PRIORITY_ID,
      organization_id: ORGS.platform.id,
      revision: 7,
      forked_at: '2026-09-02T09:14:00Z',
    },
    editable: true,
    item_count: 5,
    created_at: '2026-09-02T09:14:00Z',
    updated_at: '2026-09-20T09:14:00Z',
    ...over,
  })
}

export function forkPriorityItems(): WireItem[] {
  const L = FORK_PRIORITY_ID
  return [
    makeItem({ id: FORK_ITEM_IDS.low, list_id: L, code: 'LOW', label: 'Low', sort_order: 1, origin_item_id: COMMON_ITEM_IDS.low }),
    makeItem({ id: FORK_ITEM_IDS.medium, list_id: L, code: 'NORMAL', label: 'Medium', sort_order: 2, origin_item_id: COMMON_ITEM_IDS.normal }),
    makeItem({ id: FORK_ITEM_IDS.high, list_id: L, code: 'HIGH', label: 'High', sort_order: 3, origin_item_id: COMMON_ITEM_IDS.high }),
    makeItem({ id: FORK_ITEM_IDS.urgent, list_id: L, code: 'URGENT', label: 'Urgent', sort_order: 4, origin_item_id: COMMON_ITEM_IDS.urgent }),
    makeItem({ id: FORK_ITEM_IDS.blocker, list_id: L, code: 'BLOCKER', label: 'Blocker', sort_order: 5, origin_item_id: null }),
  ]
}

// ── Service stand-in ─────────────────────────────────────────────────────────

export interface ApiCall {
  method: string
  /** Path with the `/api` prefix stripped: `/v1/selection-lists/...` or `/v1/resolve`. */
  path: string
  query: URLSearchParams
  /** Parsed JSON request body, or `undefined`. */
  body: any
  headers: Record<string, string>
  url: string
}

export interface ApiReply {
  status?: number
  body?: unknown
  /** Hold the response until this promise settles (drives the in-flight/"submitting" states). */
  wait?: Promise<unknown>
  delayMs?: number
  /** Simulate a network failure (the request never gets an answer). */
  abort?: boolean
}

export type ApiHandler = (call: ApiCall, world: World) => ApiReply | undefined | Promise<ApiReply | undefined>

export interface World {
  /** The caller's organization (wire id) — what the org-scoped token carries. */
  orgId: string
  lists: Map<string, WireList>
  items: Map<string, WireItem[]>
  /** Lists the caller holds an instance role on (4.0.0 visibility). */
  roles: Set<string>
  /** Index page size (cursor = offset). Unset = one page. */
  pageSize?: number
  /**
   * GET /v1/selection-lists/quota. DEFAULT = 403 (the caller lacks `read_quota`, a documented answer every
   * non-admin gets; the 4.0.0 index fails open on it). A spec that needs the usage numbers opts in with
   * `grantQuotaRead(world)`; see that function for why this is not 200 by default.
   */
  quota: ApiReply
  /** GET …/access per list. Unset = 403 (the caller holds no manage_access). */
  access: Map<string, ApiReply>
  /** POST /v1/resolve per item id (a ResolvedSelectionListItem). Unlisted ids are `missing`. */
  resolve: Map<string, Record<string, unknown>>
}

export function createWorld(orgId: string = ORGS.acme.id): World {
  return {
    orgId,
    lists: new Map(),
    items: new Map(),
    roles: new Set(),
    quota: err(403, 'FORBIDDEN'),
    access: new Map(),
    resolve: new Map(),
  }
}

/**
 * Quota the caller may read, in the WIRE envelope of `SelectionListQuotaStatus`
 * (openapi 4.1.0): `{ organization_id, quotas: [{ scope, applies_to, limit, current }] }`,
 * exactly four entries. org_lists 37 of 100: the fork dialog previews 37 -> 38.
 * Any legacy-shape normalization is the UI client's concern, never this network mock's.
 */
export function defaultQuota(orgId: string = ORGS.acme.id) {
  return {
    organization_id: orgId,
    quotas: [
      { scope: 'org_lists', applies_to: 'organization', limit: 100, current: 37 },
      { scope: 'user_lists', applies_to: 'user', limit: 25, current: 3 },
      { scope: 'list_items', applies_to: 'list', limit: 1000, current: null },
      { scope: 'list_locales', applies_to: 'list', limit: 11, current: null },
    ],
  }
}

/**
 * Let the caller read quota: GET /quota answers 200 with the real wire envelope.
 *
 * Not the default because the shipped 4.0.0 management index does `quota?.scopes.some(...)` on the response
 * (packages/selection-lists-ui `SelectionListManagementFlow.tsx`), and the real service sends `quotas` — so on
 * a 200 the 4.0.0 index throws a TypeError and unmounts. That is a product defect pinned by SL9-READ-018, and
 * it must not turn every index-based spec (or the READ-001 canary) red for a reason that is not "the new UI is
 * missing". The fork dialog's quota preview (SL9-FORK-024a) reads the wire envelope and opts in.
 */
export function grantQuotaRead(world: World): void {
  world.quota = json(200, defaultQuota(world.orgId))
}

export function addList(world: World, list: WireList, items: WireItem[] = [], opts: { role?: boolean } = {}): WireList {
  world.lists.set(list.id, list)
  world.items.set(list.id, items)
  if (opts.role) world.roles.add(list.id)
  return list
}

export const json = (status: number, body?: unknown): ApiReply => ({ status, body })

/** `ErrorCode` (openapi 4.1.0). There is deliberately no 5xx code: the contract documents none. */
export type ErrorCode = 'VALIDATION_ERROR' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'QUOTA_EXCEEDED'
/** `ErrorReason` (openapi 4.1.0). A client treats an unknown value as a plain CONFLICT — see the forward-compat specs. */
export type ErrorReason = 'fork_required' | 'fork_exists' | 'fork_not_applicable' | 'visibility_locked'

/**
 * Optional members of the contract `Error` object. `reason` is typed `string` ON PURPOSE: the contract says
 * "treat an unknown value as a plain CONFLICT", so the forward-compat specs send one (`some_future_reason`).
 * Likewise `scope` (`QuotaScope` is a closed enum in 4.1.0) and an absolute `fork_url` (the contract pattern is
 * same-origin relative) are sent out-of-contract ONLY by the specs that probe the client's tolerance of them.
 */
export interface ErrorExtras {
  reason?: ErrorReason | (string & {})
  source_list_id?: string
  fork_url?: string
  scope?: string
  limit?: number
  current?: number
  details?: Array<{ field: string; message: string }>
}

/** The service's single error shape (`Error`: `{ code, message, … }`). */
export function err(status: number, code: ErrorCode, extra: ErrorExtras = {}): ApiReply {
  return { status, body: { code, message: `${code} (mock)`, ...extra } }
}

/**
 * An unhandled server/gateway failure (5xx). The contract defines NO 5xx body and no `INTERNAL` code, so this
 * is NOT the `Error` envelope — it mirrors what the existing green selection-lists specs inject for a 500
 * (`{ "error": "boom" }`): a client must treat any 5xx body as opaque.
 */
export function fault(status: 500 | 502 | 503 | 504 = 500): ApiReply {
  return { status, body: { error: 'boom' } }
}

export const NOT_FOUND = err(404, 'NOT_FOUND')

/** `on('POST', '/v1/selection-lists/<id>/fork', call => json(201, fork))` */
export function on(
  method: string,
  path: string | RegExp,
  fn: (call: ApiCall, world: World) => ApiReply | Promise<ApiReply>,
): ApiHandler {
  return (call, world) => {
    if (call.method !== method) return undefined
    const hit = typeof path === 'string' ? call.path === path : path.test(call.path)
    return hit ? fn(call, world) : undefined
  }
}

/** Hold matching requests until `gate` settles, then let the default answer through. */
export function hold(method: string, path: string | RegExp, gate: Promise<unknown>, when?: (c: ApiCall) => boolean): ApiHandler {
  return async call => {
    if (call.method !== method) return undefined
    if (!(typeof path === 'string' ? call.path === path : path.test(call.path))) return undefined
    if (when && !when(call)) return undefined
    await gate
    return undefined
  }
}

/** Answer the first `times` matching requests with `reply`, then fall through to the defaults. */
export function failTimes(times: number, method: string, path: string | RegExp, reply: ApiReply, when?: (c: ApiCall) => boolean): ApiHandler {
  let left = times
  return call => {
    if (left <= 0 || call.method !== method) return undefined
    if (!(typeof path === 'string' ? call.path === path : path.test(call.path))) return undefined
    if (when && !when(call)) return undefined
    left -= 1
    return reply
  }
}

/**
 * A panel's state, accepting the frame's two equivalent shapes: `data-state` on the
 * `data-panel` element itself, or on a child state node inside it.
 */
export function panelState(page: Page, panel: string, state: string): Locator {
  return page
    .locator(`[data-panel='${panel}'][data-state='${state}'], [data-panel='${panel}'] [data-state='${state}']`)
    .first()
}

/**
 * Click a control that the frames declare. Asserts it is there FIRST, so a missing
 * control fails fast as "element(s) not found" on its hook instead of as a 30 s
 * actionability timeout inside click().
 */
export async function press(target: Locator, label?: string): Promise<void> {
  await expect(target, label ? `${label} must render` : undefined).toBeVisible()
  await target.click()
}

export function deferred<T = void>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>(r => {
    resolve = r
  })
  return { promise, resolve }
}

function acceptLocale(call: ApiCall): string {
  return call.query.get('locale') ?? (call.headers['accept-language'] ?? 'en').slice(0, 2).toLowerCase()
}

function wireList(list: WireList, call: ApiCall): Record<string, unknown> {
  const { _names, revision: _revision, ...wire } = list
  const loc = acceptLocale(call)
  const localized = _names?.[loc]
  const out: Record<string, unknown> = localized ? { ...wire, name: localized, resolved_locale: loc } : { ...wire }
  // `revision` is not in contract 4.1.0. It is only sent when a spec opts in via the list's
  // `revision` field (the contract-gated "behind source" specs); see fork-provenance spec.
  if (_revision !== undefined) out.revision = _revision
  return out
}

function wireItem(item: WireItem, call: ApiCall): Record<string, unknown> {
  const { _labels, ...wire } = item
  const loc = acceptLocale(call)
  const localized = _labels?.[loc]
  return localized ? { ...wire, label: localized, resolved_locale: loc } : { ...wire }
}

function pageOf<T>(rows: T[], call: ApiCall, pageSize?: number) {
  const limit = Number(call.query.get('limit') ?? 0) || undefined
  const size = pageSize ?? limit ?? rows.length
  const offset = Number(call.query.get('cursor') ?? 0) || 0
  const slice = rows.slice(offset, offset + (size || rows.length))
  const next = offset + slice.length
  const hasMore = next < rows.length
  return { items: slice, page: { nextCursor: hasMore ? String(next) : null, hasMore, total: rows.length } }
}

const visOf = (l: WireList) => l.visibility ?? 'private'

/** GET /v1/selection-lists — the contract's list/lookup semantics (include_shared, shadowing, key, visibility). */
function listIndex(call: ApiCall, world: World): ApiReply {
  const q = call.query
  const includeShared = q.get('include_shared') === 'true'
  const visibility = q.get('visibility')
  const key = q.get('key')
  const status = q.get('status') ?? 'active'
  const all = [...world.lists.values()]

  const own = all.filter(l => l.organization_id === world.orgId)
  const ownReadable = own.filter(l => world.roles.has(l.id) || (includeShared && visOf(l) === 'org'))
  const shadowKeys = new Set(ownReadable.filter(l => l.status === 'active').map(l => l.key))
  const platform = includeShared ? all.filter(l => visOf(l) === 'platform' && l.organization_id !== world.orgId) : []

  let rows = [...ownReadable, ...platform]
  if (key && includeShared) {
    // The effective list: the caller's own readable ACTIVE list with the key, else the ACTIVE platform list.
    const mine = ownReadable.find(l => l.key === key && l.status === 'active')
    const common = platform.find(l => l.key === key && l.status === 'active')
    rows = mine ? [mine] : common ? [common] : []
  } else {
    if (key) rows = rows.filter(l => l.key === key)
    if (!visibility) rows = rows.filter(l => !(visOf(l) === 'platform' && shadowKeys.has(l.key)))
    if (visibility) rows = rows.filter(l => visOf(l) === visibility)
    if (status !== 'all') rows = rows.filter(l => l.status === status)
  }
  const page = pageOf(rows, call, world.pageSize)
  return json(200, { items: page.items.map(l => wireList(l, call)), page: page.page })
}

const DEFAULT_HANDLERS: ApiHandler[] = [
  on('GET', '/v1/selection-lists', (call, world) => listIndex(call, world)),
  on('GET', '/v1/selection-lists/quota', (_c, world) => world.quota),
  on('GET', /^\/v1\/selection-lists\/[^/]+$/, (call, world) => {
    const list = world.lists.get(call.path.split('/')[3])
    return list ? json(200, wireList(list, call)) : NOT_FOUND
  }),
  on('GET', /^\/v1\/selection-lists\/[^/]+\/items$/, (call, world) => {
    const id = call.path.split('/')[3]
    if (!world.lists.has(id)) return NOT_FOUND
    const status = call.query.get('status') ?? 'active'
    const rows = (world.items.get(id) ?? [])
      .filter(i => status === 'all' || i.status === status)
      .sort((a, b) => a.sort_order - b.sort_order)
    const page = pageOf(rows, call, undefined)
    return json(200, { items: page.items.map(i => wireItem(i, call)), page: page.page })
  }),
  on('GET', /^\/v1\/selection-lists\/[^/]+\/access$/, (call, world) => world.access.get(call.path.split('/')[3]) ?? err(403, 'FORBIDDEN')),
  on('GET', /^\/v1\/selection-lists\/[^/]+\/translations$/, (call, world) => {
    const id = call.path.split('/')[3]
    if (!world.lists.has(id)) return NOT_FOUND
    return json(200, {
      locales: [
        { locale: 'en', is_source: true, translated: 5, total: 5, machine_count: 0, stale_count: 0 },
        { locale: 'fr', is_source: false, translated: 5, total: 5, machine_count: 2, stale_count: 0 },
        { locale: 'he', is_source: false, translated: 5, total: 5, machine_count: 0, stale_count: 0 },
      ],
    })
  }),
  on('GET', /^\/v1\/selection-lists\/[^/]+\/translations\/[a-z-]+$/, call => {
    const locale = call.path.split('/')[5]
    return json(200, {
      locale,
      translations: [
        { item_id: COMMON_ITEM_IDS.low, locale, label: locale === 'he' ? 'נמוכה' : 'Basse', is_machine: false, source_hash: 'h1', source_hash_current: 'h1' },
        { item_id: COMMON_ITEM_IDS.normal, locale, label: locale === 'he' ? 'רגילה' : 'Normale', is_machine: true, source_hash: 'h2', source_hash_current: 'h2' },
        { item_id: COMMON_ITEM_IDS.high, locale, label: locale === 'he' ? 'גבוהה' : 'Haute', is_machine: true, source_hash: 'h3', source_hash_current: 'h3' },
      ],
    })
  }),
  on('POST', '/v1/resolve', (call, world) => {
    const ids: string[] = call.body?.ids ?? []
    const results: Record<string, unknown> = {}
    const missing: string[] = []
    for (const id of ids) {
      const hit = world.resolve.get(id)
      if (hit) results[id] = hit
      else missing.push(id)
    }
    return json(200, { results, missing })
  }),
]

export interface Api {
  readonly world: World
  readonly calls: ApiCall[]
  /** Prepend an override (most recent first). */
  use(...handlers: ApiHandler[]): void
  callsTo(method: string, path: string | RegExp): ApiCall[]
}

/**
 * Mount the service stand-in on a page. Every request to `/api/v1/selection-lists…` and
 * `/api/v1/resolve` is recorded and answered; anything unhandled is a 404 NOT_FOUND
 * (what the service answers for an unknown route/list), never a pass-through to the
 * preview server's SPA fallback.
 */
export async function mountSelectionListApi(page: Page, world: World): Promise<Api> {
  const calls: ApiCall[] = []
  const overrides: ApiHandler[] = []

  await page.route(/\/api\/v1\/(selection-lists|resolve)(?:[/?]|$)/, async (route: Route) => {
    const req = route.request()
    const url = new URL(req.url())
    let body: any
    try {
      body = req.postData() ? JSON.parse(req.postData() as string) : undefined
    } catch {
      body = req.postData()
    }
    const call: ApiCall = {
      method: req.method(),
      path: url.pathname.replace(/^\/api/, '').replace(/\/+$/, '') || '/',
      query: url.searchParams,
      body,
      headers: req.headers(),
      url: req.url(),
    }
    calls.push(call)

    let reply: ApiReply | undefined
    for (const h of [...overrides, ...DEFAULT_HANDLERS]) {
      reply = await h(call, world)
      if (reply) break
    }
    reply ??= NOT_FOUND

    if (reply.wait) await reply.wait
    if (reply.delayMs) await new Promise(r => setTimeout(r, reply.delayMs))
    if (reply.abort) return route.abort('failed')
    const status = reply.status ?? 200
    return route.fulfill({
      status,
      contentType: 'application/json',
      // `_`-prefixed members (`_names`, `_labels`) are mock-only and never reach the wire, even when a spec
      // returns a fixture object as-is.
      body: status === 204 || reply.body === undefined ? '' : JSON.stringify(reply.body, (k, v) => (k.startsWith('_') ? undefined : v)),
    })
  })

  return {
    world,
    calls,
    use: (...handlers) => {
      overrides.unshift(...handlers)
    },
    callsTo: (method, path) =>
      calls.filter(c => c.method === method && (typeof path === 'string' ? c.path === path : path.test(c.path))),
  }
}

// ── Runtime health (console / page errors / same-origin API) ─────────────────

export interface ConsoleEntry {
  text: string
  /** The URL the message is attributed to (for "Failed to load resource" it is the request URL). */
  url: string
}

export interface Runtime {
  consoleErrors: ConsoleEntry[]
  pageErrors: string[]
  /** Absolute URLs of every request that left the page's origin toward an API path. */
  crossOriginApi: string[]
}

/**
 * Track what the browser reports while a spec runs. `pageErrors` (uncaught exceptions)
 * must be empty in EVERY spec — "never throw into the host". `consoleErrors` is only
 * asserted clean on success paths: Chromium logs every non-2xx fetch as a console error,
 * so the refusal specs would otherwise fail on the mocks they inject on purpose.
 */
export function trackRuntime(page: Page): Runtime {
  const rt: Runtime = { consoleErrors: [], pageErrors: [], crossOriginApi: [] }
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() !== 'error' || isShellHarnessNoise(msg)) return
    rt.consoleErrors.push({ text: msg.text(), url: msg.location().url ?? '' })
  })
  page.on('pageerror', e => rt.pageErrors.push(e.message))
  page.on('request', req => {
    const u = new URL(req.url())
    if (/\/(api\/)?v1\//.test(u.pathname) && u.origin !== new URL(page.url() === 'about:blank' ? req.url() : page.url()).origin) {
      rt.crossOriginApi.push(req.url())
    }
  })
  return rt
}

/** Chromium narrating a non-2xx answer: "Failed to load resource: the server responded with a status of 403 (Forbidden)". */
const HTTP_ERROR_STATUS = /Failed to load resource: the server responded with a status of ([45]\d\d)/

/** One non-2xx answer the harness injects on purpose and the page is EXPECTED to log (matched by status AND request path). */
export interface ExpectedRefusal {
  name: string
  status: number
  path: RegExp
}

/**
 * Refusals that are part of the harness itself, so a ready-state page logs them even when the UI is right.
 * Every `expectRuntimeClean` call tolerates exactly these (and nothing else) unless it passes its own `expected`.
 */
export const EXPECTED_REFUSALS: readonly ExpectedRefusal[] = [
  {
    // The default world answers GET /quota with 403 (no `read_quota`) — see `World.quota` / `grantQuotaRead`. The 4.0.0
    // management index requests it on mount and the fork dialog on open. TODO(SL9-READ-018): once the 4.0.0 client
    // reads the real `{organization_id, quotas}` envelope, serve it by default, delete this entry and the 403 default.
    name: 'quota read refused (default world)',
    status: 403,
    path: /\/v1\/selection-lists\/quota$/,
  },
  {
    // The 4.0.0 value editor probes reorder permission with `HEAD …/items/reorder` (`probeReorderPermission`). HEAD is not an
    // operation of the contract (reorder is PUT), so the service — like the mock — answers 404, and Chromium logs it.
    name: '4.0.0 reorder-permission probe (HEAD) answers 404',
    status: 404,
    path: /\/v1\/selection-lists\/[^/]+\/items\/reorder$/,
  },
]

/** The console errors that are NOT an expected refusal (what `expectRuntimeClean` asserts to be empty). */
export function unexpectedConsoleErrors(rt: Runtime, expected: readonly ExpectedRefusal[] = EXPECTED_REFUSALS): string[] {
  return rt.consoleErrors
    .filter(e => {
      const status = Number(HTTP_ERROR_STATUS.exec(e.text)?.[1])
      if (!status) return true
      let path = ''
      try {
        path = new URL(e.url).pathname.replace(/^\/api/, '')
      } catch {
        // unparseable attribution URL: it can match no rule, so it stays an error
      }
      return !expected.some(r => r.status === status && r.path.test(path))
    })
    .map(e => e.text)
}

/**
 * Strict by default: 0 uncaught exceptions, 0 console errors, same-origin API — except the harness' own
 * `EXPECTED_REFUSALS`. A spec that injects further refusals on a success path lists them in `expected`
 * (concatenate with `EXPECTED_REFUSALS`); `allowHttpErrors` tolerates every HTTP-status console error
 * (still failing on anything else: exceptions, CSP, mixed content, chunk-load errors).
 */
export function expectRuntimeClean(rt: Runtime, opts: { allowHttpErrors?: boolean; expected?: readonly ExpectedRefusal[] } = {}) {
  expect(rt.pageErrors, 'no uncaught exception may reach the page').toEqual([])
  const errs = opts.allowHttpErrors
    ? rt.consoleErrors.map(e => e.text).filter(m => !HTTP_ERROR_STATUS.test(m))
    : unexpectedConsoleErrors(rt, opts.expected ?? EXPECTED_REFUSALS)
  expect(errs, 'console must be clean (0 errors / 0 CSP / 0 mixed-content)').toEqual([])
  expect(rt.crossOriginApi, 'the API base is same-origin (no absolute API host)').toEqual([])
}

// ── Navigation + layout helpers ──────────────────────────────────────────────

/** Client-side navigation (keeps in-memory caches, unlike page.goto). */
export async function spaNavigate(page: Page, route: string): Promise<void> {
  await page.evaluate(target => {
    window.history.pushState({}, '', target)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, route)
}

/** Settle the flag fetch, then open a flag-gated shell route the way a signed-in user does. */
export async function openRoute(page: Page, route: string): Promise<void> {
  await gotoFlagGatedRoute(page, route)
}

/** Open the (public) embeddable-picker harness route. */
export async function openPicker(page: Page, params: Record<string, string> = {}): Promise<void> {
  const qs = new URLSearchParams(params).toString()
  await stubExternalFonts(page)
  await page.goto(`/embed/selection-list-picker${qs ? `?${qs}` : ''}`, { waitUntil: 'domcontentloaded' })
}

export async function expectNoHorizontalScroll(page: Page, label = 'page') {
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
  expect(m.sw, `${label}: no horizontal scroll (scrollWidth ${m.sw} <= innerWidth ${m.iw})`).toBeLessThanOrEqual(m.iw + 1)
}

export async function expectInViewport(page: Page, target: Locator, label: string) {
  const box = await target.boundingBox()
  const vp = page.viewportSize()
  expect(box, `${label}: has a layout box`).not.toBeNull()
  expect(vp, 'viewport is set').not.toBeNull()
  expect(box!.x, `${label}: starts inside the viewport`).toBeGreaterThanOrEqual(-1)
  expect(box!.y, `${label}: starts inside the viewport`).toBeGreaterThanOrEqual(-1)
  expect(box!.x + box!.width, `${label}: ends inside the viewport width`).toBeLessThanOrEqual(vp!.width + 1)
  expect(box!.y + box!.height, `${label}: ends inside the viewport height (no scrolling needed)`).toBeLessThanOrEqual(vp!.height + 1)
}

/** DS `--touch-target` (44 px). */
export const TOUCH_TARGET = 44

export async function expectTouchTarget(target: Locator, label: string) {
  const box = await target.boundingBox()
  expect(box, `${label}: has a layout box`).not.toBeNull()
  expect(box!.height, `${label}: >= ${TOUCH_TARGET}px tall`).toBeGreaterThanOrEqual(TOUCH_TARGET - 0.5)
}

export async function documentDir(page: Page): Promise<string> {
  return page.evaluate(() => document.documentElement.dir || getComputedStyle(document.documentElement).direction)
}

/** Computed bidi state of the element holding exactly `text`: an LTR island with isolation. */
export async function expectLtrIsland(page: Page, text: string, label: string) {
  const el = page.getByText(text, { exact: true }).first()
  await expect(el, `${label}: "${text}" is rendered`).toBeVisible()
  const css = await el.evaluate(n => {
    const s = getComputedStyle(n as Element)
    return { direction: s.direction, unicodeBidi: s.unicodeBidi, tag: (n as Element).tagName }
  })
  expect(css.direction, `${label}: "${text}" renders as an LTR island`).toBe('ltr')
  expect(css.unicodeBidi, `${label}: "${text}" is bidi-isolated`).toMatch(/isolate/)
}

/** The mobile device block used by every 375 px spec (Chromium; phone viewport, touch, DPR). */
export const MOBILE_375 = {
  // NOT `isMobile`: Chromium's mobile emulation widens the layout viewport to fit
  // overflowing content, so `innerWidth` would silently stop being 375 and every
  // "fits the viewport" assertion would pass vacuously.
  viewport: { width: 375, height: 812 },
  hasTouch: true,
  deviceScaleFactor: 3,
} as const

/** Frame 12's sheet viewport (375 x 667): "no scrolling" is asserted at this height. */
export const MOBILE_375_SHORT = { ...MOBILE_375, viewport: { width: 375, height: 667 } } as const

/** Role-agnostic text of a locator subtree, whitespace-collapsed. */
export async function textOf(target: Locator): Promise<string> {
  return ((await target.innerText()) ?? '').replace(/\s+/g, ' ').trim()
}
