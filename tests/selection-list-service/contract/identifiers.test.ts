/**
 * Identifier standard — governance/identifier-standard.md, enforced on every create/reference of
 * the selection-list contract:
 *
 *   1. The service mints ids: a create body carrying `id` (or any undeclared property) is REJECTED
 *      (the contract's `additionalProperties: false` => 400 VALIDATION_ERROR), never silently
 *      accepted or echoed.
 *   2. Cross-type confusion is rejected: an id minted for one entity type is refused where another
 *      is expected (front_sli_ for front_sl_, usr_/org_ for either).
 *   3. An id is never a capability: knowing a valid id for entity B grants nothing to a caller
 *      authorized only for entity A — across routes, across lists, across orgs.
 *
 * No graph-create (`lid` in / `idMap` out) exists in this service's contract, so that clause of the
 * standard has nothing to verify here.
 */
import { mintTestToken } from '../helpers/auth';
import { rawFetch } from '../helpers/client';
import { assertSchema } from '../helpers/openapi';
import { closeDb, dbQuery } from '../helpers/db';

afterAll(async () => {
  await closeDb();
});

const ORG = 'org_01test0000000idents00000000';
const OTHER_ORG = 'org_01test0000000idents00000001';
const U1 = 'usr_01test0000000identsuser1000';
const U2 = 'usr_01test0000000identsuser2000';
const tok = (user: string, org = ORG, roles: string[] = []) => mintTestToken({ userId: user, organizationId: org, roles });
const call = (method: string, path: string, body?: unknown, token = tok(U1)) =>
  rawFetch(path, { method, token, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const rnd = () => Math.random().toString(16).slice(2, 8);

async function mkList(user = U1, org = ORG) {
  const res = await call('POST', '/v1/selection-lists', { key: `id-${rnd()}-${rnd()}`, name: 'Ident' }, tok(user, org));
  expect(res.status).toBe(201);
  return (res.body as { id: string }).id;
}
async function mkItem(listId: string, user = U1, org = ORG) {
  const res = await call('POST', `/v1/selection-lists/${listId}/items`, { code: `I${rnd()}`, label: 'x' }, tok(user, org));
  expect(res.status).toBe(201);
  return (res.body as { id: string }).id;
}

describe('1. the service mints ids: client-supplied ids are rejected on every create', () => {
  const FOREIGN_LIST_ID = 'front_sl_01h455vb4pex5vsknk084sn02q';
  const FOREIGN_ITEM_ID = 'front_sli_01h455vb4pex5vsknk084sn02q';

  it.each([
    ['list create with id', { key: 'idsmuggle-a', name: 'x', id: FOREIGN_LIST_ID }],
    ['list create with organization_id', { key: 'idsmuggle-b', name: 'x', organization_id: 'org_01h455vb4pex5vsknk084sn02q' }],
    ['list create with created_by', { key: 'idsmuggle-c', name: 'x', created_by: U2 }],
    ['list create with uuid', { key: 'idsmuggle-d', name: 'x', uuid: '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7d00' }],
  ])('%s -> 400 VALIDATION_ERROR and nothing is stored', async (_name, body) => {
    const res = await call('POST', '/v1/selection-lists', body);
    expect(res.status).toBe(400);
    assertSchema('Error', res.body);
    expect((res.body as { code: string }).code).toBe('VALIDATION_ERROR');
    const rows = await dbQuery('SELECT 1 FROM selection_lists WHERE organization_id = $1 AND key = $2', [ORG, (body as { key: string }).key]);
    expect(rows).toEqual([]);
  });

  it('item create with id / list_id -> 400, nothing stored, the supplied id is never echoed', async () => {
    const listId = await mkList();
    for (const extra of [{ id: FOREIGN_ITEM_ID }, { list_id: FOREIGN_LIST_ID }, { created_by: U2 }]) {
      const res = await call('POST', `/v1/selection-lists/${listId}/items`, { code: `SM${rnd()}`, label: 'x', ...extra });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain(FOREIGN_ITEM_ID);
    }
    const items = await dbQuery('SELECT 1 FROM selection_list_items WHERE list_id = $1', [listId]);
    expect(items).toEqual([]);
  });

  it('the other write bodies that already enforce the contract: list patch, item patch, access upsert', async () => {
    const listId = await mkList();
    const itemId = await mkItem(listId);
    const L = `/v1/selection-lists/${listId}`;
    const cases: Array<[string, string, string, unknown]> = [
      ['PATCH', L, 'list patch', { name: 'x', id: 'front_sl_01h455vb4pex5vsknk084sn02q' }],
      ['PATCH', `${L}/items/${itemId}`, 'item patch', { label: 'x', id: 'front_sli_01h455vb4pex5vsknk084sn02q' }],
      ['PUT', `${L}/access/${U2}`, 'access upsert', { role: 'list-viewer', user_id: U1 }],
    ];
    for (const [method, path, label, body] of cases) {
      const res = await call(method, path, body);
      if (res.status !== 400) throw new Error(`${label}: expected 400 for an undeclared property, got ${res.status} ${JSON.stringify(res.body)}`);
    }
  });
  // The remaining write bodies (list/item translation upsert, reorder, autofill, resolve) do NOT reject
  // undeclared properties today: see contract/request-validation.test.ts (it.failing, with the defect).
});

describe('2. cross-type confusion is rejected', () => {
  const GHOST_ITEM = 'front_sli_00000000000000000000000000';

  it('an item id (or usr_/org_ id) where a list id is expected never resolves to anything', async () => {
    const listId = await mkList();
    const itemId = await mkItem(listId);
    for (const wrong of [itemId, U2, ORG, 'front_sl_', 'sl_01h455vb4pex5vsknk084sn02q', '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7d00']) {
      const res = await call('GET', `/v1/selection-lists/${encodeURIComponent(wrong)}`);
      expect([400, 404]).toContain(res.status);
      expect(res.body).not.toHaveProperty('key');
      const w = await call('PATCH', `/v1/selection-lists/${encodeURIComponent(wrong)}`, { name: 'hijack' });
      expect([400, 404]).toContain(w.status);
    }
    const intact = await call('GET', `/v1/selection-lists/${listId}`);
    expect((intact.body as { name: string }).name).toBe('Ident');
  });

  it('a list id where an item id is expected is rejected, and an item id from ANOTHER list is a 404 under this one', async () => {
    const a = await mkList();
    const b = await mkList();
    const itemOfB = await mkItem(b);
    const asItem = await call('PATCH', `/v1/selection-lists/${a}/items/${a}`, { label: 'x' });
    expect([400, 404]).toContain(asItem.status);
    const viaWrongList = await call('PATCH', `/v1/selection-lists/${a}/items/${itemOfB}`, { label: 'stolen' });
    expect(viaWrongList.status).toBe(404);
    const archiveWrongList = await call('POST', `/v1/selection-lists/${a}/items/${itemOfB}/archive`);
    expect(archiveWrongList.status).toBe(404);
    const purgeWrongList = await call('DELETE', `/v1/selection-lists/${a}/items/${itemOfB}?purge=true`);
    expect(purgeWrongList.status).toBe(404);
    const row = await dbQuery('SELECT status FROM selection_list_items WHERE id = $1', [itemOfB]);
    expect(row[0]).toMatchObject({ status: 'active' });
    const label = await dbQuery(
      `SELECT t.label FROM selection_list_item_translations t WHERE t.item_id = $1`,
      [itemOfB],
    );
    expect(JSON.stringify(label)).not.toContain('stolen');
  });

  it('a polymorphic/typed reference without its discriminator is rejected: access userId must be usr_', async () => {
    const listId = await mkList();
    for (const bare of ['0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7d00', ORG, 'front_sl_01h455vb4pex5vsknk084sn02q', 'someone']) {
      const res = await call('PUT', `/v1/selection-lists/${listId}/access/${encodeURIComponent(bare)}`, { role: 'list-viewer' });
      expect([400, 404]).toContain(res.status);
      expect(res.status).not.toBe(200);
    }
    const grants = await dbQuery('SELECT user_id FROM selection_list_access WHERE list_id = $1', [listId]);
    expect(grants.map((g) => g.user_id)).toEqual([U1]); // only the creator's owner grant exists
  });

  it('a well-formed but never-minted item id resolves to `missing` (200), not an error', async () => {
    const ghost = await call('POST', '/v1/resolve', { ids: [GHOST_ITEM] });
    expect(ghost.status).toBe(200);
    expect((ghost.body as { missing: string[] }).missing).toEqual([GHOST_ITEM]);
  });
  // `POST /v1/resolve` with a list/user/org id in `ids` is NOT refused today (200 + `missing`):
  // see contract/request-validation.test.ts (it.failing, with the defect).
});

describe('3. knowing an id grants nothing', () => {
  it('a caller authorized for list A presenting list B\'s valid id is denied on every verb (A and B in the same org)', async () => {
    const aId = await mkList(U1);
    const bId = await mkList(U2); // U1 holds no role on B
    const itemOfB = await mkItem(bId, U2);
    const B = `/v1/selection-lists/${bId}`;
    const mine = await call('GET', `/v1/selection-lists/${aId}`, undefined, tok(U1));
    expect(mine.status).toBe(200); // U1 really is authorized for A

    const attempts: Array<[string, string, unknown]> = [
      ['GET', B, undefined],
      ['PATCH', B, { name: 'hijacked' }],
      ['DELETE', B, undefined],
      ['DELETE', `${B}?purge=true`, undefined],
      ['POST', `${B}/archive`, undefined],
      ['GET', `${B}/items`, undefined],
      ['POST', `${B}/items`, { code: 'HIJACK', label: 'x' }],
      ['PATCH', `${B}/items/${itemOfB}`, { label: 'hijacked' }],
      ['DELETE', `${B}/items/${itemOfB}?purge=true`, undefined],
      ['PUT', `${B}/translations/fr`, { name: 'hijacked' }],
      ['GET', `${B}/access`, undefined],
      ['PUT', `${B}/access/${U1}`, { role: 'list-owner' }], // self-escalation by knowing the id
    ];
    for (const [method, path, body] of attempts) {
      const res = await call(method, path, body, tok(U1));
      if (![403, 404].includes(res.status)) throw new Error(`${method} ${path} by a caller with no role on B returned ${res.status}, expected 403/404`);
    }
    const untouched = await call('GET', B, undefined, tok(U2));
    expect(untouched.body).toMatchObject({ name: 'Ident', status: 'active' });
    const items = await dbQuery('SELECT code, status FROM selection_list_items WHERE list_id = $1', [bId]);
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe('active');
    const grants = await dbQuery('SELECT user_id, role FROM selection_list_access WHERE list_id = $1', [bId]);
    expect(grants).toEqual([{ user_id: U2, role: 'list-owner' }]);
  });

  it('a caller in ANOTHER organization is denied with a 404 indistinguishable from "no such id" on every verb', async () => {
    const listId = await mkList(U1, ORG);
    const itemId = await mkItem(listId, U1, ORG);
    const ghostList = 'front_sl_00000000000000000000000000';
    const ghostItem = 'front_sli_00000000000000000000000000';
    const outsider = tok(U2, OTHER_ORG);
    const probe = (id: string, item: string): Array<[string, string, unknown]> => [
      ['GET', `/v1/selection-lists/${id}`, undefined],
      ['PATCH', `/v1/selection-lists/${id}`, { name: 'x' }],
      ['DELETE', `/v1/selection-lists/${id}`, undefined],
      ['GET', `/v1/selection-lists/${id}/items`, undefined],
      ['POST', `/v1/selection-lists/${id}/items`, { code: 'X', label: 'x' }],
      ['PATCH', `/v1/selection-lists/${id}/items/${item}`, { label: 'x' }],
      ['PUT', `/v1/selection-lists/${id}/access/${U2}`, { role: 'list-owner' }],
      ['GET', `/v1/selection-lists/${id}/access`, undefined],
    ];
    const real = probe(listId, itemId);
    const ghost = probe(ghostList, ghostItem);
    for (let i = 0; i < real.length; i++) {
      const r = await call(real[i][0], real[i][1], real[i][2], outsider);
      const g = await call(ghost[i][0], ghost[i][1], ghost[i][2], outsider);
      expect(r.status).toBe(404);
      expect(g.status).toBe(404);
      expect((r.body as { code: string }).code).toBe((g.body as { code: string }).code);
    }
    const stillThere = await call('GET', `/v1/selection-lists/${listId}`, undefined, tok(U1, ORG));
    expect(stillThere.status).toBe(200);
  });
});
