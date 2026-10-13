/**
 * Copy-on-write fork — `POST /v1/selection-lists/{listId}/fork` (SL9, D6).
 * Written against the FROZEN contract (openapi.yaml 4.1.0, `forkSelectionList`, `SelectionListForkRequest`,
 * `SelectionListForkProvenance`) and docs/planning/selection-lists-shared-and-fork.md. Needs the shared-lists
 * flag ON (helpers/shared-lists.ts). The 5000-item cap lives in shared-lists-fork-size.test.ts.
 *
 * Design-record rows pinned (§11.5):
 *   201      a new fork: same `key`, caller = list-owner, `forked_from {list_id, organization_id, revision,
 *            forked_at}`, `seed: null`, `created_by` = caller, `visibility` from the body (default `org`,
 *            `private` allowed, never `platform`); copies the list text + every list translation and every
 *            NON-PURGED item (active AND archived) with code / status / sort_order / source text / every item
 *            translation incl. `is_machine` + `source_hash`, each item under a NEW id with `origin_item_id`.
 *   200      repeat (idempotent per (org, source), any status) when the caller can read the fork; nothing copied.
 *   409      `fork_exists` (the fork exists and the caller cannot read it); `fork_not_applicable` (own-org
 *            source); a different list already holding the key = plain `CONFLICT` (no `reason`).
 *   403      `QUOTA_EXCEEDED` (`org_lists`, `list_items`) — atomically: nothing is created.
 *   400      body with `id` (and any other undeclared property / invalid visibility): identifier standard —
 *            the service mints every id; additionalProperties:false.
 *   404      unreadable source (other org's list, private list of the platform org, never-existed id).
 *   authz    `SelectionListCatalog:create` + read on the source: a viewer (no `create`) gets 403.
 * Also: concurrency (parallel forks of one source create exactly one fork), copy-on-write independence, and the
 * data-contract `keep` policy for provenance references: purging / archiving the SOURCE leaves forks untouched
 * (`forked_from` keeps naming the purged id; the fork's own ids keep resolving, the purged common ids go `missing`).
 */
import {
  actor, addItem, call, createList, createPlatformList, expectError, forkList, L, newOrg, PLATFORM_ORG_ID, rnd,
  assertSharedListsOn, walkItems, walkLists, effectiveList, type ItemLike, type PlatformListFixture,
} from '../helpers/shared-lists';
import { FORK_QUOTA_ITEMS_ORG_ID, FORK_QUOTA_LISTS_ORG_ID } from '../helpers/sl9-constants';
import { assertResponse } from '../helpers/openapi';
import { closeDb, dbQuery } from '../helpers/db';

const ORG_F = newOrg('frk');
const ORG_G = newOrg('frg');
const A1 = actor('a1', ORG_F, 'admin'); // forks the rich source in the first describe, becomes that fork's list-owner
// Every OTHER test gets a fresh admin of the same org: `user_lists` caps one user at 20 active lists and this suite
// makes dozens of forks, so a shared user would hit QUOTA_EXCEEDED for reasons unrelated to what is under test.
let A = actor('a', ORG_F, 'admin');
beforeEach(() => {
  A = actor('a', ORG_F, 'admin');
});
const E2 = actor('e2', ORG_F, 'editor'); // holds `create`, no instance grant
const V = actor('v', ORG_F, 'viewer'); // no `create`
const G = actor('g', ORG_G, 'admin'); // a different customer org

const FORK_PATH = '/v1/selection-lists/{listId}/fork';

/** A rich common list: 4 items (A, B, C, D); B archived, D purged; human + machine translations on list and items. */
let src: PlatformListFixture;
let srcItemsByCode: Map<string, ItemLike>;
let srcRevisionAtFork: number;

beforeAll(async () => {
  await assertSharedListsOn();
  src = await createPlatformList({ itemCodes: ['A', 'B', 'C', 'D'], name: 'Rich common list' });
  const op = src.owner;
  const [a, b, , d] = src.items;
  expect((await call(op, 'PATCH', L(src.list.id), { description: 'Source description' })).status).toBe(200);
  expect((await call(op, 'PUT', `${L(src.list.id)}/translations/fr`, { name: 'Liste riche', description: 'Description fr' })).status).toBe(200);
  expect((await call(op, 'PUT', `${L(src.list.id)}/items/${a.id}/translations/fr`, { label: 'A en francais' })).status).toBe(200);
  expect((await call(op, 'POST', `${L(src.list.id)}/translations/de/autofill`, {})).status).toBe(200); // machine rows (list + items)
  expect((await call(op, 'DELETE', `${L(src.list.id)}/items/${b.id}`)).status).toBe(200); // archive B
  expect((await call(op, 'DELETE', `${L(src.list.id)}/items/${d.id}?purge=true`)).status).toBe(204); // purge D
  const items = await walkItems(op, src.list.id, 'all');
  srcItemsByCode = new Map(items.map((i) => [i.code, i]));
  expect([...srcItemsByCode.keys()].sort()).toEqual(['A', 'B', 'C']);
  // the highest revision the source has emitted so far = its revision when forked (nothing changes it before the fork)
  const rev = await dbQuery<{ r: string | null }>(
    `SELECT max((payload->>'listRevision')::int)::text AS r FROM event_outbox WHERE organization_id = $1 AND payload->>'listId' = $2`,
    [PLATFORM_ORG_ID, src.list.id],
  );
  srcRevisionAtFork = Number(rev[0]?.r);
});
afterAll(async () => {
  await closeDb();
});

describe('201: the first fork copies everything and records provenance', () => {
  let fork: any;

  beforeAll(async () => {
    const res = await forkList(A1, src.list.id);
    expect(res.status).toBe(201);
    fork = res.body;
  });

  it('conforms to the spec and carries the fork fields', () => {
    assertResponse('POST', FORK_PATH, 201, fork);
    expect(fork.id).toMatch(/^front_sl_[0-9a-z]+$/);
    expect(fork.id).not.toBe(src.list.id); // minted by the service
    expect(fork).toMatchObject({
      organization_id: ORG_F,
      key: src.list.key,
      visibility: 'org', // default
      status: 'active',
      seed: null,
      created_by: A1.userId,
      source_locale: src.list.source_locale,
      name: src.list.name,
      description: 'Source description',
      item_count: 2, // A and C - B is archived, D was purged
      editable: true,
    });
  });

  it('forked_from names the source list, its org and its revision at the moment of copying', () => {
    expect(fork.forked_from).toMatchObject({ list_id: src.list.id, organization_id: PLATFORM_ORG_ID });
    expect(Number.isInteger(fork.forked_from.revision)).toBe(true);
    expect(fork.forked_from.revision).toBe(srcRevisionAtFork);
    expect(Math.abs(Date.now() - Date.parse(fork.forked_from.forked_at))).toBeLessThan(5 * 60_000);
  });

  it('copies every NON-PURGED item (active and archived) under NEW ids with origin_item_id, preserving code / status / sort_order / label', async () => {
    const items = await walkItems(A1, fork.id, 'all');
    expect(items.map((i) => i.code).sort()).toEqual(['A', 'B', 'C']); // D (purged) is not copied
    for (const copy of items) {
      const origin = srcItemsByCode.get(copy.code)!;
      expect(copy.id).toMatch(/^front_sli_[0-9a-z]+$/);
      expect(copy.id).not.toBe(origin.id);
      expect(copy.list_id).toBe(fork.id);
      expect(copy.origin_item_id).toBe(origin.id);
      expect({ code: copy.code, status: copy.status, sort_order: copy.sort_order, label: copy.label }).toEqual({
        code: origin.code, status: origin.status, sort_order: origin.sort_order, label: origin.label,
      });
      expect(copy.seed).toBeNull();
      expect(copy.created_by).toBe(A1.userId);
    }
    expect(items.find((i) => i.code === 'B')!.status).toBe('archived'); // archived items keep a mapping
    // the source side is untouched: its items are not "forked items"
    for (const orig of await walkItems(src.owner, src.list.id, 'all')) expect(orig.origin_item_id).toBeNull();
  });

  it('copies the list translations and every item translation with is_machine and source_hash preserved', async () => {
    const listTr = (id: string) =>
      dbQuery('SELECT locale, name, description, source_hash, is_machine FROM selection_list_translations WHERE list_id = $1 ORDER BY locale', [id]);
    const srcListTr = await listTr(src.list.id);
    const forkListTr = await listTr(fork.id);
    expect(srcListTr.map((r) => r.locale)).toEqual(expect.arrayContaining(['en', 'fr', 'de']));
    expect(srcListTr.some((r) => r.is_machine === true) && srcListTr.some((r) => r.is_machine === false)).toBe(true); // non-vacuous: both kinds exist
    expect(forkListTr).toEqual(srcListTr);

    const itemTr = (listId: string) =>
      dbQuery(
        `SELECT i.code, t.locale, t.label, t.description, t.source_hash, t.is_machine
           FROM selection_list_item_translations t JOIN selection_list_items i ON i.id = t.item_id
          WHERE i.list_id = $1 ORDER BY i.code, t.locale`,
        [listId],
      );
    const srcItemTr = (await itemTr(src.list.id)).filter((r) => r.code !== 'D');
    const forkItemTr = await itemTr(fork.id);
    expect(srcItemTr.some((r) => r.is_machine === true) && srcItemTr.some((r) => r.is_machine === false)).toBe(true);
    expect(srcItemTr.length).toBeGreaterThan(3);
    expect(forkItemTr).toEqual(srcItemTr);

    // and the same through the API: the translation workbench of the fork mirrors the source's
    const apiSrc = (await call(src.owner, 'GET', `${L(src.list.id)}/translations`)).body;
    const apiFork = (await call(A1, 'GET', `${L(fork.id)}/translations`)).body;
    const view = (rows: any[]) => rows.map((r) => [r.locale, r.machine_translated]).sort();
    expect(view(apiFork)).toEqual(view(apiSrc));
  });

  it('the caller is the fork\'s list-owner (and only the caller)', async () => {
    const roster = await call(A1, 'GET', `${L(fork.id)}/access`);
    expect(roster.status).toBe(200);
    expect(roster.body.items.map((g: any) => [g.user_id, g.role])).toEqual([[A1.userId, 'list-owner']]);
    expect((await call(A1, 'PATCH', L(fork.id), { name: 'Our version' })).status).toBe(200);
  });

  it('the fork is an `org` list: members read it, but only the owner writes (members: 403, not fork_required)', async () => {
    expect((await call(V, 'GET', L(fork.id))).status).toBe(200);
    const denied = await call(V, 'PATCH', L(fork.id), { name: 'nope' });
    expectError(denied, 403, 'FORBIDDEN');
    expect(denied.body.reason).toBeUndefined();
  });

  it('copy-on-write: edits to the fork do not touch the source, and edits to the source do not reach the fork', async () => {
    const forkA = (await walkItems(A1, fork.id, 'all')).find((i) => i.code === 'A')!;
    const srcA = srcItemsByCode.get('A')!;
    expect((await call(A1, 'PATCH', `${L(fork.id)}/items/${forkA.id}`, { label: 'Fork-only label' })).status).toBe(200);
    expect((await walkItems(src.owner, src.list.id, 'all')).find((i) => i.code === 'A')!.label).toBe(srcA.label);
    expect((await call(src.owner, 'PATCH', `${L(src.list.id)}/items/${srcA.id}`, { label: 'Source-only label' })).status).toBe(200);
    expect((await walkItems(A1, fork.id, 'all')).find((i) => i.code === 'A')!.label).toBe('Fork-only label');
    // and the fork can add what the source does not have; the source gets no such item
    await addItem(A1, fork.id, 'EXTRA');
    expect((await walkItems(src.owner, src.list.id, 'all')).map((i) => i.code)).not.toContain('EXTRA');
    expect((await walkItems(A1, fork.id, 'all')).find((i) => i.code === 'EXTRA')!.origin_item_id).toBeNull(); // added later => no origin
  });

  it('a body {visibility:"private"} makes a draft fork', async () => {
    const other = await createPlatformList({ itemCodes: ['X'] });
    const res = await forkList(A1, other.list.id, { visibility: 'private' });
    expect(res.status).toBe(201);
    expect(res.body.visibility).toBe('private');
    expect((await call(V, 'GET', L(res.body.id))).status).toBe(404); // a draft is not shared with members
  });
});

describe('on-delete of the SOURCE (data-contract: provenance references are `keep`) — forks outlive their source', () => {
  it('purging the common list leaves the fork intact: forked_from keeps naming the purged id, items keep their origin_item_id, the fork still reads, resolves and edits', async () => {
    const p = await createPlatformList({ itemCodes: ['A', 'B'] });
    const mk = await forkList(A, p.list.id);
    expect(mk.status).toBe(201);
    const before = await walkItems(A, mk.body.id, 'all');
    expect((await call(p.owner, 'DELETE', `${L(p.list.id)}?purge=true`)).status).toBe(204);
    expect((await call(A, 'GET', L(p.list.id))).status).toBe(404); // control: the source really is gone
    const after = await call(A, 'GET', L(mk.body.id));
    expect(after.status).toBe(200);
    expect(after.body.forked_from).toMatchObject({ list_id: p.list.id, organization_id: PLATFORM_ORG_ID }); // dangling provenance is legal
    const items = await walkItems(A, mk.body.id, 'all');
    expect(items.map((i) => [i.id, i.origin_item_id])).toEqual(before.map((i) => [i.id, i.origin_item_id]));
    expect(items.every((i) => p.items.some((s) => s.id === i.origin_item_id))).toBe(true);
    // the fork's own ids resolve; the purged common ids are now `missing`
    const resolved = await call(A, 'POST', '/v1/resolve', { ids: [items[0].id, p.items[0].id] });
    expect(Object.keys(resolved.body.results)).toEqual([items[0].id]);
    expect(resolved.body.missing).toEqual([p.items[0].id]);
    expect((await call(A, 'PATCH', L(mk.body.id), { name: 'Still ours' })).status).toBe(200);
  });

  it('archiving the common list does not touch the fork either (and the common ids keep resolving)', async () => {
    const p = await createPlatformList({ itemCodes: ['A'] });
    const mk = await forkList(A, p.list.id);
    expect((await call(p.owner, 'POST', `${L(p.list.id)}/archive`)).status).toBe(200);
    expect((await call(A, 'GET', L(mk.body.id))).body).toMatchObject({ status: 'active', forked_from: { list_id: p.list.id } });
    const resolved = await call(A, 'POST', '/v1/resolve', { ids: [p.items[0].id] });
    expect(resolved.body.missing).toEqual([]);
  });
});

describe('200: the fork is idempotent per (organization, source)', () => {
  it('repeating returns the same fork unchanged (200) — for the forker and for any member who can read it and holds create; nothing is copied twice', async () => {
    const p = await createPlatformList({ itemCodes: ['A', 'B'] });
    const first = await forkList(A, p.list.id);
    expect(first.status).toBe(201);
    const again = await forkList(A, p.list.id);
    expect(again.status).toBe(200);
    assertResponse('POST', FORK_PATH, 200, again.body);
    expect(again.body.id).toBe(first.body.id);
    expect(again.body.forked_from).toEqual(first.body.forked_from); // never updated
    const viaEditor = await forkList(E2, p.list.id); // E2 reads the `org` fork through the shared read and holds create
    expect(viaEditor.status).toBe(200);
    expect(viaEditor.body.id).toBe(first.body.id);
    expect((await walkItems(A, first.body.id, 'all')).length).toBe(2);
    const mine = (await walkLists(A, 'status=all')).rows.filter((l) => l.key === p.list.key);
    expect(mine).toHaveLength(1);
  });

  it('repeating after the fork was archived still returns it (200, still archived) — an archived fork counts as existing', async () => {
    const p = await createPlatformList({ itemCodes: ['A'] });
    const first = await forkList(A, p.list.id);
    expect((await call(A, 'POST', `${L(first.body.id)}/archive`)).status).toBe(200);
    const again = await forkList(A, p.list.id);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ id: first.body.id, status: 'archived' });
  });

  it('parallel forks of one source create exactly one fork: one 201, the rest 200, all the same id, one copy of the items', async () => {
    const p = await createPlatformList({ itemCodes: ['A', 'B', 'C'] });
    const results = await Promise.all([A, E2, A, E2, A].map((who) => forkList(who, p.list.id)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 200)).toHaveLength(results.length - 1);
    const id = results.find((r) => r.status === 201)!.body.id;
    for (const r of results) expect(r.body.id).toBe(id);
    expect((await walkItems(A, id, 'all')).length).toBe(3);
    const rows = await dbQuery('SELECT id FROM selection_lists WHERE organization_id = $1 AND key = $2', [ORG_F, p.list.key]);
    expect(rows).toHaveLength(1);
  });
});

describe('409 CONFLICT, refined by `reason`', () => {
  it('fork_exists: the org\'s fork exists but is a private draft the caller cannot read', async () => {
    const p = await createPlatformList({ itemCodes: ['A'] });
    const draft = await forkList(A, p.list.id, { visibility: 'private' });
    expect(draft.status).toBe(201);
    const res = await forkList(E2, p.list.id); // holds create; cannot read A's private draft
    expectError(res, 409, 'CONFLICT', 'fork_exists');
    assertResponse('POST', FORK_PATH, 409, res.body);
    expect(res.body.fork_url).toBeUndefined();
    // controls: the draft's owner gets it back (200), and nothing new was created for E2's attempt
    const owner = await forkList(A, p.list.id);
    expect(owner.status).toBe(200);
    expect(owner.body.id).toBe(draft.body.id);
    expect((await walkLists(A, 'status=all')).rows.filter((l) => l.key === p.list.key)).toHaveLength(1);
  });

  it.each(['private', 'org'] as const)('fork_not_applicable: forking a %s list of the caller\'s OWN org', async (visibility) => {
    const own = await createList(A, { name: 'Own list', visibility });
    const res = await forkList(A, own.id);
    expectError(res, 409, 'CONFLICT', 'fork_not_applicable');
    assertResponse('POST', FORK_PATH, 409, res.body);
    expect(await effectiveList(A, own.key)).toMatchObject({ id: own.id }); // nothing was created
  });

  it('fork_not_applicable: a member forking a readable `org` list of its own org; the platform org forking its own common list', async () => {
    const own = await createList(A, { name: 'Org list', visibility: 'org' });
    expectError(await forkList(E2, own.id), 409, 'CONFLICT', 'fork_not_applicable'); // E2 reads it via org visibility
    const p = await createPlatformList({ itemCodes: ['A'] });
    expectError(await forkList(p.owner, p.list.id), 409, 'CONFLICT', 'fork_not_applicable'); // the platform org owns it
    expect((await forkList(A, p.list.id)).status).toBe(201); // control: a customer org can fork it
  });

  it('a different list already holding the key is a plain CONFLICT (no reason), and nothing is created', async () => {
    const p = await createPlatformList({ itemCodes: ['A'] });
    const squatter = await createList(A, { key: p.list.key, name: 'Squatter', visibility: 'org' });
    const res = await forkList(A, p.list.id);
    expectError(res, 409, 'CONFLICT', null);
    assertResponse('POST', FORK_PATH, 409, res.body);
    expect(await effectiveList(A, p.list.key)).toMatchObject({ id: squatter.id });
    expect((await walkLists(A, 'status=all')).rows.filter((l) => l.key === p.list.key)).toHaveLength(1);
    // control: once the squatter is renamed the same call succeeds
    expect((await call(A, 'PATCH', L(squatter.id), { key: `moved-${rnd()}-${rnd()}` })).status).toBe(200);
    expect((await forkList(A, p.list.id)).status).toBe(201);
  });
});

describe('403: quota is enforced, atomically', () => {
  it('org_lists: an org at its active-list ceiling cannot fork (QUOTA_EXCEEDED, scope, limit, current); freeing a slot lets the same fork through', async () => {
    const q = actor('q1', FORK_QUOTA_LISTS_ORG_ID, 'admin'); // ceiling: 1 active list
    const made: string[] = []; // purged in `finally` so a re-run on the same database starts with an empty org
    try {
      const mine = await createList(q, { name: 'Fills the quota' });
      made.push(mine.id);
      const p = await createPlatformList({ itemCodes: ['A'] });
      const res = await forkList(q, p.list.id);
      expectError(res, 403, 'QUOTA_EXCEEDED');
      assertResponse('POST', FORK_PATH, 403, res.body);
      expect(res.body).toMatchObject({ scope: 'org_lists', limit: 1, current: 1 });
      expect((await walkLists(q, 'status=all')).rows.map((l) => l.id)).toEqual([mine.id]); // atomic: no partial fork
      // control: archive frees the allowance, and the identical request now succeeds
      expect((await call(q, 'POST', `${L(mine.id)}/archive`)).status).toBe(200);
      const ok = await forkList(q, p.list.id);
      expect(ok.status).toBe(201);
      made.push(ok.body.id);
    } finally {
      for (const id of made) await call(q, 'DELETE', `${L(id)}?purge=true`);
    }
  });

  it('list_items: a source with more items than the org\'s per-list ceiling is refused, and nothing is created', async () => {
    const q = actor('q2', FORK_QUOTA_ITEMS_ORG_ID, 'admin'); // ceiling: 2 items per list
    const made: string[] = [];
    try {
      const big = await createPlatformList({ itemCodes: ['A', 'B', 'C'] });
      const res = await forkList(q, big.list.id);
      expectError(res, 403, 'QUOTA_EXCEEDED');
      expect(res.body).toMatchObject({ scope: 'list_items', limit: 2 });
      expect((await walkLists(q, 'status=all')).rows).toEqual([]);
      // control: a source that fits is forked by the very same caller
      const small = await createPlatformList({ itemCodes: ['A', 'B'] });
      const ok = await forkList(q, small.list.id);
      expect(ok.status).toBe(201);
      made.push(ok.body.id);
    } finally {
      for (const id of made) await call(q, 'DELETE', `${L(id)}?purge=true`);
    }
  });
});

describe('400: the service mints every id — the body is closed (identifier standard)', () => {
  const bodies: Array<[string, unknown]> = [
    ['id', { id: 'front_sl_01h455vb4pex5vsknk084sn02q' }],
    ['id (item-typed: cross-type confusion)', { id: 'front_sli_01h455vb4pex5vsknk084sn02q' }],
    ['uuid', { uuid: '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7d00' }],
    ['key', { key: 'chosen-key' }],
    ['organization_id', { organization_id: PLATFORM_ORG_ID }],
    ['created_by', { created_by: 'usr_01h455vb4pex5vsknk084sn02q' }],
    ['forked_from', { forked_from: { list_id: 'front_sl_01h455vb4pex5vsknk084sn02q' } }],
    ['an undeclared property', { surprise: true }],
    ['visibility "platform" (a fork is never a common list)', { visibility: 'platform' }],
    ['visibility not in the enum', { visibility: 'public' }],
  ];

  it.each(bodies)('body with %s -> 400 VALIDATION_ERROR, nothing stored, supplied id never echoed', async (_name, body) => {
    const p = await createPlatformList({ itemCodes: ['A'] });
    const res = await forkList(A, p.list.id, body);
    expectError(res, 400, 'VALIDATION_ERROR');
    assertResponse('POST', FORK_PATH, 400, res.body);
    const sent = JSON.stringify(body);
    for (const m of sent.match(/front_sli?_[0-9a-z]+/g) ?? []) expect(JSON.stringify(res.body)).not.toContain(m);
    // nothing stored: the FIRST valid fork of this source afterwards is a 201 (it would be a 200 had the bad one created a fork)
    const control = await forkList(A, p.list.id, {});
    expect(control.status).toBe(201);
    expect(control.body.id).not.toBe((body as any).id);
  });

  it('control: the declared property is accepted ({visibility:"org"} and an empty body)', async () => {
    const p1 = await createPlatformList({ itemCodes: ['A'] });
    const p2 = await createPlatformList({ itemCodes: ['A'] });
    expect((await forkList(A, p1.list.id, { visibility: 'org' })).status).toBe(201);
    expect((await forkList(A, p2.list.id, {})).status).toBe(201);
  });
});

describe('401 / 403 / 404', () => {
  it('401 without a token', async () => {
    const p = await createPlatformList({ itemCodes: ['A'] });
    expectError(await forkList(null, p.list.id), 401, 'UNAUTHENTICATED');
  });

  it('a viewer holds no `create`: 403 on a common list it can read; the editor beside it forks fine', async () => {
    const p = await createPlatformList({ itemCodes: ['A'] });
    expect((await call(V, 'GET', L(p.list.id))).status).toBe(200); // readable...
    expectError(await forkList(V, p.list.id), 403, 'FORBIDDEN'); // ...but not forkable without create
    expect((await forkList(E2, p.list.id)).status).toBe(201);
  });

  it('404 for a source the caller cannot read: another customer org\'s `org` list, its private list, a platform-org PRIVATE list, a never-existing id', async () => {
    const theirsOrg = await createList(G, { name: 'G org list', visibility: 'org' });
    const theirsPriv = await createList(G, { name: 'G private list' });
    const platPrivate = await createList(src.owner, { name: 'Operator draft' }); // platform org, visibility private
    for (const id of [theirsOrg.id, theirsPriv.id, platPrivate.id, 'front_sl_01sl9neverexisted00000']) {
      expectError(await forkList(A, id), 404, 'NOT_FOUND');
    }
    // control: G forks nothing of its own, but A can fork a readable common list
    const p = await createPlatformList({ itemCodes: ['A'] });
    expect((await forkList(A, p.list.id)).status).toBe(201);
  });

  it('a malformed or wrong-type id in the path is rejected (an item id is not a list id)', async () => {
    const itemId = srcItemsByCode.get('A')!.id;
    for (const id of [itemId, 'usr_01h455vb4pex5vsknk084sn02q', 'org_01h455vb4pex5vsknk084sn02q', 'not-an-id']) {
      const res = await forkList(A, id);
      expect([400, 404]).toContain(res.status);
      expect(res.body?.code).toMatch(/^(VALIDATION_ERROR|NOT_FOUND)$/);
    }
  });
});
