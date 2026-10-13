// shared-lists.read.db.test.ts — the READ path of shared / common lists (design record D3, D4, D8, D13;
// section 4 matrix) through the real app, real routes and REAL Postgres, with a scriptable Security API.
//
// Pins: readable(L, C) = instance role OR (non-private AND data predicate AND read_shared in the caller's
// tenant); org scoping for reads (own org OR a common list), `404` — never `403` — for everything else;
// include_shared / visibility / shadowing on the listing and a deterministic page walk; the effective list
// for a key; `editable` from ONE bulk `translate` check; response fields always emitted; the platform org
// resolved (and failing closed); and the flag-OFF behaviour (4.0.0 behaviour with 4.1.0 shapes).

import type { Knex } from 'knex';
import { dbDescribe } from './helpers/testDb';
import { createWorld, ORG_A, ORG_B, P, PLATFORM, publishPriorityList, World } from './helpers/sharedWorld';
import { flagClientWith } from './helpers/flagClient';
import { assertConforms } from './helpers/openapi';

const state: { db: Knex | undefined } = { db: undefined };
jest.mock('../src/db', () => ({
  get db() {
    return state.db;
  },
}));

dbDescribe('shared lists — read path (real Postgres)', () => {
  let w: World;
  let platform: { listId: string; low: string; mid: string; old: string };
  let aOrgList: string; // ORG_A, visibility org, owned by aAdmin
  let aPrivate: string; // ORG_A, private, owned by aAdmin
  let bOrgList: string; // ORG_B, visibility org

  beforeAll(async () => {
    w = await createWorld(state);
    platform = await publishPriorityList(w);
    const mkA = async (key: string, visibility: string) => {
      const r = await w.api(P.aAdmin).post('/v1/selection-lists', { key, name: key, visibility });
      expect(r.status).toBe(201);
      return r.body.id as string;
    };
    aOrgList = await mkA('a-org', 'org');
    aPrivate = await mkA('a-private', 'private');
    const b = await w.api({ userId: P.bMember.userId, orgId: ORG_B }).post('/v1/selection-lists', { key: 'b-org', name: 'B', visibility: 'org' });
    expect(b.status).toBe(201);
    bOrgList = b.body.id;
  });
  afterAll(() => w.teardown());

  describe('GET /v1/selection-lists/:listId', () => {
    it('a member of ANY org reads a platform list with no grant: visibility platform, not editable, not a fork', async () => {
      for (const p of [P.aMember, P.aViewer, P.bMember]) {
        const res = await w.api(p).get(`/v1/selection-lists/${platform.listId}`);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          id: platform.listId,
          organization_id: PLATFORM,
          key: 'priority',
          visibility: 'platform',
          forked_from: null,
          editable: false,
          item_count: 2,
        });
      }
    });

    it('the platform operator who owns it sees editable=true', async () => {
      const res = await w.api(P.op).get(`/v1/selection-lists/${platform.listId}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ visibility: 'platform', editable: true });
    });

    it('a caller WITHOUT read_shared (developer) gets 404 for a platform list — the flag is not the boundary, Permit is', async () => {
      const res = await w.api(P.aDeveloper).get(`/v1/selection-lists/${platform.listId}`);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('an org-visible list: members of the OWNING org read it with no grant (editable=false); other orgs get 404', async () => {
      const own = await w.api(P.aMember).get(`/v1/selection-lists/${aOrgList}`);
      expect(own.status).toBe(200);
      expect(own.body).toMatchObject({ visibility: 'org', organization_id: ORG_A, editable: false });
      const owner = await w.api(P.aAdmin).get(`/v1/selection-lists/${aOrgList}`);
      expect(owner.body.editable).toBe(true);
      expect((await w.api(P.bMember).get(`/v1/selection-lists/${aOrgList}`)).status).toBe(404);
      expect((await w.api(P.aDeveloper).get(`/v1/selection-lists/${aOrgList}`)).status).toBe(404);
    });

    it('a private list stays instance-only: a member without a role gets 404, even in the owning org', async () => {
      expect((await w.api(P.aMember).get(`/v1/selection-lists/${aPrivate}`)).status).toBe(404);
      expect((await w.api(P.aAdmin).get(`/v1/selection-lists/${aPrivate}`)).status).toBe(200);
      w.authz.give(ORG_A, P.aMember.userId, aPrivate, 'list-viewer');
      const viewer = await w.api(P.aMember).get(`/v1/selection-lists/${aPrivate}`);
      expect(viewer.status).toBe(200);
      expect(viewer.body).toMatchObject({ visibility: 'private', editable: false }); // a viewer holds no write role
      w.authz.give(ORG_A, P.aMember.userId, aPrivate, 'list-translator');
      expect((await w.api(P.aMember).get(`/v1/selection-lists/${aPrivate}`)).body.editable).toBe(true);
      w.authz.roles.delete(`${ORG_A}|${P.aMember.userId}|${aPrivate}`); // leave the world as found
    });

    it("another org's private/org list and an unknown id are indistinguishable (404, never 403)", async () => {
      const foreign = await w.api(P.aMember).get(`/v1/selection-lists/${bOrgList}`);
      const unknown = await w.api(P.aMember).get('/v1/selection-lists/front_sl_0000000000000000000000000z');
      expect(foreign.status).toBe(404);
      expect(unknown.status).toBe(404);
      expect(foreign.body).toEqual(unknown.body);
    });

    it('asks the shared read ONCE per request (memoised) and does not ask the instance read first', async () => {
      const mark = w.authz.asked.length;
      await w.api(P.aMember).get(`/v1/selection-lists/${platform.listId}`);
      expect(w.authz.since(mark)).toEqual(['catalog:read_shared']);
    });

    it('fails CLOSED when the Security API is down (403, never a shared read)', async () => {
      w.authz.down = new Error('DECISION_UNAVAILABLE');
      try {
        const res = await w.api(P.aMember).get(`/v1/selection-lists/${platform.listId}`);
        expect(res.status).toBe(403);
      } finally {
        w.authz.down = null;
      }
    });

    it('a `platform` row NOT owned by the platform org is untrusted data and is not served', async () => {
      await w.db('selection_lists').where({ id: aPrivate }).update({ visibility: 'platform' });
      try {
        expect((await w.api(P.bMember).get(`/v1/selection-lists/${aPrivate}`)).status).toBe(404);
      } finally {
        await w.db('selection_lists').where({ id: aPrivate }).update({ visibility: 'private' });
      }
    });
  });

  describe('items and translations of a common list', () => {
    it('lists the items (active by default) with origin_item_id null, in the caller locale; archived on request', async () => {
      const res = await w.api(P.bMember).get(`/v1/selection-lists/${platform.listId}/items`);
      expect(res.status).toBe(200);
      expect(res.body.items.map((i: any) => i.code)).toEqual(['LOW', 'MID']);
      expect(res.body.items.every((i: any) => i.origin_item_id === null)).toBe(true);
      const fr = await w.api(P.bMember).get(`/v1/selection-lists/${platform.listId}/items?locale=fr`);
      expect(fr.body.items[0]).toMatchObject({ code: 'LOW', label: 'Basse', resolved_locale: 'fr' });
      const archived = await w.api(P.bMember).get(`/v1/selection-lists/${platform.listId}/items?status=archived`);
      expect(archived.body.items.map((i: any) => i.code)).toEqual(['OLD']);
    });

    it('list + item translation status are readable; a developer gets 404 on both', async () => {
      const tr = await w.api(P.aMember).get(`/v1/selection-lists/${platform.listId}/translations`);
      expect(tr.status).toBe(200);
      expect(tr.body.map((t: any) => t.locale)).toEqual(['fr']);
      const itr = await w.api(P.aMember).get(`/v1/selection-lists/${platform.listId}/items/${platform.low}/translations`);
      expect(itr.status).toBe(200);
      expect(itr.body.map((t: any) => t.locale)).toEqual(['fr']);
      expect((await w.api(P.aDeveloper).get(`/v1/selection-lists/${platform.listId}/items`)).status).toBe(404);
      expect((await w.api(P.aDeveloper).get(`/v1/selection-lists/${platform.listId}/translations`)).status).toBe(404);
      expect((await w.api(P.aDeveloper).get(`/v1/selection-lists/${platform.listId}/items/${platform.low}/translations`)).status).toBe(404);
    });

    it('the access roster of a common list is NOT readable through the shared read (manage_access)', async () => {
      const res = await w.api(P.aMember).get(`/v1/selection-lists/${platform.listId}/access`);
      expect([403, 404]).toContain(res.status);
      expect(res.status).toBe(403); // readable common list, never forkable: 403
    });

    it("another org's org-visible list items are unreachable (404)", async () => {
      expect((await w.api(P.aMember).get(`/v1/selection-lists/${bOrgList}/items`)).status).toBe(404);
    });
  });

  describe('authorship of another organization\'s rows is not leaked', () => {
    it('a common list and its items read by another org show created_by as system:platform; the owning org sees the real user', async () => {
      const foreign = await w.api(P.aMember).get(`/v1/selection-lists/${platform.listId}`);
      expect(foreign.body.created_by).toBe('system:platform');
      assertConforms('SelectionList', foreign.body);
      const active = await w.api(P.aMember).get(`/v1/selection-lists/${platform.listId}/items`);
      const archived = await w.api(P.aMember).get(`/v1/selection-lists/${platform.listId}/items?status=archived`);
      const all = [...active.body.items, ...archived.body.items];
      expect(all.length).toBe(3);
      for (const i of all) {
        expect(i.created_by).toBe('system:platform');
        assertConforms('SelectionListItem', i);
      }
      const listing = await w.api(P.bMember).get('/v1/selection-lists?include_shared=true&key=priority');
      expect(listing.body.items[0].created_by).toBe('system:platform');
      // the owning (platform) org sees who wrote it; so does a member of the same org for its own org lists
      expect((await w.api(P.op).get(`/v1/selection-lists/${platform.listId}`)).body.created_by).toBe(P.op.userId);
      expect((await w.api(P.op).get(`/v1/selection-lists/${platform.listId}/items`)).body.items[0].created_by).toBe(P.op.userId);
      expect((await w.api(P.aMember).get(`/v1/selection-lists/${aOrgList}`)).body.created_by).toBe(P.aAdmin.userId);
      // the stored value is untouched
      expect((await w.db('selection_lists').where({ id: platform.listId }).first()).created_by).toBe(P.op.userId);
    });
  });

  describe('GET /v1/selection-lists — include_shared, visibility, shadowing, pagination', () => {
    const ids = (res: any) => res.body.items.map((i: any) => i.key).sort();

    it('the DEFAULT result set is the 4.0.0 one: only lists the caller holds an instance role on', async () => {
      expect(ids(await w.api(P.aMember).get('/v1/selection-lists'))).toEqual([]);
      expect(ids(await w.api(P.aAdmin).get('/v1/selection-lists'))).toEqual(['a-org', 'a-private']);
    });

    it('include_shared=true adds the readable org lists and the common lists (a member sees them with no grant)', async () => {
      const res = await w.api(P.aMember).get('/v1/selection-lists?include_shared=true');
      expect(res.status).toBe(200);
      expect(ids(res)).toEqual(['a-org', 'priority']);
      const byKey = Object.fromEntries(res.body.items.map((i: any) => [i.key, i]));
      expect(byKey['priority']).toMatchObject({ visibility: 'platform', editable: false, forked_from: null, organization_id: PLATFORM });
      expect(byKey['a-org']).toMatchObject({ visibility: 'org', editable: false });
      // the owner also sees his private list, editable
      const owner = await w.api(P.aAdmin).get('/v1/selection-lists?include_shared=true');
      expect(ids(owner)).toEqual(['a-org', 'a-private', 'priority']);
      expect(owner.body.items.find((i: any) => i.key === 'a-private')).toMatchObject({ visibility: 'private', editable: true });
      expect(owner.body.items.find((i: any) => i.key === 'priority').editable).toBe(false);
    });

    it('a caller without read_shared gets no extra rows (not an error); org B never sees org A lists', async () => {
      // a viewer-like caller who may list but lacks read_shared
      w.authz.allowCatalog(ORG_A, P.aDeveloper.userId, ['list']);
      expect(ids(await w.api(P.aDeveloper).get('/v1/selection-lists?include_shared=true'))).toEqual([]);
      w.authz.allowCatalog(ORG_A, P.aDeveloper.userId, []);
      expect((await w.api(P.aDeveloper).get('/v1/selection-lists?include_shared=true')).status).toBe(403); // developer: no `list` at all
      expect(ids(await w.api(P.bMember).get('/v1/selection-lists?include_shared=true'))).toEqual(['b-org', 'priority']);
    });

    it('the visibility filter narrows the set; platform rows need include_shared outside the platform org', async () => {
      expect(ids(await w.api(P.aMember).get('/v1/selection-lists?include_shared=true&visibility=platform'))).toEqual(['priority']);
      expect(ids(await w.api(P.aMember).get('/v1/selection-lists?include_shared=true&visibility=org'))).toEqual(['a-org']);
      expect(ids(await w.api(P.aMember).get('/v1/selection-lists?visibility=platform'))).toEqual([]);
      expect(ids(await w.api(P.aAdmin).get('/v1/selection-lists?include_shared=true&visibility=private'))).toEqual(['a-private']);
    });

    it('key + include_shared returns the EFFECTIVE list: the common one until the org has its own', async () => {
      const res = await w.api(P.aMember).get('/v1/selection-lists?include_shared=true&key=priority');
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({ key: 'priority', visibility: 'platform' });
      // the 4.0.0 reading of `key` (no include_shared) is org-scoped: nothing for this org
      expect(ids(await w.api(P.aMember).get('/v1/selection-lists?key=priority'))).toEqual([]);
    });

    it('rejects a bad include_shared / visibility with 400 (flag ON)', async () => {
      expect((await w.api(P.aMember).get('/v1/selection-lists?include_shared=yes')).status).toBe(400);
      expect((await w.api(P.aMember).get('/v1/selection-lists?visibility=public')).status).toBe(400);
    });

    it('pages deterministically: limit is clamped, every readable row appears exactly once across pages', async () => {
      // 5 more common lists + own org lists, so the walk crosses organizations.
      const op = w.api(P.op);
      for (let i = 0; i < 5; i++) {
        const r = await op.post('/v1/selection-lists', { key: `common-${i}`, name: `C${i}`, visibility: 'platform' });
        expect(r.status).toBe(201);
      }
      const all = await w.api(P.aMember).get('/v1/selection-lists?include_shared=true&limit=200');
      const expected = ids(all);
      expect(expected).toEqual(['a-org', 'common-0', 'common-1', 'common-2', 'common-3', 'common-4', 'priority']);
      expect(all.body.page).toEqual({ nextCursor: null, hasMore: false }); // authz enforced: no total
      const seen: string[] = [];
      let cursor: string | null = null;
      let guard = 0;
      do {
        const url: string = `/v1/selection-lists?include_shared=true&limit=2${cursor ? `&cursor=${cursor}` : ''}`;
        const page: any = await w.api(P.aMember).get(url);
        expect(page.status).toBe(200);
        expect(page.body.items.length).toBeLessThanOrEqual(2);
        seen.push(...page.body.items.map((i: any) => i.key));
        cursor = page.body.page.nextCursor;
        expect(page.body.page.hasMore).toBe(cursor !== null);
      } while (cursor && ++guard < 20);
      expect([...seen].sort()).toEqual(expected);
      expect(new Set(seen).size).toBe(seen.length);
      // over-max limit is clamped, not honoured unbounded
      expect((await w.api(P.aMember).get('/v1/selection-lists?include_shared=true&limit=100000')).status).toBe(200);
      // garbage cursor is a 400
      expect((await w.api(P.aMember).get('/v1/selection-lists?include_shared=true&cursor=not-a-cursor')).status).toBe(400);
    });

    it('one bulk `translate` check backs `editable` for the whole page (no per-row decisions)', async () => {
      const mark = w.authz.asked.length;
      await w.api(P.aAdmin).get('/v1/selection-lists?include_shared=true');
      const translate = w.authz.asked.slice(mark).filter((q) => q.action === 'translate');
      // only the caller's own org rows are asked about; common lists are never editable and are not asked
      expect(new Set(translate.map((q) => q.resource.key))).toEqual(new Set([aOrgList, aPrivate]));
    });
  });

  describe('platform organization resolution', () => {
    it('with no platform org configured or projected, platform features FAIL CLOSED: no common list is served', async () => {
      const { _resetPlatformOrgCacheForTesting } = await import('../src/lib/sharedLists');
      const prev = process.env.SELECTION_LIST_PLATFORM_ORG_ID;
      delete process.env.SELECTION_LIST_PLATFORM_ORG_ID;
      _resetPlatformOrgCacheForTesting();
      try {
        expect((await w.api(P.aMember).get(`/v1/selection-lists/${platform.listId}`)).status).toBe(404);
        const res = await w.api(P.aMember).get('/v1/selection-lists?include_shared=true');
        expect(res.body.items.map((i: any) => i.key)).toEqual(['a-org']);
        // ...and nothing else changes: own org lists still read normally
        expect((await w.api(P.aMember).get(`/v1/selection-lists/${aOrgList}`)).status).toBe(200);
      } finally {
        process.env.SELECTION_LIST_PLATFORM_ORG_ID = prev;
        _resetPlatformOrgCacheForTesting();
      }
    });

    it('NO fallback to the projection: env unset + an org the projection types "platform" (user-controllable) => platform features stay disabled', async () => {
      const { _resetPlatformOrgCacheForTesting } = await import('../src/lib/sharedLists');
      const prev = process.env.SELECTION_LIST_PLATFORM_ORG_ID;
      delete process.env.SELECTION_LIST_PLATFORM_ORG_ID;
      // an attacker's org, registered as type 'platform' (POST /api/organizations {type:'platform'})
      await w.db('selection_list_ref_index').insert({
        entity_type: 'organization', entity_id: '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7eaa', wire_id: ORG_A, org_type: 'platform', is_active: true,
      });
      _resetPlatformOrgCacheForTesting();
      let ownId: string | undefined;
      try {
        // reads: the (real) common list is not served
        expect((await w.api(P.aMember).get(`/v1/selection-lists/${platform.listId}`)).status).toBe(404);
        expect((await w.api(P.aMember).get(`/v1/selection-lists/${platform.listId}/items`)).status).toBe(404);
        const listing = await w.api(P.aMember).get('/v1/selection-lists?include_shared=true');
        expect(listing.body.items.map((i: any) => i.key)).toEqual(['a-org']);
        // resolve: platform ids are not resolvable
        const res = await w.api(P.bMember).post('/v1/resolve', { ids: [platform.low] });
        expect(res.body).toEqual({ results: {}, missing: [platform.low] });
        // publish: neither the attacker's org admin (holds publish_platform in his own tenant)...
        const evil = await w.api(P.aAdmin).post('/v1/selection-lists', { key: 'evil-common', name: 'Evil', visibility: 'platform' });
        expect(evil.status).toBe(403);
        // ...nor the real platform operator can publish while the platform org is not configured
        expect((await w.api(P.op).post('/v1/selection-lists', { key: 'op-common', name: 'Op', visibility: 'platform' })).status).toBe(403);
        // promotion is refused too
        const own = await w.api(P.aAdmin).post('/v1/selection-lists', { key: 'evil-promote', name: 'E' });
        ownId = own.body.id;
        expect((await w.api(P.aAdmin).patch(`/v1/selection-lists/${own.body.id}`, { visibility: 'platform' })).status).toBe(403);
        expect(await w.db('selection_lists').where({ visibility: 'platform', organization_id: ORG_A }).first()).toBeUndefined();
        // a fork of the common list is a 404 as well
        expect((await w.api(P.bMember).post(`/v1/selection-lists/${platform.listId}/fork`, {})).status).toBe(404);
      } finally {
        if (ownId) await w.api(P.aAdmin).del(`/v1/selection-lists/${ownId}?purge=true`);
        await w.db('selection_list_ref_index').where({ wire_id: ORG_A }).delete();
        process.env.SELECTION_LIST_PLATFORM_ORG_ID = prev;
        _resetPlatformOrgCacheForTesting();
      }
    });

    it('a configured value the projection CONTRADICTS (not a platform org) is not trusted: fail closed', async () => {
      const { _resetPlatformOrgCacheForTesting } = await import('../src/lib/sharedLists');
      await w.db('selection_list_ref_index').where({ wire_id: PLATFORM }).update({ org_type: 'organization' });
      _resetPlatformOrgCacheForTesting();
      try {
        expect((await w.api(P.aMember).get(`/v1/selection-lists/${platform.listId}`)).status).toBe(404);
        // and nobody can publish
        const pub = await w.api(P.op).post('/v1/selection-lists', { key: 'x-common', name: 'X', visibility: 'platform' });
        expect(pub.status).toBe(403);
      } finally {
        await w.db('selection_list_ref_index').where({ wire_id: PLATFORM }).update({ org_type: 'platform' });
        _resetPlatformOrgCacheForTesting();
      }
    });

    it('a DEACTIVATED platform org (is_active=false) is not trusted: reads, resolve and publish are disabled; reactivated => enabled', async () => {
      const { _resetPlatformOrgCacheForTesting } = await import('../src/lib/sharedLists');
      await w.db('selection_list_ref_index').where({ wire_id: PLATFORM }).update({ is_active: false });
      _resetPlatformOrgCacheForTesting();
      try {
        expect((await w.api(P.aMember).get(`/v1/selection-lists/${platform.listId}`)).status).toBe(404);
        expect((await w.api(P.bMember).post('/v1/resolve', { ids: [platform.low] })).body.missing).toEqual([platform.low]);
        expect((await w.api(P.op).post('/v1/selection-lists', { key: 'deact-common', name: 'D', visibility: 'platform' })).status).toBe(403);
      } finally {
        await w.db('selection_list_ref_index').where({ wire_id: PLATFORM }).update({ is_active: true });
        _resetPlatformOrgCacheForTesting();
      }
      expect((await w.api(P.aMember).get(`/v1/selection-lists/${platform.listId}`)).status).toBe(200);
    });

    it('a configured id the projection has NOT confirmed (no row yet, or no type yet) is UNRESOLVED: disabled until confirmed, then enabled', async () => {
      const { _resetPlatformOrgCacheForTesting } = await import('../src/lib/sharedLists');
      const row = await w.db('selection_list_ref_index').where({ wire_id: PLATFORM }).first();
      for (const state of ['absent', 'untyped'] as const) {
        if (state === 'absent') await w.db('selection_list_ref_index').where({ wire_id: PLATFORM }).delete();
        else await w.db('selection_list_ref_index').insert({ ...row, org_type: null });
        _resetPlatformOrgCacheForTesting();
        try {
          expect((await w.api(P.aMember).get(`/v1/selection-lists/${platform.listId}`)).status).toBe(404);
          expect((await w.api(P.bMember).post('/v1/resolve', { ids: [platform.low] })).body.missing).toEqual([platform.low]);
          expect((await w.api(P.op).post('/v1/selection-lists', { key: `late-${state}`, name: 'L', visibility: 'platform' })).status).toBe(403);
        } finally {
          await w.db('selection_list_ref_index').where({ wire_id: PLATFORM }).delete();
        }
      }
      // the projection catches up: enabled again (the negative result is cached only briefly)
      await w.db('selection_list_ref_index').insert(row);
      _resetPlatformOrgCacheForTesting();
      expect((await w.api(P.aMember).get(`/v1/selection-lists/${platform.listId}`)).status).toBe(200);
    });
  });

  describe('the shared-lists flag OFF: 4.0.0 behaviour with 4.1.0 shapes', () => {
    const off = async (fn: () => Promise<void>) => {
      const { setFlagClient } = await import('../src/flags');
      setFlagClient(flagClientWith(false));
      try {
        await fn();
      } finally {
        setFlagClient(flagClientWith(true));
      }
    };

    it('a common list does not exist for members (404); its owner still sees it as a plain private list', async () => {
      await off(async () => {
        expect((await w.api(P.aMember).get(`/v1/selection-lists/${platform.listId}`)).status).toBe(404);
        const owner = await w.api(P.op).get(`/v1/selection-lists/${platform.listId}`);
        expect(owner.status).toBe(200);
        expect(owner.body).toMatchObject({ visibility: 'private', forked_from: null });
        expect(owner.body).not.toHaveProperty('editable'); // unknown (4.0.0 reading)
      });
    });

    it('an org-visible list reports private and needs an instance role; include_shared / visibility are ignored', async () => {
      await off(async () => {
        expect((await w.api(P.aMember).get(`/v1/selection-lists/${aOrgList}`)).status).toBe(404);
        const admin = await w.api(P.aAdmin).get(`/v1/selection-lists/${aOrgList}`);
        expect(admin.body).toMatchObject({ visibility: 'private', forked_from: null });
        const list = await w.api(P.aMember).get('/v1/selection-lists?include_shared=true&visibility=platform');
        expect(list.status).toBe(200);
        expect(list.body.items).toEqual([]);
        const junk = await w.api(P.aMember).get('/v1/selection-lists?include_shared=whatever&visibility=bogus');
        expect(junk.status).toBe(200);
      });
    });

    it('items carry origin_item_id null; the fork operation is a 404', async () => {
      await off(async () => {
        const items = await w.api(P.op).get(`/v1/selection-lists/${platform.listId}/items`);
        expect(items.status).toBe(200);
        expect(items.body.items.every((i: any) => i.origin_item_id === null)).toBe(true);
        expect((await w.api(P.aMember).post(`/v1/selection-lists/${platform.listId}/fork`, {})).status).toBe(404);
      });
    });

    it('create / PATCH with a non-private visibility is a 400; `private` is accepted', async () => {
      await off(async () => {
        const bad = await w.api(P.aAdmin).post('/v1/selection-lists', { key: 'off-org', name: 'Off', visibility: 'org' });
        expect(bad.status).toBe(400);
        expect(bad.body.code).toBe('VALIDATION_ERROR');
        const ok = await w.api(P.aAdmin).post('/v1/selection-lists', { key: 'off-private', name: 'Off', visibility: 'private' });
        expect(ok.status).toBe(201);
        expect(ok.body).toMatchObject({ visibility: 'private', forked_from: null });
        const patchBad = await w.api(P.aAdmin).patch(`/v1/selection-lists/${ok.body.id}`, { visibility: 'org' });
        expect(patchBad.status).toBe(400);
        const patchOk = await w.api(P.aAdmin).patch(`/v1/selection-lists/${ok.body.id}`, { visibility: 'private', name: 'Renamed' });
        expect(patchOk.status).toBe(200);
        expect(patchOk.body.name).toBe('Renamed');
        await w.api(P.aAdmin).del(`/v1/selection-lists/${ok.body.id}?purge=true`);
      });
    });

    it('asks Permit exactly what 4.0.0 asked (no read_shared, no editable bulk check)', async () => {
      await off(async () => {
        const mark = w.authz.asked.length;
        await w.api(P.aAdmin).get(`/v1/selection-lists/${aOrgList}`);
        expect(w.authz.since(mark)).toEqual(['list:read']);
        const m2 = w.authz.asked.length;
        await w.api(P.aAdmin).get('/v1/selection-lists');
        expect(w.authz.since(m2)).toEqual(['catalog:list', 'list:read', 'list:read']);
      });
    });
  });

  it('every response conforms to the 4.1.0 contract (SelectionList / SelectionListItem), flag ON and OFF', async () => {
    const check = async () => {
      const one = await w.api(P.aMember).get(`/v1/selection-lists/${aOrgList}`);
      const list = await w.api(P.aMember).get('/v1/selection-lists?include_shared=true');
      const items = await w.api(P.bMember).get(`/v1/selection-lists/${platform.listId}/items?status=all`);
      const admin = await w.api(P.aAdmin).get(`/v1/selection-lists/${aOrgList}`);
      for (const r of [one, admin]) if (r.status === 200) assertConforms('SelectionList', r.body);
      for (const l of list.body.items ?? []) assertConforms('SelectionList', l);
      for (const i of items.body.items ?? []) assertConforms('SelectionListItem', i);
    };
    await check();
    const { setFlagClient } = await import('../src/flags');
    setFlagClient(flagClientWith(false));
    try {
      await check();
    } finally {
      setFlagClient(flagClientWith(true));
    }
  });

  it('the ORG_A/ORG_B/PLATFORM fixtures are three different organizations', () => {
    expect(new Set([ORG_A, ORG_B, PLATFORM]).size).toBe(3);
  });
});
