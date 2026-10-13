/**
 * Flag OFF: 4.0.0 behaviour with 4.1.0 shapes (SL9, design record §7 "Feature flag", §11.11).
 * Written against the FROZEN contract (openapi.yaml 4.1.0) and docs/planning/selection-lists-shared-and-fork.md §7:
 * while `fuzefront.selection-lists.shared-lists` is OFF the service answers exactly as 4.0.0 *in behaviour* while still
 * emitting 4.1.0 shapes — every list reports `visibility: "private"`, `forked_from: null`, every item
 * `origin_item_id: null`; `include_shared` / `visibility` query params are accepted and ignored; `POST …/fork` -> 404;
 * create / PATCH with a non-`private` visibility -> 400 VALIDATION_ERROR. Authorization never routes through the flag.
 *
 * HOW THE HARNESS RUNS THIS SUITE: a flag is process-wide, so it needs a SECOND service instance on the SAME database with
 * the shared-lists flag NOT forced on, reached through SHARED_LISTS_FLAG_OFF_URL (see helpers/shared-lists.ts). The main
 * instance (SERVICE_BASE_URL, flag ON) is used here only to WRITE the shared data the OFF instance must refuse to serve
 * (a common list, an `org` list, a fork), so the suite proves "OFF hides what ON created" and not merely "OFF has no data".
 * A missing / misconfigured OFF instance fails the suite with an explicit PRECONDITION message — it is never skipped.
 *
 * Design-record rows pinned (§11.11 + §7):
 *   shapes     visibility "private" / forked_from null / origin_item_id null for EVERY list and item the OFF instance returns —
 *              including rows that are `org` / fork rows in the database;
 *   params     include_shared / visibility accepted and IGNORED (same rows as without them; platform + org lists absent);
 *   fork       POST fork -> 404 (even for a readable common list and a never-existing id);
 *   writes     non-private visibility on create / PATCH -> 400; no `fork_required` (a mutation of someone else's list is the
 *              4.0.0 404);
 *   resolve    common ids are `missing` (4.0.0: another org's ids) and no effective_item_id is ever returned;
 *   key lookup 4.0.0 semantics: include_shared ignored.
 */
import {
  actor, addItem, assertSharedListsOff, assertSharedListsOn, call, createList, createPlatformList, expectError, FLAG_OFF_BASE_URL, PLATFORM_ORG_ID,
  forkList, L, newOrg, rnd, walkItems, walkLists, type Actor, type ListLike,
} from '../helpers/shared-lists';
import { assertResponse } from '../helpers/openapi';
import { closeDb } from '../helpers/db';

const OFF = FLAG_OFF_BASE_URL as string; // validated in beforeAll
const ORG_O = newOrg('off');
const owner = actor('own', ORG_O, 'admin');
const member = actor('mem', ORG_O, 'viewer');
const editor = actor('ed', ORG_O, 'editor');

let common: Awaited<ReturnType<typeof createPlatformList>>;
let orgList: ListLike;
let privList: ListLike;
let fork: any;
let forkItems: any[];

const off = <T = any>(who: Actor | null, method: string, path: string, body?: unknown) => call<T>(who, method, path, body, OFF);

beforeAll(async () => {
  await assertSharedListsOn(); // the ON instance writes the shared data...
  await assertSharedListsOff(FLAG_OFF_BASE_URL); // ...the OFF instance must refuse to serve it
  common = await createPlatformList({ itemCodes: ['A', 'B'], name: 'OFF common' });
  orgList = await createList(owner, { name: 'OFF org list', visibility: 'org' });
  privList = await createList(owner, { name: 'OFF private list' });
  const f = await forkList(owner, common.list.id);
  expect(f.status).toBe(201);
  fork = f.body;
  forkItems = await walkItems(owner, fork.id, 'all');
  expect(forkItems.every((i) => i.origin_item_id)).toBe(true); // ON data really is a fork
});
afterAll(async () => {
  await closeDb();
});

describe('shapes: 4.1.0 fields with the 4.0.0 values', () => {
  it('a list created through the OFF instance reports visibility "private", forked_from null, and conforms to the spec', async () => {
    const res = await off(owner, 'POST', '/v1/selection-lists', { key: `off-${rnd()}-${rnd()}`, name: 'OFF created' });
    expect(res.status).toBe(201);
    assertResponse('POST', '/v1/selection-lists', 201, res.body);
    expect(res.body.visibility).toBe('private');
    expect(res.body.forked_from).toBeNull();
    if ('editable' in res.body) expect(typeof res.body.editable).toBe('boolean');
    const item = await off(owner, 'POST', `${L(res.body.id)}/items`, { code: 'A', label: 'A' });
    expect(item.status).toBe(201);
    assertResponse('POST', '/v1/selection-lists/{listId}/items', 201, item.body);
    expect(item.body.origin_item_id).toBeNull();
  });

  it('rows that ARE org / fork rows in the database are reported as private / not-forked by the OFF instance', async () => {
    for (const l of [orgList, fork]) {
      const res = await off(owner, 'GET', L(l.id));
      expect(res.status).toBe(200); // the owner still reads its own lists (instance grant)
      assertResponse('GET', '/v1/selection-lists/{listId}', 200, res.body);
      expect({ id: l.id, visibility: res.body.visibility, forked_from: res.body.forked_from }).toEqual({ id: l.id, visibility: 'private', forked_from: null });
    }
    const items = await walkItems(owner, fork.id, 'all', OFF);
    expect(items.length).toBe(forkItems.length);
    for (const i of items) expect(i.origin_item_id).toBeNull();
    // control: the ON instance reports the real values for the same rows
    const on = await call(owner, 'GET', L(fork.id));
    expect(on.body).toMatchObject({ visibility: 'org', forked_from: { list_id: common.list.id } });
  });

  it('every row of the OFF listing reports visibility "private" and forked_from null', async () => {
    const rows = (await walkLists(owner, '', 50, OFF)).rows;
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining([orgList.id, privList.id, fork.id]));
    for (const r of rows) expect({ id: r.id, v: r.visibility, f: r.forked_from }).toEqual({ id: r.id, v: 'private', f: null });
  });
});

describe('include_shared / visibility are accepted and IGNORED', () => {
  const ids = (rows: ListLike[]) => rows.map((r) => r.id).sort();

  it('a member: include_shared=true / visibility=… return exactly what the plain request returns — no `org`, no common lists', async () => {
    const plain = ids((await walkLists(member, '', 50, OFF)).rows);
    for (const qs of ['include_shared=true', 'include_shared=true&visibility=platform', 'include_shared=true&visibility=org', 'visibility=org', 'include_shared=false']) {
      const res = await off(member, 'GET', `/v1/selection-lists?${qs}&limit=200`);
      expect({ qs, status: res.status }).toEqual({ qs, status: 200 });
      expect({ qs, ids: ids(res.body.items) }).toEqual({ qs, ids: plain });
    }
    expect(plain).not.toContain(orgList.id);
    expect(plain).not.toContain(common.list.id);
    // control: the same member through the ON instance DOES get them - the org list, and the org's fork in the common
    // list's place (the common list itself is shadowed by that fork)
    const on = (await walkLists(member, 'include_shared=true')).rows.map((r) => r.id);
    expect(on).toEqual(expect.arrayContaining([orgList.id, fork.id]));
    expect(on).not.toContain(common.list.id);
  });

  it('the owner: the visibility filter is ignored (private rows are still returned under visibility=platform)', async () => {
    const plain = ids((await walkLists(owner, '', 50, OFF)).rows);
    const filtered = ids((await walkLists(owner, 'include_shared=true&visibility=platform', 50, OFF)).rows);
    expect(filtered).toEqual(plain);
    expect(filtered).toContain(privList.id);
  });

  it('the parameters are ignored whatever their value (4.0.0 never looked at them): a legal and a junk visibility both return the plain listing', async () => {
    const plain = ids((await walkLists(owner, '', 50, OFF)).rows);
    for (const qs of ['visibility=org', 'visibility=public', 'include_shared=maybe']) {
      const res = await off(owner, 'GET', `/v1/selection-lists?${qs}&limit=200`);
      expect({ qs, status: res.status }).toEqual({ qs, status: 200 });
      expect({ qs, ids: ids(res.body.items) }).toEqual({ qs, ids: plain });
    }
  });

  it('key lookup keeps the 4.0.0 semantics: a member finds nothing for the common key even with include_shared=true; the owner finds its own fork', async () => {
    const m = await off(member, 'GET', `/v1/selection-lists?key=${common.list.key}&include_shared=true`);
    expect(m.body.items).toEqual([]);
    const o = await off(owner, 'GET', `/v1/selection-lists?key=${common.list.key}&include_shared=true`);
    expect(o.body.items.map((r: ListLike) => r.id)).toEqual([fork.id]);
    expect(o.body.items[0].organization_id).toBe(ORG_O); // never the common list
  });
});

describe('shared reads are off: 4.0.0 org scoping applies', () => {
  it('a member (no grant) gets 404 on the org list, the fork and the common list through the OFF instance — and 200 through ON', async () => {
    for (const l of [orgList, fork, common.list]) {
      expectError(await off(member, 'GET', L(l.id)), 404, 'NOT_FOUND');
      expectError(await off(member, 'GET', `${L(l.id)}/items`), 404, 'NOT_FOUND');
      expect({ id: l.id, on: (await call(member, 'GET', L(l.id))).status }).toEqual({ id: l.id, on: 200 });
    }
  });

  it('a mutation of the common list by a customer is the 4.0.0 404 — never 409 fork_required — while the platform operator keeps writing it', async () => {
    const res = await off(editor, 'PATCH', L(common.list.id), { name: 'x' });
    expectError(res, 404, 'NOT_FOUND');
    expect(res.body.reason).toBeUndefined();
    expect(res.body.fork_url).toBeUndefined();
    expect((await off(common.owner, 'PATCH', L(common.list.id), { name: 'OFF common (operator edit)' })).status).toBe(200); // org-scoped write by the owning org
  });
});

describe('fork is off: POST …/fork -> 404', () => {
  it('404 for a common list the caller can read through ON, for the caller\'s own list, and for a never-existing id', async () => {
    const readable = await forkList(editor, common.list.id, undefined, OFF);
    expectError(readable, 404, 'NOT_FOUND');
    expectError(await forkList(owner, orgList.id, undefined, OFF), 404, 'NOT_FOUND');
    expectError(await forkList(owner, 'front_sl_01sl9neverexisted00000', undefined, OFF), 404, 'NOT_FOUND');
    // control: the identical request through the ON instance works (so the 404 is the flag) — the org already holds
    // a fork of this source (made in beforeAll), so ON answers 200 with it
    const on = await forkList(editor, common.list.id);
    expect(on.status).toBe(200);
    expect(on.body.id).toBe(fork.id);
  });
});

describe('visibility writes are off: non-private visibility is 400', () => {
  it.each(['org', 'platform'])('create with visibility "%s" -> 400 VALIDATION_ERROR and nothing stored', async (v) => {
    const key = `offv-${rnd()}-${rnd()}`;
    const res = await off(owner, 'POST', '/v1/selection-lists', { key, name: 'x', visibility: v });
    expectError(res, 400, 'VALIDATION_ERROR');
    expect((await off(owner, 'POST', '/v1/selection-lists', { key, name: 'x' })).status).toBe(201); // control: the key was never taken
  });

  it('a platform operator through OFF cannot publish a common list either', async () => {
    const res = await off(common.owner, 'POST', '/v1/selection-lists', { key: `offp-${rnd()}-${rnd()}`, name: 'x', visibility: 'platform' });
    expectError(res, 400, 'VALIDATION_ERROR');
  });

  it.each(['org', 'platform'])('PATCH visibility "%s" -> 400 VALIDATION_ERROR and the list is unchanged', async (v) => {
    const l = await off(owner, 'POST', '/v1/selection-lists', { key: `offpatch-${rnd()}-${rnd()}`, name: 'Before' });
    const res = await off(owner, 'PATCH', L(l.body.id), { visibility: v, name: 'After' });
    expectError(res, 400, 'VALIDATION_ERROR');
    expect((await off(owner, 'GET', L(l.body.id))).body).toMatchObject({ name: 'Before', visibility: 'private' });
    expect((await off(owner, 'PATCH', L(l.body.id), { name: 'After' })).status).toBe(200); // control
  });
});

describe('resolve is off: common ids are missing, no redirect', () => {
  it('the common list\'s ids are `missing` for a customer (another org\'s ids, 4.0.0); the fork\'s own ids resolve; no effective_item_id ever', async () => {
    const commonIds = common.items.map((i) => i.id);
    const res = await off(member, 'POST', '/v1/resolve', { ids: [...commonIds, ...forkItems.map((i) => i.id)] });
    expect(res.status).toBe(200);
    expect([...res.body.missing].sort()).toEqual([...commonIds].sort());
    expect(Object.keys(res.body.results).sort()).toEqual(forkItems.map((i) => i.id).sort());
    for (const r of Object.values(res.body.results) as any[]) expect(r.effective_item_id).toBeUndefined();
    // control: through ON the same ids resolve, with the fork redirect
    const on = await call(member, 'POST', '/v1/resolve', { ids: commonIds });
    expect(on.body.missing).toEqual([]);
    expect(on.body.results[commonIds[0]].effective_item_id).toBeDefined();
  });
});

describe('authorization never routes through the flag', () => {
  it('the OFF instance still enforces the instance roles: a viewer member cannot mutate the owner\'s list, the owner can', async () => {
    const mine = await off(owner, 'POST', '/v1/selection-lists', { key: `offauthz-${rnd()}-${rnd()}`, name: 'Mine' });
    expect(mine.status).toBe(201);
    expectError(await off(member, 'PATCH', L(mine.body.id), { name: 'x' }), 403, 'FORBIDDEN'); // 4.0.0 (R7): a same-org write without a grant is 403
    expectError(await off(member, 'GET', L(mine.body.id)), 404, 'NOT_FOUND'); // ...while the read stays 404
    expect((await off(owner, 'PATCH', L(mine.body.id), { name: 'y' })).status).toBe(200);
    expect((await off(null, 'GET', L(mine.body.id))).status).toBe(401);
    const item = await addItem(owner, orgList.id, `Z${rnd()}`, 'z'); // ON write, to keep the ON/OFF split honest
    expect(item.origin_item_id).toBeNull();
  });
});

describe('the purge guard for common lists does NOT depend on the flag (service 1.1.0)', () => {
  it('an owner without publish_platform is refused the purge of a platform row through the flag-OFF instance too; the operator is not; archive stays the owner\'s', async () => {
    const p = await createPlatformList({ itemCodes: ['A', 'B'] });
    const lowOwner = actor('low', PLATFORM_ORG_ID, 'editor'); // platform-org editor: can own a list, never holds publish_platform
    expect((await call(p.owner, 'PUT', `${L(p.list.id)}/access/${lowOwner.userId}`, { role: 'list-owner' })).status).toBe(200);

    expectError(await off(lowOwner, 'DELETE', `${L(p.list.id)}/items/${p.items[0].id}?purge=true`), 403, 'FORBIDDEN');
    expectError(await off(lowOwner, 'DELETE', `${L(p.list.id)}?purge=true`), 403, 'FORBIDDEN');
    expect((await walkItems(p.owner, p.list.id, 'all')).map((i) => i.code).sort()).toEqual(['A', 'B']); // intact

    // controls: the reversible act needs no publish_platform; the operator (holds it, acts in the platform org) purges
    expect((await off(lowOwner, 'DELETE', `${L(p.list.id)}/items/${p.items[1].id}`)).status).toBe(200);
    expect((await off(p.owner, 'DELETE', `${L(p.list.id)}/items/${p.items[0].id}?purge=true`)).status).toBe(204);
    expect((await off(p.owner, 'DELETE', `${L(p.list.id)}?purge=true`)).status).toBe(204);
  });
});
