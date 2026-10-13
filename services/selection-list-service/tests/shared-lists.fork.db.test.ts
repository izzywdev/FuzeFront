// shared-lists.fork.db.test.ts — POST /v1/selection-lists/{listId}/fork (design record D6, section 6) and the
// resolve changes that make a fork transparent to stored values (D9), through the real app and REAL Postgres.
//
// Pins: 201 new fork (copy of list + every non-purged item incl. archived + all translations, new minted ids,
// origin_item_id, forked_from, owner grant with the MACHINE identity, seed null, created_by = caller) in ONE
// transaction with its events; 200 idempotent repeat; 409 fork_exists / fork_not_applicable / key taken;
// quotas; 400 for `id` in the body and for > 5000 items; 404 for an unreadable source and when the flag is
// OFF; compensation of the owner grant when the transaction fails; concurrent forks; precedence (the fork
// shadows the common list); and resolve over platform ids with the fork redirect.

import type { Knex } from 'knex';
import { TOPICS, schemaForTopic } from '@fuzefront/shared/kafka';
import { dbDescribe } from './helpers/testDb';
import { fromUuid } from '@izzywdev/fuzefront-identity';
import { createWorld, ORG_A, ORG_B, P, PLATFORM, publishPriorityList, World } from './helpers/sharedWorld';
import { parseId } from '@izzywdev/fuzefront-identity';
import { flagClientWith } from './helpers/flagClient';
import { assertConforms } from './helpers/openapi';

const state: { db: Knex | undefined } = { db: undefined };
jest.mock('../src/db', () => ({
  get db() {
    return state.db;
  },
}));

dbDescribe('shared lists — fork and resolve (real Postgres)', () => {
  let w: World;
  let platform: { listId: string; low: string; mid: string; old: string };

  beforeAll(async () => {
    w = await createWorld(state);
    platform = await publishPriorityList(w);
    await w.newEvents(); // drain setup events
  });
  afterAll(() => w.teardown());

  const fork = (p = P.aMember, body: object = {}, id = platform.listId) => w.api(p).post(`/v1/selection-lists/${id}/fork`, body);

  describe('POST /fork', () => {
    let forkId: string;
    let forkBody: any;

    it('201: a copy the caller owns — same key, new ids, provenance, translations, archived items kept', async () => {
      const mark = w.authz.asked.length;
      const res = await fork(P.aMember);
      expect(res.status).toBe(201);
      forkBody = res.body;
      forkId = res.body.id;
      assertConforms('SelectionList', res.body);
      // ids are service-minted with the registry prefixes and pass the strict TypeID validator
      expect(forkId.startsWith('front_sl_')).toBe(true);
      expect(() => parseId('selectionList', forkId)).not.toThrow();
      expect(() => parseId('selectionListItem', forkId)).toThrow(); // a list id is not an item id
      expect(forkId).toMatch(/^front_sl_[0-9a-z]+$/);
      expect(forkId).not.toBe(platform.listId);
      expect(res.body).toMatchObject({
        organization_id: ORG_A,
        key: 'priority',
        status: 'active',
        visibility: 'org', // the default
        created_by: P.aMember.userId,
        seed: null,
        editable: true,
        item_count: 2,
        forked_from: { list_id: platform.listId, organization_id: PLATFORM, revision: expect.any(Number) },
      });
      expect(res.body.forked_from.forked_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(res.body.forked_from.revision).toBeGreaterThan(1);

      // decisions: the catalog `create` (route), the source read (shared read), nothing else
      expect(w.authz.since(mark)).toEqual(['catalog:create', 'catalog:read_shared']);

      // the rows: list + translations
      const row = await w.db('selection_lists').where({ id: forkId }).first();
      expect(row).toMatchObject({ organization_id: ORG_A, visibility: 'org', forked_from_list_id: platform.listId, forked_from_org_id: PLATFORM, seed_source: null });
      const srcRow = await w.db('selection_lists').where({ id: platform.listId }).first();
      expect(Number(row.forked_from_revision)).toBe(Number(srcRow.revision)); // the source revision AT COPY TIME
      const lt = await w.db('selection_list_translations').where({ list_id: forkId }).orderBy('locale');
      expect(lt.map((t: any) => [t.locale, t.name, t.is_machine])).toEqual([['en', 'Priority', false], ['fr', 'Priorité', false]]);

      // items: ALL non-purged (active AND archived), new ids, origin ids, same code/status/sort_order
      const src = await w.db('selection_list_items').where({ list_id: platform.listId }).orderBy('sort_order');
      const items = await w.db('selection_list_items').where({ list_id: forkId }).orderBy('sort_order');
      expect(items.map((i: any) => [i.code, i.status, i.sort_order, i.origin_item_id, i.created_by])).toEqual(
        src.map((i: any) => [i.code, i.status, i.sort_order, i.id, P.aMember.userId]),
      );
      for (const i of items) expect(() => parseId('selectionListItem', i.id)).not.toThrow();
      expect(items.every((i: any) => /^front_sli_[0-9a-z]+$/.test(i.id) && !src.some((s: any) => s.id === i.id))).toBe(true);
      expect(items.every((i: any) => i.seed_source === null)).toBe(true);
      const it = await w.db('selection_list_item_translations').whereIn('item_id', items.map((i: any) => i.id)).orderBy(['item_id', 'locale']);
      const lowFork = items.find((i: any) => i.code === 'LOW');
      expect(it.filter((t: any) => t.item_id === lowFork.id).map((t: any) => [t.locale, t.label])).toEqual([['en', 'Low'], ['fr', 'Basse']]);

      // the caller is list-owner on the fork, granted with the MACHINE identity (service grant, tenant = caller org)
      expect(w.authz.grants.filter((g) => g.listId === forkId)).toEqual([{ subject: P.aMember.userId, tenant: ORG_A, role: 'list-owner', listId: forkId }]);
      expect(await w.db('selection_list_access').where({ list_id: forkId }).first()).toMatchObject({ user_id: P.aMember.userId, role: 'list-owner' });
    });

    it('the source is untouched; a fork is a different entity (editing it does not move the common list)', async () => {
      const srcItems = await w.db('selection_list_items').where({ list_id: platform.listId }).orderBy('sort_order');
      expect(srcItems.map((i: any) => i.origin_item_id)).toEqual([null, null, null]);
      const edit = await w.api(P.aMember).patch(`/v1/selection-lists/${forkId}`, { name: 'Our priority' });
      expect(edit.status).toBe(200);
      expect(edit.body.name).toBe('Our priority');
      const common = await w.api(P.bMember).get(`/v1/selection-lists/${platform.listId}`);
      expect(common.body.name).toBe('Priority');
      await w.api(P.aMember).patch(`/v1/selection-lists/${forkId}`, { name: 'Priority' });
    });

    it('emits, in ONE transaction: list.created, item.created x n, translation.upserted x m, access.granted, list.forked', async () => {
      const events = await w.newEvents();
      const forkEvents = events.filter((e) => e.p.listId === forkId);
      const topics = forkEvents.map((e) => e.topic);
      expect(topics[0]).toBe(TOPICS.SELECTION_LISTS_LIST_CREATED);
      expect(topics.filter((t) => t === TOPICS.SELECTION_LISTS_ITEM_CREATED)).toHaveLength(3);
      expect(topics.filter((t) => t === TOPICS.SELECTION_LISTS_TRANSLATION_UPSERTED)).toHaveLength(2); // fr list + fr LOW
      expect(topics.filter((t) => t === TOPICS.SELECTION_LISTS_ACCESS_GRANTED)).toHaveLength(1);
      expect(topics.filter((t) => t === TOPICS.SELECTION_LISTS_LIST_FORKED)).toHaveLength(1);
      const forkedIdx = topics.indexOf(TOPICS.SELECTION_LISTS_LIST_FORKED);
      expect(forkedIdx).toBeGreaterThan(topics.indexOf(TOPICS.SELECTION_LISTS_ACCESS_GRANTED));
      // organization of the events = the FORKING org (partition key), including list.forked
      for (const e of forkEvents) expect(e.p.organizationId).toBe(ORG_A);

      // listRevision strictly increases across the revision-carrying events, with no gaps
      const revs = forkEvents.filter((e) => e.p.listRevision !== undefined).map((e) => e.p.listRevision);
      expect(revs).toEqual(revs.map((_, i) => i + 1));
      const final = (await w.db('selection_lists').where({ id: forkId }).first()).revision;
      expect(Number(final)).toBeGreaterThanOrEqual(revs[revs.length - 1]);

      const forked = forkEvents[forkedIdx].p;
      const items = await w.db('selection_list_items').where({ list_id: forkId });
      expect(forked.source).toEqual({
        listId: platform.listId,
        organizationId: PLATFORM,
        listKey: 'priority',
        listRevision: forkBody.forked_from.revision,
      });
      expect(forked.itemMap).toHaveLength(3);
      expect(forked.itemMap).toEqual(
        expect.arrayContaining(items.map((i: any) => ({ originItemId: i.origin_item_id, itemId: i.id }))),
      );
      expect(forked.list).toMatchObject({
        listId: forkId,
        visibility: 'org',
        forkedFrom: { listId: platform.listId, organizationId: PLATFORM, listRevision: forkBody.forked_from.revision },
      });
      // snapshots of the ordinary events carry the provenance too
      const itemCreated = forkEvents.find((e) => e.topic === TOPICS.SELECTION_LISTS_ITEM_CREATED)!;
      expect(itemCreated.p.item.originItemId).toEqual(expect.stringMatching(/^front_sli_/));
      // every payload validates against the published schema (they were validated on write; re-prove it)
      for (const e of events) expect(schemaForTopic(e.topic)!.safeParse(e.p).success).toBe(true);
      // the owner grant is attributed to the caller
      const granted = forkEvents.find((e) => e.topic === TOPICS.SELECTION_LISTS_ACCESS_GRANTED)!;
      expect(granted.p).toMatchObject({ userId: P.aMember.userId, role: 'list-owner', previousRole: null });
    });

    it('200: repeating the fork is idempotent per (org, source) — the existing fork, nothing copied, no new events', async () => {
      const before = await w.db('selection_lists').count('* as n').first();
      const res = await fork(P.aMember);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(forkId);
      // another member who CAN read it (org visibility) also gets 200 with the same list
      const other = await fork(P.aMember2);
      expect(other.status).toBe(200);
      expect(other.body.id).toBe(forkId);
      expect(other.body.editable).toBe(false); // a reader, not an owner
      expect((await w.db('selection_lists').count('* as n').first())!.n).toBe(before!.n);
      expect(await w.newEvents()).toEqual([]);
    });

    it('precedence: the fork shadows the common list for the org (key lookup, listing); the filter shows both', async () => {
      const eff = await w.api(P.aMember2).get('/v1/selection-lists?include_shared=true&key=priority');
      expect(eff.body.items).toHaveLength(1);
      expect(eff.body.items[0].id).toBe(forkId);
      const list = await w.api(P.aMember2).get('/v1/selection-lists?include_shared=true');
      expect(list.body.items.filter((i: any) => i.key === 'priority').map((i: any) => i.id)).toEqual([forkId]);
      // an org that did not fork still gets the common list
      const b = await w.api(P.bMember).get('/v1/selection-lists?include_shared=true&key=priority');
      expect(b.body.items.map((i: any) => i.id)).toEqual([platform.listId]);
      // visibility filter turns shadowing off: an administrator sees the list behind the fork
      const both = await w.api(P.aMember2).get('/v1/selection-lists?include_shared=true&key=priority&visibility=platform');
      expect(both.body.items.map((i: any) => i.id)).toEqual([platform.listId]);
      // archived fork reverts to the common list
      await w.api(P.aMember).post(`/v1/selection-lists/${forkId}/archive`);
      const reverted = await w.api(P.aMember2).get('/v1/selection-lists?include_shared=true&key=priority');
      expect(reverted.body.items.map((i: any) => i.id)).toEqual([platform.listId]);
      await w.api(P.aMember).patch(`/v1/selection-lists/${forkId}`, { status: 'active' });
      await w.newEvents();
    });

    it('409 fork_exists: the org already holds a fork the caller cannot read (private fork of another member)', async () => {
      // org B forks as a PRIVATE draft; another member of B (no grant) cannot read it
      const bOwner = { userId: P.bMember.userId, orgId: ORG_B };
      const mine = await fork(bOwner, { visibility: 'private' });
      expect(mine.status).toBe(201);
      expect(mine.body.visibility).toBe('private');
      const bOther = { userId: 'usr_01bother00000000000000000000', orgId: ORG_B };
      w.authz.allowCatalog(ORG_B, bOther.userId, ['list', 'create', 'resolve', 'read_shared']);
      const res = await fork(bOther);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'CONFLICT', reason: 'fork_exists' });
      // the owner repeating it gets the 200
      expect((await fork(bOwner, { visibility: 'private' })).status).toBe(200);
    });

    it('409 fork_not_applicable: forking a list of your OWN org (a platform operator forking the platform list)', async () => {
      const res = await fork(P.op);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'CONFLICT', reason: 'fork_not_applicable' });
      // ...and an org-visible list of the caller's own org
      const own = await w.api(P.aAdmin).post('/v1/selection-lists', { key: 'own-org-list', name: 'Own', visibility: 'org' });
      const res2 = await fork(P.aMember, {}, own.body.id);
      expect(res2.status).toBe(409);
      expect(res2.body.reason).toBe('fork_not_applicable');
    });

    it('409 (plain CONFLICT, no reason): the key is held by a DIFFERENT list of the org', async () => {
      // org B already forked; use a second common list and pre-occupy the key in org A
      const mk = await w.api(P.op).post('/v1/selection-lists', { key: 'taken-key', name: 'T', visibility: 'platform' });
      await w.api(P.aAdmin).post('/v1/selection-lists', { key: 'taken-key', name: 'Mine' });
      const res = await fork(P.aMember, {}, mk.body.id);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CONFLICT');
      expect(res.body.reason).toBeUndefined();
    });

    it('404: a source the caller cannot read (developer; a private list of another org; unknown id)', async () => {
      expect((await fork(P.aDeveloper)).status).toBe(403); // no `create` at all
      w.authz.allowCatalog(ORG_A, P.aDeveloper.userId, ['create']);
      expect((await fork(P.aDeveloper)).status).toBe(404); // may create, cannot read
      w.authz.allowCatalog(ORG_A, P.aDeveloper.userId, []);
      const priv = await w.api(P.aAdmin).post('/v1/selection-lists', { key: 'a-secret', name: 'S' });
      expect((await fork({ userId: P.bMember.userId, orgId: ORG_B }, {}, priv.body.id)).status).toBe(404);
      expect((await fork(P.aMember, {}, 'front_sl_0000000000000000000000000z')).status).toBe(404);
    });

    it('403 without SelectionListCatalog:create (viewer); nothing is copied', async () => {
      const before = await w.db('selection_lists').count('* as n').first();
      const res = await fork(P.aViewer);
      expect(res.status).toBe(403);
      expect((await w.db('selection_lists').count('* as n').first())!.n).toBe(before!.n);
    });

    it('400: the body rejects `id`, `key` and any unknown property; visibility is org | private only', async () => {
      for (const body of [{ id: 'front_sl_abc' }, { key: 'other' }, { organization_id: ORG_B }, { visibility: 'platform' }, { visibility: 'public' }]) {
        const res = await fork({ userId: 'usr_01bother00000000000000000000', orgId: ORG_B }, body);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
      }
    });

    it('400: a source with more than 5000 items is refused', async () => {
      const big = await w.api(P.op).post('/v1/selection-lists', { key: 'huge', name: 'Huge', visibility: 'platform' });
      await w.db.raw(
        `INSERT INTO selection_list_items (id, list_id, code, sort_order, status, created_by)
         SELECT 'front_sli_huge' || g, ?, 'C' || g, g, 'active', 'usr_x' FROM generate_series(1, 5001) g`,
        [big.body.id],
      );
      const res = await fork(P.aMember, {}, big.body.id);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(await w.db('selection_lists').where({ organization_id: ORG_A, key: 'huge' }).first()).toBeUndefined();
    });

    it('404 while the shared-lists flag is OFF (the route does not exist) — and it asks nothing', async () => {
      const { setFlagClient } = await import('../src/flags');
      setFlagClient(flagClientWith(false));
      try {
        const mark = w.authz.asked.length;
        const res = await fork({ userId: 'usr_01bother00000000000000000000', orgId: ORG_B });
        expect(res.status).toBe(404);
        expect(w.authz.since(mark)).toEqual([]);
      } finally {
        setFlagClient(flagClientWith(true));
      }
    });

    it('fails closed when the Security API is down (403 from the catalog check; nothing is copied)', async () => {
      w.authz.down = new Error('DECISION_UNAVAILABLE');
      try {
        expect((await fork({ userId: 'usr_01bother00000000000000000000', orgId: ORG_B })).status).toBe(403);
      } finally {
        w.authz.down = null;
      }
    });
  });

  describe('quotas (403 QUOTA_EXCEEDED) — exact, inside the transaction', () => {
    const quotaOrg = (n: number) => `org_01quota${n}00000000000000000`;
    const quotaUser = (n: number) => `usr_01quota${n}00000000000000000`;
    const setup = (n: number, quota: Record<string, number>) => {
      const p = { userId: quotaUser(n), orgId: quotaOrg(n) };
      w.authz.allowCatalog(p.orgId, p.userId, ['list', 'create', 'resolve', 'read_shared']);
      return w.db('selection_list_org_quota').insert({ organization_id: p.orgId, updated_by: 'usr_x', ...quota }).then(() => p);
    };

    it('org_lists: an org at its list ceiling cannot fork', async () => {
      const p = await setup(1, { max_lists: 1 });
      expect((await w.api(p).post('/v1/selection-lists', { key: 'filler', name: 'F' })).status).toBe(201);
      const res = await fork(p);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'QUOTA_EXCEEDED', scope: 'org_lists', limit: 1 });
      expect(await w.db('selection_lists').where({ organization_id: p.orgId, key: 'priority' }).first()).toBeUndefined();
    });

    it('list_items: a source with more active items than the org ceiling cannot be forked whole', async () => {
      const p = await setup(2, { max_items_per_list: 1 });
      const res = await fork(p);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'QUOTA_EXCEEDED', scope: 'list_items', limit: 1, current: 2 });
    });

    it('list_locales: an org whose locale ceiling is below the source locales cannot fork it', async () => {
      const p = await setup(3, { max_locales: 1 });
      const res = await fork(p);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'QUOTA_EXCEEDED', scope: 'list_locales', limit: 1, current: 2 });
    });

    it('user_lists: the per-user ceiling applies to the forker', async () => {
      const p = await setup(4, { max_lists_per_user: 1 });
      expect((await w.api(p).post('/v1/selection-lists', { key: 'mine', name: 'M' })).status).toBe(201);
      const res = await fork(p);
      expect(res.status).toBe(403);
      expect(res.body.scope).toBe('user_lists');
    });

    it('the repeat of an EXISTING fork is not a new list: it is answered 200 even at the ceiling', async () => {
      const p = await setup(5, { max_lists: 1 });
      expect((await fork(p)).status).toBe(201);
      expect((await fork(p)).status).toBe(200);
    });
  });

  describe('one organization, two renderings of its id (bare UUID and org_ TypeID)', () => {
    it('cannot fork the same source twice (nor take its key) by presenting the other rendering', async () => {
      const uuid = '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7ebb';
      const typeId = fromUuid('organization', uuid);
      const byTypeId = { userId: 'usr_01render0000000000000000000a', orgId: typeId };
      const byUuid = { userId: 'usr_01render0000000000000000000b', orgId: uuid };
      for (const p of [byTypeId, byUuid]) w.authz.allowCatalog(p.orgId, p.userId, ['list', 'create', 'resolve', 'read_shared']);
      expect((await fork(byTypeId)).status).toBe(201);
      const again = await fork(byUuid);
      expect(again.status).not.toBe(201);
      expect([200, 409]).toContain(again.status);
      expect((await w.db('selection_lists').whereIn('organization_id', [uuid, typeId]).where({ key: 'priority' })).length).toBe(1);
      // the other order, on a second common list
      const other = await w.api(P.op).post('/v1/selection-lists', { key: 'render-common', name: 'R', visibility: 'platform' });
      expect((await fork(byUuid, {}, other.body.id)).status).toBe(201);
      expect((await fork(byTypeId, {}, other.body.id)).status).not.toBe(201);
      expect((await w.db('selection_lists').whereIn('organization_id', [uuid, typeId]).where({ key: 'render-common' })).length).toBe(1);
    });
  });

  describe('atomicity, compensation and concurrency', () => {
    it('a failure AFTER the transaction committed keeps the creator\'s owner grant (no compensation); a retry returns the fork (200)', async () => {
      const listShape = await import('../src/routes/listShape');
      const spy = jest.spyOn(listShape, 'formatList').mockImplementationOnce(() => {
        throw new Error('boom: formatting after commit');
      });
      const p = { userId: 'usr_01commit0000000000000000000a', orgId: 'org_01commit0000000000000000000a' };
      w.authz.allowCatalog(p.orgId, p.userId, ['list', 'create', 'resolve', 'read_shared']);
      const grantsBefore = w.authz.grants.length;
      const revokesBefore = w.authz.revokes.length;
      let res: any;
      try {
        res = await fork(p);
      } finally {
        spy.mockRestore();
      }
      expect(res.status).toBe(500);
      expect(res.body.message).toMatch(/repeat the request/);
      const row = await w.db('selection_lists').where({ organization_id: p.orgId, key: 'priority' }).first();
      expect(row).toBeDefined(); // committed
      expect(w.authz.revokes.length).toBe(revokesBefore); // the owner grant was NOT taken back
      const granted = w.authz.grants.slice(grantsBefore);
      expect(granted).toHaveLength(1);
      expect(w.authz.roles.get(`${p.orgId}|${p.userId}|${row.id}`)).toBe('list-owner');
      // retry-safe: the repeat answers the existing fork, with the creator still its owner
      const retry = await fork(p);
      expect(retry.status).toBe(200);
      expect(retry.body).toMatchObject({ id: row.id, editable: true });
    });

    it('a failure after the owner grant rolls EVERYTHING back and takes the grant back (compensation)', async () => {
      const emitters = await import('../src/events/emitters');
      const spy = jest.spyOn(emitters, 'emitForkEvents').mockRejectedValueOnce(new Error('boom: outbox unavailable'));
      const p = { userId: 'usr_01atomic00000000000000000000', orgId: 'org_01atomic00000000000000000000' };
      w.authz.allowCatalog(p.orgId, p.userId, ['list', 'create', 'resolve', 'read_shared']);
      const listsBefore = (await w.db('selection_lists').count('* as n').first())!.n;
      const eventsBefore = (await w.db('event_outbox').count('* as n').first())!.n;
      const grantsBefore = w.authz.grants.length;
      try {
        const res = await fork(p);
        expect(res.status).toBe(500);
      } finally {
        spy.mockRestore();
      }
      // nothing persisted: no list, no items, no events, no mirror row
      expect((await w.db('selection_lists').count('* as n').first())!.n).toBe(listsBefore);
      expect((await w.db('event_outbox').count('* as n').first())!.n).toBe(eventsBefore);
      expect(await w.db('selection_lists').where({ organization_id: p.orgId }).first()).toBeUndefined();
      // the Security API grant that WAS made is revoked again
      const granted = w.authz.grants.slice(grantsBefore);
      expect(granted).toHaveLength(1);
      expect(w.authz.revokes.filter((r) => r.listId === granted[0].listId)).toEqual([
        { subject: p.userId, tenant: p.orgId, role: 'list-owner', listId: granted[0].listId },
      ]);
      expect(w.authz.roles.has(`${p.orgId}|${p.userId}|${granted[0].listId}`)).toBe(false);
      // and the org can fork afterwards
      expect((await fork(p)).status).toBe(201);
    });

    it('a failing owner grant (Security API) fails the fork cleanly: no list, no events', async () => {
      const p = { userId: 'usr_01grant000000000000000000000', orgId: 'org_01grant000000000000000000000' };
      w.authz.allowCatalog(p.orgId, p.userId, ['list', 'create', 'resolve', 'read_shared']);
      w.authz.grantFails = new Error('grant refused');
      try {
        const res = await fork(p);
        expect(res.status).toBe(500);
      } finally {
        w.authz.grantFails = null;
      }
      expect(await w.db('selection_lists').where({ organization_id: p.orgId }).first()).toBeUndefined();
    });

    it('two concurrent forks of the same source by one org: exactly one 201, the other the idempotent 200', async () => {
      const p = { userId: 'usr_01race0000000000000000000000', orgId: 'org_01race0000000000000000000000' };
      w.authz.allowCatalog(p.orgId, p.userId, ['list', 'create', 'resolve', 'read_shared']);
      const [a, b] = await Promise.all([fork(p), fork(p)]);
      expect([a.status, b.status].sort()).toEqual([200, 201]);
      expect(a.body.id).toBe(b.body.id);
      expect((await w.db('selection_lists').where({ organization_id: p.orgId, forked_from_list_id: platform.listId })).length).toBe(1);
    });
  });

  describe('POST /v1/resolve — platform ids and the fork redirect', () => {
    const resolve = (p: any, ids: string[], extra: object = {}) => w.api(p).post('/v1/resolve', { ids, ...extra });
    let forkOrg: { userId: string; orgId: string };
    let forkItems: Record<string, string>; // code -> fork item id

    beforeAll(async () => {
      forkOrg = { userId: 'usr_01resolve0000000000000000000', orgId: 'org_01resolve0000000000000000000' };
      w.authz.allowCatalog(forkOrg.orgId, forkOrg.userId, ['list', 'create', 'resolve', 'read_shared']);
    });

    it('platform item ids resolve in EVERY org (label, locale, status), archived ones too; other orgs ids stay missing', async () => {
      const mine = await w.api(P.aAdmin).post('/v1/selection-lists', { key: 'a-own', name: 'Own' });
      const aItem = await w.api(P.aAdmin).post(`/v1/selection-lists/${mine.body.id}/items`, { code: 'X', label: 'Ex' });
      const res = await resolve(P.bMember, [platform.low, platform.mid, platform.old, aItem.body.id], { locale: 'fr' });
      expect(res.status).toBe(200);
      expect(res.body.results[platform.low]).toEqual({ label: 'Basse', locale: 'fr', is_machine: false, status: 'active' });
      expect(res.body.results[platform.mid]).toMatchObject({ label: 'Medium', locale: 'en', status: 'active' });
      expect(res.body.results[platform.old]).toMatchObject({ label: 'Obsolete', status: 'archived' });
      expect(res.body.results[platform.low]).not.toHaveProperty('effective_item_id');
      expect(res.body.missing).toEqual([aItem.body.id]); // another org's id is indistinguishable from a never-created one
    });

    it('with an org-visible fork: the result is the FORK item (label/status) + effective_item_id; both ids keep resolving', async () => {
      const before = await resolve(forkOrg, [platform.low, platform.mid, platform.old]);
      expect(before.body.results[platform.low]).not.toHaveProperty('effective_item_id');
      const etagBefore = before.headers['etag'];

      const f = await fork(forkOrg);
      expect(f.status).toBe(201);
      const items = await w.db('selection_list_items').where({ list_id: f.body.id });
      forkItems = Object.fromEntries(items.map((i: any) => [i.code, i.id]));

      // the fork's text is the org's now
      await w.api(forkOrg).patch(`/v1/selection-lists/${f.body.id}/items/${forkItems.LOW}`, { label: 'Minor' });
      const after = await resolve(forkOrg, [platform.low, platform.mid, platform.old, forkItems.LOW]);
      expect(after.status).toBe(200);
      expect(after.body.results[platform.low]).toMatchObject({ label: 'Minor', status: 'active', effective_item_id: forkItems.LOW });
      expect(after.body.results[platform.mid]).toMatchObject({ label: 'Medium', effective_item_id: forkItems.MID });
      expect(after.body.results[platform.old]).toMatchObject({ status: 'archived', effective_item_id: forkItems.OLD }); // archived fork item
      // the fork item id itself resolves too, with no redirect
      expect(after.body.results[forkItems.LOW]).toMatchObject({ label: 'Minor' });
      expect(after.body.results[forkItems.LOW]).not.toHaveProperty('effective_item_id');
      expect(after.body.missing).toEqual([]);
      assertConforms('ResolveResponse', after.body);
      // one request, ETag varies on fork presence (the body — hence the express ETag — differs)
      const etagAfter = (await resolve(forkOrg, [platform.low, platform.mid, platform.old])).headers['etag'];
      expect(etagBefore).toBeDefined();
      expect(etagAfter).toBeDefined();
      expect(etagAfter).not.toBe(etagBefore);
      // an org WITHOUT a fork is unaffected
      const other = await resolve(P.bMember, [platform.low]);
      expect(other.body.results[platform.low]).toMatchObject({ label: 'Low' });
      expect(other.body.results[platform.low]).not.toHaveProperty('effective_item_id');
    });

    it('the redirect respects the locale chain of the fork item', async () => {
      const fr = await resolve(forkOrg, [platform.low], { locale: 'fr' });
      // the fork item has no fr label of its own after the edit? (copied 'Basse') -> fr text wins over the source text
      expect(fr.body.results[platform.low]).toMatchObject({ label: 'Basse', locale: 'fr', effective_item_id: forkItems.LOW });
    });

    it('a fork item PURGED from the fork falls back to the common item', async () => {
      const f = await w.db('selection_lists').where({ organization_id: forkOrg.orgId, key: 'priority' }).first();
      expect((await w.api(forkOrg).del(`/v1/selection-lists/${f.id}/items/${forkItems.MID}?purge=true`)).status).toBe(204);
      const res = await resolve(forkOrg, [platform.mid]);
      expect(res.body.results[platform.mid]).toMatchObject({ label: 'Medium', status: 'active' });
      expect(res.body.results[platform.mid]).not.toHaveProperty('effective_item_id');
    });

    it('a PRIVATE fork never redirects (a draft is not the org\'s choice); neither does an archived one', async () => {
      const f = await w.db('selection_lists').where({ organization_id: forkOrg.orgId, key: 'priority' }).first();
      // org-visible -> private
      expect((await w.api(forkOrg).patch(`/v1/selection-lists/${f.id}`, { visibility: 'private' })).status).toBe(200);
      let res = await resolve(forkOrg, [platform.low]);
      expect(res.body.results[platform.low]).toMatchObject({ label: 'Low' });
      expect(res.body.results[platform.low]).not.toHaveProperty('effective_item_id');
      // back to org -> redirects again; archived -> falls back
      await w.api(forkOrg).patch(`/v1/selection-lists/${f.id}`, { visibility: 'org' });
      res = await resolve(forkOrg, [platform.low]);
      expect(res.body.results[platform.low].effective_item_id).toBe(forkItems.LOW);
      await w.api(forkOrg).post(`/v1/selection-lists/${f.id}/archive`);
      res = await resolve(forkOrg, [platform.low]);
      expect(res.body.results[platform.low]).not.toHaveProperty('effective_item_id');
      await w.api(forkOrg).patch(`/v1/selection-lists/${f.id}`, { status: 'active' });
    });

    it('is ONE round trip: a single statement against the item table for any number of ids', async () => {
      const seen: string[] = [];
      const listener = (q: { sql: string }) => seen.push(q.sql);
      w.db.on('query', listener);
      try {
        await resolve(forkOrg, [platform.low, platform.mid, platform.old]);
      } finally {
        w.db.removeListener('query', listener);
      }
      expect(seen.filter((s) => /selection_list_items/.test(s))).toHaveLength(1);
    });

    it('flag OFF: platform ids are NOT resolvable (4.0.0 org scoping) and nothing redirects', async () => {
      const { setFlagClient } = await import('../src/flags');
      setFlagClient(flagClientWith(false));
      try {
        const res = await resolve(forkOrg, [platform.low]);
        expect(res.status).toBe(200);
        expect(res.body.results).toEqual({});
        expect(res.body.missing).toEqual([platform.low]);
      } finally {
        setFlagClient(flagClientWith(true));
      }
    });

    it('a platform id resolves for a caller with `resolve` only (no per-id read check — accepted trade-off L-4)', async () => {
      w.authz.allowCatalog(ORG_B, P.bMember.userId, ['resolve']);
      const res = await resolve(P.bMember, [platform.low]);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body.results)).toEqual([platform.low]);
      w.authz.allowCatalog(ORG_B, P.bMember.userId, ['list', 'create', 'resolve', 'read_shared']);
    });
  });
});
