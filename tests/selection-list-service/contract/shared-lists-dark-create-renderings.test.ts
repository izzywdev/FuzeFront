/**
 * The "dark create" block: a key is unique per ORGANIZATION across every rendering of its id, WHATEVER the shared-lists
 * flag says (SL9, service 1.1.x; rollout runbook §10.1: "Creating or renaming a list is refused (409) when the key already
 * exists for the same org under ANY rendering of its id, whatever the shared-lists flag says"). Written against the frozen
 * contract (`key` is "unique within the organization"; `409 CONFLICT` on a duplicate key on create and on rename) and the
 * runbook, not against the handlers.
 *
 * Why it matters while the feature is still DARK: with the flag OFF the service keeps the 4.0.0 EXACT org scope, so a token
 * carrying the org's bare UUID and one carrying its `org_...` TypeID see DIFFERENT (disjoint) sets of lists - and the
 * database constraint `UNIQUE (organization_id, key)` compares the stored text, so it cannot tell the two apart. Without the
 * service-side check the same key would be created twice for one organization while dark and would become an ambiguous pair
 * the day the flag turns on. So, flag ON and OFF alike:
 *   1. create onto a key held under the OTHER rendering -> 409 CONFLICT, nothing is created (either direction);
 *   2. the holder may be archived (any status counts) - the key is still taken;
 *   3. rename onto such a key -> 409 CONFLICT, nothing changes; a free key and the list's own key are fine;
 *   4. concurrent creates of one key through both renderings: exactly one wins;
 *   5. the block is not a visibility leak: with the flag OFF the other rendering still cannot read or list the holder (the
 *      4.0.0 exact scope is otherwise unchanged).
 * The flag-OFF half needs the second instance (SHARED_LISTS_FLAG_OFF_URL); a missing URL fails the suite, never skips it.
 */
import {
  actor, assertSharedListsOff, assertSharedListsOn, call, expectError, FLAG_OFF_BASE_URL, L, newCodecOrg, rnd, walkLists, type Actor, type Res,
} from '../helpers/shared-lists';
import { mintTestToken } from '../helpers/auth';
import { closeDb, dbQuery } from '../helpers/db';

beforeAll(async () => {
  await assertSharedListsOn();
  await assertSharedListsOff(FLAG_OFF_BASE_URL);
});
afterAll(async () => {
  await closeDb();
});

const INSTANCES: Array<[string, string | undefined]> = [
  ['shared-lists flag OFF (dark)', FLAG_OFF_BASE_URL],
  ['shared-lists flag ON', undefined],
];

const stored = (orgs: string[], key: string) =>
  dbQuery<{ id: string; organization_id: string; status: string }>('SELECT id, organization_id, status FROM selection_lists WHERE organization_id = ANY($1::text[]) AND key = $2 ORDER BY created_at', [orgs, key]);

const create = (who: Actor, key: string, url: string | undefined, name = 'Dark create'): Promise<Res> => call(who, 'POST', '/v1/selection-lists', { key, name }, url);

describe.each(INSTANCES)('%s', (_label, url) => {
  /** One org; one admin per rendering of its id. */
  const org = () => {
    const o = newCodecOrg();
    return { ...o, byType: actor('dc-t', o.wire, 'admin'), byUuid: actor('dc-u', o.uuid, 'admin') };
  };

  it.each([
    ['TypeID first, then the bare UUID', 'byType', 'byUuid'],
    ['bare UUID first, then the TypeID', 'byUuid', 'byType'],
  ] as const)('create: %s - the second create of the key is 409 CONFLICT and creates nothing', async (_n, first, second) => {
    const o = org();
    const key = `dc-${rnd()}-${rnd()}`;
    const made = await create(o[first], key, url);
    expect(made.status).toBe(201);
    const again = await create(o[second], key, url);
    expectError(again, 409, 'CONFLICT', null); // a plain CONFLICT: no fork_* / visibility_* reason
    expect(again.body.id).toBeUndefined();
    expect(await stored([o.wire, o.uuid], key)).toEqual([expect.objectContaining({ id: made.body.id })]); // exactly one row
    // the same rendering is the ordinary duplicate; and a different key through the other rendering is fine (so the 409 is about the key)
    expectError(await create(o[first], key, url), 409, 'CONFLICT', null);
    expect((await create(o[second], `dc-${rnd()}-${rnd()}`, url)).status).toBe(201);
  });

  it('create: an ARCHIVED holder still holds the key (any status counts)', async () => {
    const o = org();
    const key = `dc-arch-${rnd()}-${rnd()}`;
    const made = await create(o.byType, key, url);
    expect(made.status).toBe(201);
    expect((await call(o.byType, 'DELETE', L(made.body.id), undefined, url)).status).toBe(200); // archive
    expect((await call(o.byType, 'GET', L(made.body.id), undefined, url)).body.status).toBe('archived');
    expectError(await create(o.byUuid, key, url), 409, 'CONFLICT', null);
    expect(await stored([o.wire, o.uuid], key)).toHaveLength(1);
  });

  it('create: a key held by ANOTHER organization is no obstacle (the block is per organization, not global)', async () => {
    const [a, b] = [org(), org()];
    const key = `dc-other-${rnd()}-${rnd()}`;
    expect((await create(a.byType, key, url)).status).toBe(201);
    expect((await create(b.byType, key, url)).status).toBe(201);
    expectError(await create(b.byUuid, key, url), 409, 'CONFLICT', null); // ...but b's OTHER rendering now collides with b's own list
  });

  it('create: concurrent creates of one key through BOTH renderings - exactly one 201, every other 409, one row', async () => {
    const o = org();
    const key = `dc-race-${rnd()}-${rnd()}`;
    const results = await Promise.all([
      create(o.byType, key, url, 'A'), create(o.byUuid, key, url, 'B'), create(o.byType, key, url, 'C'), create(o.byUuid, key, url, 'D'),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
    for (const r of results.filter((x) => x.status === 409)) expect(r.body).toMatchObject({ code: 'CONFLICT' });
    expect(await stored([o.wire, o.uuid], key)).toHaveLength(1);
  });

  it('rename: onto a key held under the other rendering is 409 in BOTH directions and changes nothing; a free key and the list\'s own key are fine', async () => {
    const o = org();
    const [ka, kb] = [`dc-ra-${rnd()}-${rnd()}`, `dc-rb-${rnd()}-${rnd()}`];
    const a = await create(o.byType, ka, url); // stored under the TypeID
    const b = await create(o.byUuid, kb, url); // stored under the bare UUID - with the flag OFF the two do not see each other
    expect([a.status, b.status]).toEqual([201, 201]);
    expectError(await call(o.byUuid, 'PATCH', L(b.body.id), { key: ka }, url), 409, 'CONFLICT', null);
    expectError(await call(o.byType, 'PATCH', L(a.body.id), { key: kb }, url), 409, 'CONFLICT', null);
    expect((await dbQuery('SELECT key FROM selection_lists WHERE id = ANY($1::text[]) ORDER BY key', [[a.body.id, b.body.id]])).map((r) => r['key']).sort()).toEqual([ka, kb].sort()); // untouched
    // controls: the list's own key (re-sent) and a free key are accepted
    expect((await call(o.byUuid, 'PATCH', L(b.body.id), { key: kb, name: 'Renamed B' }, url)).status).toBe(200);
    const free = `dc-free-${rnd()}-${rnd()}`;
    const renamed = await call(o.byUuid, 'PATCH', L(b.body.id), { key: free }, url);
    expect(renamed.status).toBe(200);
    expect(renamed.body.key).toBe(free);
    // and the key b gave up is free again, for the other rendering too
    expect((await call(o.byType, 'PATCH', L(a.body.id), { key: kb }, url)).status).toBe(200);
  });

  it('rename: onto the key of an ARCHIVED list of the other rendering is 409 too', async () => {
    const o = org();
    const archivedKey = `dc-ra-arch-${rnd()}-${rnd()}`;
    const holder = await create(o.byType, archivedKey, url);
    expect((await call(o.byType, 'DELETE', L(holder.body.id), undefined, url)).status).toBe(200);
    const mover = await create(o.byUuid, `dc-mover-${rnd()}-${rnd()}`, url);
    expectError(await call(o.byUuid, 'PATCH', L(mover.body.id), { key: archivedKey }, url), 409, 'CONFLICT', null);
  });
});

describe('the dark instance is otherwise the 4.0.0 exact scope (the block is not a visibility leak)', () => {
  it('flag OFF: a list stored under one rendering is invisible to the other rendering of the SAME org, though it holds the key', async () => {
    const o = newCodecOrg();
    const byType = actor('dc-v', o.wire, 'admin');
    const byUuid = actor('dc-w', o.uuid, 'admin');
    const key = `dc-vis-${rnd()}-${rnd()}`;
    const made = await call(byType, 'POST', '/v1/selection-lists', { key, name: 'Hidden from the other rendering' }, FLAG_OFF_BASE_URL);
    expect(made.status).toBe(201);
    expectError(await call(byUuid, 'GET', L(made.body.id), undefined, FLAG_OFF_BASE_URL), 404, 'NOT_FOUND'); // not readable...
    expect((await walkLists(byUuid, `key=${key}`, 50, FLAG_OFF_BASE_URL)).rows).toEqual([]); // ...not listed...
    expectError(await call(byUuid, 'POST', '/v1/selection-lists', { key, name: 'Twin' }, FLAG_OFF_BASE_URL), 409, 'CONFLICT', null); // ...and yet the key is taken
    // with the flag ON the two renderings are one org: the same user, presenting the org's other rendering, reads its own list
    const sameUserOtherRendering: Actor = { ...byType, orgId: o.uuid, token: () => mintTestToken({ userId: byType.userId, organizationId: o.uuid, roles: ['admin'] }) };
    expect((await call(sameUserOtherRendering, 'GET', L(made.body.id))).status).toBe(200);
  });
});
