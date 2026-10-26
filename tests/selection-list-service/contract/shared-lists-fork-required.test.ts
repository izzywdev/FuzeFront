/**
 * "Fork required" — every per-list mutation on a common (`platform`) list the caller holds no instance role on
 * (SL9, D7). Written against the FROZEN contract (openapi.yaml 4.1.0: `409` declared on every per-list mutation,
 * `Error.reason` / `fork_url` / `source_list_id`, `ErrorReason`) and docs/planning/selection-lists-shared-and-fork.md.
 * Needs the shared-lists flag ON (helpers/shared-lists.ts).
 *
 * Design-record rows pinned (§11.6, D7, §4 "any mutation" row):
 *   - each per-list mutation (list update / archive / delete / purge, item create / update / reorder / archive /
 *     delete / purge, list + item translation upsert / delete, autofill) on a `platform` list owned by another org
 *     answers `409 CONFLICT` with `reason: fork_required`, `source_list_id` = the common list and a SAME-ORIGIN
 *     RELATIVE `fork_url` (`/v1/selection-lists/{id}/fork`) when the caller holds `SelectionListCatalog:create`;
 *   - the same request is `403 FORBIDDEN` (no reason, no fork_url) without `create`;
 *   - check order: an unreadable list is 404 FIRST (a `developer` cannot tell the list exists); readable-but-not-
 *     writable is 409/403 second;
 *   - access-management operations on a common list are ALWAYS 403 (not forkable);
 *   - nothing is changed and no event is emitted by a refused mutation;
 *   - the "no instance role" proviso: after forking, the SAME operations on the fork succeed (it is the caller's own
 *     list), and the platform operator who owns the common list performs them (200/204) — the positive controls.
 */
import {
  actor, call, createPlatformList, expectError, forkList, L, newOrg, PLATFORM_ORG_ID, assertSharedListsOn, walkItems,
  type Actor, type ItemLike, type PlatformListFixture,
} from '../helpers/shared-lists';
import { assertResponse } from '../helpers/openapi';
import { closeDb, dbQuery } from '../helpers/db';

const ORG_R = newOrg('frq');
const withCreate = actor('ed', ORG_R, 'editor'); // holds create (and list)
const adminWithCreate = actor('adm', ORG_R, 'admin');
const noCreate = actor('vw', ORG_R, 'viewer'); // can read a common list, cannot create
const noRead = actor('dev', ORG_R, 'developer'); // holds neither read_shared nor create

beforeAll(async () => {
  await assertSharedListsOn();
});
afterAll(async () => {
  await closeDb();
});

interface Op {
  name: string;
  method: string;
  /** the spec's own path template, to validate the 409 body against the operation's declared response */
  tpl: string;
  /** path + body from a fresh common list with items [A, B] (A has an fr translation and the list has an fr translation) */
  req: (p: PlatformListFixture, items: ItemLike[]) => { path: string; body?: unknown };
  /** the success status the owning operator gets (positive control) */
  ok: number;
}

const OPS: Op[] = [
  { name: 'updateSelectionList', method: 'PATCH', tpl: '/v1/selection-lists/{listId}', ok: 200, req: (p) => ({ path: L(p.list.id), body: { name: 'Changed' } }) },
  { name: 'deleteSelectionList (archive)', method: 'DELETE', tpl: '/v1/selection-lists/{listId}', ok: 200, req: (p) => ({ path: L(p.list.id) }) },
  { name: 'deleteSelectionList (purge)', method: 'DELETE', tpl: '/v1/selection-lists/{listId}', ok: 204, req: (p) => ({ path: `${L(p.list.id)}?purge=true` }) },
  { name: 'archiveSelectionList', method: 'POST', tpl: '/v1/selection-lists/{listId}/archive', ok: 200, req: (p) => ({ path: `${L(p.list.id)}/archive` }) },
  { name: 'createSelectionListItem', method: 'POST', tpl: '/v1/selection-lists/{listId}/items', ok: 201, req: (p) => ({ path: `${L(p.list.id)}/items`, body: { code: 'NEW', label: 'New' } }) },
  { name: 'reorderSelectionListItems', method: 'PUT', tpl: '/v1/selection-lists/{listId}/items/reorder', ok: 200, req: (p, it) => ({ path: `${L(p.list.id)}/items/reorder`, body: { item_ids: [it[1].id, it[0].id] } }) },
  { name: 'updateSelectionListItem', method: 'PATCH', tpl: '/v1/selection-lists/{listId}/items/{itemId}', ok: 200, req: (p, it) => ({ path: `${L(p.list.id)}/items/${it[0].id}`, body: { label: 'Changed' } }) },
  { name: 'deleteSelectionListItem (archive)', method: 'DELETE', tpl: '/v1/selection-lists/{listId}/items/{itemId}', ok: 200, req: (p, it) => ({ path: `${L(p.list.id)}/items/${it[0].id}` }) },
  { name: 'deleteSelectionListItem (purge)', method: 'DELETE', tpl: '/v1/selection-lists/{listId}/items/{itemId}', ok: 204, req: (p, it) => ({ path: `${L(p.list.id)}/items/${it[0].id}?purge=true` }) },
  { name: 'archiveSelectionListItem', method: 'POST', tpl: '/v1/selection-lists/{listId}/items/{itemId}/archive', ok: 200, req: (p, it) => ({ path: `${L(p.list.id)}/items/${it[0].id}/archive` }) },
  { name: 'upsertSelectionListTranslation', method: 'PUT', tpl: '/v1/selection-lists/{listId}/translations/{locale}', ok: 200, req: (p) => ({ path: `${L(p.list.id)}/translations/es`, body: { name: 'Cambiado' } }) },
  { name: 'deleteSelectionListTranslation', method: 'DELETE', tpl: '/v1/selection-lists/{listId}/translations/{locale}', ok: 204, req: (p) => ({ path: `${L(p.list.id)}/translations/fr` }) },
  { name: 'upsertSelectionListItemTranslation', method: 'PUT', tpl: '/v1/selection-lists/{listId}/items/{itemId}/translations/{locale}', ok: 200, req: (p, it) => ({ path: `${L(p.list.id)}/items/${it[0].id}/translations/es`, body: { label: 'Cambiado' } }) },
  { name: 'deleteSelectionListItemTranslation', method: 'DELETE', tpl: '/v1/selection-lists/{listId}/items/{itemId}/translations/{locale}', ok: 204, req: (p, it) => ({ path: `${L(p.list.id)}/items/${it[0].id}/translations/fr` }) },
  { name: 'autofillSelectionListTranslations', method: 'POST', tpl: '/v1/selection-lists/{listId}/translations/{locale}/autofill', ok: 200, req: (p) => ({ path: `${L(p.list.id)}/translations/de/autofill`, body: {} }) },
];

/** A fresh common list with items A, B and an fr translation on the list and on A. */
async function freshCommonList(): Promise<{ p: PlatformListFixture; items: ItemLike[] }> {
  const p = await createPlatformList({ itemCodes: ['A', 'B'] });
  expect((await call(p.owner, 'PUT', `${L(p.list.id)}/translations/fr`, { name: 'Commun' })).status).toBe(200);
  expect((await call(p.owner, 'PUT', `${L(p.list.id)}/items/${p.items[0].id}/translations/fr`, { label: 'Un' })).status).toBe(200);
  return { p, items: p.items };
}

async function snapshot(p: PlatformListFixture) {
  const list = await call(p.owner, 'GET', L(p.list.id));
  const items = await walkItems(p.owner, p.list.id, 'all');
  const tr = await call(p.owner, 'GET', `${L(p.list.id)}/translations`);
  const revs = await dbQuery<{ n: string }>(`SELECT count(*)::text AS n FROM event_outbox WHERE organization_id = $1 AND payload->>'listId' = $2`, [PLATFORM_ORG_ID, p.list.id]);
  return JSON.stringify({
    list: [list.body.name, list.body.status, list.body.updated_at],
    items: items.map((i) => [i.id, i.code, i.label, i.status, i.sort_order]),
    locales: tr.body.map((t: any) => t.locale),
    events: revs[0].n,
  });
}

describe('§11.6: a caller holding `create` gets 409 fork_required with fork_url + source_list_id', () => {
  it.each(OPS.map((o) => [o.name, o] as const))('%s', async (_n, op) => {
    const { p, items } = await freshCommonList();
    const before = await snapshot(p);
    const { path, body } = op.req(p, items);
    for (const who of [withCreate, adminWithCreate]) {
      const res = await call(who, op.method, path, body);
      expect({ who: who.role, status: res.status }).toEqual({ who: who.role, status: 409 });
      expectError(res, 409, 'CONFLICT', 'fork_required');
      assertResponse(op.method, op.tpl, 409, res.body);
      expect(res.body.source_list_id).toBe(p.list.id);
      expect(res.body.fork_url).toBe(`/v1/selection-lists/${p.list.id}/fork`);
      expect(res.body.fork_url).toMatch(/^\/v1\/selection-lists\/front_sl_[0-9a-z]+\/fork$/); // same-origin RELATIVE, never an absolute host
      expect(res.body.fork_url).not.toMatch(/^[a-z]+:\/\//i);
    }
    expect(await snapshot(p)).toBe(before); // refused = nothing changed, nothing emitted
  });

  it('the fork_url the error hands out is the real operation: following it yields the fork (201), after which the same call succeeds on the fork', async () => {
    const { p } = await freshCommonList();
    const refused = await call(withCreate, 'PATCH', L(p.list.id), { name: 'Our label' });
    expectError(refused, 409, 'CONFLICT', 'fork_required');
    const forked = await call(withCreate, 'POST', refused.body.fork_url);
    expect(forked.status).toBe(201);
    expect(forked.body.forked_from.list_id).toBe(refused.body.source_list_id);
    const retry = await call(withCreate, 'PATCH', L(forked.body.id), { name: 'Our label' });
    expect(retry.status).toBe(200);
    expect(retry.body.name).toBe('Our label');
    // and the common list kept its name
    expect((await call(p.owner, 'GET', L(p.list.id))).body.name).toBe(p.list.name);
  });
});

describe('§11.6: without `create` it is a plain 403 (no reason, no fork_url)', () => {
  it.each(OPS.map((o) => [o.name, o] as const))('%s', async (_n, op) => {
    const { p, items } = await freshCommonList();
    const before = await snapshot(p);
    const { path, body } = op.req(p, items);
    const res = await call(noCreate, op.method, path, body);
    expectError(res, 403, 'FORBIDDEN', null);
    expect(res.body.fork_url).toBeUndefined();
    expect(res.body.source_list_id).toBeUndefined();
    expect(await snapshot(p)).toBe(before);
    // control: the same viewer CAN read the list (so 403 is "readable but not writable", not an authz blanket)
    expect((await call(noCreate, 'GET', L(p.list.id))).status).toBe(200);
  });
});

describe('§11.6 / D7 check order: unreadable is 404 FIRST', () => {
  it.each(OPS.map((o) => [o.name, o] as const))('%s: a developer (no read_shared) gets 404, not 409/403', async (_n, op) => {
    const { p, items } = await freshCommonList();
    const { path, body } = op.req(p, items);
    const res = await call(noRead, op.method, path, body);
    expectError(res, 404, 'NOT_FOUND');
    expect(res.body.fork_url).toBeUndefined();
    // control: the same request from a caller who may read it is NOT 404
    expect((await call(withCreate, op.method, path, body)).status).toBe(409);
  });
});

describe('access management on a common list is always 403 (not forkable)', () => {
  it.each([
    ['listSelectionListAccess', 'GET', (p: PlatformListFixture) => `${L(p.list.id)}/access`, undefined],
    ['setSelectionListAccess', 'PUT', (p: PlatformListFixture) => `${L(p.list.id)}/access/${withCreate.userId}`, { role: 'list-owner' }],
    ['revokeSelectionListAccess', 'DELETE', (p: PlatformListFixture) => `${L(p.list.id)}/access/${p.owner.userId}`, undefined],
  ] as const)('%s: 403 for a caller WITH create (never 409 fork_required) and for one without', async (_n, method, path, body) => {
    const { p } = await freshCommonList();
    for (const who of [withCreate, adminWithCreate, noCreate] as Actor[]) {
      const res = await call(who, method, path(p), body);
      expectError(res, 403, 'FORBIDDEN', null);
      expect(res.body.fork_url).toBeUndefined();
    }
    expect((await call(noRead, method, path(p), body)).status).toBe(404); // unreadable first, as everywhere
    // control: the operator-owner holds manage_access and is served
    expect((await call(p.owner, 'GET', `${L(p.list.id)}/access`)).status).toBe(200);
  });
});

describe('the proviso "holds no instance role": positive controls', () => {
  it.each(OPS.map((o) => [o.name, o] as const))('%s: the operator who owns the common list performs it (not fork_required)', async (_n, op) => {
    const { p, items } = await freshCommonList();
    const { path, body } = op.req(p, items);
    const res = await call(p.owner, op.method, path, body);
    expect(res.status).toBe(op.ok);
    expect((res.body as any)?.reason).toBeUndefined();
  });

  it('after forking, every operation the caller was refused on the common list is allowed on the fork (their own list)', async () => {
    for (const op of OPS) {
      const { p, items } = await freshCommonList();
      const fork = await forkList(withCreate, p.list.id);
      expect(fork.status).toBe(201);
      const forkItems = await walkItems(withCreate, fork.body.id, 'all');
      // map the common list's items onto the fork's by code
      const mapped = items.map((i) => forkItems.find((f) => f.code === i.code)!);
      const { path, body } = op.req({ ...p, list: fork.body }, mapped);
      const res = await call(withCreate, op.method, path, body);
      expect({ op: op.name, status: res.status, reason: (res.body as any)?.reason }).toEqual({ op: op.name, status: op.ok, reason: undefined });
    }
  }, 120_000);
});
