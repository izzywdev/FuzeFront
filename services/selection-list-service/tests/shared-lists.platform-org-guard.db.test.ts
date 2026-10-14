// shared-lists.platform-org-guard.db.test.ts - the org lifecycle consumers treat the PLATFORM organization as
// immutable (src/events/platformGuard.ts): a schema-valid but forged identity.org.deleted / org.updated / org.created
// cannot delete, archive, tombstone, retype or deactivate the org that owns every common list. Real Postgres, real
// handlers, real app. The guard is flag-independent and falls back to "any org owning a platform row" when the
// platform org is not configured.

import type { Knex } from 'knex';
import { dbDescribe } from './helpers/testDb';
import { fromUuid, toUuid } from '@izzywdev/fuzefront-identity';
import { createWorld, ORG_A, P, PLATFORM, publishPriorityList, World } from './helpers/sharedWorld';
import { flagClientWith } from './helpers/flagClient';
import { logger } from '../src/lib/logger';

const state: { db: Knex | undefined } = { db: undefined };
jest.mock('../src/db', () => ({
  get db() {
    return state.db;
  },
}));

const PLATFORM_UUID = toUuid(PLATFORM as never);
let clock = Date.parse('2026-10-14T00:00:00.000Z');
const at = () => new Date((clock += 60_000)).toISOString();
const deleted = (organizationId: string, cascade: 'soft' | 'hard') =>
  ({ version: '1.0', topic: 'identity.org.deleted', correlationId: `corr-del-${clock}`, occurredAt: at(), payload: { organizationId, slug: 'x', ownerId: null, cascade } }) as never;
const orgEvent = (topic: 'identity.org.updated' | 'identity.org.created', organizationId: string, over: Record<string, unknown> = {}) =>
  ({
    version: '1.0',
    topic,
    correlationId: `corr-${topic}-${clock}`,
    occurredAt: at(),
    payload: { organizationId, slug: 'x', name: 'Platform', type: 'platform', isActive: true, parentId: null, ownerId: null, ...over },
  }) as never;

dbDescribe('the platform organization is immutable for the org lifecycle consumers (real Postgres)', () => {
  let w: World;
  let platform: { listId: string; low: string; mid: string; old: string };
  let errorSpy: jest.Mock;
  let childSpy: jest.SpyInstance;

  beforeAll(async () => {
    w = await createWorld(state);
    platform = await publishPriorityList(w);
    errorSpy = jest.fn();
    const real = logger.child.bind(logger);
    childSpy = jest.spyOn(logger, 'child').mockImplementation(((...a: unknown[]) => {
      const c = (real as (...x: unknown[]) => any)(...a);
      return new Proxy(c, { get: (t, k) => (k === 'error' ? errorSpy : t[k]) });
    }) as never);
  });
  afterAll(async () => {
    childSpy.mockRestore();
    await w.teardown();
  });
  beforeEach(() => errorSpy.mockClear());

  const counts = async () => ({
    lists: Number((await w.db('selection_lists').where({ organization_id: PLATFORM }).count('id as c').first() as any).c),
    activeLists: Number((await w.db('selection_lists').where({ organization_id: PLATFORM, status: 'active' }).count('id as c').first() as any).c),
    items: Number((await w.db('selection_list_items').whereIn('list_id', w.db('selection_lists').select('id').where({ organization_id: PLATFORM })).count('id as c').first() as any).c),
    listTranslations: Number((await w.db('selection_list_translations').whereIn('list_id', w.db('selection_lists').select('id').where({ organization_id: PLATFORM })).count('list_id as c').first() as any).c),
    itemTranslations: Number((await w.db('selection_list_item_translations').whereIn('item_id', w.db('selection_list_items').select('id').where({ list_id: platform.listId })).count('item_id as c').first() as any).c),
  });
  const projection = () => w.db('selection_list_ref_index').where({ wire_id: PLATFORM }).first();
  const commonStillServed = async () => {
    expect((await w.api(P.aMember).get(`/v1/selection-lists/${platform.listId}`)).status).toBe(200);
    expect((await w.api(P.bMember).post('/v1/resolve', { ids: [platform.low] })).body.missing).toEqual([]);
    expect((await w.api(P.op).post('/v1/selection-lists', { key: `still-${Math.random().toString(36).slice(2, 8)}`, name: 'S', visibility: 'platform' })).status).toBe(201);
  };
  const flagOff = async (fn: () => Promise<void>) => {
    const { setFlagClient } = await import('../src/flags');
    setFlagClient(flagClientWith(false));
    try {
      await fn();
    } finally {
      setFlagClient(flagClientWith(true));
    }
  };

  describe.each([
    ['TypeID', PLATFORM],
    ['bare UUID', PLATFORM_UUID],
  ])('identity.org.deleted for the platform org (%s)', (_n, id) => {
    it.each(['hard', 'soft'] as const)('%s cascade: lists, items, translations and the projection row are left intact; logged at error; acknowledged', async (cascade) => {
      const { handleOrgDeleted } = await import('../src/events/org-deleted.handler');
      const before = await counts();
      const row = await projection();
      expect(before.lists).toBeGreaterThan(0);
      await expect(handleOrgDeleted(deleted(id, cascade))).resolves.toBeUndefined(); // acknowledged, not thrown
      expect(await counts()).toEqual(before);
      const after = await projection();
      expect(after.status).toBe('active');
      expect(after.status).toBe(row.status);
      expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({ cascade, eventId: expect.stringContaining('corr-del-') }), expect.stringContaining('PLATFORM organization REFUSED'));
      await commonStillServed();
    });

    it('the guard holds with the shared-lists flag OFF', async () => {
      const { handleOrgDeleted } = await import('../src/events/org-deleted.handler');
      const before = await counts();
      await flagOff(async () => {
        await handleOrgDeleted(deleted(id, 'hard'));
      });
      expect(await counts()).toEqual(before);
      expect((await projection()).status).toBe('active');
    });
  });

  it('the platform org NOT configured: any org owning a platform-visibility row is still protected', async () => {
    const { handleOrgDeleted } = await import('../src/events/org-deleted.handler');
    const { _resetPlatformOrgCacheForTesting } = await import('../src/lib/sharedLists');
    const before = await counts();
    delete process.env.SELECTION_LIST_PLATFORM_ORG_ID;
    _resetPlatformOrgCacheForTesting();
    try {
      await handleOrgDeleted(deleted(PLATFORM, 'hard'));
      await handleOrgDeleted(deleted(PLATFORM_UUID, 'hard'));
      expect(await counts()).toEqual(before);
      expect((await projection()).status).toBe('active');
    } finally {
      process.env.SELECTION_LIST_PLATFORM_ORG_ID = PLATFORM;
      _resetPlatformOrgCacheForTesting();
    }
  });

  it('a NORMAL org still cascades (hard purges, soft archives, the projection is tombstoned)', async () => {
    const { handleOrgDeleted } = await import('../src/events/org-deleted.handler');
    const orgUuid = '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7d77';
    const org = fromUuid('organization', orgUuid);
    const owner = { userId: fromUuid('user', '0195a8f2-aaaa-7a11-8b2d-3f4e5a6b7d77'), orgId: org };
    w.authz.allowCatalog(org, owner.userId, ['list', 'create', 'resolve', 'read_shared']);
    const mk = async (key: string) => {
      const l = await w.api(owner).post('/v1/selection-lists', { key, name: key });
      expect(l.status).toBe(201);
      expect((await w.api(owner).post(`/v1/selection-lists/${l.body.id}/items`, { code: 'A', label: 'A' })).status).toBe(201);
      return l.body.id as string;
    };
    const soft = await mk('norm-soft');
    await handleOrgDeleted(deleted(orgUuid, 'soft'));
    expect((await w.db('selection_lists').where({ id: soft }).first()).status).toBe('archived');
    expect((await w.db('selection_list_ref_index').where({ wire_id: org }).first())?.status).toBe('deleted');
    expect(errorSpy).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('REFUSED'));
    await handleOrgDeleted(deleted(orgUuid, 'hard'));
    expect(await w.db('selection_lists').where({ id: soft }).first()).toBeUndefined();
    expect(await w.db('selection_list_items').where({ list_id: soft })).toHaveLength(0);
  });

  describe('hostile snapshots of the platform org are refused; harmless ones apply', () => {
    it.each([
      ['updated: deactivate', 'identity.org.updated', { isActive: false }],
      ['updated: retype to organization', 'identity.org.updated', { type: 'organization' }],
      ['created: retype to personal', 'identity.org.created', { type: 'personal' }],
      ['created: inactive', 'identity.org.created', { isActive: false }],
    ] as const)('%s', async (_n, topic, over) => {
      const { handleOrgUpdated } = await import('../src/events/org-updated.handler');
      const { handleOrgCreated } = await import('../src/events/org-created.handler');
      const before = await projection();
      for (const id of [PLATFORM_UUID]) {
        if (topic === 'identity.org.updated') await handleOrgUpdated(orgEvent(topic, id, over));
        else expect(await handleOrgCreated(orgEvent(topic, id, over))).toMatchObject({ projected: false, seeding: 'refused-platform-org' });
      }
      const after = await projection();
      expect({ t: after.org_type, a: after.is_active, s: after.status }).toEqual({ t: before.org_type, a: before.is_active, s: before.status });
      expect(errorSpy).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('PLATFORM organization REFUSED'));
      await commonStillServed();
    });

    it('a rename (same type, still active) applies', async () => {
      const { handleOrgUpdated } = await import('../src/events/org-updated.handler');
      await handleOrgUpdated(orgEvent('identity.org.updated', PLATFORM_UUID, { name: 'Renamed Platform' }));
      expect((await projection()).org_name).toBe('Renamed Platform');
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('an ordinary org may still be deactivated / retyped by an update', async () => {
      const { handleOrgUpdated } = await import('../src/events/org-updated.handler');
      const orgUuid = ORG_A && toUuid(ORG_A as never);
      await handleOrgUpdated(orgEvent('identity.org.updated', orgUuid, { type: 'organization', isActive: false, name: 'A' }));
      const row = await w.db('selection_list_ref_index').where({ wire_id: ORG_A }).first();
      expect({ t: row.org_type, a: row.is_active }).toEqual({ t: 'organization', a: false });
    });
  });
});
