// shared-lists.platform-org-guard.db.test.ts - the platform organization is IMMUTABLE for the org lifecycle
// consumers (src/events/platformGuard.ts): no event deletes, archives or tombstones it, nothing retypes it, and a
// DEACTIVATION splits into its two effects:
//   READS stay available to every tenant (common lists, resolve, ids) - data intact;
//   WRITES fail closed (publish_platform, platform list/item mutations, platform purge, platform seeding) while the
//   projection carries `suspended_at`, read FRESH per request; a legitimate reactivation clears it.
// Real Postgres, real handlers, real app. Flag-independent, with the "any org owning a platform row" fallback when
// the platform org is not configured.

import type { Knex } from 'knex';
import { dbDescribe } from './helpers/testDb';
import { fromUuid, toUuid } from '@izzywdev/fuzefront-identity';
import { createWorld, ORG_A, P, PLATFORM, publishPriorityList, World } from './helpers/sharedWorld';
import { flagClientWith } from './helpers/flagClient';
import { spec } from './helpers/seedFixtures';
import { logger } from '../src/lib/logger';

const state: { db: Knex | undefined } = { db: undefined };
jest.mock('../src/db', () => ({
  get db() {
    return state.db;
  },
}));

const PLATFORM_UUID = toUuid(PLATFORM as never);
let clock = Date.now() - 24 * 3_600_000;
const BASE = Date.now() - 3_600_000;
const T = (n: number) => new Date(BASE + n * 1000).toISOString(); // explicit, ordered instants (all in the past)
const at = () => new Date((clock += 60_000)).toISOString();
const deleted = (organizationId: string, cascade: 'soft' | 'hard', iso?: string) =>
  ({ version: '1.0', topic: 'identity.org.deleted', correlationId: `corr-del-${iso ?? clock}`, occurredAt: iso ?? at(), payload: { organizationId, slug: 'x', ownerId: null, cascade } }) as never;
const orgEvent = (topic: 'identity.org.updated' | 'identity.org.created', organizationId: string, over: Record<string, unknown> = {}, iso?: string) =>
  ({
    version: '1.0',
    topic,
    correlationId: `corr-${topic}-${iso ?? clock}`,
    occurredAt: iso ?? at(),
    payload: { organizationId, slug: 'x', name: 'Platform', type: 'platform', isActive: true, parentId: null, ownerId: null, ...over },
  }) as never;

dbDescribe('the platform organization is immutable and suspendable for the org lifecycle consumers (real Postgres)', () => {
  let w: World;
  let platform: { listId: string; low: string; mid: string; old: string };
  let errorSpy: jest.Mock;
  let warnSpy: jest.Mock;
  let childSpy: jest.SpyInstance;

  beforeAll(async () => {
    w = await createWorld(state);
    platform = await publishPriorityList(w);
    errorSpy = jest.fn();
    warnSpy = jest.fn();
    const real = logger.child.bind(logger);
    childSpy = jest.spyOn(logger, 'child').mockImplementation(((...a: unknown[]) => {
      const c = (real as (...x: unknown[]) => any)(...a);
      return new Proxy(c, { get: (t, k) => (k === 'error' ? errorSpy : k === 'warn' ? warnSpy : t[k]) });
    }) as never);
  });
  afterAll(async () => {
    childSpy.mockRestore();
    await w.teardown();
  });
  beforeEach(() => {
    errorSpy.mockClear();
    warnSpy.mockClear();
  });
  // every test leaves the world un-suspended
  afterEach(async () => {
    await w.db('selection_list_ref_index').where({ wire_id: PLATFORM }).update({ suspended_at: null, suspended_event_at: null, snapshot_at: null });
  });

  const counts = async () => ({
    lists: Number(((await w.db('selection_lists').where({ organization_id: PLATFORM }).count('id as c').first()) as any).c),
    activeLists: Number(((await w.db('selection_lists').where({ organization_id: PLATFORM, status: 'active' }).count('id as c').first()) as any).c),
    items: Number(((await w.db('selection_list_items').whereIn('list_id', w.db('selection_lists').select('id').where({ organization_id: PLATFORM })).count('id as c').first()) as any).c),
    listTranslations: Number(((await w.db('selection_list_translations').whereIn('list_id', w.db('selection_lists').select('id').where({ organization_id: PLATFORM })).count('list_id as c').first()) as any).c),
    itemTranslations: Number(((await w.db('selection_list_item_translations').whereIn('item_id', w.db('selection_list_items').select('id').where({ list_id: platform.listId })).count('item_id as c').first()) as any).c),
  });
  const projection = () => w.db('selection_list_ref_index').where({ wire_id: PLATFORM }).first();
  const suspended = async () => Boolean((await projection()).suspended_at);
  const readsWork = async () => {
    expect((await w.api(P.aMember).get(`/v1/selection-lists/${platform.listId}`)).status).toBe(200);
    expect((await w.api(P.bMember).get(`/v1/selection-lists/${platform.listId}/items`)).status).toBe(200);
    expect((await w.api(P.bMember).post('/v1/resolve', { ids: [platform.low] })).body.missing).toEqual([]);
    expect((await w.api(P.aMember).get('/v1/selection-lists?include_shared=true&key=priority')).body.items).toHaveLength(1);
  };
  const publish = (key = `pub-${Math.random().toString(36).slice(2, 8)}`) => w.api(P.op).post('/v1/selection-lists', { key, name: 'X', visibility: 'platform' });
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
    it.each(['hard', 'soft'] as const)('%s cascade: nothing deleted, archived or tombstoned; writes SUSPENDED; logged at error; acknowledged', async (cascade) => {
      const { handleOrgDeleted } = await import('../src/events/org-deleted.handler');
      const before = await counts();
      expect(before.lists).toBeGreaterThan(0);
      expect(await suspended()).toBe(false);
      await expect(handleOrgDeleted(deleted(id, cascade))).resolves.toBeUndefined(); // acknowledged, not thrown
      expect(await counts()).toEqual(before);
      const after = await projection();
      expect(after.status).toBe('active'); // never a tombstone
      expect(after.is_active).toBe(true);
      expect(after.org_type).toBe('platform');
      expect(await suspended()).toBe(true);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ cascade, eventId: expect.stringContaining('corr-del-'), newlySuspended: true }),
        expect.stringContaining('platform WRITES are SUSPENDED'),
      );
      await readsWork();
    });

    it('the guard holds with the shared-lists flag OFF', async () => {
      const { handleOrgDeleted } = await import('../src/events/org-deleted.handler');
      const before = await counts();
      await flagOff(async () => {
        await handleOrgDeleted(deleted(id, 'hard'));
      });
      expect(await counts()).toEqual(before);
      expect((await projection()).status).toBe('active');
      expect(await suspended()).toBe(true);
    });
  });

  describe('while the platform org is SUSPENDED', () => {
    const suspend = async () => {
      const { handleOrgDeleted } = await import('../src/events/org-deleted.handler');
      await handleOrgDeleted(deleted(PLATFORM, 'soft'));
      expect(await suspended()).toBe(true);
    };

    it('every platform write is refused (publish, visibility change, platform purge of list and item, platform list/item edits, seeding)', async () => {
      // set up the things to attempt BEFORE suspending
      const mine = await w.api(P.op).post('/v1/selection-lists', { key: 'to-promote', name: 'P' }); // a private list of the platform org
      expect(mine.status).toBe(201);
      const common = await w.api(P.op).post('/v1/selection-lists', { key: 'to-edit', name: 'E', visibility: 'platform' });
      expect(common.status).toBe(201);
      const item = await w.api(P.op).post(`/v1/selection-lists/${common.body.id}/items`, { code: 'X', label: 'X' });
      expect(item.status).toBe(201);
      const before = await counts();

      await suspend();

      expect((await publish()).status).toBe(403); // publish_platform
      expect((await w.api(P.op).patch(`/v1/selection-lists/${mine.body.id}`, { visibility: 'platform' })).status).toBe(403); // to platform
      expect((await w.db('selection_lists').where({ id: mine.body.id }).first()).visibility).toBe('private');
      expect((await w.api(P.op).del(`/v1/selection-lists/${common.body.id}?purge=true`)).status).toBe(403); // platform purge
      expect((await w.api(P.op).del(`/v1/selection-lists/${common.body.id}/items/${item.body.id}?purge=true`)).status).toBe(403);
      const edit = await w.api(P.op).patch(`/v1/selection-lists/${common.body.id}`, { description: 'nope' }); // platform list edit
      expect(edit.status).toBe(403);
      expect(edit.body.reason).toBe('platform_suspended');
      expect((await w.api(P.op).post(`/v1/selection-lists/${common.body.id}/items`, { code: 'Y', label: 'Y' })).status).toBe(403); // platform item edit
      expect((await w.api(P.op).patch(`/v1/selection-lists/${common.body.id}/items/${item.body.id}`, { label: 'Z' })).status).toBe(403);
      expect((await w.api(P.op).del(`/v1/selection-lists/${common.body.id}`)).status).toBe(403); // archive
      expect((await w.api(P.op).put(`/v1/selection-lists/${common.body.id}/translations/fr`, { name: 'Nope' })).status).toBe(403);

      // platform SEEDING: retryable refusal, nothing written
      const { applySeedRequest } = await import('../src/seed');
      const res: any = await applySeedRequest(w.db, {
        organizationId: PLATFORM,
        scope: 'org',
        source: { app: 'platform', service: 'selection-list-service' },
        pack: { key: 'susp-pack', version: 1 },
        trigger: 'org-created',
        requestId: null,
        honorVisibility: true,
        lists: [spec('susp-common', ['A'], { visibility: 'platform' })],
      } as never);
      expect(res.status).toBe('failed');
      expect(res.retryable).toBe(true);
      expect(await w.db('selection_lists').where({ key: 'susp-common' })).toHaveLength(0);

      // the platform org's NON-platform lists are not platform writes: a private list of the org still edits
      expect((await w.api(P.op).patch(`/v1/selection-lists/${mine.body.id}`, { description: 'fine' })).status).toBe(200);
      // nothing was deleted
      const after = await counts();
      expect(after.lists).toBe(before.lists);
      expect(after.items).toBe(before.items);
    });

    it('READS, resolve and ids keep working for every tenant, and other tenants keep their usual answers on a common list', async () => {
      await suspend();
      await readsWork();
      // a tenant's mutation of a common list is still "fork required" (not a suspension answer)
      const m = await w.api(P.aMember).patch(`/v1/selection-lists/${platform.listId}`, { description: 'x' });
      expect(m.status).toBe(409);
      expect(m.body.reason).toBe('fork_required');
      // and forking it (a write into the TENANT's own org) still works
      const fork = await w.api(P.aMember).post(`/v1/selection-lists/${platform.listId}/fork`, {});
      expect([200, 201]).toContain(fork.status);
    });

    it('the cache does not mask the suspension: warm cache, event, the very next publish is refused while reads keep using it', async () => {
      expect((await publish()).status).toBe(201); // warms the positive platform-org cache, writes allowed
      await readsWork();
      await suspend(); // no cache reset anywhere
      expect((await publish()).status).toBe(403);
      await readsWork();
    });

    it('with the shared-lists flag OFF the suspension gate STILL holds on EVERY mutation path of a platform row (list, archive, restore, items, translations, access, purge); other rows and an unsuspended org keep 4.0.0 behaviour', async () => {
      const common = await w.api(P.op).post('/v1/selection-lists', { key: 'off-edit', name: 'E', visibility: 'platform' });
      expect(common.status).toBe(201);
      const L = `/v1/selection-lists/${common.body.id}`;
      const item = await w.api(P.op).post(`${L}/items`, { code: 'X', label: 'X' });
      expect(item.status).toBe(201);
      const second = await w.api(P.op).post(`${L}/items`, { code: 'Y', label: 'Y' });
      const mine = await w.api(P.op).post('/v1/selection-lists', { key: 'off-private', name: 'M' }); // the platform org's own PRIVATE list
      const attempts: Array<[string, () => Promise<{ status: number; body: any }>]> = [
        ['PATCH list', () => w.api(P.op).patch(L, { description: 'x' })],
        ['PATCH list status=archived (archive)', () => w.api(P.op).patch(L, { status: 'archived' })],
        ['PATCH list status=active (restore)', () => w.api(P.op).patch(L, { status: 'active' })],
        ['DELETE list (archive)', () => w.api(P.op).del(L)],
        ['POST list/archive', () => w.api(P.op).post(`${L}/archive`)],
        ['DELETE list ?purge=true', () => w.api(P.op).del(`${L}?purge=true`)],
        ['POST item', () => w.api(P.op).post(`${L}/items`, { code: 'Z', label: 'Z' })],
        ['PATCH item', () => w.api(P.op).patch(`${L}/items/${item.body.id}`, { label: 'Z' })],
        ['PUT items/reorder', () => w.api(P.op).put(`${L}/items/reorder`, { order: [second.body.id, item.body.id] })],
        ['DELETE item (archive)', () => w.api(P.op).del(`${L}/items/${item.body.id}`)],
        ['POST item/archive', () => w.api(P.op).post(`${L}/items/${item.body.id}/archive`)],
        ['DELETE item ?purge=true', () => w.api(P.op).del(`${L}/items/${item.body.id}?purge=true`)],
        ['PUT list translation', () => w.api(P.op).put(`${L}/translations/fr`, { name: 'Nope' })],
        ['DELETE list translation', () => w.api(P.op).del(`${L}/translations/fr`)],
        ['POST list translation autofill', () => w.api(P.op).post(`${L}/translations/de/autofill`, {})],
        ['PUT item translation', () => w.api(P.op).put(`${L}/items/${item.body.id}/translations/fr`, { label: 'Nope' })],
        ['DELETE item translation', () => w.api(P.op).del(`${L}/items/${item.body.id}/translations/fr`)],
        ['PUT access', () => w.api(P.op).put(`${L}/access/${P.opEditor.userId}`, { role: 'list-viewer' })],
        ['DELETE access', () => w.api(P.op).del(`${L}/access/${P.opEditor.userId}`)],
      ];
      const { handleOrgDeleted } = await import('../src/events/org-deleted.handler');
      await flagOff(async () => {
        // sanity: not suspended yet -> the 4.0.0 path answers (never the suspension)
        expect((await w.api(P.op).patch(L, { description: 'before' })).status).toBe(200);
        await handleOrgDeleted(deleted(PLATFORM, 'soft'));
        expect(await suspended()).toBe(true);
        for (const [name, run] of attempts) {
          const r = await run();
          expect({ name, status: r.status }).toEqual({ name, status: 403 });
          if (!name.includes('purge')) expect({ name, reason: r.body.reason }).toEqual({ name, reason: 'platform_suspended' });
        }
        // the platform org's NON-platform row: 4.0.0 behaviour unchanged
        expect((await w.api(P.op).patch(`/v1/selection-lists/${mine.body.id}`, { description: 'fine' })).status).toBe(200);
        // a read is a read
        expect((await w.api(P.op).get(L)).status).toBe(200);
      });
      // nothing changed on the platform row, nothing deleted
      const row = await w.db('selection_lists').where({ id: common.body.id }).first();
      expect(row.status).toBe('active');
      expect((await w.db('selection_list_items').where({ list_id: common.body.id })).length).toBe(2);
      // reactivation: the flag-OFF 4.0.0 edit works again
      const { handleOrgUpdated } = await import('../src/events/org-updated.handler');
      await handleOrgUpdated(orgEvent('identity.org.updated', PLATFORM_UUID));
      expect(await suspended()).toBe(false);
      await flagOff(async () => {
        expect((await w.api(P.op).patch(L, { description: 'after' })).status).toBe(200);
      });
    });

    it('with the flag OFF a pack upgrade is not written into a SUSPENDED platform org that owns common lists (retryable); ordinary orgs are unaffected', async () => {
      const { handleOrgDeleted } = await import('../src/events/org-deleted.handler');
      const { applySeedRequest } = await import('../src/seed');
      const req = (org: string, key: string) =>
        ({
          organizationId: org,
          scope: 'org',
          source: { app: 'platform', service: 'selection-list-service' },
          pack: { key, version: 1 },
          trigger: 'org-created',
          requestId: null,
          lists: [spec(`s-${key}`, ['A'])],
        }) as never;
      await flagOff(async () => {
        await handleOrgDeleted(deleted(PLATFORM, 'soft'));
        const res: any = await applySeedRequest(w.db, req(PLATFORM, 'off-susp'));
        expect(res.status).toBe('failed');
        expect(res.retryable).toBe(true);
        expect(await w.db('selection_lists').where({ key: 's-off-susp' })).toHaveLength(0);
      });
    });

    it('REACTIVATION (org.updated or org.created, active, type platform) clears the suspension and writes resume; logged at warn', async () => {
      const { handleOrgUpdated } = await import('../src/events/org-updated.handler');
      const { handleOrgCreated } = await import('../src/events/org-created.handler');
      await suspend();
      expect((await publish()).status).toBe(403);
      await handleOrgUpdated(orgEvent('identity.org.updated', PLATFORM_UUID));
      expect(await suspended()).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(expect.objectContaining({ eventId: expect.stringContaining('corr-identity.org.updated') }), expect.stringContaining('RESUMED'));
      expect((await publish()).status).toBe(201);
      await suspend();
      await handleOrgCreated({ ...(orgEvent('identity.org.created', PLATFORM_UUID) as any), payload: { ...(orgEvent('identity.org.created', PLATFORM_UUID) as any).payload } } as never);
      expect(await suspended()).toBe(false);
      expect((await publish()).status).toBe(201);
    });

    it('a STALE reactivation (older than the newest snapshot) does not resume', async () => {
      const { handleOrgUpdated } = await import('../src/events/org-updated.handler');
      await handleOrgUpdated(orgEvent('identity.org.updated', PLATFORM_UUID)); // advances snapshot_at
      await suspend();
      const stale = orgEvent('identity.org.updated', PLATFORM_UUID) as any;
      stale.occurredAt = '2020-01-01T00:00:00.000Z';
      await handleOrgUpdated(stale);
      expect(await suspended()).toBe(true);
    });
  });

  it('the platform org NOT configured: any org owning a platform-visibility row is still protected from every cascade', async () => {
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

  it('a NORMAL org still cascades (hard purges, soft archives, the projection is tombstoned) and is never suspended', async () => {
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
    const row = await w.db('selection_list_ref_index').where({ wire_id: org }).first();
    expect(row.status).toBe('deleted');
    expect(row.suspended_at).toBeNull();
    expect(errorSpy).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('SUSPENDED'));
    await handleOrgDeleted(deleted(orgUuid, 'hard'));
    expect(await w.db('selection_lists').where({ id: soft }).first()).toBeUndefined();
    expect(await w.db('selection_list_items').where({ list_id: soft })).toHaveLength(0);
    expect(await suspended()).toBe(false); // the platform org was not touched
  });

  describe('snapshots of the platform org', () => {
    it.each([
      ['updated: deactivate', 'identity.org.updated', { isActive: false }],
      ['created: inactive', 'identity.org.created', { isActive: false }],
    ] as const)('%s -> writes SUSPENDED, projection otherwise unchanged, reads work', async (_n, topic, over) => {
      const { handleOrgUpdated } = await import('../src/events/org-updated.handler');
      const { handleOrgCreated } = await import('../src/events/org-created.handler');
      const before = await projection();
      if (topic === 'identity.org.updated') await handleOrgUpdated(orgEvent(topic, PLATFORM_UUID, over));
      else expect(await handleOrgCreated(orgEvent(topic, PLATFORM_UUID, over))).toMatchObject({ projected: false, seeding: 'refused-platform-org' });
      const after = await projection();
      expect({ t: after.org_type, a: after.is_active, s: after.status }).toEqual({ t: before.org_type, a: before.is_active, s: before.status });
      expect(await suspended()).toBe(true);
      expect(errorSpy).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('platform WRITES are SUSPENDED'));
      await readsWork();
      expect((await publish()).status).toBe(403);
    });

    it.each([
      ['updated: retype to organization', 'identity.org.updated', { type: 'organization' }],
      ['created: retype to personal', 'identity.org.created', { type: 'personal' }],
    ] as const)('%s is REFUSED outright: no suspension, no state change, common lists still fully available', async (_n, topic, over) => {
      const { handleOrgUpdated } = await import('../src/events/org-updated.handler');
      const { handleOrgCreated } = await import('../src/events/org-created.handler');
      const before = await projection();
      if (topic === 'identity.org.updated') await handleOrgUpdated(orgEvent(topic, PLATFORM_UUID, over));
      else await handleOrgCreated(orgEvent(topic, PLATFORM_UUID, over));
      const after = await projection();
      expect({ t: after.org_type, a: after.is_active, s: after.status }).toEqual({ t: before.org_type, a: before.is_active, s: before.status });
      expect(await suspended()).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('REFUSED'));
      await readsWork();
      expect((await publish()).status).toBe(201);
    });

    it('a rename (same type, still active) applies', async () => {
      const { handleOrgUpdated } = await import('../src/events/org-updated.handler');
      await handleOrgUpdated(orgEvent('identity.org.updated', PLATFORM_UUID, { name: 'Renamed Platform' }));
      expect((await projection()).org_name).toBe('Renamed Platform');
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('an ordinary org may still be deactivated / retyped by an update, and is never suspended', async () => {
      const { handleOrgUpdated } = await import('../src/events/org-updated.handler');
      await handleOrgUpdated(orgEvent('identity.org.updated', toUuid(ORG_A as never), { type: 'organization', isActive: false, name: 'A' }));
      const row = await w.db('selection_list_ref_index').where({ wire_id: ORG_A }).first();
      expect({ t: row.org_type, a: row.is_active, s: row.suspended_at }).toEqual({ t: 'organization', a: false, s: null });
    });
  });

  describe('ordering of the suspend / resume state machine (separate consumer groups deliver out of order)', () => {
    const upd = async (over: Record<string, unknown>, iso: string) => {
      const { handleOrgUpdated } = await import('../src/events/org-updated.handler');
      await handleOrgUpdated(orgEvent('identity.org.updated', PLATFORM_UUID, over, iso));
    };
    const created = async (over: Record<string, unknown>, iso: string) => {
      const { handleOrgCreated } = await import('../src/events/org-created.handler');
      return handleOrgCreated(orgEvent('identity.org.created', PLATFORM_UUID, over, iso));
    };
    const del = async (iso: string, cascade: 'soft' | 'hard' = 'soft') => {
      const { handleOrgDeleted } = await import('../src/events/org-deleted.handler');
      await handleOrgDeleted(deleted(PLATFORM_UUID, cascade, iso));
    };
    const warnedWith = (outcome: string, needle: string) =>
      expect(warnSpy).toHaveBeenCalledWith(expect.objectContaining({ outcome, eventId: expect.stringContaining(needle) }), expect.stringContaining('PLATFORM'));

    it('a STALE inactive org.created arriving after a NEWER active org.updated does not suspend (warn, correlationId)', async () => {
      await upd({}, T(10));
      await created({ isActive: false }, T(5));
      expect(await suspended()).toBe(false);
      warnedWith('stale', T(5));
      expect((await publish()).status).toBe(201);
    });

    it.each(['updated', 'created', 'deleted-soft', 'deleted-hard'] as const)('stale deactivation via %s does not suspend either', async (via) => {
      await upd({}, T(10));
      if (via === 'updated') await upd({ isActive: false }, T(9));
      else if (via === 'created') await created({ isActive: false }, T(9));
      else await del(T(9), via === 'deleted-soft' ? 'soft' : 'hard');
      expect(await suspended()).toBe(false);
      warnedWith('stale', T(9));
    });

    it('TIE (deactivation at the exact instant of the newest applied snapshot): ties go to ACTIVE - not suspended, logged', async () => {
      await upd({}, T(10));
      await created({ isActive: false }, T(10));
      expect(await suspended()).toBe(false);
      warnedWith('tie', T(10));
      await del(T(10));
      expect(await suspended()).toBe(false);
    });

    it('a NEWER deactivation suspends and records its instant; a stale or older activation cannot resume it, a newer one or a tie does', async () => {
      await upd({}, T(10));
      await del(T(20));
      expect(await suspended()).toBe(true);
      const row = await projection();
      expect(new Date(row.suspended_event_at).toISOString()).toBe(T(20));
      expect(new Date(row.snapshot_at).toISOString()).toBe(T(10)); // the deactivation does not move the snapshot clock
      await upd({}, T(15)); // newer than the last snapshot, OLDER than the deactivation
      expect(await suspended()).toBe(true);
      await created({}, T(12));
      expect(await suspended()).toBe(true);
      await upd({}, T(20)); // tie with the deactivation: activation wins
      expect(await suspended()).toBe(false);
      await del(T(30));
      expect(await suspended()).toBe(true);
      await upd({}, T(31)); // newer activation
      expect(await suspended()).toBe(false);
    });

    it('delete THEN (older) created: suspended, the older created still types the org, and only a newer activation resumes', async () => {
      await w.db('selection_list_ref_index').where({ wire_id: PLATFORM }).update({ org_type: null, is_active: null }); // not typed yet
      await del(T(30));
      expect(await suspended()).toBe(true);
      await created({}, T(25)); // older: applies (the projection learns the type) but cannot resume
      const row = await projection();
      expect({ t: row.org_type, a: row.is_active }).toEqual({ t: 'platform', a: true });
      expect(await suspended()).toBe(true);
      await created({}, T(35));
      expect(await suspended()).toBe(false);
    });

    it('created THEN deleted in order, with the row absent: the deletion creates a typeless suspended row; the created resumes it', async () => {
      await w.db('selection_list_ref_index').where({ wire_id: PLATFORM }).delete();
      await del(T(40), 'hard');
      let row = await projection();
      expect({ s: Boolean(row.suspended_at), t: row.org_type, st: row.status }).toEqual({ s: true, t: null, st: 'active' });
      await created({}, T(41));
      row = await projection();
      expect({ s: Boolean(row.suspended_at), t: row.org_type }).toEqual({ s: false, t: 'platform' });
    });

    it('duplicate delivery is idempotent: a repeated deactivation keeps the first suspended_at; a repeated activation resumes once', async () => {
      await upd({}, T(10));
      await del(T(40));
      const first = (await projection()).suspended_at;
      errorSpy.mockClear();
      await del(T(40));
      expect(new Date((await projection()).suspended_at).getTime()).toBe(new Date(first).getTime());
      expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'already-suspended', newlySuspended: false }), expect.anything());
      await upd({}, T(50));
      expect(await suspended()).toBe(false);
      warnSpy.mockClear();
      await upd({}, T(50)); // duplicate activation
      expect(warnSpy).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('RESUMED'));
      expect(await suspended()).toBe(false);
    });

    it('REPLAY of an old deactivation after the resume is stale and ignored', async () => {
      await upd({}, T(10));
      await del(T(40));
      await upd({}, T(50)); // resumed, snapshot clock = T(50)
      expect(await suspended()).toBe(false);
      await del(T(40)); // replay
      await created({ isActive: false }, T(45));
      expect(await suspended()).toBe(false);
      warnedWith('stale', T(40));
    });

    it('out-of-order org.updated renames: the newer name wins either way, and suspension is unaffected', async () => {
      await upd({ name: 'New' }, T(60));
      await upd({ name: 'Old' }, T(55));
      expect((await projection()).org_name).toBe('New');
      await del(T(70));
      await upd({ name: 'Newest' }, T(65)); // older than the deactivation: applies as a rename, does not resume
      expect((await projection()).org_name).toBe('Newest');
      expect(await suspended()).toBe(true);
      await upd({ name: 'Back' }, T(80));
      expect((await projection()).org_name).toBe('Back');
      expect(await suspended()).toBe(false);
    });

    it('a FAR-FUTURE forged timestamp is clamped to now: it cannot pin the clocks ahead of every legitimate event', async () => {
      await del('2099-01-01T00:00:00.000Z');
      expect(await suspended()).toBe(true);
      expect(new Date((await projection()).suspended_event_at).getTime()).toBeLessThanOrEqual(Date.now());
      await new Promise((r) => setTimeout(r, 5));
      await upd({ name: 'Legit' }, new Date().toISOString()); // a legitimate activation right now resumes
      expect(await suspended()).toBe(false);
      await upd({ name: 'Forged' }, '2099-01-01T00:00:00.000Z');
      await new Promise((r) => setTimeout(r, 5));
      await upd({ name: 'Later legit' }, new Date().toISOString());
      expect((await projection()).org_name).toBe('Later legit'); // not rejected as stale behind a future-dated snapshot
    });
  });
});
