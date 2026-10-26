/**
 * `visibility` on create and PATCH — the state machine and the wire shapes (SL9, D1 / D10).
 * Written against the FROZEN contract (openapi.yaml 4.1.0: `SelectionListCreate.visibility`,
 * `SelectionListUpdate.visibility`, `SelectionList.visibility` / `forked_from` / `editable` read-only,
 * `ErrorReason.visibility_locked`) and docs/planning/selection-lists-shared-and-fork.md.
 * Needs the shared-lists flag ON (helpers/shared-lists.ts). The AUTHORIZATION of visibility changes
 * (owner vs editor, publish_platform, platform org) is pinned in security/shared-lists-privileged-ops.test.ts.
 *
 * Design-record rows pinned:
 *   D1 / §11.7   `visibility` defaults to `private` on create; `org` and `private` are settable by the creator;
 *                `private <-> org` by PATCH; `platform` is ONE-WAY: any other visibility on a `platform` list is
 *                `409 CONFLICT` with `reason: visibility_locked` (demotion would turn every tenant's stored ids
 *                into `missing`), the refusal applies to the whole PATCH (all-or-nothing), and the list stays
 *                readable by every tenant; sending the current visibility is a no-op (200).
 *   identifier standard / read-only fields   `visibility` values outside the enum, `null`, wrong case -> 400;
 *                `forked_from`, `editable`, `origin_item_id`, `organization_id` are READ-ONLY: a create / PATCH
 *                body carrying them is rejected (additionalProperties:false), never silently accepted.
 */
import {
  actor, addItem, call, createList, createPlatformList, expectError, L, newOrg, PLATFORM_ORG_ID, rnd,
  assertSharedListsOn,
} from '../helpers/shared-lists';
import { assertResponse } from '../helpers/openapi';
import { closeDb } from '../helpers/db';

const ORG = newOrg('vis');
const owner = actor('own', ORG, 'admin');
const member = actor('mem', ORG, 'viewer');
const stranger = actor('str', newOrg('visstranger'), 'viewer');

beforeAll(async () => {
  await assertSharedListsOn();
});
afterAll(async () => {
  await closeDb();
});

describe('create: visibility defaults to private and accepts private | org', () => {
  it('omitted -> "private"; explicit "private" and "org" are echoed; every response conforms', async () => {
    for (const [body, expected] of [
      [{}, 'private'],
      [{ visibility: 'private' }, 'private'],
      [{ visibility: 'org' }, 'org'],
    ] as const) {
      const res = await call(owner, 'POST', '/v1/selection-lists', { key: `v-${rnd()}-${rnd()}`, name: 'Vis', ...body });
      expect(res.status).toBe(201);
      assertResponse('POST', '/v1/selection-lists', 201, res.body);
      expect(res.body.visibility).toBe(expected);
      expect(res.body.forked_from).toBeNull();
    }
  });

  it.each([
    ['unknown value', 'public'],
    ['wrong case', 'Org'],
    ['null', null],
    ['a number', 1],
    ['an empty string', ''],
  ])('visibility: %s -> 400 VALIDATION_ERROR and nothing is created', async (_n, value) => {
    const key = `vbad-${rnd()}-${rnd()}`;
    const res = await call(owner, 'POST', '/v1/selection-lists', { key, name: 'Bad', visibility: value });
    expectError(res, 400, 'VALIDATION_ERROR');
    assertResponse('POST', '/v1/selection-lists', 400, res.body);
    // control: the identical request with a valid value is accepted (so the 400 is about `visibility`)
    expect((await call(owner, 'POST', '/v1/selection-lists', { key, name: 'Good', visibility: 'org' })).status).toBe(201);
  });
});

describe('PATCH: private <-> org by the owner', () => {
  it('flips both ways, follows the member\'s read access, and can ride along with other fields (all applied together)', async () => {
    const l = await createList(owner, { name: 'Flip' });
    expect((await call(member, 'GET', L(l.id))).status).toBe(404);
    const toOrg = await call(owner, 'PATCH', L(l.id), { visibility: 'org', name: 'Flip (shared)' });
    expect(toOrg.status).toBe(200);
    assertResponse('PATCH', '/v1/selection-lists/{listId}', 200, toOrg.body);
    expect(toOrg.body).toMatchObject({ visibility: 'org', name: 'Flip (shared)' });
    expect((await call(member, 'GET', L(l.id))).status).toBe(200);
    const toPrivate = await call(owner, 'PATCH', L(l.id), { visibility: 'private' });
    expect(toPrivate.body.visibility).toBe('private');
    expect((await call(member, 'GET', L(l.id))).status).toBe(404);
  });

  it('sending the current visibility is a 200 no-op', async () => {
    const l = await createList(owner, { name: 'Same', visibility: 'org' });
    const res = await call(owner, 'PATCH', L(l.id), { visibility: 'org' });
    expect(res.status).toBe(200);
    expect(res.body.visibility).toBe('org');
  });

  it('an invalid visibility in PATCH is 400 and changes nothing (including the name sent alongside)', async () => {
    const l = await createList(owner, { name: 'Untouched' });
    expectError(await call(owner, 'PATCH', L(l.id), { visibility: 'everyone', name: 'Changed' }), 400, 'VALIDATION_ERROR');
    expect((await call(owner, 'GET', L(l.id))).body).toMatchObject({ name: 'Untouched', visibility: 'private' });
  });
});

describe('platform is one-way: demotion is 409 visibility_locked', () => {
  it.each(['org', 'private'] as const)('PATCH {visibility:"%s"} on a common list by its owning operator -> 409 CONFLICT / visibility_locked; still platform, still readable by every tenant', async (target) => {
    const p = await createPlatformList({ itemCodes: ['A'] });
    const res = await call(p.owner, 'PATCH', L(p.list.id), { visibility: target });
    expectError(res, 409, 'CONFLICT', 'visibility_locked');
    assertResponse('PATCH', '/v1/selection-lists/{listId}', 409, res.body);
    expect(res.body.fork_url).toBeUndefined();
    const after = await call(p.owner, 'GET', L(p.list.id));
    expect(after.body.visibility).toBe('platform');
    expect((await call(stranger, 'GET', L(p.list.id))).status).toBe(200); // every tenant still reads it
    // control: a no-op PATCH of the current visibility is allowed (200), so the 409 is specifically the demotion
    expect((await call(p.owner, 'PATCH', L(p.list.id), { visibility: 'platform' })).status).toBe(200);
  });

  it('the refusal is all-or-nothing: a rename sent with the demotion is not applied', async () => {
    const p = await createPlatformList({ itemCodes: [] });
    const res = await call(p.owner, 'PATCH', L(p.list.id), { visibility: 'org', name: 'Sneaky rename' });
    expectError(res, 409, 'CONFLICT', 'visibility_locked');
    expect((await call(p.owner, 'GET', L(p.list.id))).body.name).toBe(p.list.name);
  });

  it('archiving is how a common list is retired: archived, it keeps its visibility and its items keep resolving', async () => {
    const p = await createPlatformList({ itemCodes: ['A'] });
    expect((await call(p.owner, 'POST', `${L(p.list.id)}/archive`)).status).toBe(200);
    const got = await call(p.owner, 'GET', L(p.list.id));
    expect(got.body).toMatchObject({ status: 'archived', visibility: 'platform' });
    const resolved = await call(stranger, 'POST', '/v1/resolve', { ids: [p.items[0].id] });
    expect(resolved.status).toBe(200);
    expect(resolved.body.results[p.items[0].id]).toBeDefined();
    expect(resolved.body.missing).toEqual([]);
  });
});

describe('read-only fields are never accepted on writes', () => {
  it.each([
    ['forked_from', { forked_from: { list_id: 'front_sl_01h455vb4pex5vsknk084sn02q', organization_id: PLATFORM_ORG_ID, revision: 1, forked_at: '2026-01-01T00:00:00Z' } }],
    ['editable', { editable: true }],
    ['organization_id', { organization_id: PLATFORM_ORG_ID }],
  ])('create with %s -> 400', async (_n, extra) => {
    const key = `ro-${rnd()}-${rnd()}`;
    expectError(await call(owner, 'POST', '/v1/selection-lists', { key, name: 'RO', ...extra }), 400, 'VALIDATION_ERROR');
    expect((await call(owner, 'POST', '/v1/selection-lists', { key, name: 'RO' })).status).toBe(201); // control: the key was never taken
  });

  it.each([
    ['forked_from', { forked_from: null }],
    ['editable', { editable: true }],
    ['organization_id', { organization_id: PLATFORM_ORG_ID }],
  ])('PATCH with %s -> 400, nothing changes', async (_n, extra) => {
    const l = await createList(owner, { name: 'RO patch' });
    expectError(await call(owner, 'PATCH', L(l.id), { name: 'Changed', ...extra }), 400, 'VALIDATION_ERROR');
    expect((await call(owner, 'GET', L(l.id))).body.name).toBe('RO patch');
  });

  it('an item create / PATCH carrying origin_item_id is rejected; origin_item_id reads null on a normal item', async () => {
    const l = await createList(owner, { name: 'Items RO' });
    const item = await addItem(owner, l.id, 'X');
    expect(item.origin_item_id).toBeNull();
    expectError(await call(owner, 'POST', `${L(l.id)}/items`, { code: 'Y', label: 'Y', origin_item_id: item.id }), 400, 'VALIDATION_ERROR');
    expectError(await call(owner, 'PATCH', `${L(l.id)}/items/${item.id}`, { origin_item_id: item.id }), 400, 'VALIDATION_ERROR');
    expect((await call(owner, 'GET', `${L(l.id)}/items`)).body.items.map((i: any) => i.code)).toEqual(['X']);
  });
});
