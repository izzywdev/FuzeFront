// shared-lists.suspension-owner.db.test.ts - the write suspension is keyed by the org that OWNS the platform rows,
// not by SELECTION_LIST_PLATFORM_ORG_ID. Removing the variable (or pointing it elsewhere) after common rows exist
// must not turn a suspended owner back into "not suspended": every write path of its platform rows - list, item,
// translation and access mutations, purge, publish/promote and seeding - stays refused, flag ON and OFF, until the
// owner is reactivated. Reads are unaffected. Real Postgres, real handlers, real app.

import type { Knex } from 'knex';
import { dbDescribe } from './helpers/testDb';
import { toUuid } from '@izzywdev/fuzefront-identity';
import { createWorld, ORG_A, ORG_B, P, PLATFORM, World } from './helpers/sharedWorld';
import { allFlagsExceptShared, flagClientWith } from './helpers/flagClient';
import { spec } from './helpers/seedFixtures';
import { ATTEMPT_NAMES, Ctx, freshCommonList, mutationAttempts } from './helpers/suspensionFixtures';

const state: { db: Knex | undefined } = { db: undefined };
jest.mock('../src/db', () => ({
  get db() {
    return state.db;
  },
}));

const PLATFORM_UUID = toUuid(PLATFORM as never);
const ORG_A_UUID = toUuid(ORG_A as never);
let tick = 0;
const T = () => new Date(Date.now() - 600_000 + ++tick * 1000).toISOString();
const deleted = (organizationId: string, cascade: 'soft' | 'hard' = 'soft') =>
  ({ version: '1.0', topic: 'identity.org.deleted', correlationId: `corr-owner-del-${tick}`, occurredAt: T(), payload: { organizationId, slug: 'x', ownerId: null, cascade } }) as never;
const updated = (organizationId: string, over: Record<string, unknown> = {}) =>
  ({
    version: '1.0',
    topic: 'identity.org.updated',
    correlationId: `corr-owner-upd-${tick}`,
    occurredAt: T(),
    payload: { organizationId, slug: 'x', name: 'Org', type: 'platform', isActive: true, parentId: null, ownerId: null, ...over },
  }) as never;

dbDescribe('write suspension follows the OWNER of the platform rows, not the platform-org configuration (real Postgres)', () => {
  let w: World;
  let n = 0;

  beforeAll(async () => {
    w = await createWorld(state);
    w.authz.member(PLATFORM, P.opEditor.userId); // the membership probe of access PUT
  });
  afterAll(() => w.teardown());
  const resetSuspension = () => w.db('selection_list_ref_index').where({ entity_type: 'organization' }).update({ suspended_at: null, suspended_event_at: null, snapshot_at: null });
  beforeEach(resetSuspension);
  afterEach(async () => {
    await resetSuspension();
    process.env.SELECTION_LIST_PLATFORM_ORG_ID = PLATFORM;
    const { _resetPlatformOrgCacheForTesting } = await import('../src/lib/sharedLists');
    _resetPlatformOrgCacheForTesting();
    await useFlags(true);
  });

  const useFlags = async (shared: boolean) => {
    const { setFlagClient } = await import('../src/flags');
    setFlagClient(shared ? flagClientWith(true) : { getBooleanValue: allFlagsExceptShared });
  };
  const removeConfig = async () => {
    delete process.env.SELECTION_LIST_PLATFORM_ORG_ID;
    const { _resetPlatformOrgCacheForTesting } = await import('../src/lib/sharedLists');
    _resetPlatformOrgCacheForTesting();
  };
  const seedReq = (org: string, key: string, lists: unknown[]) =>
    ({
      organizationId: org,
      scope: 'org',
      source: { app: 'platform', service: 'selection-list-service' },
      pack: { key, version: 1 },
      trigger: 'org-created',
      requestId: null,
      honorVisibility: true,
      orgCheck: 'skip', // the target org's projection is not what is under test; the suspension is
      lists,
    }) as never;
  const suspendedAt = async (wire: string) => (await w.db('selection_list_ref_index').where({ wire_id: wire }).first())?.suspended_at ?? null;

  describe.each([
    ['flag ON', true],
    ['shared-lists flag OFF', false],
  ] as Array<[string, boolean]>)('%s', (_name, shared) => {
    it('env var REMOVED after common rows exist, the owner suspended: EVERY write path of its platform rows is refused (list, item, translation, access, purge); reads keep working; reactivation resumes', async () => {
      const c = await freshCommonList(w, `owner-env-${++n}`);
      await removeConfig();
      await useFlags(shared);
      const { handleOrgDeleted } = await import('../src/events/org-deleted.handler');
      const { handleOrgUpdated } = await import('../src/events/org-updated.handler');

      // control: not suspended yet -> the write goes through (the refusals below are the suspension, not the missing config)
      expect((await w.api(P.op).patch(c.L, { description: 'before' })).status).toBe(200);

      // an org that owns a platform row is protected even with no configuration: its deactivation is a SUSPENSION
      await handleOrgDeleted(deleted(PLATFORM_UUID));
      expect(await suspendedAt(PLATFORM)).not.toBeNull();

      for (const [name, run] of mutationAttempts(w)) {
        const r = await run(c);
        expect({ name, status: r.status, reason: r.body?.reason }).toEqual({ name, status: 403, reason: 'platform_suspended' });
      }
      expect((await w.db('selection_lists').where({ id: c.id }).first()).status).toBe('active');
      expect(await w.db('selection_list_items').where({ list_id: c.id })).toHaveLength(2);
      expect((await w.api(P.op).get(c.L)).status).toBe(200); // a read is a read
      expect((await w.api(P.op).get(c.L)).body.description).toBe('before');

      // reactivation clears it; the very same write now goes through, still with no configuration
      await handleOrgUpdated(updated(PLATFORM_UUID));
      expect(await suspendedAt(PLATFORM)).toBeNull();
      expect((await w.api(P.op).patch(c.L, { description: 'after' })).status).toBe(200);
    });

    it('env var REMOVED: platform SEEDING into the suspended owner is refused (retryable), nothing written; an ordinary org still seeds', async () => {
      await freshCommonList(w, `owner-seed-${++n}`);
      await removeConfig();
      await useFlags(shared);
      const { handleOrgDeleted } = await import('../src/events/org-deleted.handler');
      const { applySeedRequest } = await import('../src/seed');
      await handleOrgDeleted(deleted(PLATFORM_UUID));
      for (const [label, lists] of [
        ['common list', [spec(`own-seed-common-${n}`, ['A'], { visibility: 'platform' })]],
        ['private list (the org owns common rows)', [spec(`own-seed-private-${n}`, ['A'])]],
      ] as Array<[string, unknown[]]>) {
        const res: any = await applySeedRequest(w.db, seedReq(PLATFORM, `own-pack-${label.length}-${n}`, lists));
        expect({ label, status: res.status, retryable: res.retryable }).toEqual({ label, status: 'failed', retryable: true });
        expect(res.message).toContain('suspended');
      }
      expect(await w.db('selection_lists').where('key', 'like', `own-seed-%-${n}`)).toHaveLength(0);
      const ok: any = await applySeedRequest(w.db, seedReq(ORG_B, `own-pack-b-${n}`, [spec(`own-seed-b-${n}`, ['A'])]));
      expect(ok.status).not.toBe('failed');
    });

    it('env var configured for ANOTHER org: rows owned by another org whose projection is suspended are refused for that org, and only that org', async () => {
      // ORG_A owns a platform-visibility row (e.g. the configuration was changed after it was published)
      const made = await w.api(P.aAdmin).post('/v1/selection-lists', { key: `a-common-${++n}`, name: 'A common' });
      expect(made.status).toBe(201);
      const L = `/v1/selection-lists/${made.body.id}`;
      await w.db('selection_lists').where({ id: made.body.id }).update({ visibility: 'platform', created_by: 'system' });
      const aPrivate = await w.api(P.aAdmin).post('/v1/selection-lists', { key: `a-private-${n}`, name: 'A private' });
      expect(aPrivate.status).toBe(201);
      const platformList = await freshCommonList(w, `owner-other-${n}`);
      await useFlags(shared);
      const { handleOrgDeleted } = await import('../src/events/org-deleted.handler');
      const { handleOrgUpdated } = await import('../src/events/org-updated.handler');
      const { applySeedRequest } = await import('../src/seed');

      expect((await w.api(P.aAdmin).patch(L, { description: 'ok' })).status).toBe(200); // control: not suspended

      await handleOrgDeleted(deleted(ORG_A_UUID, 'hard')); // ORG_A owns a platform row -> protected -> suspended, nothing deleted
      expect(await suspendedAt(ORG_A)).not.toBeNull();
      expect(await suspendedAt(PLATFORM)).toBeNull();
      expect(await w.db('selection_lists').where({ id: made.body.id })).toHaveLength(1);

      for (const [name, run] of mutationAttempts(w, P.aAdmin)) {
        // the fixture list belongs to the PLATFORM org: only its own owner's rows are in scope here
        if (name.includes('access') || name.includes('item')) continue;
        const r = await run({ L, id: made.body.id, item: 'x', second: 'y' } as Ctx);
        expect({ name, status: r.status, reason: r.body?.reason }).toEqual({ name, status: 403, reason: 'platform_suspended' });
      }
      expect((await w.api(P.aAdmin).patch(`/v1/selection-lists/${aPrivate.body.id}`, { description: 'fine' })).status).toBe(200); // its private rows are not platform rows
      expect((await w.api(P.op).patch(platformList.L, { description: 'platform org unaffected' })).status).toBe(200); // other owners unaffected
      const seeded: any = await applySeedRequest(w.db, seedReq(ORG_A, `own-pack-a-${n}`, [spec(`own-seed-a-${n}`, ['A'])]));
      expect({ status: seeded.status, retryable: seeded.retryable }).toEqual({ status: 'failed', retryable: true });
      expect(seeded.message).toContain('suspended');

      await handleOrgUpdated(updated(ORG_A_UUID));
      expect(await suspendedAt(ORG_A)).toBeNull();
      expect((await w.api(P.aAdmin).patch(L, { description: 'back' })).status).toBe(200);
    });
  });

  it.each([
    ['flag ON', true],
    ['shared-lists flag OFF', false],
  ] as Array<[string, boolean]>)('%s: a FIRST publication of common lists into a suspended platform org that owns no common row yet is refused (retryable), nothing written', async (_n, shared) => {
    // ORG_B becomes the confirmed, configured platform org; it owns no `platform` row yet
    const orgBUuid = toUuid(ORG_B as never);
    await w.db('selection_list_ref_index').insert({ entity_type: 'organization', entity_id: orgBUuid, wire_id: ORG_B, org_type: 'platform', is_active: true });
    process.env.SELECTION_LIST_PLATFORM_ORG_ID = ORG_B;
    const { _resetPlatformOrgCacheForTesting } = await import('../src/lib/sharedLists');
    _resetPlatformOrgCacheForTesting();
    try {
      await useFlags(shared);
      const { handleOrgDeleted } = await import('../src/events/org-deleted.handler');
      const { applySeedRequest } = await import('../src/seed');
      await handleOrgDeleted(deleted(orgBUuid));
      expect(await suspendedAt(ORG_B)).not.toBeNull();
      const res: any = await applySeedRequest(w.db, seedReq(ORG_B, `first-pub-${++n}`, [spec(`first-pub-common-${n}`, ['A'], { visibility: 'platform' })]));
      expect({ status: res.status, retryable: res.retryable }).toEqual({ status: 'failed', retryable: true });
      expect(res.message).toContain('suspended');
      expect(await w.db('selection_lists').where('key', 'like', `first-pub-common-%`)).toHaveLength(0);
    } finally {
      await w.db('selection_list_ref_index').where({ entity_id: orgBUuid }).delete();
    }
  });

  it('the EVERY-path list covers what the race suite covers (kept in step)', () => {
    expect(ATTEMPT_NAMES.length).toBeGreaterThanOrEqual(19);
  });
});
