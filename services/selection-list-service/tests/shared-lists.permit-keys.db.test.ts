// shared-lists.permit-keys.db.test.ts - the Security API (hence Permit) knows tenants and users by their BARE UUID;
// every call this service makes names them that way (src/lib/permitKeys.ts), whatever rendering the token, the
// stored row or the route path carries, and an id that is neither form is REFUSED. The fake Security API here keys
// everything by the UUID it is actually SENT, so a TypeID reaching it would be a different (unprovisioned) key.
// Real app, real handlers, real Postgres.

import type { Knex } from 'knex';
import { dbDescribe } from './helpers/testDb';
import { fromUuid, toUuid } from '@izzywdev/fuzefront-identity';
import { createWorld, EDITOR_ACTIONS as EDITOR, ORG_A, P, PLATFORM, Principal, World } from './helpers/sharedWorld';
import { permitKeyedClient, permitSubjectKey, permitTenantKey, PermitKeyError } from '../src/lib/permitKeys';
import { permitKey } from './helpers/ids';
import { PLATFORM_SEED_SOURCE } from '@fuzefront/shared/kafka';

const state: { db: Knex | undefined } = { db: undefined };
jest.mock('../src/db', () => ({
  get db() {
    return state.db;
  },
}));

describe('permit keys - pure', () => {
  const U = '0195a8f2-aaaa-7a11-8b2d-3f4e5a6b7e01';
  const O = '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7e0a';
  const usrT = fromUuid('user', U);
  const orgT = fromUuid('organization', O);

  it('a TypeID becomes its bare UUID; a bare UUID is left untouched; machine principals are left untouched', () => {
    expect(permitSubjectKey(usrT)).toBe(U);
    expect(permitTenantKey(orgT)).toBe(O);
    expect(permitSubjectKey(U)).toBe(U);
    expect(permitTenantKey(O)).toBe(O);
    for (const svc of ['svc:selection-list-service', 'service:selection-list-service', 'svc_token:abc123']) expect(permitSubjectKey(svc)).toBe(svc);
  });

  it('anything that is neither form is REFUSED (never passed through as is)', () => {
    for (const bad of ['', 'u-1', 'usr_', 'usr_notatypeid', 'usr_01jpmf5anaf88rpb9z9sd6pzgjZZZ', 'org_' + 'x'.repeat(26), 'not a user', fromUuid('organization', O)]) {
      expect(() => permitSubjectKey(bad)).toThrow(PermitKeyError);
    }
    for (const bad of ['', 'acme', 'org_', 'org_notatypeid', 'svc:selection-list-service', usrT]) {
      expect(() => permitTenantKey(bad)).toThrow(PermitKeyError); // a user id is not a tenant, a machine principal is not a tenant
    }
    expect(() => permitSubjectKey(undefined as never)).toThrow(PermitKeyError);
  });

  it('the wrapper converts every call and refuses a malformed id BEFORE reaching the Security API', async () => {
    const seen: any[] = [];
    const rec = (name: string) => async (...a: any[]) => {
      seen.push([name, ...a]);
      return name === 'bulkCheck' ? [{ allow: true }] : name === 'check' ? { allow: true } : ({} as never);
    };
    const inner: any = { check: rec('check'), bulkCheck: rec('bulkCheck'), grant: rec('grant'), revoke: rec('revoke'), listGrants: rec('listGrants'), setAttributes: rec('setAttributes') };
    const c = permitKeyedClient(inner);
    const resource = { type: 'SelectionList', key: 'front_sl_x' };
    await c.check({ subject: usrT, tenant: orgT, resource, action: 'read' }, 't');
    await c.bulkCheck([{ subject: usrT, tenant: orgT, resource, action: 'read' }], 't');
    await c.grant({ subject: usrT, tenant: orgT, role: 'list-owner', resource }, 't');
    await c.revoke({ subject: usrT, tenant: orgT, role: 'list-owner', resource }, 't');
    await c.revoke({ grantId: `${O}:${U}:list-owner` }, 't'); // by grant id: nothing to convert
    await c.listGrants({ subject: usrT, tenant: orgT }, 't');
    for (const [name, arg] of seen.slice(0, 4).concat(seen.slice(5))) {
      const x = Array.isArray(arg) ? arg[0] : arg;
      expect({ name, subject: x.subject, tenant: x.tenant }).toEqual({ name, subject: U, tenant: O });
    }
    expect(seen[4][1]).toEqual({ grantId: `${O}:${U}:list-owner` });

    seen.length = 0;
    await expect(c.check({ subject: 'u-1', tenant: orgT, resource, action: 'read' }, 't')).rejects.toBeInstanceOf(PermitKeyError);
    await expect(c.bulkCheck([{ subject: usrT, tenant: 'acme', resource, action: 'read' }], 't')).rejects.toBeInstanceOf(PermitKeyError);
    await expect(c.grant({ subject: usrT, tenant: 'acme', role: 'list-owner' }, 't')).rejects.toBeInstanceOf(PermitKeyError);
    await expect(c.revoke({ subject: 'u-1', tenant: orgT, role: 'list-owner' }, 't')).rejects.toBeInstanceOf(PermitKeyError);
    await expect(c.listGrants({ tenant: 'acme' }, 't')).rejects.toBeInstanceOf(PermitKeyError);
    expect(seen).toEqual([]); // nothing malformed ever reached the Security API
  });
});

dbDescribe('Permit keys on the real routes (real Postgres, fake Security keyed by what it is sent)', () => {
  let w: World;
  let seq = 0;

  beforeAll(async () => {
    w = await createWorld(state);
  });
  afterAll(() => w.teardown());

  /** An ordinary org whose owner has a seeded list (stored under the wire org id, as the seeder does). */
  const seededOrg = async () => {
    const n = String(10 + ++seq).padStart(2, '0');
    const orgUuid = `0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7d${n}`;
    const ownerUuid = `0195a8f2-aaaa-7a11-8b2d-3f4e5a6b7d${n}`;
    const org = fromUuid('organization', orgUuid);
    const owner = fromUuid('user', ownerUuid);
    await w.db('selection_list_ref_index').insert({
      entity_type: 'organization', entity_id: orgUuid, status: 'active', wire_id: org, org_type: 'organization', is_active: true, owner_id: owner, owner_uuid: ownerUuid,
    });
    const listId = `front_sl_seeded${n}`;
    await w.db('selection_lists').insert({
      id: listId, organization_id: org, key: `seeded-${n}`, created_by: 'system:selection-list-service', visibility: 'org',
      seed_source: PLATFORM_SEED_SOURCE, seed_key: 'platform-defaults', seed_list_key: `seeded-${n}`, seed_version: 1, seed_hash: 'h',
    });
    await w.db('selection_list_translations').insert({ list_id: listId, locale: 'en', name: 'Seeded', source_hash: 'h', is_machine: false });
    const { ensureSeededListOwners } = await import('../src/seed/ownerGrants');
    expect((await ensureSeededListOwners(w.db, org)).granted).toBe(1);
    const uuidOwner: Principal = { userId: ownerUuid, orgId: orgUuid }; // what a real org-session token carries
    const uuidOther: Principal = { userId: `0195a8f2-bbbb-7a11-8b2d-3f4e5a6b7d${n}`, orgId: orgUuid };
    for (const p of [uuidOwner, uuidOther]) w.authz.allowCatalog(p.orgId, p.userId, EDITOR);
    return { org, orgUuid, owner, ownerUuid, listId, uuidOwner, uuidOther };
  };

  it('a seeded owner grant is keyed by UUID, so the owner presenting UUID claims can read AND mutate; another UUID user cannot', async () => {
    const x = await seededOrg();
    // the seeder sent the Security API Permit's keys, not the wire ids it works with
    expect(w.authz.grants.filter((g) => g.listId === x.listId)).toEqual([{ subject: x.ownerUuid, tenant: x.orgUuid, role: 'list-owner', listId: x.listId }]);
    expect(await w.db('selection_list_access').where({ list_id: x.listId }).first()).toMatchObject({ user_id: x.ownerUuid, org_id: x.orgUuid, role: 'list-owner' });

    const read = await w.api(x.uuidOwner).get(`/v1/selection-lists/${x.listId}`);
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ id: x.listId, editable: true });
    const patch = await w.api(x.uuidOwner).patch(`/v1/selection-lists/${x.listId}`, { description: 'edited by the owner' });
    expect(patch.status).toBe(200);
    const item = await w.api(x.uuidOwner).post(`/v1/selection-lists/${x.listId}/items`, { code: 'A', label: 'A' });
    expect(item.status).toBe(201);

    // a UUID-token user with no grant: the list is org-visible, so reading is allowed, but they cannot mutate
    expect((await w.api(x.uuidOther).patch(`/v1/selection-lists/${x.listId}`, { description: 'nope' })).status).toBe(403);
    expect((await w.api(x.uuidOther).post(`/v1/selection-lists/${x.listId}/items`, { code: 'B', label: 'B' })).status).toBe(403);
    // ...and a list the user has no grant on and that is private is not even visible
    await w.db('selection_lists').where({ id: x.listId }).update({ visibility: 'private' });
    expect((await w.api(x.uuidOther).get(`/v1/selection-lists/${x.listId}`)).status).toBe(404);
  });

  it('a new access-PUT grant to a usr_ path id is keyed by UUID in Permit and in the mirror, and is reported as usr_', async () => {
    const x = await seededOrg();
    const member = fromUuid('user', x.uuidOther.userId);
    w.authz.member(x.orgUuid, x.uuidOther.userId); // the membership probe (Organization:read)
    const before = w.authz.grants.length;
    const res = await w.api(x.uuidOwner).put(`/v1/selection-lists/${x.listId}/access/${member}`, { role: 'list-editor' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ user_id: member, role: 'list-editor' }); // wire contract: usr_
    expect(w.authz.grants.slice(before)).toEqual([{ subject: x.uuidOther.userId, tenant: x.orgUuid, role: 'list-editor', listId: x.listId }]);
    expect(await w.db('selection_list_access').where({ list_id: x.listId, user_id: x.uuidOther.userId }).first()).toMatchObject({ role: 'list-editor', org_id: x.orgUuid });
    expect(await w.db('selection_list_access').where({ list_id: x.listId, user_id: member }).first()).toBeUndefined(); // not keyed by the TypeID
    // the grantee, presenting UUID claims, can now edit
    expect((await w.api(x.uuidOther).patch(`/v1/selection-lists/${x.listId}`, { description: 'by the editor' })).status).toBe(200);
    // and the listing renders usr_ ids
    const grants = await w.api(x.uuidOwner).get(`/v1/selection-lists/${x.listId}/access`);
    expect(grants.body.items.map((i: any) => i.user_id).sort()).toEqual([x.owner, member].sort());
    // removing it revokes the UUID key
    const revokes = w.authz.revokes.length;
    expect((await w.api(x.uuidOwner).del(`/v1/selection-lists/${x.listId}/access/${member}`)).status).toBe(204);
    expect(w.authz.revokes.slice(revokes)).toEqual([{ subject: x.uuidOther.userId, tenant: x.orgUuid, role: 'list-editor', listId: x.listId }]);
  });

  it('legacy mirror rows holding TypeIDs are revoked by the UUID key on both the user-deleted and the purge paths', async () => {
    const x = await seededOrg();
    const legacyUser = fromUuid('user', '0195a8f2-cccc-7a11-8b2d-3f4e5a6b7d99');
    const legacyUuid = toUuid(legacyUser as never);
    await w.db('selection_list_access').insert({ list_id: x.listId, user_id: legacyUser, role: 'list-viewer', granted_by: x.owner, org_id: x.org });
    w.authz.give(x.orgUuid, legacyUuid, x.listId, 'list-viewer'); // Permit holds it under the UUID key only

    const { handleUserDeleted } = await import('../src/events/user-deleted.handler');
    const before = w.authz.revokes.length;
    await handleUserDeleted({ correlationId: 'c', payload: { userId: legacyUuid, email: 'x@example.com', cascade: 'soft' } } as never);
    expect(w.authz.revokes.slice(before)).toEqual([{ subject: legacyUuid, tenant: x.orgUuid, role: 'list-viewer', listId: x.listId }]);
    expect(w.authz.roleOf(x.orgUuid, legacyUuid, x.listId)).toBeUndefined();

    // purge: every live grant (the owner's UUID-keyed one and a legacy TypeID-keyed one) is revoked by its UUID key
    const other = fromUuid('user', '0195a8f2-dddd-7a11-8b2d-3f4e5a6b7d98');
    await w.db('selection_list_access').insert({ list_id: x.listId, user_id: other, role: 'list-editor', granted_by: x.owner, org_id: x.org });
    w.authz.give(x.orgUuid, toUuid(other as never), x.listId, 'list-editor');
    const r0 = w.authz.revokes.length;
    expect((await w.api(x.uuidOwner).del(`/v1/selection-lists/${x.listId}?purge=true`)).status).toBe(204);
    const purged = w.authz.revokes.slice(r0).map((r) => `${r.subject}:${r.tenant}:${r.role}`).sort();
    expect(purged).toEqual([`${x.ownerUuid}:${x.orgUuid}:list-owner`, `${toUuid(other as never)}:${x.orgUuid}:list-editor`].sort());
    expect(w.authz.roleOf(x.orgUuid, toUuid(other as never), x.listId)).toBeUndefined();
  });

  it('a malformed org or user claim is refused (403, fail closed) and nothing is sent to the Security API', async () => {
    const mark = w.authz.asked.length;
    const grants = w.authz.grants.length;
    const bad: Principal[] = [
      { userId: P.aMember.userId, orgId: 'org_notatypeid' },
      { userId: 'usr_notatypeid', orgId: ORG_A },
      { userId: 'someone', orgId: ORG_A },
    ];
    for (const p of bad) {
      const res = await w.api(p).get('/v1/selection-lists');
      expect([401, 403]).toContain(res.status);
      const create = await w.api(p).post('/v1/selection-lists', { key: 'bad-claim', name: 'Bad' });
      expect([401, 403]).toContain(create.status);
    }
    expect(w.authz.asked.length).toBe(mark);
    expect(w.authz.grants.length).toBe(grants);
    expect(await w.db('selection_lists').where({ key: 'bad-claim' })).toHaveLength(0);
  });

  it('create and fork send the UUID keys whichever rendering the token carries', async () => {
    const p: Principal = { userId: fromUuid('user', '0195a8f2-aaaa-7a11-8b2d-3f4e5a6b7c01'), orgId: fromUuid('organization', '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7c01') };
    const q: Principal = { userId: toUuid(p.userId as never), orgId: toUuid(p.orgId as never) };
    for (const x of [p, q]) w.authz.allowCatalog(x.orgId, x.userId, EDITOR);
    const before = w.authz.grants.length;
    expect((await w.api(p).post('/v1/selection-lists', { key: 'k-type', name: 'T' })).status).toBe(201);
    expect((await w.api(q).post('/v1/selection-lists', { key: 'k-uuid', name: 'U' })).status).toBe(201);
    for (const g of w.authz.grants.slice(before)) expect({ s: g.subject, t: g.tenant }).toEqual({ s: permitKey(p.userId), t: permitKey(p.orgId) });
    expect(PLATFORM).toBeTruthy();
  });
});
