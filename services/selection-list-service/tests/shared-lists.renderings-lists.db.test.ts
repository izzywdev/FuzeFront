// shared-lists.renderings-lists.db.test.ts - the default listing and the key uniqueness of lists under the TWO
// renderings of one organization id (bare UUID vs `org_...` TypeID), through the real app and REAL Postgres.
//
// (1) GET /v1/selection-lists WITHOUT include_shared is "my organization's lists", and the organization is one
//     org whatever rendering of its id the token carries: a platform operator whose token carries the bare UUID
//     sees a platform list stored under the configured `org_...` id (and vice versa). Another org never matches.
// (2) (organization_id, key) is unique per ORG, not per stored text: the DB constraint is exact on the text, so
//     the service checks every rendering on every create and every rename (private, org and platform alike).
// Both only while the shared-lists flag is ON; OFF keeps the 4.0.0 exact behaviour.

import type { Knex } from 'knex';
import { dbDescribe } from './helpers/testDb';
import { fromUuid, toUuid } from '@izzywdev/fuzefront-identity';
import { ADMIN_ACTIONS, createWorld, EDITOR_ACTIONS as EDITOR, ORG_A, P, PLATFORM, Principal, World } from './helpers/sharedWorld';
import { usr as mkUsr, org as mkOrg, permitKey } from './helpers/ids';
import { flagClientWith } from './helpers/flagClient';

const state: { db: Knex | undefined } = { db: undefined };
jest.mock('../src/db', () => ({
  get db() {
    return state.db;
  },
}));

dbDescribe('lists under two renderings of one org id (real Postgres)', () => {
  let w: World;

  beforeAll(async () => {
    w = await createWorld(state);
  });
  afterAll(() => w.teardown());

  const off = async (fn: () => Promise<void>) => {
    const { setFlagClient } = await import('../src/flags');
    setFlagClient(flagClientWith(false));
    try {
      await fn();
    } finally {
      setFlagClient(flagClientWith(true));
    }
  };

  /** An org with a user per rendering; both hold the catalog actions in their own tenant string. */
  const orgWorld = (n: number) => {
    const typeId = fromUuid('organization', `0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7c${n.toString(16)}0`);
    const uuid = toUuid(typeId as never);
    const byType: Principal = { userId: mkUsr(`rendlst${n}a`), orgId: typeId };
    const byUuid: Principal = { userId: mkUsr(`rendlst${n}b`), orgId: uuid };
    for (const p of [byType, byUuid]) w.authz.allowCatalog(p.orgId, p.userId, EDITOR);
    return { typeId, uuid, byType, byUuid };
  };
  const keys = (res: any) => res.body.items.map((i: any) => i.key).sort();

  describe('the default listing (no include_shared) matches the org under every rendering', () => {
    it('a platform operator with the bare-UUID token sees a platform list stored under the configured org_ id', async () => {
      const uuid = toUuid(PLATFORM as never);
      const opUuid: Principal = { userId: P.op.userId, orgId: uuid };
      w.authz.allowCatalog(uuid, P.op.userId, ADMIN_ACTIONS);
      const made = await w.api(P.op).post('/v1/selection-lists', { key: 'dl-common', name: 'Common', visibility: 'platform' });
      expect(made.status).toBe(201);
      expect(made.body.organization_id).toBe(PLATFORM);
      w.authz.give(uuid, P.op.userId, made.body.id, 'list-owner'); // the Security API holds the role in either tenant

      const viaUuid = await w.api(opUuid).get('/v1/selection-lists');
      expect(viaUuid.status).toBe(200);
      expect(keys(viaUuid)).toContain('dl-common');
      const viaType = await w.api(P.op).get('/v1/selection-lists');
      expect(keys(viaType)).toContain('dl-common');
      expect(viaUuid.body.page).toMatchObject({ hasMore: false, nextCursor: null });
    });

    it('an ordinary org: a list stored under the TypeID is listed for the UUID token and the reverse; another org never', async () => {
      const x = orgWorld(1);
      const a = await w.api(x.byType).post('/v1/selection-lists', { key: 'dl-type', name: 'T' });
      const b = await w.api(x.byUuid).post('/v1/selection-lists', { key: 'dl-uuid', name: 'U' });
      expect([a.status, b.status]).toEqual([201, 201]);
      // each principal owns what it made in ITS tenant string; give the other principal a role in its own
      w.authz.give(x.uuid, x.byUuid.userId, a.body.id, 'list-owner');
      w.authz.give(x.typeId, x.byType.userId, b.body.id, 'list-owner');
      expect(keys(await w.api(x.byUuid).get('/v1/selection-lists'))).toEqual(['dl-type', 'dl-uuid']);
      expect(keys(await w.api(x.byType).get('/v1/selection-lists'))).toEqual(['dl-type', 'dl-uuid']);
      // another org holds the same roles' subjects nowhere: org B sees none of it
      w.authz.give(P.bMember.orgId, P.bMember.userId, a.body.id, 'list-owner');
      expect(keys(await w.api(P.bMember).get('/v1/selection-lists'))).not.toContain('dl-type');
    });

    it('the default listing still does NOT add the common lists (that is include_shared)', async () => {
      const res = await w.api(P.aMember).get('/v1/selection-lists');
      expect(res.status).toBe(200);
      expect(keys(res)).not.toContain('dl-common');
      const withShared = await w.api(P.aMember).get('/v1/selection-lists?include_shared=true');
      expect(keys(withShared)).toContain('dl-common');
    });

    it('flag OFF: the 4.0.0 exact match (the UUID token does not see rows stored under the TypeID)', async () => {
      const x = orgWorld(2);
      const a = await w.api(x.byType).post('/v1/selection-lists', { key: 'dl-off', name: 'O' });
      w.authz.give(x.uuid, x.byUuid.userId, a.body.id, 'list-owner');
      expect(keys(await w.api(x.byUuid).get('/v1/selection-lists'))).toEqual(['dl-off']); // ON: same org
      await off(async () => {
        expect(keys(await w.api(x.byUuid).get('/v1/selection-lists'))).toEqual([]);
        expect(keys(await w.api(x.byType).get('/v1/selection-lists'))).toEqual(['dl-off']);
      });
    });
  });

  describe('keys are unique per org across renderings: every create and every rename', () => {
    it.each([['private'], ['org']] as const)('create (%s): the same key through the other rendering is a 409; another org may reuse it', async (visibility) => {
      const x = orgWorld(visibility === 'private' ? 3 : 4);
      const key = `uk-${visibility}`;
      expect((await w.api(x.byType).post('/v1/selection-lists', { key, name: 'One', visibility })).status).toBe(201);
      for (const p of [x.byUuid, x.byType]) {
        const dup = await w.api(p).post('/v1/selection-lists', { key, name: 'Two', visibility });
        expect(dup.status).toBe(409);
        expect(dup.body.code).toBe('CONFLICT');
      }
      expect(await w.db('selection_lists').whereIn('organization_id', [x.typeId, x.uuid]).where({ key })).toHaveLength(1);
      // and the reverse order
      expect((await w.api(x.byUuid).post('/v1/selection-lists', { key: `${key}-r`, name: 'R', visibility })).status).toBe(201);
      expect((await w.api(x.byType).post('/v1/selection-lists', { key: `${key}-r`, name: 'R2', visibility })).status).toBe(409);
      // a different org is a different namespace
      expect((await w.api(P.bMember).post('/v1/selection-lists', { key, name: 'B', visibility })).status).toBe(201);
    });

    it('create: a legacy row stored under the OTHER rendering (and an archived one) still blocks the key', async () => {
      const x = orgWorld(5);
      await w.db('selection_lists').insert({ id: 'front_sl_legacyrend00001', organization_id: x.uuid, key: 'uk-legacy', created_by: 'usr_x', status: 'archived' });
      expect((await w.api(x.byType).post('/v1/selection-lists', { key: 'uk-legacy', name: 'L' })).status).toBe(409);
    });

    it('create: two concurrent creates of one key through different renderings admit exactly one', async () => {
      const x = orgWorld(6);
      const results = await Promise.all([
        w.api(x.byType).post('/v1/selection-lists', { key: 'uk-race', name: 'A' }),
        w.api(x.byUuid).post('/v1/selection-lists', { key: 'uk-race', name: 'B' }),
        w.api(x.byType).post('/v1/selection-lists', { key: 'uk-race', name: 'C' }),
        w.api(x.byUuid).post('/v1/selection-lists', { key: 'uk-race', name: 'D' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
    });

    it('rename: onto a key taken under the other rendering is a 409, in both directions; an unrelated key is fine', async () => {
      const x = orgWorld(7);
      const a = await w.api(x.byType).post('/v1/selection-lists', { key: 'rn-a', name: 'A' });
      const b = await w.api(x.byUuid).post('/v1/selection-lists', { key: 'rn-b', name: 'B' }); // stored under the UUID
      expect([a.status, b.status]).toEqual([201, 201]);
      w.authz.give(x.typeId, x.byType.userId, b.body.id, 'list-owner');
      w.authz.give(x.uuid, x.byUuid.userId, a.body.id, 'list-owner');
      // UUID-stored b renamed onto the TypeID-stored a (by either principal)
      for (const p of [x.byUuid, x.byType]) {
        const r = await w.api(p).patch(`/v1/selection-lists/${b.body.id}`, { key: 'rn-a' });
        expect(r.status).toBe(409);
        expect(r.body.message).toMatch(/already exists/);
      }
      // TypeID-stored a renamed onto the UUID-stored b
      expect((await w.api(x.byUuid).patch(`/v1/selection-lists/${a.body.id}`, { key: 'rn-b' })).status).toBe(409);
      expect((await w.db('selection_lists').where({ id: b.body.id }).first()).key).toBe('rn-b');
      expect((await w.db('selection_lists').where({ id: a.body.id }).first()).key).toBe('rn-a');
      // renaming to the list's own current key, or to a free one, is fine
      expect((await w.api(x.byUuid).patch(`/v1/selection-lists/${b.body.id}`, { key: 'rn-b', name: 'B2' })).status).toBe(200);
      expect((await w.api(x.byUuid).patch(`/v1/selection-lists/${b.body.id}`, { key: 'rn-free' })).status).toBe(200);
    });

    it('platform lists keep the all-renderings check on create and rename (unchanged)', async () => {
      const uuid = toUuid(PLATFORM as never);
      const opUuid: Principal = { userId: P.op.userId, orgId: uuid };
      w.authz.allowCatalog(uuid, P.op.userId, ADMIN_ACTIONS);
      const first = await w.api(opUuid).post('/v1/selection-lists', { key: 'uk-common', name: 'C', visibility: 'platform' });
      expect(first.status).toBe(201);
      expect((await w.api(P.op).post('/v1/selection-lists', { key: 'uk-common', name: 'C2', visibility: 'platform' })).status).toBe(409);
      const other = await w.api(P.op).post('/v1/selection-lists', { key: 'uk-common-2', name: 'C3', visibility: 'platform' });
      expect(other.status).toBe(201);
      const rename = await w.api(P.op).patch(`/v1/selection-lists/${other.body.id}`, { key: 'uk-common' });
      expect(rename.status).toBe(409);
      expect(rename.body.message).toMatch(/common list/);
    });

    describe('flag OFF ("dark create"): the same rule - a key is unique per org across renderings', () => {
      it('create, in BOTH id orders: the other rendering of an existing key is a 409 (the existing code), the exact repeat too; another org may reuse the key', async () => {
        const x = orgWorld(8);
        await off(async () => {
          const key = 'uk-off';
          const first = await w.api(x.byType).post('/v1/selection-lists', { key, name: 'T' });
          expect(first.status).toBe(201);
          expect(first.body.organization_id).toBe(x.typeId); // stored under the claim as presented (4.0.0)
          const dup = await w.api(x.byUuid).post('/v1/selection-lists', { key, name: 'U' });
          expect(dup.status).toBe(409);
          expect(dup.body).toEqual({ code: 'CONFLICT', message: `A list with key '${key}' already exists.` });
          expect((await w.api(x.byType).post('/v1/selection-lists', { key, name: 'T2' })).status).toBe(409);
          // the reverse order
          expect((await w.api(x.byUuid).post('/v1/selection-lists', { key: `${key}-r`, name: 'R' })).status).toBe(201);
          expect((await w.api(x.byType).post('/v1/selection-lists', { key: `${key}-r`, name: 'R2' })).status).toBe(409);
          expect(await w.db('selection_lists').whereIn('organization_id', [x.typeId, x.uuid]).whereIn('key', [key, `${key}-r`])).toHaveLength(2);
          // a different org is a different namespace
          expect((await w.api(P.bMember).post('/v1/selection-lists', { key, name: 'B' })).status).toBe(201);
        });
      });

      it('create: a legacy row under the OTHER rendering (even an archived one) blocks the key', async () => {
        const x = orgWorld(9);
        await w.db('selection_lists').insert({ id: 'front_sl_legacyrend00002', organization_id: x.uuid, key: 'uk-off-legacy', created_by: 'usr_x', status: 'archived' });
        await off(async () => {
          expect((await w.api(x.byType).post('/v1/selection-lists', { key: 'uk-off-legacy', name: 'L' })).status).toBe(409);
        });
      });

      it('create: concurrent creates of one key through different renderings admit exactly one (the org outbox lock serialises them)', async () => {
        const x = orgWorld(10);
        await off(async () => {
          const results = await Promise.all([
            w.api(x.byType).post('/v1/selection-lists', { key: 'uk-off-race', name: 'A' }),
            w.api(x.byUuid).post('/v1/selection-lists', { key: 'uk-off-race', name: 'B' }),
            w.api(x.byType).post('/v1/selection-lists', { key: 'uk-off-race', name: 'C' }),
            w.api(x.byUuid).post('/v1/selection-lists', { key: 'uk-off-race', name: 'D' }),
          ]);
          expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
          expect(await w.db('selection_lists').whereIn('organization_id', [x.typeId, x.uuid]).where({ key: 'uk-off-race' })).toHaveLength(1);
        });
      });

      it('rename: onto a key taken under the other rendering is a 409 in both directions; a free key and the own key are fine', async () => {
        const x = orgWorld(11);
        await off(async () => {
          const a = await w.api(x.byType).post('/v1/selection-lists', { key: 'rn-off-a', name: 'A' });
          const b = await w.api(x.byUuid).post('/v1/selection-lists', { key: 'rn-off-b', name: 'B' }); // stored under the UUID
          expect([a.status, b.status]).toEqual([201, 201]);
          w.authz.give(x.typeId, x.byType.userId, a.body.id, 'list-owner');
          w.authz.give(x.uuid, x.byUuid.userId, b.body.id, 'list-owner');
          const r1 = await w.api(x.byUuid).patch(`/v1/selection-lists/${b.body.id}`, { key: 'rn-off-a' });
          expect(r1).toMatchObject({ status: 409 });
          expect(r1.body).toEqual({ code: 'CONFLICT', message: 'A list with that key already exists.' });
          expect((await w.api(x.byType).patch(`/v1/selection-lists/${a.body.id}`, { key: 'rn-off-b' })).status).toBe(409);
          expect((await w.db('selection_lists').where({ id: b.body.id }).first()).key).toBe('rn-off-b');
          expect((await w.api(x.byUuid).patch(`/v1/selection-lists/${b.body.id}`, { key: 'rn-off-b', name: 'B2' })).status).toBe(200);
          expect((await w.api(x.byUuid).patch(`/v1/selection-lists/${b.body.id}`, { key: 'rn-off-free' })).status).toBe(200);
        });
      });

      it('everything ELSE about the flag-OFF path is unchanged: exact org scoping (the other rendering cannot read or list the row) and the response shape', async () => {
        const x = orgWorld(12);
        await off(async () => {
          const made = await w.api(x.byType).post('/v1/selection-lists', { key: 'scope-off', name: 'S' });
          expect(made.status).toBe(201);
          expect(made.body.visibility).toBe('private'); // while OFF every list reports private (unchanged)
          expect((await w.api(x.byUuid).get(`/v1/selection-lists/${made.body.id}`)).status).toBe(404); // the other rendering is another tenant
          expect(keys(await w.api(x.byUuid).get('/v1/selection-lists'))).not.toContain('scope-off');
        });
      });
    });
  });

  it('sanity: ORG_A principals are unaffected (their own listing is unchanged)', async () => {
    const res = await w.api(P.aAdmin).get('/v1/selection-lists');
    expect(res.status).toBe(200);
    expect(res.body.items.every((i: any) => i.organization_id === ORG_A)).toBe(true);
  });
});
