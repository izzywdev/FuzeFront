/**
 * Tenant-level (catalog) authorization — contract 3.0.0, review H-3 / M-1 / L-1.
 *
 * Contract: docs/planning/selection-lists-permit-actions.md
 *
 *   tenant role | list | create | read_quota | resolve      (resource SelectionListCatalog, keyless)
 *   ------------|------|--------|------------|--------
 *   admin       |  x   |   x    |     x      |   x
 *   editor      |  x   |   x    |            |   x
 *   viewer      |  x   |        |            |   x
 *   developer   |      |        |            |
 *
 * Per-list actions are INSTANCE-ONLY: no tenant role confers any of them, so
 *   - a tenant role never lets a caller read/write a list it holds no
 *     instance role on, and GET / returns only lists the caller holds a role on;
 *   - the creator of a list is its list-owner (granted by the SERVICE with its
 *     machine identity), not because the tenant role implies anything.
 *
 * Additionally:
 *   - item purge (?purge=true) needs `delete` on the list -> list-owner only (M-1)
 *   - PATCH {status:"archived"} needs the archive action (`delete`) (L-1)
 *
 * The stand-in Security API (helpers/fake-security-api.mjs) implements exactly
 * this matrix, reading the tenant role from the JWT `roles` claim.
 */

import { makeClient, rawFetch } from '../helpers/client';
import { mintTestToken } from '../helpers/auth';
import { createTestListWithItems, purgeList } from '../helpers/factories';
import { closeDb, dbQuery } from '../helpers/db';
import type { SelectionListId, SelectionListItemId } from '../helpers/factories';

const ORG_ID = 'org_01test0000000catalog000000';
const USER_ADMIN = 'usr_01test0000000catalogadmin0';
const USER_EDITOR = 'usr_01test0000000catalogeditor';
const USER_VIEWER = 'usr_01test0000000catalogviewer';
const USER_DEVELOPER = 'usr_01test0000000catalogdevelop';
const USER_LIST_EDITOR = 'usr_01test0000000cataloglisted0';

const token = (userId: string, role: string) =>
  mintTestToken({ userId, organizationId: ORG_ID, roles: [role] });

const adminToken = () => token(USER_ADMIN, 'admin');
const editorToken = () => token(USER_EDITOR, 'editor');
const viewerToken = () => token(USER_VIEWER, 'viewer');
const developerToken = () => token(USER_DEVELOPER, 'developer');

const get = (path: string, t: string) => rawFetch(path, { method: 'GET', token: t });

let adminListId: SelectionListId;
let adminItemId: SelectionListItemId;

beforeAll(async () => {
  const adminClient = makeClient(adminToken);
  const { list, items } = await createTestListWithItems(adminClient, 1, {
    key: 'catalog-' + Math.random().toString(16).slice(2, 8),
    name: 'Catalog Matrix List',
  });
  adminListId = list.id as SelectionListId;
  adminItemId = items[0].id as SelectionListItemId;
});

afterAll(async () => {
  await purgeList(makeClient(adminToken), adminListId);
  await closeDb();
});

describe('GET /v1/selection-lists — catalog `list`', () => {
  it.each([
    ['admin', adminToken, 200],
    ['editor', editorToken, 200],
    ['viewer', viewerToken, 200],
    ['developer', developerToken, 403],
  ])('tenant %s -> %i', async (_role, tok, expected) => {
    const res = await get('/v1/selection-lists?limit=200', tok());
    expect(res.status).toBe(expected);
  });

  it('a tenant role does not reveal lists the caller holds no instance role on', async () => {
    for (const tok of [editorToken, viewerToken]) {
      const res = await get('/v1/selection-lists?limit=200', tok());
      expect(res.status).toBe(200);
      const ids = ((res.body as { items: Array<{ id: string }> }).items ?? []).map((i) => i.id);
      expect(ids).not.toContain(adminListId);
    }
  });

  it('the list creator (the admin, via its list-owner grant) does see it', async () => {
    const res = await get('/v1/selection-lists?limit=200', adminToken());
    const ids = ((res.body as { items: Array<{ id: string }> }).items ?? []).map((i) => i.id);
    expect(ids).toContain(adminListId);
  });
});

describe('POST /v1/selection-lists — catalog `create`', () => {
  const create = (t: string) =>
    rawFetch('/v1/selection-lists', {
      method: 'POST',
      token: t,
      body: JSON.stringify({ key: 'cat-' + Math.random().toString(16).slice(2, 9), name: 'Created', source_locale: 'en' }),
    });

  it.each([
    ['viewer', viewerToken, 403],
    ['developer', developerToken, 403],
  ])('tenant %s -> %i and nothing is created', async (_role, tok, expected) => {
    const key = 'cat-deny-' + Math.random().toString(16).slice(2, 9);
    const res = await rawFetch('/v1/selection-lists', {
      method: 'POST',
      token: tok(),
      body: JSON.stringify({ key, name: 'Must not exist', source_locale: 'en' }),
    });
    expect(res.status).toBe(expected);
    // the title always claimed this; it was never asserted
    expect(await dbQuery('SELECT 1 FROM selection_lists WHERE organization_id = $1 AND key = $2', [ORG_ID, key])).toEqual([]);
  });

  it('tenant editor can create, and is then list-owner of its own list (granted by the service)', async () => {
    const res = await create(editorToken());
    expect(res.status).toBe(201);
    const id = (res.body as { id: string }).id as SelectionListId;
    try {
      // owner-level action (`delete` via archive) proves list-owner, not just read
      const archived = await rawFetch(`/v1/selection-lists/${encodeURIComponent(id)}/archive`, {
        method: 'POST',
        token: editorToken(),
      });
      expect(archived.status).toBe(200);
    } finally {
      await purgeList(makeClient(editorToken), id);
    }
  });
});

describe('GET /v1/selection-lists/quota — catalog `read_quota`', () => {
  it.each([
    ['admin', adminToken, 200],
    ['editor', editorToken, 403],
    ['viewer', viewerToken, 403],
    ['developer', developerToken, 403],
  ])('tenant %s -> %i', async (_role, tok, expected) => {
    const res = await get('/v1/selection-lists/quota', tok());
    expect(res.status).toBe(expected);
  });
});

describe('POST /v1/resolve — catalog `resolve`', () => {
  const resolve = (t: string) =>
    rawFetch('/v1/resolve', { method: 'POST', token: t, body: JSON.stringify({ ids: [adminItemId] }) });

  it.each([
    ['admin', adminToken, 200],
    ['editor', editorToken, 200],
    ['viewer', viewerToken, 200],
    ['developer', developerToken, 403],
  ])('tenant %s -> %i', async (_role, tok, expected) => {
    const res = await resolve(tok());
    expect(res.status).toBe(expected);
  });

  it('L-4 (accepted trade-off, documented): a viewer holding NO role on the list can still resolve its item id — but only the minimal shape', async () => {
    const res = await resolve(viewerToken());
    expect(res.status).toBe(200);
    const body = res.body as { results: Record<string, Record<string, unknown>>; missing: string[] };
    expect(body.missing).toEqual([]);
    expect(Object.keys(body.results[adminItemId]).sort()).toEqual(['is_machine', 'label', 'locale', 'status']);
  });

  it('a developer gets 403 and NOTHING of the item (no partial result, no echo of the id as missing)', async () => {
    const res = await resolve(developerToken());
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain(adminItemId);
  });
});

describe('per-list actions are instance-only — a tenant role grants none', () => {
  // `developer` was missing: the contract (permit-actions §4.1) gives it NO catalog action at all, so
  // it is the role most likely to be wrongly satisfied by a per-list shortcut.
  // NOTE on the expected statuses: openapi 4.0.0 mandates 404-not-403 for READS the caller may not
  // perform (info description + `NotFound`), and declares 403 for the write operations. The
  // permit-actions doc §4 sentence "a tenant developer gets 404 on every per-list route" is broader
  // than the spec, and the spec is normative; this block pins the spec (reads 404, writes 403).
  it.each([
    ['editor', editorToken],
    ['viewer', viewerToken],
    ['developer', developerToken],
  ])('tenant %s with no instance role gets 404 reading the list and 403 writing to it', async (_r, tok) => {
    const path = `/v1/selection-lists/${encodeURIComponent(adminListId)}`;
    expect((await get(path, tok())).status).toBe(404);
    expect((await get(`${path}/items`, tok())).status).toBe(404);
    const add = await rawFetch(`${path}/items`, {
      method: 'POST',
      token: tok(),
      body: JSON.stringify({ code: 'X', label: 'X' }),
    });
    expect(add.status).toBe(403);
  });
});

describe('item purge is owner-only (M-1) and PATCH archive needs the archive action (L-1)', () => {
  let listId: SelectionListId;
  let itemIds: SelectionListItemId[];
  const listEditorToken = () => token(USER_LIST_EDITOR, 'editor');

  beforeAll(async () => {
    const adminClient = makeClient(adminToken);
    const { list, items } = await createTestListWithItems(adminClient, 3, {
      key: 'catalog-purge-' + Math.random().toString(16).slice(2, 8),
      name: 'Purge Matrix List',
    });
    listId = list.id as SelectionListId;
    itemIds = items.map((i) => i.id as SelectionListItemId);
    await adminClient.setAccess(listId, USER_LIST_EDITOR, 'list-editor');
  });

  afterAll(async () => {
    await purgeList(makeClient(adminToken), listId);
  });

  const item = (i: number, qs = '') =>
    `/v1/selection-lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemIds[i])}${qs}`;

  it('list-editor can archive an item (remove_value) ...', async () => {
    const res = await rawFetch(item(0), { method: 'DELETE', token: listEditorToken() });
    expect(res.status).toBe(200);
  });

  it('... but a list-editor can NOT purge it: 403, and the item still exists', async () => {
    const res = await rawFetch(item(1, '?purge=true'), { method: 'DELETE', token: listEditorToken() });
    expect(res.status).toBe(403);
    const still = await rawFetch(`/v1/selection-lists/${encodeURIComponent(listId)}/items`, {
      method: 'GET',
      token: adminToken(),
    });
    const ids = ((still.body as { items: Array<{ id: string }> }).items ?? []).map((i) => i.id);
    expect(ids).toContain(itemIds[1]);
  });

  it('the list-owner can purge it (204)', async () => {
    const res = await rawFetch(item(1, '?purge=true'), { method: 'DELETE', token: adminToken() });
    expect(res.status).toBe(204);
  });

  it('list-editor can PATCH metadata, but NOT {status:"archived"} (403, list unchanged)', async () => {
    const path = `/v1/selection-lists/${encodeURIComponent(listId)}`;
    const ok = await rawFetch(path, { method: 'PATCH', token: listEditorToken(), body: JSON.stringify({ name: 'Renamed by editor' }) });
    expect(ok.status).toBe(200);
    const denied = await rawFetch(path, { method: 'PATCH', token: listEditorToken(), body: JSON.stringify({ status: 'archived' }) });
    expect(denied.status).toBe(403);
    const now = await rawFetch(path, { method: 'GET', token: adminToken() });
    expect((now.body as { status: string }).status).toBe('active');
  });

  it('the list-owner can archive via PATCH', async () => {
    const path = `/v1/selection-lists/${encodeURIComponent(listId)}`;
    const res = await rawFetch(path, { method: 'PATCH', token: adminToken(), body: JSON.stringify({ status: 'archived' }) });
    expect(res.status).toBe(200);
    // restore so afterAll's purge path is the normal one
    const back = await rawFetch(path, { method: 'PATCH', token: adminToken(), body: JSON.stringify({ status: 'active' }) });
    expect(back.status).toBe(200);
  });
});
