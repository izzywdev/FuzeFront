/**
 * Authorization matrix test — every role does exactly what the spec allows.
 *
 * Contract (openapi.yaml §Authorization):
 *
 *   | role              | read | add_value | update_value | remove_value | translate | update | delete | manage_access |
 *   |-------------------|------|-----------|--------------|--------------|-----------|--------|--------|---------------|
 *   | list-owner        |  x   |     x     |      x       |      x       |     x     |   x    |   x    |       x       |
 *   | list-editor       |  x   |     x     |      x       |      x       |     x     |   x    |        |               |
 *   | list-contributor  |  x   |     x     |      x       |              |     x     |        |        |               |
 *   | list-translator   |  x   |           |              |              |     x     |        |        |               |
 *   | list-viewer       |  x   |           |              |              |           |        |        |               |
 *
 * Each test cell:
 *   ALLOWED → assert 2xx
 *   DENIED  → assert 403 (or 404 for reads, per the "not an existence oracle" rule)
 *
 * Additionally (contract 3.0.0, docs/planning/selection-lists-permit-actions.md
 * §4.2/§5): per-list actions are INSTANCE-ONLY. A tenant role (admin included)
 * confers none of them, and there is NO automatic org-admin -> list-owner
 * derivation. A tenant admin reaches a list only through an explicit
 * `list-owner` grant (the support path).
 *
 * GREEN against the service; gated in CI by selection-list-service-integration-tests.
 */

import { makeClient, rawFetch } from '../helpers/client';
import { mintTestToken } from '../helpers/auth';
import { createTestList, createTestListWithItems, purgeList } from '../helpers/factories';
import type { SelectionListId, SelectionListItemId } from '../helpers/factories';

// ---------------------------------------------------------------------------
// Test org — one org, one list, multiple actors
// ---------------------------------------------------------------------------

const ORG_ID = 'org_01test00000000authz0000000';
const USER_OWNER = 'usr_01test00000000authzowner00';
const USER_EDITOR = 'usr_01test00000000authzeditor0';
const USER_CONTRIBUTOR = 'usr_01test00000000authzcontrib';
const USER_TRANSLATOR = 'usr_01test00000000authztransl0';
const USER_VIEWER = 'usr_01test00000000authzviewer0';
const USER_ORG_ADMIN = 'usr_01test00000000authzadmin00';

function tokenFor(userId: string, roles: string[] = []): string {
  return mintTestToken({ userId, organizationId: ORG_ID, roles });
}

// Shared test list and item — created once, each test reads or writes to it
let sharedListId: SelectionListId;
let sharedItemId: SelectionListItemId;

beforeAll(async () => {
  const ownerClient = makeClient(() => tokenFor(USER_OWNER));
  const { list, items } = await createTestListWithItems(ownerClient, 1, {
    key: 'authz-matrix-' + Math.random().toString(16).slice(2, 8),
    name: 'AuthZ Matrix Test',
    source_locale: 'en',
  });
  sharedListId = list.id as SelectionListId;
  sharedItemId = items[0].id as SelectionListItemId;

  // Grant roles to test actors
  await ownerClient.setAccess(sharedListId, USER_EDITOR, 'list-editor');
  await ownerClient.setAccess(sharedListId, USER_CONTRIBUTOR, 'list-contributor');
  await ownerClient.setAccess(sharedListId, USER_TRANSLATOR, 'list-translator');
  await ownerClient.setAccess(sharedListId, USER_VIEWER, 'list-viewer');
  // USER_ORG_ADMIN has roles: ['org-admin'] in JWT; no explicit list grant
});

afterAll(async () => {
  const ownerClient = makeClient(() => tokenFor(USER_OWNER));
  await purgeList(ownerClient, sharedListId);
});

// ---------------------------------------------------------------------------
// Helpers — raw action calls that return { status, body }
// ---------------------------------------------------------------------------

function doRead(token: string) {
  return rawFetch(`/v1/selection-lists/${encodeURIComponent(sharedListId)}`, {
    method: 'GET',
    token,
  });
}

function doAddValue(token: string, suffix: string) {
  return rawFetch(`/v1/selection-lists/${encodeURIComponent(sharedListId)}/items`, {
    method: 'POST',
    token,
    body: JSON.stringify({ code: `ADD${suffix}`, label: `Added ${suffix}` }),
  });
}

function doUpdateValue(token: string) {
  return rawFetch(
    `/v1/selection-lists/${encodeURIComponent(sharedListId)}/items/${encodeURIComponent(sharedItemId)}`,
    {
      method: 'PATCH',
      token,
      body: JSON.stringify({ label: 'Updated by test' }),
    }
  );
}

function doRemoveValue(token: string) {
  return rawFetch(
    `/v1/selection-lists/${encodeURIComponent(sharedListId)}/items/${encodeURIComponent(sharedItemId)}`,
    { method: 'DELETE', token }
  );
}

function doTranslate(token: string) {
  return rawFetch(
    `/v1/selection-lists/${encodeURIComponent(sharedListId)}/translations/fr`,
    {
      method: 'PUT',
      token,
      body: JSON.stringify({ name: 'Nom en français' }),
    }
  );
}

function doUpdate(token: string) {
  return rawFetch(`/v1/selection-lists/${encodeURIComponent(sharedListId)}`, {
    method: 'PATCH',
    token,
    body: JSON.stringify({ name: 'Updated List Name' }),
  });
}

function doDelete(token: string) {
  return rawFetch(`/v1/selection-lists/${encodeURIComponent(sharedListId)}`, {
    method: 'DELETE',
    token,
  });
}

function doManageAccess(token: string) {
  return rawFetch(`/v1/selection-lists/${encodeURIComponent(sharedListId)}/access`, {
    method: 'GET',
    token,
  });
}

// ---------------------------------------------------------------------------
// list-viewer: read only
// ---------------------------------------------------------------------------

describe('list-viewer role', () => {
  const token = () => tokenFor(USER_VIEWER);

  it('can: read', async () => {
    const { status } = await doRead(token());
    expect(status).toBe(200);
  });

  it('cannot: add_value → 403', async () => {
    const { status } = await doAddValue(token(), 'viewer');
    expect(status).toBe(403);
  });

  it('cannot: update_value → 403', async () => {
    const { status } = await doUpdateValue(token());
    expect(status).toBe(403);
  });

  it('cannot: remove_value → 403', async () => {
    const { status } = await doRemoveValue(token());
    expect(status).toBe(403);
  });

  it('cannot: translate → 403', async () => {
    const { status } = await doTranslate(token());
    expect(status).toBe(403);
  });

  it('cannot: update → 403', async () => {
    const { status } = await doUpdate(token());
    expect(status).toBe(403);
  });

  it('cannot: delete → 403', async () => {
    const { status } = await doDelete(token());
    expect(status).toBe(403);
  });

  it('cannot: manage_access → 403', async () => {
    const { status } = await doManageAccess(token());
    expect(status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// list-contributor: read + add_value + update_value + translate
// ---------------------------------------------------------------------------

describe('list-contributor role', () => {
  const token = () => tokenFor(USER_CONTRIBUTOR);

  it('can: read', async () => {
    const { status } = await doRead(token());
    expect(status).toBe(200);
  });

  it('can: add_value', async () => {
    const { status } = await doAddValue(token(), 'contrib');
    expect(status).toBe(201);
  });

  it('can: update_value', async () => {
    const { status } = await doUpdateValue(token());
    expect(status).toBe(200);
  });

  it('cannot: remove_value → 403', async () => {
    const { status } = await doRemoveValue(token());
    expect(status).toBe(403);
  });

  it('can: translate', async () => {
    const { status } = await doTranslate(token());
    expect(status).toBe(200);
  });

  it('cannot: update (list metadata) → 403', async () => {
    const { status } = await doUpdate(token());
    expect(status).toBe(403);
  });

  it('cannot: delete → 403', async () => {
    const { status } = await doDelete(token());
    expect(status).toBe(403);
  });

  it('cannot: manage_access → 403', async () => {
    const { status } = await doManageAccess(token());
    expect(status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// list-translator: read + translate only
// ---------------------------------------------------------------------------

describe('list-translator role', () => {
  const token = () => tokenFor(USER_TRANSLATOR);

  it('can: read', async () => {
    const { status } = await doRead(token());
    expect(status).toBe(200);
  });

  it('cannot: add_value → 403', async () => {
    const { status } = await doAddValue(token(), 'transl');
    expect(status).toBe(403);
  });

  it('cannot: update_value → 403', async () => {
    const { status } = await doUpdateValue(token());
    expect(status).toBe(403);
  });

  it('cannot: remove_value → 403', async () => {
    const { status } = await doRemoveValue(token());
    expect(status).toBe(403);
  });

  it('can: translate', async () => {
    const { status } = await doTranslate(token());
    expect(status).toBe(200);
  });

  it('cannot: update → 403', async () => {
    const { status } = await doUpdate(token());
    expect(status).toBe(403);
  });

  it('cannot: delete → 403', async () => {
    const { status } = await doDelete(token());
    expect(status).toBe(403);
  });

  it('cannot: manage_access → 403', async () => {
    const { status } = await doManageAccess(token());
    expect(status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// list-editor: read + add_value + update_value + remove_value + translate + update
// ---------------------------------------------------------------------------

describe('list-editor role', () => {
  const token = () => tokenFor(USER_EDITOR);

  it('can: read', async () => {
    const { status } = await doRead(token());
    expect(status).toBe(200);
  });

  it('can: add_value', async () => {
    const { status } = await doAddValue(token(), 'editor');
    expect(status).toBe(201);
  });

  it('can: update_value', async () => {
    const { status } = await doUpdateValue(token());
    expect(status).toBe(200);
  });

  it('can: remove_value', async () => {
    // archive (not purge) so the item persists for later tests
    const ownerClient = makeClient(() => tokenFor(USER_OWNER));
    const extraList = await createTestList(ownerClient, {
      key: 'editor-rm-' + Math.random().toString(16).slice(2, 8),
      name: 'Editor Remove Test',
    });
    await ownerClient.setAccess(extraList.id as SelectionListId, USER_EDITOR, 'list-editor');
    const extraItem = await ownerClient.createItem(extraList.id as SelectionListId, {
      code: 'RM', label: 'Removable',
    });

    const { status } = await rawFetch(
      `/v1/selection-lists/${encodeURIComponent(extraList.id)}/items/${encodeURIComponent(extraItem.id)}`,
      { method: 'DELETE', token: token() }
    );
    expect(status).toBe(200); // archived; 200 returned with archived item

    await purgeList(ownerClient, extraList.id as SelectionListId);
  });

  it('can: translate', async () => {
    const { status } = await doTranslate(token());
    expect(status).toBe(200);
  });

  it('can: update (list metadata)', async () => {
    const { status } = await doUpdate(token());
    expect(status).toBe(200);
  });

  it('cannot: delete → 403', async () => {
    const { status } = await doDelete(token());
    expect(status).toBe(403);
  });

  it('cannot: manage_access → 403', async () => {
    const { status } = await doManageAccess(token());
    expect(status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// list-owner: all 8 actions
// ---------------------------------------------------------------------------

describe('list-owner role', () => {
  const token = () => tokenFor(USER_OWNER);

  it('can: read', async () => {
    const { status } = await doRead(token());
    expect(status).toBe(200);
  });

  it('can: add_value', async () => {
    const { status } = await doAddValue(token(), 'owner');
    expect(status).toBe(201);
  });

  it('can: update_value', async () => {
    const { status } = await doUpdateValue(token());
    expect(status).toBe(200);
  });

  // remove_value (archive; not purge) tested via archive endpoint
  it('can: remove_value (archive item)', async () => {
    const ownerClient = makeClient(token);
    const extraItem = await ownerClient.createItem(sharedListId, {
      code: 'OWN-RM' + Math.random().toString(16).slice(2, 6),
      label: 'Owner Removable',
    });
    const { status } = await rawFetch(
      `/v1/selection-lists/${encodeURIComponent(sharedListId)}/items/${encodeURIComponent(extraItem.id)}`,
      { method: 'DELETE', token: token() }
    );
    expect(status).toBe(200);
  });

  it('can: translate', async () => {
    const { status } = await doTranslate(token());
    expect(status).toBe(200);
  });

  it('can: update', async () => {
    const { status } = await doUpdate(token());
    expect(status).toBe(200);
  });

  // delete is tested on a fresh list (not the shared one) to avoid purging the fixture
  it('can: delete (archive)', async () => {
    const ownerClient = makeClient(token);
    const disposable = await createTestList(ownerClient, {
      key: 'owner-del-' + Math.random().toString(16).slice(2, 8),
      name: 'Deleteable by Owner',
    });
    const { status } = await rawFetch(
      `/v1/selection-lists/${encodeURIComponent(disposable.id)}`,
      { method: 'DELETE', token: token() }
    );
    expect([200, 204]).toContain(status);
    // purge it fully
    await purgeList(ownerClient, disposable.id as SelectionListId);
  });

  it('can: manage_access', async () => {
    const { status } = await doManageAccess(token());
    expect(status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Tenant admin does NOT derive list-owner (contract 3.0.0, review H-3)
//
// Replaces the 2.0.0 block "org-admin implicit list-owner", which asserted the
// opposite. 3.0.0 splits authorization into the tenant-level
// SelectionListCatalog (tenant roles) and the instance-level SelectionList
// (per-list roles only): a tenant role confers NO per-list action, so an org
// admin with no instance role on a list is treated like any other non-member of
// that list — 404 on reads (no existence oracle), 403 on writes — until it is
// explicitly granted list-owner.
// ---------------------------------------------------------------------------

// Run for BOTH spellings: `admin` is the tenant role the 3.0.0 contract names
// (docs/planning/selection-lists-permit-actions.md §4.1/§5 — customer org administrators hold the
// TENANT role `admin`; ReBAC `org-admin` is FuzeOne staff), `org-admin` is the legacy claim the
// stand-in Security API aliases to `admin`. The original block only exercised the alias.
describe.each([
  ['admin', 'usr_01test00000000authztenadmin0'],
  ['org-admin', USER_ORG_ADMIN],
])('tenant role %s has no implicit list-owner (3.0.0)', (tenantRole, adminUser) => {
  const adminToken = () => tokenFor(adminUser, [tenantRole]);

  let orgAdminListId: SelectionListId;

  beforeAll(async () => {
    // Create a list as USER_OWNER; USER_ORG_ADMIN has no explicit grant
    const ownerClient = makeClient(() => tokenFor(USER_OWNER));
    const list = await createTestList(ownerClient, {
      key: 'org-admin-' + Math.random().toString(16).slice(2, 8),
      name: 'Org Admin Test',
    });
    orgAdminListId = list.id as SelectionListId;
  });

  afterAll(async () => {
    const ownerClient = makeClient(() => tokenFor(USER_OWNER));
    await purgeList(ownerClient, orgAdminListId);
  });

  it('org admin can NOT read a list it holds no instance role on (404, not 403)', async () => {
    const { status } = await rawFetch(`/v1/selection-lists/${encodeURIComponent(orgAdminListId)}`, {
      method: 'GET',
      token: adminToken(),
    });
    expect(status).toBe(404);
  });

  it('org admin can NOT update list metadata without an instance role', async () => {
    const { status } = await rawFetch(`/v1/selection-lists/${encodeURIComponent(orgAdminListId)}`, {
      method: 'PATCH',
      token: adminToken(),
      body: JSON.stringify({ name: 'Admin-updated Name' }),
    });
    expect(status).toBe(403);
  });

  it('org admin can NOT manage_access on a list it holds no instance role on', async () => {
    const { status } = await rawFetch(
      `/v1/selection-lists/${encodeURIComponent(orgAdminListId)}/access`,
      { method: 'GET', token: adminToken() }
    );
    expect(status).toBe(403);
  });

  it('org admin can NOT delete (archive) a list it holds no instance role on, and the list survives', async () => {
    const ownerClient = makeClient(() => tokenFor(USER_OWNER));
    const disposable = await createTestList(ownerClient, {
      key: 'admin-del-' + Math.random().toString(16).slice(2, 8),
      name: 'Admin Deleteable',
    });

    const { status } = await rawFetch(`/v1/selection-lists/${encodeURIComponent(disposable.id)}`, {
      method: 'DELETE',
      token: adminToken(),
    });
    expect(status).toBe(403);

    const still = await rawFetch(`/v1/selection-lists/${encodeURIComponent(disposable.id)}`, {
      method: 'GET',
      token: tokenFor(USER_OWNER),
    });
    expect(still.status).toBe(200);
    await purgeList(ownerClient, disposable.id as SelectionListId);
  });

  it('...but CAN use the tenant-level catalog (list, create), and sees no list it holds no role on', async () => {
    const res = await rawFetch('/v1/selection-lists?limit=200', { method: 'GET', token: adminToken() });
    expect(res.status).toBe(200);
    const items = ((res.body as { items?: Array<{ id: string }> } | null)?.items ?? []) as Array<{ id: string }>;
    expect(items.map((i) => i.id)).not.toContain(orgAdminListId);

    // `create` is half of what this test's title claims; it was previously never asserted
    const created = await rawFetch('/v1/selection-lists', {
      method: 'POST',
      token: adminToken(),
      body: JSON.stringify({ key: 'admin-own-' + Math.random().toString(16).slice(2, 8), name: 'Admin created' }),
    });
    expect(created.status).toBe(201);
    await purgeList(makeClient(adminToken), (created.body as { id: string }).id as SelectionListId);
  });

  it('can NOT reach ANY other per-list action either: items, translations, reorder, archive, purge, grants (403/404, state unchanged)', async () => {
    const ownerClient = makeClient(() => tokenFor(USER_OWNER));
    const { list, items } = await createTestListWithItems(ownerClient, 2, {
      key: 'admin-deny-' + Math.random().toString(16).slice(2, 8),
      name: 'Admin Denied Everything',
    });
    const L = `/v1/selection-lists/${encodeURIComponent(list.id)}`;
    const [i1, i2] = items.map((i) => encodeURIComponent(i.id));
    const attempts: Array<[string, string, unknown]> = [
      ['GET', `${L}/items`, undefined],
      ['POST', `${L}/items`, { code: 'ADMINADD', label: 'x' }],
      ['PATCH', `${L}/items/${i1}`, { label: 'admin edit' }],
      ['PUT', `${L}/items/reorder`, { item_ids: [i2, i1] }],
      ['POST', `${L}/items/${i1}/archive`, undefined],
      ['DELETE', `${L}/items/${i1}`, undefined],
      ['DELETE', `${L}/items/${i1}?purge=true`, undefined],
      ['GET', `${L}/translations`, undefined],
      ['PUT', `${L}/translations/fr`, { name: 'x' }],
      ['PUT', `${L}/items/${i1}/translations/fr`, { label: 'x' }],
      ['POST', `${L}/translations/fr/autofill`, {}],
      ['POST', `${L}/archive`, undefined],
      ['PATCH', L, { status: 'archived' }],
      ['DELETE', `${L}?purge=true`, undefined],
      ['PUT', `${L}/access/${encodeURIComponent(adminUser)}`, { role: 'list-owner' }], // self-escalation
      ['DELETE', `${L}/access/${encodeURIComponent(USER_OWNER)}`, undefined],
    ];
    for (const [method, path, body] of attempts) {
      const res = await rawFetch(path, { method, token: adminToken(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (![403, 404].includes(res.status)) {
        throw new Error(`${method} ${path} by tenant ${tenantRole} with no instance role returned ${res.status}, expected 403/404`);
      }
    }
    // nothing changed: still active, 2 active items, owner is the only grant
    const after = await rawFetch(L, { method: 'GET', token: tokenFor(USER_OWNER) });
    expect(after.body).toMatchObject({ status: 'active', name: 'Admin Denied Everything' });
    const itemsNow = await rawFetch(`${L}/items`, { method: 'GET', token: tokenFor(USER_OWNER) });
    expect(((itemsNow.body as { items: Array<{ status: string }> }).items).map((i) => i.status)).toEqual(['active', 'active']);
    const access = await rawFetch(`${L}/access`, { method: 'GET', token: tokenFor(USER_OWNER) });
    expect(((access.body as { items: Array<{ user_id: string }> }).items).map((g) => g.user_id)).toEqual([USER_OWNER]);
    await purgeList(ownerClient, list.id as SelectionListId);
  });

  it('once EXPLICITLY granted list-owner, the admin is a list-owner of that list', async () => {
    const ownerClient = makeClient(() => tokenFor(USER_OWNER));
    await ownerClient.setAccess(orgAdminListId, adminUser, 'list-owner');
    const { status } = await rawFetch(`/v1/selection-lists/${encodeURIComponent(orgAdminListId)}`, {
      method: 'GET',
      token: adminToken(),
    });
    expect(status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Id-not-capability: knowing a list id grants nothing
// ---------------------------------------------------------------------------

describe('id is not a capability', () => {
  it('a user with no grant on a list gets 404 (not 403) when reading it', async () => {
    const ownerClient = makeClient(() => tokenFor(USER_OWNER));
    const privateList = await createTestList(ownerClient, {
      key: 'no-cap-' + Math.random().toString(16).slice(2, 8),
      name: 'Private List',
    });

    const noGrantToken = mintTestToken({
      userId: 'usr_01test00000000authznogrant',
      organizationId: ORG_ID,
    });

    const { status } = await rawFetch(`/v1/selection-lists/${encodeURIComponent(privateList.id)}`, {
      method: 'GET',
      token: noGrantToken,
    });
    // Must be 404 — not 403 — so the API is not an existence oracle
    expect(status).toBe(404);

    await purgeList(ownerClient, privateList.id as SelectionListId);
  });
});
