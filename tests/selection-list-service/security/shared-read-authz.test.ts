/**
 * Shared-read authorization (SL9) — visibility widens READING only, never writing, and never across tenants.
 * Written against the FROZEN contract (openapi.yaml 4.1.0) and the design record
 * docs/planning/selection-lists-shared-and-fork.md. Needs the shared-lists flag ON (see
 * helpers/shared-lists.ts for how the harness turns it on); runs against the stand-in Security API.
 *
 * Design-record rows pinned (§ = section of the record):
 *   §11.2  shared read: a member (admin/editor/viewer) of X reads an `org` list of X without a grant;
 *          `developer` gets 404; a member of Y gets 404 on X's `org` list; any member reads a `platform`
 *          list; nobody can mutate via the shared read.
 *   §4     authz matrix rows "get / items / translations", "any mutation" (org list -> 403), "access
 *          roster/grants" (manage_access only, so a shared reader cannot see it), "list of another
 *          customer org -> 404".
 *   D3     `read_shared` is held by admin/editor/viewer and NOT by developer.
 *   D4/§6  shared read = Permit `read_shared` in the caller's OWN tenant + the service-owned visibility
 *          predicate; an id is never a capability; a customer-tenant instance grant on a common list
 *          does not make it writable (D1: a `platform` list is "immutable for tenants (they fork)").
 *   §11.3  (security angle) `include_shared=true` never surfaces another org's `org`/`private` list nor a
 *          `private` list of the caller's own org it holds no grant on.
 *
 * Every deny has a positive control in the same test (the same call as a role that is allowed, or the same
 * role on a list it may read) so a 404/403 cannot be an accident of a broken fixture.
 */
import {
  actor, call, createList, addItem, createPlatformList, expectError, fixtureGrant, L, newOrg, PLATFORM_ORG_ID,
  assertSharedListsOn, walkLists, walkItems, platformAdmin, type Actor, type ItemLike, type ListLike,
} from '../helpers/shared-lists';
import { closeDb } from '../helpers/db';
import { assertResponse } from '../helpers/openapi';

const ORG_X = newOrg('shrx');
const ORG_Y = newOrg('shry');

const owner = actor('own', ORG_X, 'admin'); // creates + owns the X fixtures
const x = {
  admin: actor('xadm', ORG_X, 'admin'),
  editor: actor('xed', ORG_X, 'editor'),
  viewer: actor('xvw', ORG_X, 'viewer'),
  developer: actor('xdev', ORG_X, 'developer'),
};
const y = {
  admin: actor('yadm', ORG_Y, 'admin'),
  editor: actor('yed', ORG_Y, 'editor'),
  viewer: actor('yvw', ORG_Y, 'viewer'),
  developer: actor('ydev', ORG_Y, 'developer'),
};

let privX: ListLike; // private list of X (owner has the only grant)
let orgX: ListLike; // `org`-visible list of X
let orgXItem: ItemLike;
let orgXItem2: ItemLike;
let orgY: ListLike; // `org`-visible list of Y
let plat: ListLike; // common list
let platItem: ItemLike;
let platOwner: Actor;

beforeAll(async () => {
  await assertSharedListsOn();
  privX = await createList(owner, { name: 'Private X' });
  orgX = await createList(owner, { name: 'Org X', visibility: 'org' });
  orgXItem = await addItem(owner, orgX.id, 'ONE');
  orgXItem2 = await addItem(owner, orgX.id, 'TWO');
  const tr = await call(owner, 'PUT', `${L(orgX.id)}/items/${orgXItem.id}/translations/fr`, { label: 'Un' });
  expect(tr.status).toBe(200);
  expect((await call(owner, 'PUT', `${L(orgX.id)}/translations/fr`, { name: 'Org X fr' })).status).toBe(200);
  orgY = await createList(y.admin, { name: 'Org Y', visibility: 'org' });
  const p = await createPlatformList({ itemCodes: ['A', 'B'] });
  plat = p.list;
  platItem = p.items[0];
  platOwner = p.owner;
});

afterAll(async () => {
  await closeDb();
});

/** The four single-list read operations the contract declares `x-permit-shared-read` on. */
const reads = (l: ListLike, item: ItemLike): Array<[string, string]> => [
  ['getSelectionList', L(l.id)],
  ['listSelectionListItems', `${L(l.id)}/items`],
  ['listSelectionListTranslations', `${L(l.id)}/translations`],
  ['listSelectionListItemTranslations', `${L(l.id)}/items/${item.id}/translations`],
];

describe('§11.2 / D3: an `org` list is readable by every member of the OWNING org without a grant — except developer', () => {
  it('controls: the owner reads every endpoint; a stranger-id is a plain 404', async () => {
    for (const [name, path] of reads(orgX, orgXItem)) {
      const res = await call(owner, 'GET', path);
      expect({ name, status: res.status }).toEqual({ name, status: 200 });
    }
    const missing = await call(x.admin, 'GET', L('front_sl_01sl9doesnotexist00000'));
    expectError(missing, 404, 'NOT_FOUND');
  });

  it.each(['admin', 'editor', 'viewer'] as const)('tenant %s (no instance grant) -> 200 on get / items / translations / item translations', async (role) => {
    for (const [name, path] of reads(orgX, orgXItem)) {
      const res = await call(x[role], 'GET', path);
      expect({ role, name, status: res.status }).toEqual({ role, name, status: 200 });
    }
    const got = await call(x[role], 'GET', L(orgX.id));
    assertResponse('GET', '/v1/selection-lists/{listId}', 200, got.body);
    expect(got.body).toMatchObject({ id: orgX.id, visibility: 'org', organization_id: ORG_X });
  });

  it('tenant developer (no read_shared) -> 404 on every read of the SAME list the viewer just read', async () => {
    for (const [name, path] of reads(orgX, orgXItem)) {
      const res = await call(x.developer, 'GET', path);
      expect({ name, status: res.status }).toEqual({ name, status: 404 });
      expectError(res, 404, 'NOT_FOUND');
    }
  });

  it('visibility is what widens the read: the same members get 404 on the `private` list of the same org', async () => {
    for (const role of ['admin', 'editor', 'viewer'] as const) {
      for (const [name, path] of [['get', L(privX.id)], ['items', `${L(privX.id)}/items`]]) {
        const res = await call(x[role], 'GET', path);
        expect({ role, name, status: res.status }).toEqual({ role, name, status: 404 });
      }
    }
    expect((await call(owner, 'GET', L(privX.id))).status).toBe(200); // control: the grant-holder reads it
  });

  it('401 without a token and with a no-org session token (the shared read needs an authenticated, org-scoped caller)', async () => {
    expect((await call(null, 'GET', L(orgX.id))).status).toBe(401);
    expect((await call('not.a.jwt', 'GET', L(orgX.id))).status).toBe(401);
  });
});

describe('§11.2 / §4: a member of ANOTHER customer org gets 404 on X\'s `org` list (and cannot tell it from a missing id)', () => {
  it.each(['admin', 'editor', 'viewer'] as const)('tenant %s of Y -> 404 on every read of X\'s `org` list', async (role) => {
    for (const [name, path] of reads(orgX, orgXItem)) {
      const res = await call(y[role], 'GET', path);
      expect({ role, name, status: res.status }).toEqual({ role, name, status: 404 });
    }
  });

  it('the cross-org 404 is indistinguishable from a never-existing id (no existence oracle)', async () => {
    const real = await call(y.admin, 'GET', L(orgX.id));
    const fake = await call(y.admin, 'GET', L('front_sl_01sl9neverexisted000000'));
    expect(real.status).toBe(fake.status);
    expect((real.body as any).code).toBe((fake.body as any).code);
    expect((real.body as any).code).toBe('NOT_FOUND');
    // control: Y reads Y's own `org` list through the very same mechanism
    expect((await call(y.viewer, 'GET', L(orgY.id))).status).toBe(200);
    expect((await call(x.viewer, 'GET', L(orgY.id))).status).toBe(404);
  });
});

describe('§11.2: any member reads a `platform` list, in any org — except developer', () => {
  it.each([
    ['X admin', x.admin], ['X editor', x.editor], ['X viewer', x.viewer],
    ['Y admin', y.admin], ['Y editor', y.editor], ['Y viewer', y.viewer],
  ] as const)('%s -> 200 on get / items / translations / item translations of the common list', async (_n, who) => {
    for (const [name, path] of reads(plat, platItem)) {
      const res = await call(who, 'GET', path);
      expect({ name, status: res.status }).toEqual({ name, status: 200 });
    }
    const got = await call(who, 'GET', L(plat.id));
    assertResponse('GET', '/v1/selection-lists/{listId}', 200, got.body);
    expect(got.body).toMatchObject({ id: plat.id, visibility: 'platform', organization_id: PLATFORM_ORG_ID });
  });

  it.each([['X developer', x.developer], ['Y developer', y.developer]] as const)('%s -> 404 on every read of the common list', async (_n, who) => {
    for (const [name, path] of reads(plat, platItem)) {
      const res = await call(who, 'GET', path);
      expect({ name, status: res.status }).toEqual({ name, status: 404 });
    }
  });

  it('a platform list owned by the platform org but left `private` is NOT shared (control for the predicate)', async () => {
    const op = platformAdmin('privplat');
    const draft = await createList(op, { name: 'Operator draft' }); // default visibility private, in the platform org
    expect(draft.organization_id).toBe(PLATFORM_ORG_ID);
    expect((await call(op, 'GET', L(draft.id))).status).toBe(200);
    expect((await call(x.viewer, 'GET', L(draft.id))).status).toBe(404);
  });
});

describe('§11.2: nobody can mutate via the shared read (an `org` list -> 403, state unchanged)', () => {
  const memberRoles = ['admin', 'editor', 'viewer'] as const;

  const mutations = (): Array<[string, string, string, unknown?]> => [
    ['updateSelectionList (name)', 'PATCH', L(orgX.id), { name: 'Hijacked' }],
    ['updateSelectionList (visibility)', 'PATCH', L(orgX.id), { visibility: 'private' }],
    ['deleteSelectionList (archive)', 'DELETE', L(orgX.id)],
    ['deleteSelectionList (purge)', 'DELETE', `${L(orgX.id)}?purge=true`],
    ['archiveSelectionList', 'POST', `${L(orgX.id)}/archive`],
    ['createSelectionListItem', 'POST', `${L(orgX.id)}/items`, { code: 'EVIL', label: 'Evil' }],
    ['reorderSelectionListItems', 'PUT', `${L(orgX.id)}/items/reorder`, { item_ids: [orgXItem2.id, orgXItem.id] }],
    ['updateSelectionListItem', 'PATCH', `${L(orgX.id)}/items/${orgXItem.id}`, { label: 'Hijacked' }],
    ['deleteSelectionListItem (archive)', 'DELETE', `${L(orgX.id)}/items/${orgXItem.id}`],
    ['deleteSelectionListItem (purge)', 'DELETE', `${L(orgX.id)}/items/${orgXItem.id}?purge=true`],
    ['archiveSelectionListItem', 'POST', `${L(orgX.id)}/items/${orgXItem.id}/archive`],
    ['upsertSelectionListTranslation', 'PUT', `${L(orgX.id)}/translations/de`, { name: 'Hijacked' }],
    ['deleteSelectionListTranslation', 'DELETE', `${L(orgX.id)}/translations/fr`],
    ['upsertSelectionListItemTranslation', 'PUT', `${L(orgX.id)}/items/${orgXItem.id}/translations/de`, { label: 'Hijacked' }],
    ['deleteSelectionListItemTranslation', 'DELETE', `${L(orgX.id)}/items/${orgXItem.id}/translations/fr`],
    ['autofillSelectionListTranslations', 'POST', `${L(orgX.id)}/translations/es/autofill`, {}],
    ['listSelectionListAccess (roster)', 'GET', `${L(orgX.id)}/access`],
    ['setSelectionListAccess', 'PUT', `${L(orgX.id)}/access/${x.viewer.userId}`, { role: 'list-owner' }],
    ['revokeSelectionListAccess', 'DELETE', `${L(orgX.id)}/access/${owner.userId}`],
  ];

  const snapshot = async () => {
    const list = await call(owner, 'GET', L(orgX.id));
    const items = await walkItems(owner, orgX.id, 'all');
    const roster = await call(owner, 'GET', `${L(orgX.id)}/access`);
    const trs = await call(owner, 'GET', `${L(orgX.id)}/translations`);
    return JSON.stringify({
      list: { name: list.body.name, status: list.body.status, visibility: list.body.visibility, updated_at: list.body.updated_at },
      items: items.map((i: ItemLike) => [i.id, i.code, i.label, i.status, i.sort_order]),
      roster: roster.body.items?.map((g: any) => [g.user_id, g.role]),
      locales: trs.body.map((t: any) => t.locale),
    });
  };

  it.each(memberRoles)('tenant %s, readable list, no instance role: every mutation is 403 FORBIDDEN (never 2xx, never 409), and nothing changes', async (role) => {
    const before = await snapshot();
    for (const [name, method, path, body] of mutations()) {
      const res = await call(x[role], method, path, body);
      expect({ role, name, status: res.status }).toEqual({ role, name, status: 403 });
      expect((res.body as any)?.code).toBe('FORBIDDEN');
      expect((res.body as any)?.reason).toBeUndefined(); // a fork_required hint belongs to common lists only
    }
    expect(await snapshot()).toBe(before);
  });

  it('control: the SAME requests are not blanket-denied — the owner mutates the same list, and the shared reader reads it', async () => {
    const renamed = await call(owner, 'PATCH', L(orgX.id), { name: 'Org X (renamed by owner)' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Org X (renamed by owner)');
    const added = await call(owner, 'POST', `${L(orgX.id)}/items`, { code: 'OWNERADD', label: 'Owner added' });
    expect(added.status).toBe(201);
    const seen = await walkItems(x.viewer, orgX.id, 'all');
    expect(seen.map((i: ItemLike) => i.code)).toContain('OWNERADD');
  });

  it('a member of ANOTHER org is 404 (not 403) for the same mutations — the deny reasons differ, as the matrix says', async () => {
    for (const [name, method, path, body] of mutations()) {
      const res = await call(y.admin, method, path, body);
      expect({ name, status: res.status }).toEqual({ name, status: 404 });
    }
  });

  it('a `developer` (no read_shared) is refused the mutations too — 403 like any same-org caller without a grant (4.0.0 precedent, R7) or 404; never 2xx, nothing changes', async () => {
    const before = await snapshot();
    for (const [name, method, path, body] of mutations()) {
      const res = await call(x.developer, method, path, body);
      expect({ name, ok: [403, 404].includes(res.status) }).toEqual({ name, ok: true });
    }
    expect(await snapshot()).toBe(before);
    // control: the READ side of the same list is where the developer\'s deny reason is pinned (404)
    expect((await call(x.developer, 'GET', L(orgX.id))).status).toBe(404);
  });
});

describe('§4 access roster: a shared reader cannot see who holds roles (manage_access only)', () => {
  it('org list: viewer -> 403; common list: viewer/editor/admin -> 403, never the roster', async () => {
    expect((await call(x.viewer, 'GET', `${L(orgX.id)}/access`)).status).toBe(403);
    for (const who of [x.viewer, x.editor, x.admin, y.admin]) {
      const res = await call(who, 'GET', `${L(plat.id)}/access`);
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain(platOwner.userId);
    }
  });

  it('control: the common list\'s operator-owner (manage_access) gets the roster', async () => {
    const res = await call(platOwner, 'GET', `${L(plat.id)}/access`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain(platOwner.userId);
  });

  it('access management on a common list is 403 for tenants — not forkable, so never 409 fork_required', async () => {
    for (const who of [x.admin, x.editor, x.viewer]) {
      const put = await call(who, 'PUT', `${L(plat.id)}/access/${who.userId}`, { role: 'list-owner' });
      expect(put.status).toBe(403);
      expect((put.body as any).reason).toBeUndefined();
      const del = await call(who, 'DELETE', `${L(plat.id)}/access/${platOwner.userId}`);
      expect(del.status).toBe(403);
    }
    // the operator is still the only owner afterwards
    const roster = await call(platOwner, 'GET', `${L(plat.id)}/access`);
    expect(roster.body.items.map((g: any) => g.role)).toEqual(['list-owner']);
  });
});

describe('D1/D4: a customer-tenant instance grant on a common list does not make it writable (immutable for tenants)', () => {
  it('a list-owner grant in tenant X on the platform list: no mutation applies, the common list is unchanged', async () => {
    const victim = (await call(platOwner, 'GET', L(plat.id))).body;
    await fixtureGrant(ORG_X, x.editor.userId, plat.id, 'list-owner');
    for (const [method, path, body] of [
      ['PATCH', L(plat.id), { name: 'Hijacked by tenant' }],
      ['POST', `${L(plat.id)}/items`, { code: 'EVIL', label: 'Evil' }],
      ['PATCH', `${L(plat.id)}/items/${platItem.id}`, { label: 'Hijacked' }],
      ['DELETE', `${L(plat.id)}?purge=true`, undefined],
    ] as const) {
      const res = await call(x.editor, method, path, body);
      expect([403, 404, 409]).toContain(res.status);
    }
    const after = (await call(platOwner, 'GET', L(plat.id))).body;
    expect(after.name).toBe(victim.name);
    expect(after.status).toBe('active');
    const items = await walkItems(platOwner, plat.id, 'all');
    expect(items.map((i: ItemLike) => i.code).sort()).toEqual(['A', 'B']);
    expect(items.find((i: ItemLike) => i.id === platItem.id)!.label).toBe(platItem.label);
  });

  it('control: the identical fixture grant on an `org` list of X DOES let the grantee mutate it (so the deny above is the platform rule)', async () => {
    await fixtureGrant(ORG_X, x.viewer.userId, orgX.id, 'list-owner');
    const res = await call(x.viewer, 'PATCH', L(orgX.id), { name: 'Renamed by granted viewer' });
    expect(res.status).toBe(200);
  });

  it('control: the platform operator who owns it mutates it fine', async () => {
    const res = await call(platOwner, 'PATCH', L(plat.id), { name: 'Operator renamed' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Operator renamed');
  });
});

describe('an id is never a capability (identifier standard): knowing B\'s id grants nothing to a caller authorized for A', () => {
  it('a caller owning list A cannot reach B\'s items through A\'s path, nor mutate B by id', async () => {
    const mine = await createList(x.admin, { name: 'Mine A' }); // x.admin owns A
    expect((await call(x.admin, 'PATCH', L(mine.id), { name: 'Mine A2' })).status).toBe(200); // control
    // B's item id under A's path
    expect((await call(x.admin, 'PATCH', `${L(mine.id)}/items/${orgXItem2.id}`, { label: 'x' })).status).toBe(404);
    expect((await call(x.admin, 'GET', `${L(mine.id)}/items/${orgXItem2.id}/translations`)).status).toBe(404);
    // B's own path: readable (org visibility) but not writable
    expect((await call(x.admin, 'PATCH', `${L(orgX.id)}/items/${orgXItem2.id}`, { label: 'x' })).status).toBe(403);
    // a PRIVATE list B in the same org: the id alone buys nothing at all (a read stays 404, a write stays 403 — R7, 4.0.0 behaviour)
    expect((await call(x.admin, 'GET', L(privX.id))).status).toBe(404);
    expect((await call(x.admin, 'PATCH', L(privX.id), { name: 'x' })).status).toBe(403);
    expect((await call(owner, 'GET', L(privX.id))).body.name).toBe('Private X'); // and it did not change
    // a common list's item id under A's path
    expect((await call(x.admin, 'PATCH', `${L(mine.id)}/items/${platItem.id}`, { label: 'x' })).status).toBe(404);
  });
});

describe('§11.3 security angle: include_shared=true never leaks past visibility', () => {
  it('Y\'s listing holds only Y\'s own lists and common lists — nothing of X\'s, `org` or `private`', async () => {
    const { rows } = await walkLists(y.admin, 'include_shared=true');
    const orgs = new Set(rows.map((r) => r.organization_id));
    for (const o of orgs) expect([ORG_Y, PLATFORM_ORG_ID]).toContain(o);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(orgY.id); // control: its own org list is there
    expect(ids).toContain(plat.id); // control: the common list is there
    expect(ids).not.toContain(orgX.id);
    expect(ids).not.toContain(privX.id);
  });

  it('X\'s viewer sees X\'s `org` list and the common list, but NOT the `private` list it holds no grant on', async () => {
    const { rows } = await walkLists(x.viewer, 'include_shared=true');
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(orgX.id);
    expect(ids).toContain(plat.id);
    expect(ids).not.toContain(privX.id);
    const ownerRows = (await walkLists(owner, 'include_shared=true')).rows.map((r) => r.id);
    expect(ownerRows).toContain(privX.id); // control: the grant-holder does
  });

  it('developer holds no catalog `list`, so include_shared does not get it past the 403', async () => {
    const res = await call(x.developer, 'GET', '/v1/selection-lists?include_shared=true');
    expect(res.status).toBe(403);
    expect((await call(x.viewer, 'GET', '/v1/selection-lists?include_shared=true')).status).toBe(200); // control
  });

  it('without include_shared the shared lists are NOT listed (the 4.0.0 default)', async () => {
    const fresh = actor('fresh', ORG_X, 'viewer'); // never granted anything (x.viewer was granted an instance role by a control above)
    const { rows } = await walkLists(fresh, '');
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(orgX.id);
    expect(ids).not.toContain(plat.id);
    expect((await walkLists(fresh, 'include_shared=true')).rows.map((r) => r.id)).toEqual(expect.arrayContaining([orgX.id, plat.id])); // control: the opt-in adds them
  });
});
