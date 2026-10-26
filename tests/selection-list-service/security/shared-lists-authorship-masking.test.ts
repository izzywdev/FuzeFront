/**
 * Authorship of another organization's rows is not disclosed (SL9, service 1.1.0 hardening).
 * Contract basis (openapi.yaml 4.1.0 / 4.0.0): `created_by` is an `AuthorPrincipal` = a `usr_` id, a
 * `system:<service>` principal or the `[deleted-user]` sentinel. A common list is read by EVERY tenant, so rendering the
 * platform operator's user id (a spine id of a person in ANOTHER organization) to all of them would leak identities
 * across tenants - the "no cross-org existence/identity oracle" rule of the contract. The service therefore renders
 * `created_by` of rows of a list owned by another organization as the system principal `system:platform`.
 *
 * Pinned: for a cross-org reader the common list and EVERY item report `system:platform` (get, list, items, and the
 * mutation-free key lookup) and still validate against the spec; the owning org's own operators and a forking org keep
 * real ids for what is THEIRS (the fork's `created_by` is the forker); nothing else about the row changes, and an
 * `org`-visible list read by a member of its own org keeps the real author (masking is for FOREIGN rows only).
 * The user ids are asserted absent from the whole response body, not just one field.
 */
import { actor, addItem, call, createList, createPlatformList, forkList, L, newOrg, assertSharedListsOn, walkLists, walkItems } from '../helpers/shared-lists';
import { assertResponse, schemaErrors } from '../helpers/openapi';
import { closeDb } from '../helpers/db';

const ORG_Y = newOrg('mskY');
const reader = actor('rd', ORG_Y, 'viewer');
const forker = actor('fk', ORG_Y, 'admin');
const MASK = 'system:platform';

beforeAll(async () => {
  await assertSharedListsOn();
});
afterAll(async () => {
  await closeDb();
});

describe('a common list read by another organization hides who authored it', () => {
  it('get / listing / items: created_by is system:platform everywhere, the operator\'s id appears nowhere, and responses still conform', async () => {
    const p = await createPlatformList({ itemCodes: ['A', 'B'] });
    const operatorId = p.owner.userId;
    // control: the owning org's operator sees the real author (it is their own row)
    const own = await call(p.owner, 'GET', L(p.list.id));
    expect(own.body.created_by).toBe(operatorId);
    expect((await walkItems(p.owner, p.list.id, 'active')).map((i) => i.created_by)).toEqual([operatorId, operatorId]);

    const got = await call(reader, 'GET', L(p.list.id));
    expect(got.status).toBe(200);
    assertResponse('GET', '/v1/selection-lists/{listId}', 200, got.body);
    expect(got.body.created_by).toBe(MASK);
    expect(JSON.stringify(got.body)).not.toContain(operatorId);

    const listed = (await walkLists(reader, `include_shared=true&key=${p.list.key}`)).rows;
    expect(listed.map((r) => r.id)).toEqual([p.list.id]);
    expect(listed[0]!.created_by).toBe(MASK);

    const items = await call(reader, 'GET', `${L(p.list.id)}/items`);
    assertResponse('GET', '/v1/selection-lists/{listId}/items', 200, items.body);
    expect(items.body.items).toHaveLength(2);
    for (const i of items.body.items) expect(i.created_by).toBe(MASK);
    expect(JSON.stringify(items.body)).not.toContain(operatorId);
    expect(schemaErrors('AuthorPrincipal', MASK)).toEqual([]); // the masked value is a legal AuthorPrincipal
  });

  it('a fork belongs to the forking org: its created_by is the forker; the source stays masked for that org', async () => {
    const p = await createPlatformList({ itemCodes: ['A'] });
    const fork = await forkList(forker, p.list.id);
    expect(fork.status).toBe(201);
    expect(fork.body.created_by).toBe(forker.userId);
    const mine = await walkItems(forker, fork.body.id, 'active');
    expect(mine.map((i) => i.created_by)).toEqual([forker.userId]);
    expect((await call(reader, 'GET', L(fork.body.id))).body.created_by).toBe(forker.userId); // its own org's member sees its org's author
    // the common list, still foreign to ORG_Y, stays masked (with the fork, the registry shows the fork; by id the source is still readable)
    expect((await call(reader, 'GET', L(p.list.id))).body.created_by).toBe(MASK);
  });

  it('masking is for FOREIGN rows only: an `org` list read by a member of its own org shows the real author', async () => {
    const l = await createList(forker, { name: 'Our own shared list', visibility: 'org' });
    await addItem(forker, l.id, 'X');
    const got = await call(reader, 'GET', L(l.id));
    expect(got.body.created_by).toBe(forker.userId);
    expect((await call(reader, 'GET', `${L(l.id)}/items`)).body.items[0].created_by).toBe(forker.userId);
    // and another org's member reading a foreign `org` list is 404 (nothing to mask: it is not readable at all)
    expect((await call(actor('oth', newOrg('mskO'), 'viewer'), 'GET', L(l.id))).status).toBe(404);
  });
});
