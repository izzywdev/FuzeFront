/**
 * Privileged operations on shared / common lists (SL9) — who may publish, promote, change visibility and purge.
 * Written against the FROZEN contract (openapi.yaml 4.1.0, `x-permit-additional-actions` on createSelectionList,
 * updateSelectionList, deleteSelectionList, deleteSelectionListItem) and the design record
 * docs/planning/selection-lists-shared-and-fork.md. Needs the shared-lists flag ON (helpers/shared-lists.ts).
 *
 * Design-record rows pinned:
 *   D5 / §4   `publish_platform` (tenant admin, effective ONLY in the platform org's tenant AND the caller must be
 *             acting in the platform org): creating a `platform` list, promoting a list to `platform`, and
 *             purging a `platform` list or one of its items all require it. A customer-org admin holds the action
 *             in its own tenant and still cannot publish — proven with a tenant the stand-in switches to bare
 *             Permit behaviour (`permitPublishAnywhere`), so it is the SERVICE that refuses, not the stand-in.
 *   D10 / §11.7   `private <-> org` needs `manage_access` (owner) in addition to `update`: a list-editor gets 403
 *             on `visibility` and can still PATCH other fields; promotion to `platform` additionally needs
 *             `publish_platform` and a list owned by the platform org ("a tenant cannot donate a list to every
 *             tenant"). Sending the current visibility is a no-op that still requires `manage_access`.
 *   §11.8     purge on a common list: an owner WITHOUT `publish_platform` -> 403, list/items intact; archive stays
 *             with the instance owner; purge of a non-platform list is unchanged (owner only).
 */
import {
  actor, call, createList, addItem, createPlatformList, expectError, L, newOrg, PLATFORM_ORG_ID, platformAdmin,
  assertSharedListsOn, permitPublishAnywhere, rnd, walkItems,
} from '../helpers/shared-lists';
import { closeDb, dbQuery } from '../helpers/db';
import { assertResponse } from '../helpers/openapi';

const ORG_C = newOrg('prvc'); // a customer org
const ORG_L = newOrg('prvl'); // a customer org where the stand-in behaves like bare Permit for publish_platform
const cust = { admin: actor('cadm', ORG_C, 'admin'), editor: actor('ced', ORG_C, 'editor') };
const lenientAdmin = actor('ladm', ORG_L, 'admin');
const plat = {
  admin: platformAdmin('padm'),
  editor: actor('ped', PLATFORM_ORG_ID, 'editor'),
  viewer: actor('pvw', PLATFORM_ORG_ID, 'viewer'),
  developer: actor('pdv', PLATFORM_ORG_ID, 'developer'),
};

beforeAll(async () => {
  await assertSharedListsOn();
  await permitPublishAnywhere(ORG_L);
});
afterAll(async () => {
  await closeDb();
});

const dbCount = async (key: string): Promise<number> =>
  (await dbQuery('SELECT 1 FROM selection_lists WHERE key = $1', [key])).length;

describe('D5: creating a `platform` list needs publish_platform AND acting in the platform org', () => {
  it('a platform operator (admin acting in the platform org) publishes: 201, owned by the platform org, owner grant', async () => {
    const key = `pub-${rnd()}-${rnd()}`;
    const res = await call(plat.admin, 'POST', '/v1/selection-lists', { key, name: 'Common colours', visibility: 'platform' });
    expect(res.status).toBe(201);
    assertResponse('POST', '/v1/selection-lists', 201, res.body);
    expect(res.body).toMatchObject({ key, visibility: 'platform', organization_id: PLATFORM_ORG_ID, forked_from: null, created_by: plat.admin.userId });
    // the operator is the list-owner (grant made by the service with its machine identity, as on any create)
    const roster = await call(plat.admin, 'GET', `${L(res.body.id)}/access`);
    expect(roster.status).toBe(200);
    expect(roster.body.items.map((g: any) => [g.user_id, g.role])).toEqual([[plat.admin.userId, 'list-owner']]);
  });

  it.each([
    ['platform-org editor (holds create, not publish_platform)', plat.editor],
    ['platform-org viewer (no create)', plat.viewer],
    ['platform-org developer (no catalog action at all)', plat.developer],
    ['customer-org admin (holds publish_platform in its OWN tenant per the Permit schema)', cust.admin],
    ['customer-org admin where the stand-in grants publish_platform in the caller\'s own tenant (bare Permit)', lenientAdmin],
  ] as const)('%s -> 403 and nothing is created', async (_name, who) => {
    const key = `deny-${rnd()}-${rnd()}`;
    const res = await call(who, 'POST', '/v1/selection-lists', { key, name: 'Not allowed', visibility: 'platform' });
    expectError(res, 403, 'FORBIDDEN');
    expect(await dbCount(key)).toBe(0);
  });

  it('controls: the very same denied callers CAN create `org` lists (the 403 above is about publish_platform only)', async () => {
    for (const who of [plat.editor, cust.admin, lenientAdmin]) {
      const res = await call(who, 'POST', '/v1/selection-lists', { key: `ctl-${rnd()}-${rnd()}`, name: 'Allowed', visibility: 'org' });
      expect(res.status).toBe(201);
      expect(res.body.visibility).toBe('org');
    }
    expect((await call(plat.viewer, 'POST', '/v1/selection-lists', { key: `ctl-${rnd()}`, name: 'x' })).status).toBe(403); // viewer has no `create` at all
  });
});

describe('D10 / §11.7: promotion to `platform` — owner + publish_platform + a list owned by the platform org', () => {
  it('a platform operator who owns an `org` list of the platform org promotes it: 200, now readable by every tenant', async () => {
    const op = platformAdmin('promo');
    const l = await createList(op, { name: 'Promote me', visibility: 'org' });
    const stranger = actor('xr', newOrg('stranger'), 'viewer');
    expect((await call(stranger, 'GET', L(l.id))).status).toBe(404); // not shared with other orgs while it is `org`
    const res = await call(op, 'PATCH', L(l.id), { visibility: 'platform' });
    expect(res.status).toBe(200);
    assertResponse('PATCH', '/v1/selection-lists/{listId}', 200, res.body);
    expect(res.body).toMatchObject({ id: l.id, visibility: 'platform', organization_id: PLATFORM_ORG_ID });
    expect((await call(stranger, 'GET', L(l.id))).status).toBe(200);
  });

  it('platform-org editor who OWNS a private list of the platform org (manage_access yes, publish_platform no) -> 403, unchanged', async () => {
    const l = await createList(plat.editor, { name: 'Editor draft' });
    const res = await call(plat.editor, 'PATCH', L(l.id), { visibility: 'platform' });
    expectError(res, 403, 'FORBIDDEN');
    const after = await call(plat.editor, 'GET', L(l.id));
    expect(after.body.visibility).toBe('private');
    expect((await call(actor('xr', newOrg('stranger2'), 'viewer'), 'GET', L(l.id))).status).toBe(404);
  });

  it('platform admin who is NOT the list\'s owner (publish_platform yes, manage_access no) -> 403, unchanged', async () => {
    const ownerOp = platformAdmin('own1');
    const l = await createList(ownerOp, { name: 'Org list of operator A', visibility: 'org' });
    const otherOp = platformAdmin('own2'); // same org + role, no instance grant; reads it through `org` visibility
    expect((await call(otherOp, 'GET', L(l.id))).status).toBe(200);
    const res = await call(otherOp, 'PATCH', L(l.id), { visibility: 'platform' });
    expectError(res, 403, 'FORBIDDEN');
    expect((await call(ownerOp, 'GET', L(l.id))).body.visibility).toBe('org');
    // control: the owner (who has both) succeeds
    expect((await call(ownerOp, 'PATCH', L(l.id), { visibility: 'platform' })).status).toBe(200);
  });

  it.each([
    ['customer-org admin', cust.admin],
    ['customer-org admin under bare Permit (publish_platform "allowed" in its own tenant)', lenientAdmin],
  ] as const)('%s owning a list of its own org cannot donate it to every tenant: 403, still `org`, still invisible elsewhere', async (_n, who) => {
    const l = await createList(who, { name: 'My org list', visibility: 'org' });
    const res = await call(who, 'PATCH', L(l.id), { visibility: 'platform' });
    expectError(res, 403, 'FORBIDDEN');
    const after = await call(who, 'GET', L(l.id));
    expect(after.body).toMatchObject({ visibility: 'org', organization_id: who.orgId });
    expect((await call(actor('oth', newOrg('other'), 'admin'), 'GET', L(l.id))).status).toBe(404);
    // control: the same owner can still move it between private and org
    expect((await call(who, 'PATCH', L(l.id), { visibility: 'private' })).status).toBe(200);
  });
});

describe('D10 / §11.7: private <-> org is an access decision — owner only', () => {
  it('the owner flips private -> org -> private; members\' read follows it', async () => {
    const l = await createList(cust.admin, { name: 'Flip' });
    const member = actor('mem', ORG_C, 'viewer');
    expect((await call(member, 'GET', L(l.id))).status).toBe(404);
    const up = await call(cust.admin, 'PATCH', L(l.id), { visibility: 'org' });
    expect(up.status).toBe(200);
    expect(up.body.visibility).toBe('org');
    expect((await call(member, 'GET', L(l.id))).status).toBe(200);
    const down = await call(cust.admin, 'PATCH', L(l.id), { visibility: 'private' });
    expect(down.status).toBe(200);
    expect(down.body.visibility).toBe('private');
    expect((await call(member, 'GET', L(l.id))).status).toBe(404);
  });

  it.each(['list-editor', 'list-contributor', 'list-translator', 'list-viewer'] as const)(
    'instance role %s: visibility change -> 403 and unchanged',
    async (role) => {
      const l = await createList(cust.admin, { name: `Roles ${role}` });
      const holder = actor('hld', ORG_C, 'viewer');
      expect((await call(cust.admin, 'PUT', `${L(l.id)}/access/${holder.userId}`, { role })).status).toBe(200);
      const res = await call(holder, 'PATCH', L(l.id), { visibility: 'org' });
      expectError(res, 403, 'FORBIDDEN');
      expect((await call(cust.admin, 'GET', L(l.id))).body.visibility).toBe('private');
    },
  );

  it('list-editor: visibility 403, but the same editor still PATCHes the name (the extra requirement is specific to visibility)', async () => {
    const l = await createList(cust.admin, { name: 'Editor can rename' });
    const editor = actor('led', ORG_C, 'viewer');
    await call(cust.admin, 'PUT', `${L(l.id)}/access/${editor.userId}`, { role: 'list-editor' });
    expect((await call(editor, 'PATCH', L(l.id), { name: 'Renamed by editor' })).status).toBe(200);
    expect((await call(editor, 'PATCH', L(l.id), { name: 'Renamed again', visibility: 'org' })).status).toBe(403);
    const after = (await call(cust.admin, 'GET', L(l.id))).body;
    expect(after).toMatchObject({ name: 'Renamed by editor', visibility: 'private' }); // all-or-nothing: the rename in the denied PATCH did not apply
  });

  it('tenant admin WITHOUT an instance role: 403 on both a readable (`org`) list and a private one (R7: 4.0.0 answers a write without a grant 403) — and neither changes anything', async () => {
    const orgList = await createList(cust.editor, { name: 'Editor org list', visibility: 'org' });
    const privList = await createList(cust.editor, { name: 'Editor private list' });
    expect((await call(cust.admin, 'PATCH', L(orgList.id), { visibility: 'private' })).status).toBe(403);
    expect((await call(cust.admin, 'PATCH', L(privList.id), { visibility: 'org' })).status).toBe(403);
    expect((await call(cust.admin, 'GET', L(privList.id))).status).toBe(404); // while a READ of it stays 404 (no existence oracle)
    expect((await call(cust.editor, 'GET', L(orgList.id))).body.visibility).toBe('org');
    expect((await call(cust.editor, 'GET', L(privList.id))).body.visibility).toBe('private');
  });

  it('sending the CURRENT visibility is a no-op that still requires manage_access', async () => {
    const l = await createList(cust.admin, { name: 'No-op', visibility: 'org' });
    const editor = actor('led2', ORG_C, 'viewer');
    await call(cust.admin, 'PUT', `${L(l.id)}/access/${editor.userId}`, { role: 'list-editor' });
    expect((await call(editor, 'PATCH', L(l.id), { visibility: 'org' })).status).toBe(403);
    const ok = await call(cust.admin, 'PATCH', L(l.id), { visibility: 'org' });
    expect(ok.status).toBe(200);
    expect(ok.body.visibility).toBe('org');
  });
});

describe('§11.8: purge on common lists needs publish_platform (owner alone is not enough)', () => {
  it('an owner without publish_platform: purge list -> 403, purge item -> 403, everything intact; archive is still the owner\'s call', async () => {
    const p = await createPlatformList({ itemCodes: ['A', 'B'] });
    const lowOwner = plat.editor; // platform-org editor: can become list-owner, never holds publish_platform
    const grant = await call(p.owner, 'PUT', `${L(p.list.id)}/access/${lowOwner.userId}`, { role: 'list-owner' });
    expect(grant.status).toBe(200);

    const purgeItem = await call(lowOwner, 'DELETE', `${L(p.list.id)}/items/${p.items[0].id}?purge=true`);
    expectError(purgeItem, 403, 'FORBIDDEN');
    const purgeList = await call(lowOwner, 'DELETE', `${L(p.list.id)}?purge=true`);
    expectError(purgeList, 403, 'FORBIDDEN');

    // intact
    const items = await walkItems(p.owner, p.list.id, 'all');
    expect(items.map((i) => i.code).sort()).toEqual(['A', 'B']);
    expect((await call(p.owner, 'GET', L(p.list.id))).status).toBe(200);

    // controls: the owner's reversible operations need no publish_platform
    const archiveItem = await call(lowOwner, 'DELETE', `${L(p.list.id)}/items/${p.items[1].id}`);
    expect(archiveItem.status).toBe(200);
    expect(archiveItem.body.status).toBe('archived');
    const archiveList = await call(lowOwner, 'POST', `${L(p.list.id)}/archive`);
    expect(archiveList.status).toBe(200);
    expect(archiveList.body.status).toBe('archived');
  });

  it('the operator who holds both delete (owner) and publish_platform purges an item, then the list', async () => {
    const p = await createPlatformList({ itemCodes: ['A', 'B'] });
    const stranger = actor('rd', newOrg('reader'), 'viewer');
    expect((await call(stranger, 'GET', L(p.list.id))).status).toBe(200);
    expect((await call(p.owner, 'DELETE', `${L(p.list.id)}/items/${p.items[0].id}?purge=true`)).status).toBe(204);
    const left = await walkItems(p.owner, p.list.id, 'all');
    expect(left.map((i) => i.code)).toEqual(['B']);
    expect((await call(p.owner, 'DELETE', `${L(p.list.id)}?purge=true`)).status).toBe(204);
    expect((await call(p.owner, 'GET', L(p.list.id))).status).toBe(404);
    expect((await call(stranger, 'GET', L(p.list.id))).status).toBe(404);
  });

  it('control: purging a NON-platform list (and its items) is unchanged — the owner alone, no publish_platform', async () => {
    const l = await createList(cust.admin, { name: 'Org list to purge', visibility: 'org' });
    const it1 = await addItem(cust.admin, l.id, 'X');
    expect((await call(cust.admin, 'DELETE', `${L(l.id)}/items/${it1.id}?purge=true`)).status).toBe(204);
    expect((await call(cust.admin, 'DELETE', `${L(l.id)}?purge=true`)).status).toBe(204);
    expect((await call(cust.admin, 'GET', L(l.id))).status).toBe(404);
  });
});
