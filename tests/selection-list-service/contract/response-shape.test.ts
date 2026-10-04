/**
 * Response-shape conformance against openapi.yaml 4.0.0 (the frozen contract).
 *
 * Every response the suite provokes is validated, with Ajv, against the schema the SPEC FILE
 * declares for that operation + status — so a missing required `seed`, a `created_by` outside
 * `AuthorPrincipal` (usr_ | system: | [deleted-user]), an undeclared property
 * (`additionalProperties: false`) or a malformed page envelope fails here, independent of the
 * service's own types.
 *
 * 4.0.0 specifics asserted explicitly (not just via the schema):
 *   - `seed` is REQUIRED and nullable on lists and items: `null` for a user-authored row;
 *   - `created_by` / `granted_by` are an `AuthorPrincipal`.
 * Seeded rows (`seed` object, `system:` created_by) and the `[deleted-user]` sentinel are
 * exercised in contract/seeding.test.ts, which has a way to produce them.
 */
import { mintTestToken } from '../helpers/auth';
import { rawFetch } from '../helpers/client';
import { assertResponse, assertSchema, schemaErrors, specVersion } from '../helpers/openapi';

const ORG = 'org_01test0000000shape000000000';
const USER = 'usr_01test0000000shapeusera0000';
const USER_B = 'usr_01test0000000shapeuserb0000';
const token = () => mintTestToken({ userId: USER, organizationId: ORG });
const call = (method: string, path: string, body?: unknown, tok = token()) =>
  rawFetch(path, { method, token: tok, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const rnd = () => Math.random().toString(16).slice(2, 8);

const P_LISTS = '/v1/selection-lists';
const P_LIST = '/v1/selection-lists/{listId}';
const P_ITEMS = '/v1/selection-lists/{listId}/items';
const P_ITEM = '/v1/selection-lists/{listId}/items/{itemId}';
const P_ACCESS = '/v1/selection-lists/{listId}/access';
const P_ACCESS_USER = '/v1/selection-lists/{listId}/access/{userId}';

let listId: string;
let itemId: string;
const L = () => `/v1/selection-lists/${encodeURIComponent(listId)}`;

beforeAll(async () => {
  const l = await call('POST', P_LISTS, { key: `shape-${rnd()}-${rnd()}`, name: 'Shape list', description: 'd', source_locale: 'en' });
  expect(l.status).toBe(201);
  assertResponse('POST', P_LISTS, 201, l.body);
  listId = (l.body as { id: string }).id;
  const i = await call('POST', `${L()}/items`, { code: 'SHAPE', label: 'Shape item', description: 'x' });
  expect(i.status).toBe(201);
  itemId = (i.body as { id: string }).id;
});

it('the spec under test is the 4.x contract', () => {
  expect(specVersion()).toMatch(/^4\./);
});

describe('SelectionList', () => {
  it('create (201) conforms and carries seed: null and a usr_ created_by', async () => {
    const res = await call('POST', P_LISTS, { key: `shape-c-${rnd()}-${rnd()}`, name: 'Created' });
    expect(res.status).toBe(201);
    assertResponse('POST', P_LISTS, 201, res.body);
    const body = res.body as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(body, 'seed')).toBe(true);
    expect(body['seed']).toBeNull();
    expect(body['created_by']).toBe(USER);
    expect(body['organization_id']).toBe(ORG);
  });

  it('get (200), patch (200) and the page of lists (200) conform', async () => {
    const get = await call('GET', L());
    expect(get.status).toBe(200);
    assertResponse('GET', P_LIST, 200, get.body);

    const patch = await call('PATCH', L(), { description: 'patched' });
    expect(patch.status).toBe(200);
    assertResponse('PATCH', P_LIST, 200, patch.body);
    expect((patch.body as { seed: unknown }).seed).toBeNull();

    const page = await call('GET', `${P_LISTS}?limit=5`);
    expect(page.status).toBe(200);
    assertResponse('GET', P_LISTS, 200, page.body);
    for (const row of (page.body as { items: Array<{ seed: unknown }> }).items) expect(row.seed).toBeNull();
  });

  it('archive (200) conforms; status is "archived"', async () => {
    const created = await call('POST', P_LISTS, { key: `shape-a-${rnd()}-${rnd()}`, name: 'To archive' });
    const id = encodeURIComponent((created.body as { id: string }).id);
    const res = await call('POST', `/v1/selection-lists/${id}/archive`);
    expect(res.status).toBe(200);
    assertResponse('POST', '/v1/selection-lists/{listId}/archive', 200, res.body);
    expect((res.body as { status: string }).status).toBe('archived');
  });

  it('a body missing `seed` or with a malformed created_by does NOT conform (the validator has teeth)', async () => {
    const get = await call('GET', L());
    const { seed: _drop, ...withoutSeed } = get.body as Record<string, unknown>;
    expect(schemaErrors('SelectionList', withoutSeed).join()).toMatch(/seed/);
    expect(schemaErrors('SelectionList', { ...(get.body as object), created_by: 'org_01abc' })).not.toEqual([]);
    expect(schemaErrors('SelectionList', { ...(get.body as object), created_by: 'system:Bad Name' })).not.toEqual([]);
    expect(schemaErrors('SelectionList', { ...(get.body as object), extra: 1 })).not.toEqual([]);
    // the three widened author forms are accepted
    for (const ok of ['usr_01h455vb4pex5vsknk084sn02q', 'system:selection-list-service', '[deleted-user]']) {
      expect(schemaErrors('SelectionList', { ...(get.body as object), created_by: ok })).toEqual([]);
    }
  });
});

describe('SelectionListItem', () => {
  it('create (201), get page (200), patch (200) conform and carry seed: null', async () => {
    const created = await call('POST', `${L()}/items`, { code: `IT${rnd()}`, label: 'Another', sort_order: 500 });
    expect(created.status).toBe(201);
    assertResponse('POST', P_ITEMS, 201, created.body);
    expect((created.body as { seed: unknown }).seed).toBeNull();
    expect((created.body as { created_by: unknown }).created_by).toBe(USER);

    const page = await call('GET', `${L()}/items?limit=10`);
    expect(page.status).toBe(200);
    assertResponse('GET', P_ITEMS, 200, page.body);
    expect((page.body as { items: unknown[] }).items.length).toBeGreaterThanOrEqual(2);

    const patched = await call('PATCH', `${L()}/items/${itemId}`, { label: 'Relabelled' });
    expect(patched.status).toBe(200);
    assertResponse('PATCH', P_ITEM, 200, patched.body);
  });

  it('a body missing `seed` does not conform to SelectionListItem', async () => {
    const page = await call('GET', `${L()}/items`);
    const first = (page.body as { items: Array<Record<string, unknown>> }).items[0];
    const { seed: _drop, ...rest } = first;
    expect(schemaErrors('SelectionListItem', rest).join()).toMatch(/seed/);
  });
});

describe('SelectionListAccessGrant', () => {
  it('set (200), list (200) conform; granted_by is the granting user', async () => {
    const set = await call('PUT', `${L()}/access/${USER_B}`, { role: 'list-contributor' });
    expect(set.status).toBe(200);
    assertResponse('PUT', P_ACCESS_USER, 200, set.body);
    expect((set.body as { granted_by: string }).granted_by).toBe(USER);

    const all = await call('GET', `${L()}/access`);
    expect(all.status).toBe(200);
    assertResponse('GET', P_ACCESS, 200, all.body);
    const owner = (all.body as { items: Array<{ user_id: string; role: string; granted_by: string }> }).items.find((g) => g.user_id === USER);
    expect(owner?.role).toBe('list-owner');
    // the owner grant the SERVICE wrote on create is attributed to the creating user
    expect(owner?.granted_by).toBe(USER);
  });

  it('a grant with a non-usr_/system:/[deleted-user] granted_by does not conform', () => {
    const base = { list_id: 'front_sl_01abc', user_id: USER, role: 'list-viewer', granted_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
    expect(schemaErrors('SelectionListAccessGrant', { ...base, granted_by: USER })).toEqual([]);
    expect(schemaErrors('SelectionListAccessGrant', { ...base, granted_by: 'system:selection-list-service' })).toEqual([]);
    expect(schemaErrors('SelectionListAccessGrant', { ...base, granted_by: '[deleted-user]' })).toEqual([]);
    expect(schemaErrors('SelectionListAccessGrant', { ...base, granted_by: 'org_01abc' })).not.toEqual([]);
    expect(schemaErrors('SelectionListAccessGrant', { ...base, granted_by: '' })).not.toEqual([]);
  });
});

describe('other resources and the error envelope', () => {
  it('quota (200) and resolve (200) conform', async () => {
    const quota = await call('GET', `${P_LISTS}/quota`);
    expect(quota.status).toBe(200);
    assertResponse('GET', '/v1/selection-lists/quota', 200, quota.body);
    const resolved = await call('POST', '/v1/resolve', { ids: [itemId] });
    expect(resolved.status).toBe(200);
    assertResponse('POST', '/v1/resolve', 200, resolved.body);
  });

  it('error responses use the declared Error schema: 400, 404, 409', async () => {
    const bad = await call('POST', P_LISTS, { key: 'x' });
    expect(bad.status).toBe(400);
    assertSchema('Error', bad.body);

    const missing = await call('GET', '/v1/selection-lists/front_sl_00000000000000000000000000');
    expect(missing.status).toBe(404);
    assertSchema('Error', missing.body);

    const dupe = await call('POST', `${L()}/items`, { code: 'SHAPE', label: 'again' });
    expect(dupe.status).toBe(409);
    assertSchema('Error', dupe.body);
  });

  it('401 without a token and 403 for a forbidden tenant role use the Error schema', async () => {
    const anon = await rawFetch(P_LISTS, { method: 'GET' });
    expect(anon.status).toBe(401);
    assertSchema('Error', anon.body);
    const dev = await call('GET', P_LISTS, undefined, mintTestToken({ userId: USER, organizationId: ORG, roles: ['developer'] }));
    expect(dev.status).toBe(403);
    assertSchema('Error', dev.body);
  });
});
