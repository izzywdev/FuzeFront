/**
 * Helpers for the SL9 suites (shared / common lists + copy-on-write fork, contract 4.1.0;
 * design record docs/planning/selection-lists-shared-and-fork.md).
 *
 * HOW THE HARNESS TURNS THE FEATURE ON (CI / local)
 *   The feature is behind the release flag `fuzefront.selection-lists.shared-lists`
 *   (default OFF, design §7). Like the service flag, the harness turns it on with the one
 *   sanctioned CI mechanism, the offline OpenFeature provider (refused under NODE_ENV=production):
 *
 *     main service      FUZE_FLAGS_PROVIDER=offline
 *                       FUZE_FLAGS_OFFLINE_ON=fuzefront.selection-lists.service,fuzefront.selection-lists.shared-lists
 *                       SELECTION_LIST_PLATFORM_ORG_ID=org_01jpmf4z1yf88rpb9z9sd6pz00
 *     flag-OFF service  a SECOND instance on the SAME database, FUZE_FLAGS_PROVIDER=offline,
 *                       FUZE_FLAGS_OFFLINE_ON=fuzefront.selection-lists.service (shared-lists flag absent), same
 *                       SELECTION_LIST_PLATFORM_ORG_ID, on its own port; tests reach it through
 *                       SHARED_LISTS_FLAG_OFF_URL (suite: shared-lists-flag-off).
 *
 *   A flag is process-wide, so "both states" needs two processes; sharing the database is what lets
 *   the OFF suite prove that data written while ON is served as 4.0.0 while OFF.
 *
 *   The stand-in Security API learns the platform org with POST /__fixture/platform-org (done here,
 *   idempotently, by `declarePlatformOrg`) — no extra start-up env is required for it.
 *
 * PRECONDITION GUARDS: every flag-ON suite calls `assertSharedListsOn()` in beforeAll, which fails
 * with an explanatory message (not a confusing 400/404 cascade) if the service under test is not
 * running the feature. A red result caused by "feature not implemented / flag off" is therefore
 * recognisable as such.
 */
import { mintTestToken } from './auth';
import { rawFetch, SERVICE_BASE_URL } from './client';
import { canonicalUuid, testOrg, testUser } from './ids';
import { FAKE_SECURITY_URL } from './security-url';
import { PLATFORM_ORG_ID } from './sl9-constants';

export { PLATFORM_ORG_ID };

// Resolved in helpers/security-url.ts (SECURITY_SERVICE_URL by default; FAKE_SECURITY_URL only as an explicit override).
export { FAKE_SECURITY_URL };

/** Base URL of a second service instance running with the shared-lists flag OFF (see header). */
export const FLAG_OFF_BASE_URL: string | undefined = process.env['SHARED_LISTS_FLAG_OFF_URL'];

export const rnd = (): string => Math.random().toString(36).slice(2, 8).padEnd(6, '0');

/**
 * A fresh, per-run, codec-valid org / user TypeID (so reruns against one database never accumulate state in
 * an org). Minted through the identity package (helpers/ids.ts) from the tag plus a random part: a service
 * that names tenants and users to the Security API by their bare UUID refuses an id that does not decode.
 */
export const newOrg = (tag: string): string => testOrg(`sl9:${tag}:${rnd()}${rnd()}`);
export const newUser = (tag: string): string => testUser(`sl9:${tag}:${rnd()}${rnd()}`);

/**
 * Both renderings of ONE organization: its `org_…` TypeID and the bare UUID production tokens carry (the service accepts
 * either as the token's org claim). A fresh random org, minted codec-valid (helpers/ids.ts).
 */
export function newCodecOrg(): { wire: string; uuid: string } {
  const wire = newOrg('codec');
  return { wire, uuid: canonicalUuid(wire) };
}

/** The bare-UUID rendering of an `org_…` TypeID. */
export const orgUuidOf = (wire: string): string => canonicalUuid(wire);

export type TenantRole = 'admin' | 'editor' | 'viewer' | 'developer';

export interface Actor {
  userId: string;
  orgId: string;
  role: TenantRole;
  token: () => string;
}

/** An actor in `orgId` holding tenant role `role` (the stand-in Security API reads it from `roles`). */
export function actor(tag: string, orgId: string, role: TenantRole = 'admin'): Actor {
  const userId = newUser(tag);
  return { userId, orgId, role, token: () => mintTestToken({ userId, organizationId: orgId, roles: [role] }) };
}

export type Res<T = any> = { status: number; body: T };

/** Raw call as `who` (an Actor or a ready token), optionally against another service instance. */
export function call<T = any>(
  who: Actor | string | null,
  method: string,
  path: string,
  body?: unknown,
  baseUrl?: string,
): Promise<Res<T>> {
  const token = who === null ? undefined : typeof who === 'string' ? who : who.token();
  return rawFetch(path, {
    method,
    ...(token ? { token } : {}),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(baseUrl ? { baseUrl } : {}),
  }) as Promise<Res<T>>;
}

export const L = (id: string): string => `/v1/selection-lists/${encodeURIComponent(id)}`;

// ---------------------------------------------------------------------------
// stand-in Security API fixtures
// ---------------------------------------------------------------------------

async function fixture(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${FAKE_SECURITY_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status >= 300) throw new Error(`stand-in Security API ${path} -> ${res.status}`);
}

/** Tell the stand-in Security API which organization is the platform org (idempotent). */
export const declarePlatformOrg = (orgId: string = PLATFORM_ORG_ID): Promise<void> =>
  fixture('/__fixture/platform-org', { orgId });

/** Declare `subject` a non-member of `tenant` (answers `Organization:read` false), in either id rendering. */
export const declareNonMember = (tenant: string, subject: string): Promise<void> =>
  fixture('/__fixture/non-member', { tenant, subject });

/** Make the stand-in behave like bare Permit for `publish_platform` in ONE tenant (see its header). */
export const permitPublishAnywhere = (tenant: string): Promise<void> =>
  fixture('/__fixture/publish-anywhere', { tenant });

/** Grant an instance role behind the service's back (the operator path), in `tenant`. */
export const fixtureGrant = (tenant: string, subject: string, listId: string, role: string): Promise<void> =>
  fixture('/__fixture/grants', { tenant, subject, role, resource: { type: 'SelectionList', key: listId } });

// ---------------------------------------------------------------------------
// precondition guards
// ---------------------------------------------------------------------------

/**
 * Fail fast and legibly unless the service under test runs the shared-lists feature: a plain tenant
 * admin can create an `org`-visible list. With the flag OFF that is `400 VALIDATION_ERROR`
 * (design §7); on a 4.0.0 service it is `400` too (visibility is an unknown property).
 */
export async function assertSharedListsOn(baseUrl?: string): Promise<void> {
  const probe = actor('probe', newOrg('probe'), 'admin');
  const res = await call(probe, 'POST', '/v1/selection-lists', { key: `probe-${rnd()}`, name: 'flag probe', visibility: 'org' }, baseUrl);
  if (res.status !== 201 || res.body?.visibility !== 'org') {
    throw new Error(
      `PRECONDITION: the service at ${baseUrl ?? SERVICE_BASE_URL} does not run the shared-lists feature ` +
        `(POST visibility:"org" -> ${res.status} ${JSON.stringify(res.body)}). Either the feature is not implemented, or ` +
        `FUZE_FLAGS_OFFLINE_ON lacks fuzefront.selection-lists.shared-lists (see helpers/shared-lists.ts header).`,
    );
  }
  await declarePlatformOrg();
}

/** The mirror guard for the OFF suite: the instance must NOT run the feature. */
export async function assertSharedListsOff(baseUrl: string | undefined): Promise<void> {
  if (!baseUrl) {
    throw new Error(
      'PRECONDITION: SHARED_LISTS_FLAG_OFF_URL is not set. The flag-OFF suite needs a second service instance on the same ' +
        'database with fuzefront.selection-lists.shared-lists NOT forced on (see helpers/shared-lists.ts header).',
    );
  }
  const probe = actor('probe', newOrg('probeoff'), 'admin');
  const res = await call(probe, 'POST', '/v1/selection-lists', { key: `probe-${rnd()}`, name: 'flag probe', visibility: 'org' }, baseUrl);
  if (res.status === 201) {
    throw new Error(`PRECONDITION: the service at ${baseUrl} accepted visibility:"org" — the shared-lists flag is ON there, but this suite needs it OFF.`);
  }
  await declarePlatformOrg();
}

// ---------------------------------------------------------------------------
// fixtures through the public API
// ---------------------------------------------------------------------------

export interface ListLike {
  id: string;
  key: string;
  organization_id: string;
  visibility?: string;
  [k: string]: any;
}

/** Create a list as `who`; asserts 201 (a fixture failure must be loud, not a downstream confusion). */
export async function createList(who: Actor, over: Record<string, unknown> = {}, baseUrl?: string): Promise<ListLike> {
  const res = await call(who, 'POST', '/v1/selection-lists', { key: `sl9-${rnd()}-${rnd()}`, name: `SL9 ${rnd()}`, ...over }, baseUrl);
  if (res.status !== 201) throw new Error(`fixture: createList(${JSON.stringify(over)}) as ${who.role}@${who.orgId} -> ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as ListLike;
}

export interface ItemLike {
  id: string;
  list_id: string;
  code: string;
  label: string;
  status: string;
  sort_order: number;
  origin_item_id?: string | null;
  [k: string]: any;
}

export async function addItem(who: Actor, listId: string, code: string = `C${rnd()}`, label: string = `Label ${code}`, baseUrl?: string): Promise<ItemLike> {
  const res = await call(who, 'POST', `${L(listId)}/items`, { code, label }, baseUrl);
  if (res.status !== 201) throw new Error(`fixture: addItem(${listId}) -> ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as ItemLike;
}

/**
 * A platform operator: a tenant `admin` ACTING IN the platform org (token org = platform org).
 * Each caller gets its own user so per-user list quotas never interact.
 */
export const platformAdmin = (tag = 'padm'): Actor => actor(tag, PLATFORM_ORG_ID, 'admin');

export interface PlatformListFixture {
  list: ListLike;
  items: ItemLike[];
  owner: Actor;
}

/**
 * Publish a common list as a platform operator: `POST visibility:"platform"` in the platform org
 * (design D5), then `itemCodes.length` items. Throws a legible fixture error if publishing fails.
 */
export async function createPlatformList(
  opts: { key?: string; itemCodes?: string[]; name?: string; owner?: Actor; extra?: Record<string, unknown> } = {},
): Promise<PlatformListFixture> {
  const owner = opts.owner ?? platformAdmin();
  const list = await createList(owner, {
    key: opts.key ?? `plat-${rnd()}-${rnd()}`,
    name: opts.name ?? `Common ${rnd()}`,
    visibility: 'platform',
    ...(opts.extra ?? {}),
  });
  if (list.visibility !== 'platform' || list.organization_id !== PLATFORM_ORG_ID) {
    throw new Error(`fixture: platform list came back ${JSON.stringify({ visibility: list.visibility, organization_id: list.organization_id })}`);
  }
  const items: ItemLike[] = [];
  for (const code of opts.itemCodes ?? ['A', 'B']) items.push(await addItem(owner, list.id, code, `Common ${code} ${rnd()}`));
  return { list, items, owner };
}

/** Fork `listId` as `who`. */
export const forkList = (who: Actor | string | null, listId: string, body?: unknown, baseUrl?: string): Promise<Res> =>
  call(who, 'POST', `${L(listId)}/fork`, body, baseUrl);

// ---------------------------------------------------------------------------
// reading helpers
// ---------------------------------------------------------------------------

/** Walk `GET /v1/selection-lists?<query>` to the end with the opaque cursor; returns every row, in order. */
export async function walkLists(who: Actor, query: string, limit = 50, baseUrl?: string): Promise<{ rows: ListLike[]; pages: number }> {
  const rows: ListLike[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const qs: string = `${query}${query ? '&' : ''}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res: Res = await call(who, 'GET', `/v1/selection-lists?${qs}`, undefined, baseUrl);
    if (res.status !== 200) throw new Error(`walkLists(${qs}) -> ${res.status} ${JSON.stringify(res.body)}`);
    rows.push(...(res.body.items as ListLike[]));
    cursor = res.body.page.nextCursor as string | null;
    pages++;
    if (pages > 500) throw new Error('walkLists did not terminate');
  } while (cursor);
  return { rows, pages };
}

/**
 * Walk all items of a list (`status` 'all' by default: active then archived), returning every row.
 *
 * NOTE: 'all' is composed from two `status=active` / `status=archived` walks on purpose. The frozen
 * contract lists `all` as a valid items `status` filter, but master's `GET …/items?status=all` answers
 * 400 (pre-existing defect, pinned as an `it.failing` in contract/request-validation.test.ts), and the SL9
 * suites must not turn red for an unrelated reason.
 */
export async function walkItems(who: Actor, listId: string, status = 'all', baseUrl?: string): Promise<ItemLike[]> {
  if (status === 'all') {
    return [...(await walkItems(who, listId, 'active', baseUrl)), ...(await walkItems(who, listId, 'archived', baseUrl))];
  }
  const rows: ItemLike[] = [];
  let cursor: string | null = null;
  let guard = 0;
  do {
    const qs: string = `status=${status}&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res: Res = await call(who, 'GET', `${L(listId)}/items?${qs}`, undefined, baseUrl);
    if (res.status !== 200) throw new Error(`walkItems(${listId}) -> ${res.status} ${JSON.stringify(res.body)}`);
    rows.push(...(res.body.items as ItemLike[]));
    cursor = res.body.page.nextCursor as string | null;
    if (++guard > 100) throw new Error('walkItems did not terminate');
  } while (cursor);
  return rows;
}

/** The single effective row for `key` (`GET ?key=&include_shared=true`) or undefined. */
export async function effectiveList(who: Actor, key: string): Promise<ListLike | undefined> {
  const res = await call(who, 'GET', `/v1/selection-lists?key=${encodeURIComponent(key)}&include_shared=true&status=active`);
  if (res.status !== 200) throw new Error(`effectiveList(${key}) -> ${res.status} ${JSON.stringify(res.body)}`);
  expectAtMost(res.body.items.length, 1, 'the effective-list lookup returns at most one row');
  return res.body.items[0];
}

function expectAtMost(n: number, max: number, msg: string): void {
  if (n > max) throw new Error(`${msg}: got ${n}`);
}

/** Assert an Error-envelope response of the given status/code (and optional reason). */
export function expectError(res: Res, status: number, code: string, reason?: string | null): void {
  expect(res.status).toBe(status);
  expect(res.body).toMatchObject({ code });
  if (reason === null) expect((res.body as any).reason).toBeUndefined();
  else if (reason !== undefined) expect((res.body as any).reason).toBe(reason);
}

// ---------------------------------------------------------------------------
// SQL fixtures for rows the API refuses to create (untrusted data)
// ---------------------------------------------------------------------------

/**
 * Insert a `platform`-visibility list (with one active item) owned by `ownerOrgId` straight into the service's own
 * tables (4.0.0 columns + `visibility`). The API only lets the CONFIGURED platform org own such a row, so this is how
 * a suite plants "a platform row anywhere else": untrusted data that must never be served.
 */
export async function insertPlatformRowViaSql(
  ownerOrgId: string,
  key: string = `sql-${rnd()}-${rnd()}`,
): Promise<{ id: string; key: string; itemId: string }> {
  const { dbQuery } = await import('./db');
  const id = `front_sl_sl9sql${rnd()}${rnd()}`;
  const itemId = `front_sli_sl9sql${rnd()}${rnd()}`;
  await dbQuery(
    `INSERT INTO selection_lists (id, organization_id, key, source_locale, status, created_by, visibility)
     VALUES ($1, $2, $3, 'en', 'active', 'system:selection-list-service', 'platform')`,
    [id, ownerOrgId, key],
  );
  await dbQuery(`INSERT INTO selection_list_translations (list_id, locale, name, is_machine) VALUES ($1, 'en', 'Planted common list', false)`, [id]);
  await dbQuery(
    `INSERT INTO selection_list_items (id, list_id, code, sort_order, status, created_by) VALUES ($1, $2, 'P1', 100, 'active', 'system:selection-list-service')`,
    [itemId, id],
  );
  await dbQuery(`INSERT INTO selection_list_item_translations (item_id, locale, label, is_machine) VALUES ($1, 'en', 'Planted item', false)`, [itemId]);
  return { id, key, itemId };
}
