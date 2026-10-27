// shared-lists.seed-quota.db.test.ts - the seed's quota step sees ONE organization however its id was stored.
//
// A seed event always targets the wire TypeID, but lists (and quota overrides) written through the HTTP API with a
// bare-UUID claim are stored under the UUID. With shared lists ON the seed must count the lists across every
// rendering of the org id, resolve the MOST RESTRICTIVE override across them, and take the same canonical quota lock
// as the HTTP write paths. Flag OFF: the 4.0.0 exact id (unchanged). Real Postgres, real seed library, real app.

import type { Knex } from 'knex';
import { dbDescribe } from './helpers/testDb';
import { fromUuid, toUuid } from '@izzywdev/fuzefront-identity';
import { createWorld, EDITOR_ACTIONS, Principal, World } from './helpers/sharedWorld';
import { allFlagsExceptShared, flagClientWith } from './helpers/flagClient';
import { spec } from './helpers/seedFixtures';

const state: { db: Knex | undefined } = { db: undefined };
jest.mock('../src/db', () => ({
  get db() {
    return state.db;
  },
}));

dbDescribe('the seed quota step is rendering-aware (real Postgres)', () => {
  let w: World;
  let seq = 0;
  let rowSeq = 0;

  beforeAll(async () => {
    w = await createWorld(state);
  });
  afterAll(() => w.teardown());
  afterEach(() => useFlags(true));

  const useFlags = async (shared: boolean) => {
    const { setFlagClient } = await import('../src/flags');
    setFlagClient(shared ? flagClientWith(true) : { getBooleanValue: allFlagsExceptShared });
  };

  /** A fresh organization: its TypeID, its bare UUID, and a caller per rendering. */
  const newOrg = () => {
    const n = String(++seq).padStart(4, '0');
    const typeId = fromUuid('organization', `0195a8f2-7c3e-7a11-8b2d-3f4e5a6b${n}`);
    const uuid = toUuid(typeId as never);
    const byUuid: Principal = { userId: toUuid(fromUuid('user', `0195a8f2-aaaa-7a11-8b2d-3f4e5a6b${n}`) as never), orgId: uuid };
    const byType: Principal = { userId: fromUuid('user', `0195a8f2-aaaa-7a11-8b2d-3f4e5a6b${n}`), orgId: typeId };
    for (const p of [byUuid, byType]) w.authz.allowCatalog(p.orgId, p.userId, EDITOR_ACTIONS);
    return { typeId, uuid, byUuid, byType };
  };

  /** An ACTIVE list stored under `org` exactly as the HTTP API would have stored it for that claim. */
  const insertList = async (org: string, key: string) => {
    const id = `front_sl_sq${String(++rowSeq).padStart(4, '0')}`;
    await w.db('selection_lists').insert({ id, organization_id: org, key, created_by: 'system:test', visibility: 'private' });
    await w.db('selection_list_translations').insert({ list_id: id, locale: 'en', name: key, source_hash: 'h', is_machine: false });
    return id;
  };
  const override = (org: string, o: Record<string, number | null>) => w.db('selection_list_org_quota').insert({ organization_id: org, updated_by: 'test', ...o });

  const seedReq = (org: string, key: string, lists: unknown[]) =>
    ({
      organizationId: org,
      scope: 'org',
      source: { app: 'platform', service: 'selection-list-service' },
      pack: { key, version: 1 },
      trigger: 'org-created',
      requestId: null,
      orgCheck: 'skip', // the org projection is not under test; the quota is
      lists,
    }) as never;
  const seed = async (org: string, key: string, lists: unknown[]): Promise<any> => {
    const { applySeedRequest } = await import('../src/seed');
    return applySeedRequest(w.db, seedReq(org, key, lists));
  };
  const seededKeys = async (prefix: string) => (await w.db('selection_lists').where('key', 'like', `${prefix}%`)).map((r: any) => r.key).sort();

  describe('lists counted across renderings (org_lists)', () => {
    it('UUID-side lists + a UUID-side override, TypeID-targeted seed over the limit: refused (QUOTA_EXCEEDED), nothing written', async () => {
      const x = newOrg();
      await insertList(x.uuid, `u-${x.uuid.slice(-4)}-1`);
      await insertList(x.uuid, `u-${x.uuid.slice(-4)}-2`);
      await override(x.uuid, { max_lists: 3 });
      const p = `sq-over-${seq}-`;
      const res = await seed(x.typeId, `pack-over-${seq}`, [spec(`${p}a`, ['A']), spec(`${p}b`, ['A'])]); // 2 existing + 2 new > 3
      expect(res.status).toBe('failed');
      expect(res.reason).toBe('QUOTA_EXCEEDED');
      expect(res.details).toEqual([expect.objectContaining({ quotaScope: 'org_lists', limit: 3, current: 2, requested: 2 })]);
      expect(await seededKeys(p)).toEqual([]);
    });

    it('below the limit: applied', async () => {
      const x = newOrg();
      await insertList(x.uuid, `u-${x.uuid.slice(-4)}-1`);
      await insertList(x.uuid, `u-${x.uuid.slice(-4)}-2`);
      await override(x.uuid, { max_lists: 3 });
      const p = `sq-ok-${seq}-`;
      const res = await seed(x.typeId, `pack-ok-${seq}`, [spec(`${p}a`, ['A'])]); // 2 + 1 = 3 <= 3
      expect(res.status).not.toBe('failed');
      expect(await seededKeys(p)).toEqual([`${p}a`]);
    });

    it('UUID-side lists beat the DEFAULT ceiling too (no override anywhere)', async () => {
      const x = newOrg();
      const { DEFAULT_MAX_LISTS } = await import('../src/services/quota.service');
      await w.db('selection_lists').insert(
        Array.from({ length: DEFAULT_MAX_LISTS }, (_, i) => ({ id: `front_sl_df${seq}_${i}`.padEnd(24, 'x'), organization_id: x.uuid, key: `def-${seq}-${i}`, created_by: 'system:test', visibility: 'private' })),
      );
      const res = await seed(x.typeId, `pack-def-${seq}`, [spec(`sq-def-${seq}-a`, ['A'])]);
      expect(res.reason).toBe('QUOTA_EXCEEDED');
      expect(res.details).toEqual([expect.objectContaining({ quotaScope: 'org_lists', limit: DEFAULT_MAX_LISTS, current: DEFAULT_MAX_LISTS })]);
    });

    it('overrides under BOTH renderings: the most restrictive wins', async () => {
      const x = newOrg();
      await override(x.typeId, { max_lists: 50 });
      await override(x.uuid, { max_lists: 1 });
      const p = `sq-min-${seq}-`;
      const res = await seed(x.typeId, `pack-min-${seq}`, [spec(`${p}a`, ['A']), spec(`${p}b`, ['A'])]);
      expect(res.reason).toBe('QUOTA_EXCEEDED');
      expect(res.details).toEqual([expect.objectContaining({ quotaScope: 'org_lists', limit: 1 })]);
    });

    it('a single UUID-side list at a UUID-side limit of one leaves no room for a TypeID-targeted create', async () => {
      const x = newOrg();
      await insertList(x.uuid, `u-${x.uuid.slice(-4)}-1`);
      await override(x.uuid, { max_lists: 1 });
      const res = await seed(x.typeId, `pack-re-${seq}`, [spec(`sq-re-${seq}-a`, ['A'])]);
      expect(res.reason).toBe('QUOTA_EXCEEDED');
    });
  });

  describe('items per list (list_items) resolved across renderings', () => {
    it('a UUID-side max_items_per_list override applies to a TypeID-targeted seed', async () => {
      const x = newOrg();
      await override(x.uuid, { max_items_per_list: 2 });
      const p = `sq-items-${seq}-`;
      const over = await seed(x.typeId, `pack-items-${seq}`, [spec(`${p}a`, ['A', 'B', 'C'])]);
      expect(over.reason).toBe('QUOTA_EXCEEDED');
      expect(over.details).toEqual([expect.objectContaining({ quotaScope: 'list_items', listKey: `${p}a`, limit: 2, requested: 3 })]);
      expect(await seededKeys(p)).toEqual([]);
      const ok = await seed(x.typeId, `pack-items-ok-${seq}`, [spec(`${p}b`, ['A', 'B'])]);
      expect(ok.status).not.toBe('failed');
    });

    it('an UPGRADE adding items past a UUID-side override is refused', async () => {
      const x = newOrg();
      await override(x.uuid, { max_items_per_list: 3 });
      const p = `sq-up-${seq}-`;
      expect((await seed(x.typeId, `pack-up-${seq}`, [spec(`${p}a`, ['A', 'B'])])).status).not.toBe('failed');
      const { applySeedRequest } = await import('../src/seed');
      const v2: any = await applySeedRequest(w.db, { ...(seedReq(x.typeId, `pack-up-${seq}`, [spec(`${p}a`, ['A', 'B', 'C', 'D'])]) as any), pack: { key: `pack-up-${seq}`, version: 2 } });
      expect(v2.reason).toBe('QUOTA_EXCEEDED');
      expect(v2.details).toEqual([expect.objectContaining({ quotaScope: 'list_items', limit: 3 })]);
    });
  });

  describe('flag OFF: the 4.0.0 exact id, unchanged', () => {
    it('UUID-side lists and override are NOT seen by a TypeID-targeted seed', async () => {
      const x = newOrg();
      await insertList(x.uuid, `u-${x.uuid.slice(-4)}-1`);
      await insertList(x.uuid, `u-${x.uuid.slice(-4)}-2`);
      await override(x.uuid, { max_lists: 1, max_items_per_list: 1 });
      await useFlags(false);
      const p = `sq-off-${seq}-`;
      const res = await seed(x.typeId, `pack-off-${seq}`, [spec(`${p}a`, ['A', 'B']), spec(`${p}b`, ['A'])]);
      expect(res.status).not.toBe('failed');
      expect(await seededKeys(p)).toEqual([`${p}a`, `${p}b`]);
      // and its own exact-id override still binds
      const y = newOrg();
      await override(y.typeId, { max_lists: 1 });
      const refused = await seed(y.typeId, `pack-off2-${seq}`, [spec(`sq-off2-${seq}-a`, ['A']), spec(`sq-off2-${seq}-b`, ['A'])]);
      expect(refused.reason).toBe('QUOTA_EXCEEDED');
    });
  });

  describe('the canonical quota lock (shared with the HTTP write paths)', () => {
    const quotaKey = (typeId: string) => `org_lists:${typeId}`;
    const waitersOn = async (scopeKey: string): Promise<number> => {
      const r = await w.db.raw(
        `SELECT count(*)::int AS c FROM pg_locks
          WHERE locktype = 'advisory' AND NOT granted
            AND ((classid::bigint << 32) | objid::bigint) = (SELECT hashtextextended(?, 0))`,
        [scopeKey],
      );
      return r.rows[0].c as number;
    };

    it('a seed parks on the SAME quota lock an HTTP create through the bare-UUID claim holds', async () => {
      const x = newOrg();
      const { lockQuotaScope } = await import('../src/services/quota.service');
      let release!: () => void;
      const holding = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const haveLock = new Promise<void>((r) => (locked = r));
      // exactly what the HTTP create does for the UUID claim with the flag ON: the CANONICAL org id
      const holder = w.db.transaction(async (trx) => {
        await lockQuotaScope(trx, quotaKey(x.typeId));
        locked();
        await holding;
      });
      await haveLock;
      const base = await waitersOn(quotaKey(x.typeId));
      const p = `sq-lock-${seq}-`;
      const pending = seed(x.typeId, `pack-lock-${seq}`, [spec(`${p}a`, ['A'])]);
      try {
        for (let i = 0; i < 200 && (await waitersOn(quotaKey(x.typeId))) <= base; i++) await new Promise((r) => setTimeout(r, 25));
        expect(await waitersOn(quotaKey(x.typeId))).toBeGreaterThan(base); // parked on the canonical quota lock
        expect(await seededKeys(p)).toEqual([]);
      } finally {
        release();
        await holder;
      }
      expect((await pending).status).not.toBe('failed');
      expect(await seededKeys(p)).toEqual([`${p}a`]);
    });

    it('a seed and an HTTP create through DIFFERENT renderings serialise: with room for exactly one more list only one of them wins', async () => {
      for (let round = 0; round < 6; round++) {
        const x = newOrg();
        await override(x.uuid, { max_lists: 1 }); // UUID-side override, TypeID-targeted seed, UUID-claim HTTP create
        const key = `race-${seq}`;
        const [http, seeded] = await Promise.all([
          w.api(x.byUuid).post('/v1/selection-lists', { key: `${key}-http`, name: 'H' }),
          seed(x.typeId, `pack-race-${seq}`, [spec(`${key}-seed`, ['A'])]),
        ]);
        const httpOk = http.status === 201;
        const seedOk = seeded.status !== 'failed';
        expect({ round, winners: Number(httpOk) + Number(seedOk) }).toEqual({ round, winners: 1 });
        const active = await w.db('selection_lists').whereIn('organization_id', [x.typeId, x.uuid]).where({ status: 'active' }).count('id as c').first();
        expect(Number((active as { c: string }).c)).toBe(1);
        if (!httpOk) expect(http.status).toBe(403); // QUOTA_EXCEEDED
        if (!seedOk) expect(seeded.reason).toBe('QUOTA_EXCEEDED');
      }
    });
  });
});
