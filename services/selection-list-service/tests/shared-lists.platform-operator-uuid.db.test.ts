// shared-lists.platform-operator-uuid.db.test.ts - the platform operator presenting the BARE-UUID org claim (what
// org-session tokens carry) on a common list stored under the configured `org_...` TypeID.
//
// Every guard, pre-check, quota and Permit decision treats the two renderings as ONE organization:
//   - the delegated authorization pre-check (requireAuthzCheck) matches every rendering, so a mutation is never a 404;
//   - item and locale quotas resolve overrides across every rendering (the most restrictive wins);
//   - the Permit decision is asked in the Permit key form of the tenant and subject (the keyed client), so a grant made
//     under the TypeID authorizes the UUID claim.
// Real Postgres, real app.

import type { Knex } from 'knex';
import { dbDescribe } from './helpers/testDb';
import { toUuid } from '@izzywdev/fuzefront-identity';
import { ADMIN_ACTIONS, createWorld, P, PLATFORM, Principal, World } from './helpers/sharedWorld';

const state: { db: Knex | undefined } = { db: undefined };
jest.mock('../src/db', () => ({
  get db() {
    return state.db;
  },
}));

dbDescribe('the platform operator with the bare-UUID claim on a TypeID-stored common list (real Postgres)', () => {
  let w: World;
  let n = 0;
  let opUuid: Principal;
  const PLATFORM_UUID = toUuid(PLATFORM as never);

  beforeAll(async () => {
    w = await createWorld(state);
    opUuid = { userId: toUuid(P.op.userId as never), orgId: PLATFORM_UUID };
    w.authz.allowCatalog(PLATFORM_UUID, opUuid.userId, ADMIN_ACTIONS);
    w.authz.member(PLATFORM, P.opEditor.userId);
  });
  afterAll(() => w.teardown());

  /** A common list created by the operator through the TypeID claim (stored under the configured TypeID). */
  const common = async () => {
    const made = await w.api(P.op).post('/v1/selection-lists', { key: `uuid-op-${++n}`, name: 'Common', visibility: 'platform' });
    expect(made.status).toBe(201);
    expect(made.body.organization_id).toBe(PLATFORM);
    await w.db('selection_lists').where({ id: made.body.id }).update({ created_by: 'system' }); // out of the per-user quota
    return { id: made.body.id as string, L: `/v1/selection-lists/${made.body.id}` };
  };
  const quotaOverride = (org: string, o: Record<string, number>) =>
    w.db('selection_list_org_quota').insert({ organization_id: org, updated_by: 'test', ...o }).onConflict('organization_id').merge();
  const clearOverride = () => w.db('selection_list_org_quota').whereIn('organization_id', [PLATFORM, PLATFORM_UUID]).delete();
  afterEach(clearOverride);

  it('EVERY mutation through the UUID claim goes through (never the legacy pre-check 404): list, items, translations, access, archive', async () => {
    const c = await common();
    const api = w.api(opUuid);
    expect((await api.patch(c.L, { description: 'by uuid' })).status).toBe(200);
    const item = await api.post(`${c.L}/items`, { code: 'A', label: 'A' });
    expect(item.status).toBe(201);
    const second = await api.post(`${c.L}/items`, { code: 'B', label: 'B' });
    expect(second.status).toBe(201);
    expect((await api.patch(`${c.L}/items/${item.body.id}`, { label: 'A2' })).status).toBe(200);
    expect((await api.put(`${c.L}/items/reorder`, { item_ids: [second.body.id, item.body.id] })).status).toBe(200);
    expect((await api.put(`${c.L}/translations/fr`, { name: 'Commune' })).status).toBe(200);
    expect((await api.put(`${c.L}/items/${item.body.id}/translations/fr`, { label: 'A fr' })).status).toBe(200);
    expect((await api.put(`${c.L}/access/${P.opEditor.userId}`, { role: 'list-viewer' })).status).toBe(200);
    expect((await api.get(`${c.L}/access`)).status).toBe(200);
    expect((await api.post(`${c.L}/items/${second.body.id}/archive`)).status).toBe(200);
    expect((await api.post(`${c.L}/archive`)).status).toBe(200);
  });

  it('item quota: an override stored under the OTHER rendering applies to item create and to un-archive', async () => {
    const c = await common();
    await quotaOverride(PLATFORM, { max_items_per_list: 1 }); // stored under the TypeID, list stored under the TypeID, claim is the UUID
    const api = w.api(opUuid);
    const first = await api.post(`${c.L}/items`, { code: 'A', label: 'A' });
    expect(first.status).toBe(201);
    const over = await api.post(`${c.L}/items`, { code: 'B', label: 'B' });
    expect(over.status).toBe(403);
    expect(over.body).toMatchObject({ code: 'QUOTA_EXCEEDED', scope: 'list_items', limit: 1 });
    // un-archive path: archive the first, add another, then restoring the first is refused
    expect((await api.post(`${c.L}/items/${first.body.id}/archive`)).status).toBe(200);
    expect((await api.post(`${c.L}/items`, { code: 'C', label: 'C' })).status).toBe(201);
    const restore = await api.patch(`${c.L}/items/${first.body.id}`, { status: 'active' });
    expect(restore.status).toBe(403);
    expect(restore.body).toMatchObject({ code: 'QUOTA_EXCEEDED', scope: 'list_items' });
  });

  it('item create: the EXACT in-transaction quota check resolves the override across renderings too (the fast path sees room, a concurrent write fills it)', async () => {
    const c = await common();
    await quotaOverride(PLATFORM, { max_items_per_list: 1 }); // under the TypeID; the caller presents the UUID
    const { lockOrgOutbox } = await import('../src/events/outbox');
    const waiters = async (): Promise<number> =>
      (await w.db.raw(
        `SELECT count(*)::int AS c FROM pg_locks WHERE locktype = 'advisory' AND NOT granted
            AND ((classid::bigint << 32) | objid::bigint) = (SELECT hashtextextended(?, 0))`,
        [`sl-outbox:${PLATFORM}`],
      )).rows[0].c as number;
    let release!: () => void;
    const holding = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const haveLock = new Promise<void>((r) => (locked = r));
    const holder = w.db.transaction(async (trx) => {
      await lockOrgOutbox(trx, PLATFORM);
      locked();
      await holding;
      // a concurrent writer fills the only slot while the request waits for the org lock (it passed the unlocked fast path with 0 items)
      await trx('selection_list_items').insert({ id: `front_sli_audit${++n}`.padEnd(24, 'x'), list_id: c.id, code: 'RACE', sort_order: 100, status: 'active', created_by: 'system' });
    });
    await haveLock;
    const base = await waiters();
    const pending = Promise.resolve(w.api(opUuid).post(`${c.L}/items`, { code: 'A', label: 'A' }));
    try {
      for (let i = 0; i < 200 && (await waiters()) <= base; i++) await new Promise((r) => setTimeout(r, 25));
      expect(await waiters()).toBeGreaterThan(base);
    } finally {
      release();
      await holder;
    }
    const res = await pending;
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'QUOTA_EXCEEDED', scope: 'list_items', limit: 1 });
  });

  it('item quota: an override stored under the UUID applies to a TypeID-claim caller too (the reverse)', async () => {
    const c = await common();
    await quotaOverride(PLATFORM_UUID, { max_items_per_list: 1 });
    expect((await w.api(P.op).post(`${c.L}/items`, { code: 'A', label: 'A' })).status).toBe(201);
    expect((await w.api(P.op).post(`${c.L}/items`, { code: 'B', label: 'B' })).status).toBe(403);
  });

  it('locale quota: an override under the other rendering refuses a new list-level and new locale', async () => {
    const c = await common();
    const api = w.api(opUuid);
    const item = await api.post(`${c.L}/items`, { code: 'A', label: 'A' });
    expect(item.status).toBe(201);
    await quotaOverride(PLATFORM, { max_locales: 1 }); // the source locale already uses the only slot
    const list = await api.put(`${c.L}/translations/fr`, { name: 'Commune' });
    expect(list.status).toBe(403);
    expect(list.body).toMatchObject({ code: 'QUOTA_EXCEEDED', scope: 'list_locales' });
    // the source locale itself is an update, never refused
    expect((await api.patch(c.L, { name: 'Renamed' })).status).toBe(200);
  });

  it('the Permit decision is asked in the Permit key form: a grant under the TypeID authorizes the UUID claim, and the keys sent are bare UUIDs', async () => {
    const c = await common();
    const mark = w.authz.asked.length;
    expect((await w.api(opUuid).patch(c.L, { description: 'x' })).status).toBe(200);
    const asked = w.authz.asked.slice(mark).filter((q) => q.resource.key === c.id);
    expect(asked.length).toBeGreaterThan(0);
    for (const q of asked) {
      expect(q.tenant).toBe(PLATFORM_UUID);
      expect(q.subject).toBe(opUuid.userId);
    }
  });
});
