// outbox.routes.db.test.ts - ROUTE-level proof that every mutating route writes
// exactly the expected topic(s), once, with the right listRevision, in the same
// transaction as the data change - through the real Express app, the real
// routes/emitters/outbox and REAL Postgres (real migrations). Only the flag
// client, the Security API client and the machine-token provider are test
// doubles (as in the other route suites).
//
// "Exactly once": after each call the test reads the rows the call added to
// `event_outbox` and asserts the complete (topic, listRevision) list.

import type { Knex } from 'knex';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { fromUuid } from '@izzywdev/fuzefront-identity';
import { TOPICS } from '@fuzefront/shared/kafka';
import { createTestDb, dbDescribe, TestDb } from './helpers/testDb';

const state: { db: Knex | undefined } = { db: undefined };
jest.mock('../src/db', () => ({
  get db() {
    return state.db;
  },
}));

import { createApp } from '../src/app';
import { setFlagClient } from '../src/flags';
import { _setAuthzClientForTesting, makeNoOpProxy } from '../src/middleware/authz';
import { _setGrantTokenProviderForTesting } from '../src/lib/machineIdentity';

const JWT_SECRET = process.env.TEST_JWT_SECRET ?? 'test-only-not-a-real-secret-outbox-routes';
const ORG = fromUuid('organization', '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7e01');
const USER = fromUuid('user', '0195a8f2-aaaa-7a11-8b2d-3f4e5a6b7e01');
const USER2 = fromUuid('user', '0195a8f2-aaaa-7a11-8b2d-3f4e5a6b7e02');

const token = (userId = USER, orgId = ORG) => jwt.sign({ userId, orgId }, JWT_SECRET);
const auth = () => ({ Authorization: `Bearer ${token()}` });

type Ev = { topic: string; rev: number | undefined; p: Record<string, any> };

dbDescribe('mutating routes -> outbox (real Postgres)', () => {
  let t: TestDb;
  let db: Knex;
  let app: ReturnType<typeof createApp>;
  let seen = 0n; // outbox seq watermark

  /** Events the last call(s) added, oldest first. */
  async function newEvents(): Promise<Ev[]> {
    const rows = await db('event_outbox').where('seq', '>', seen.toString()).orderBy('seq');
    if (rows.length) seen = BigInt(rows[rows.length - 1].seq);
    return rows.map((r) => ({ topic: r.topic, rev: r.payload.listRevision, p: r.payload }));
  }
  const shape = (evs: Ev[]) => evs.map((e) => `${e.topic}@${e.rev ?? '-'}`);

  beforeAll(async () => {
    t = await createTestDb();
    db = t.db;
    state.db = db;
    process.env.JWT_SECRET = JWT_SECRET;
    delete process.env.FUZEFRONT_SELECTION_LIST_AUTHZ_ENABLED;
    setFlagClient({ getBooleanValue: async () => true });
    _setAuthzClientForTesting(makeNoOpProxy());
    _setGrantTokenProviderForTesting({ getToken: async () => 'machine-token' });
    app = createApp();
  });
  afterAll(async () => {
    setFlagClient(null);
    _setGrantTokenProviderForTesting(null);
    delete process.env.JWT_SECRET;
    await t.drop();
  });

  it('walks the whole mutating surface: exactly one expected topic per change, listRevision strictly increasing per list', async () => {
    // ---- POST /lists : list.created@1 + the creator's owner grant
    let res = await request(app).post('/v1/selection-lists').set(auth()).send({ key: 'priority', name: 'Priority', description: 'How urgent' });
    expect(res.status).toBe(201);
    const listId: string = res.body.id;
    let evs = await newEvents();
    expect(shape(evs)).toEqual([`${TOPICS.SELECTION_LISTS_LIST_CREATED}@1`, `${TOPICS.SELECTION_LISTS_ACCESS_GRANTED}@-`]);
    expect(evs[0].p).toMatchObject({
      organizationId: ORG,
      actor: { type: 'user', userId: USER },
      listId,
      listKey: 'priority',
      list: { listId, key: 'priority', sourceLocale: 'en', status: 'active', name: 'Priority', description: 'How urgent', seed: null },
    });
    expect(evs[1].p).toMatchObject({ listId, userId: USER, role: 'list-owner', previousRole: null, actor: { type: 'user', userId: USER } });
    // every event has its own UUID eventId, equal to the outbox row id
    const rows = await db('event_outbox').orderBy('seq');
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    for (const r of rows) expect(r.payload.eventId).toBe(r.id);
    expect(rows[0].correlation_id).toBe(res.headers['x-request-id']); // trace id = the request's reqId

    // ---- PATCH /lists/:id : name -> list.updated@2 ; key -> list.updated@3 (previousKey)
    res = await request(app).patch(`/v1/selection-lists/${listId}`).set(auth()).send({ name: 'Priorities' });
    expect(res.status).toBe(200);
    evs = await newEvents();
    expect(shape(evs)).toEqual([`${TOPICS.SELECTION_LISTS_LIST_UPDATED}@2`]);
    expect(evs[0].p).toMatchObject({ changedFields: ['name'], previousKey: null, list: { name: 'Priorities' } });

    res = await request(app).patch(`/v1/selection-lists/${listId}`).set(auth()).send({ key: 'prio' });
    expect(res.status).toBe(200);
    evs = await newEvents();
    expect(shape(evs)).toEqual([`${TOPICS.SELECTION_LISTS_LIST_UPDATED}@3`]);
    expect(evs[0].p).toMatchObject({ changedFields: ['key'], previousKey: 'priority', listKey: 'prio' });

    // PATCH that changes nothing -> no event
    res = await request(app).patch(`/v1/selection-lists/${listId}`).set(auth()).send({ name: 'Priorities' });
    expect(res.status).toBe(200);
    expect(await newEvents()).toEqual([]);

    // ---- POST items : item.created@4, @5
    res = await request(app).post(`/v1/selection-lists/${listId}/items`).set(auth()).send({ code: 'LOW', label: 'Low' });
    expect(res.status).toBe(201);
    const low: string = res.body.id;
    evs = await newEvents();
    expect(shape(evs)).toEqual([`${TOPICS.SELECTION_LISTS_ITEM_CREATED}@4`]);
    expect(evs[0].p).toMatchObject({ listKey: 'prio', item: { itemId: low, code: 'LOW', label: 'Low', sortOrder: 100, status: 'active', seed: null } });

    res = await request(app).post(`/v1/selection-lists/${listId}/items`).set(auth()).send({ code: 'HIGH', label: 'High', description: 'Do now' });
    expect(res.status).toBe(201);
    const high: string = res.body.id;
    evs = await newEvents();
    expect(shape(evs)).toEqual([`${TOPICS.SELECTION_LISTS_ITEM_CREATED}@5`]);
    expect(evs[0].p.item).toMatchObject({ code: 'HIGH', sortOrder: 200, description: 'Do now' });

    // ---- PATCH item : label -> item.updated@6 ; restore etc below
    res = await request(app).patch(`/v1/selection-lists/${listId}/items/${low}`).set(auth()).send({ label: 'Lowest' });
    expect(res.status).toBe(200);
    evs = await newEvents();
    expect(shape(evs)).toEqual([`${TOPICS.SELECTION_LISTS_ITEM_UPDATED}@6`]);
    expect(evs[0].p).toMatchObject({ changedFields: ['label'], item: { itemId: low, label: 'Lowest' } });

    // ---- PUT reorder : item.reordered@7 with the full resulting order
    res = await request(app).put(`/v1/selection-lists/${listId}/items/reorder`).set(auth()).send({ item_ids: [high, low] });
    expect(res.status).toBe(200);
    evs = await newEvents();
    expect(shape(evs)).toEqual([`${TOPICS.SELECTION_LISTS_ITEM_REORDERED}@7`]);
    expect(evs[0].p.order).toEqual([
      { itemId: high, code: 'HIGH', sortOrder: 100 },
      { itemId: low, code: 'LOW', sortOrder: 200 },
    ]);

    // ---- item archive (POST /archive) -> item.archived@8 ; a second archive/DELETE is a no-op (no event)
    res = await request(app).post(`/v1/selection-lists/${listId}/items/${low}/archive`).set(auth());
    expect(res.status).toBe(200);
    evs = await newEvents();
    expect(shape(evs)).toEqual([`${TOPICS.SELECTION_LISTS_ITEM_ARCHIVED}@8`]);
    expect(evs[0].p.item).toMatchObject({ itemId: low, status: 'archived' });
    res = await request(app).delete(`/v1/selection-lists/${listId}/items/${low}`).set(auth());
    expect(res.status).toBe(200);
    expect(await newEvents()).toEqual([]);

    // ---- restore via PATCH -> item.updated@9 {status}; DELETE (soft) -> item.archived@10
    res = await request(app).patch(`/v1/selection-lists/${listId}/items/${low}`).set(auth()).send({ status: 'active' });
    expect(res.status).toBe(200);
    evs = await newEvents();
    expect(shape(evs)).toEqual([`${TOPICS.SELECTION_LISTS_ITEM_UPDATED}@9`]);
    expect(evs[0].p.changedFields).toEqual(['status']);
    res = await request(app).delete(`/v1/selection-lists/${listId}/items/${low}`).set(auth());
    expect(res.status).toBe(200);
    expect(shape(await newEvents())).toEqual([`${TOPICS.SELECTION_LISTS_ITEM_ARCHIVED}@10`]);

    // ---- PATCH {status:'archived'} on an item is an archive too (own topic, not updated{status})
    res = await request(app).patch(`/v1/selection-lists/${listId}/items/${high}`).set(auth()).send({ status: 'archived' });
    expect(res.status).toBe(200);
    expect(shape(await newEvents())).toEqual([`${TOPICS.SELECTION_LISTS_ITEM_ARCHIVED}@11`]);
    res = await request(app).patch(`/v1/selection-lists/${listId}/items/${high}`).set(auth()).send({ status: 'active' });
    expect(shape(await newEvents())).toEqual([`${TOPICS.SELECTION_LISTS_ITEM_UPDATED}@12`]);

    // ---- translations (non-source locale): list + item upsert, autofill, deletes
    res = await request(app).put(`/v1/selection-lists/${listId}/translations/fr`).set(auth()).send({ name: 'Priorites' });
    expect(res.status).toBe(200);
    evs = await newEvents();
    expect(shape(evs)).toEqual([`${TOPICS.SELECTION_LISTS_TRANSLATION_UPSERTED}@13`]);
    expect(evs[0].p).toMatchObject({ locale: 'fr', isMachine: false, target: { kind: 'list', name: 'Priorites', description: null } });

    res = await request(app).put(`/v1/selection-lists/${listId}/items/${high}/translations/fr`).set(auth()).send({ label: 'Haute' });
    expect(res.status).toBe(200);
    evs = await newEvents();
    expect(shape(evs)).toEqual([`${TOPICS.SELECTION_LISTS_TRANSLATION_UPSERTED}@14`]);
    expect(evs[0].p).toMatchObject({ locale: 'fr', isMachine: false, target: { kind: 'item', itemId: high, itemCode: 'HIGH', label: 'Haute' } });

    // autofill de: ONE event per written translation (the list + the single ACTIVE item - LOW is archived), each its own revision
    res = await request(app).post(`/v1/selection-lists/${listId}/translations/de/autofill`).set(auth()).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ list_translated: true, items_translated: 1 });
    evs = await newEvents();
    expect(shape(evs)).toEqual([
      `${TOPICS.SELECTION_LISTS_TRANSLATION_UPSERTED}@15`,
      `${TOPICS.SELECTION_LISTS_TRANSLATION_UPSERTED}@16`,
    ]);
    expect(evs.every((e) => e.p.locale === 'de' && e.p.isMachine === true)).toBe(true);
    expect(evs[0].p.target.kind).toBe('list');
    expect(evs.slice(1).map((e) => e.p.target.itemCode)).toEqual(['HIGH']);
    // a second autofill writes nothing -> no events
    res = await request(app).post(`/v1/selection-lists/${listId}/translations/de/autofill`).set(auth()).send({});
    expect(res.body).toMatchObject({ list_translated: false, items_translated: 0 });
    expect(await newEvents()).toEqual([]);

    res = await request(app).delete(`/v1/selection-lists/${listId}/items/${high}/translations/fr`).set(auth());
    expect(res.status).toBe(204);
    evs = await newEvents();
    expect(shape(evs)).toEqual([`${TOPICS.SELECTION_LISTS_TRANSLATION_DELETED}@17`]);
    expect(evs[0].p).toMatchObject({ locale: 'fr', target: { kind: 'item', itemId: high, itemCode: 'HIGH' } });
    res = await request(app).delete(`/v1/selection-lists/${listId}/translations/fr`).set(auth());
    expect(res.status).toBe(204);
    evs = await newEvents();
    expect(shape(evs)).toEqual([`${TOPICS.SELECTION_LISTS_TRANSLATION_DELETED}@18`]);
    expect(evs[0].p.target).toEqual({ kind: 'list' });
    // deleting a translation that is not there is idempotent: 204, no event
    res = await request(app).delete(`/v1/selection-lists/${listId}/translations/fr`).set(auth());
    expect(res.status).toBe(204);
    expect(await newEvents()).toEqual([]);

    // ---- access: grant, role change, repeat (no-op), revoke, repeat (no-op)
    res = await request(app).put(`/v1/selection-lists/${listId}/access/${USER2}`).set(auth()).send({ role: 'list-editor' });
    expect(res.status).toBe(200);
    evs = await newEvents();
    expect(shape(evs)).toEqual([`${TOPICS.SELECTION_LISTS_ACCESS_GRANTED}@-`]);
    expect(evs[0].p).toMatchObject({ listId, listKey: 'prio', userId: USER2, role: 'list-editor', previousRole: null });
    res = await request(app).put(`/v1/selection-lists/${listId}/access/${USER2}`).set(auth()).send({ role: 'list-viewer' });
    expect(res.status).toBe(200);
    evs = await newEvents();
    expect(shape(evs)).toEqual([`${TOPICS.SELECTION_LISTS_ACCESS_GRANTED}@-`]);
    expect(evs[0].p).toMatchObject({ role: 'list-viewer', previousRole: 'list-editor' });
    res = await request(app).put(`/v1/selection-lists/${listId}/access/${USER2}`).set(auth()).send({ role: 'list-viewer' });
    expect(res.status).toBe(200);
    expect(await newEvents()).toEqual([]);
    res = await request(app).delete(`/v1/selection-lists/${listId}/access/${USER2}`).set(auth());
    expect(res.status).toBe(204);
    evs = await newEvents();
    expect(shape(evs)).toEqual([`${TOPICS.SELECTION_LISTS_ACCESS_REVOKED}@-`]);
    expect(evs[0].p).toMatchObject({ userId: USER2, role: 'list-viewer' });
    res = await request(app).delete(`/v1/selection-lists/${listId}/access/${USER2}`).set(auth());
    expect(res.status).toBe(204);
    expect(await newEvents()).toEqual([]);

    // ---- item purge -> item.deleted@19 (no translation events for the cascade)
    res = await request(app).delete(`/v1/selection-lists/${listId}/items/${low}?purge=true`).set(auth());
    expect(res.status).toBe(204);
    evs = await newEvents();
    expect(shape(evs)).toEqual([`${TOPICS.SELECTION_LISTS_ITEM_DELETED}@19`]);
    expect(evs[0].p).toMatchObject({ itemId: low, code: 'LOW' });

    // ---- list lifecycle: archive (POST) @20, no-op DELETE, restore via PATCH @21, soft DELETE @22, purge @23
    res = await request(app).post(`/v1/selection-lists/${listId}/archive`).set(auth());
    expect(res.status).toBe(200);
    evs = await newEvents();
    expect(shape(evs)).toEqual([`${TOPICS.SELECTION_LISTS_LIST_ARCHIVED}@20`]);
    expect(evs[0].p.list.status).toBe('archived');
    res = await request(app).delete(`/v1/selection-lists/${listId}`).set(auth());
    expect(res.status).toBe(200);
    expect(await newEvents()).toEqual([]); // already archived

    res = await request(app).patch(`/v1/selection-lists/${listId}`).set(auth()).send({ status: 'active' });
    expect(res.status).toBe(200);
    evs = await newEvents();
    expect(shape(evs)).toEqual([`${TOPICS.SELECTION_LISTS_LIST_UPDATED}@21`]);
    expect(evs[0].p.changedFields).toEqual(['status']);

    res = await request(app).delete(`/v1/selection-lists/${listId}`).set(auth());
    expect(res.status).toBe(200);
    expect(shape(await newEvents())).toEqual([`${TOPICS.SELECTION_LISTS_LIST_ARCHIVED}@22`]);

    res = await request(app).delete(`/v1/selection-lists/${listId}?purge=true`).set(auth());
    expect(res.status).toBe(204);
    evs = await newEvents();
    expect(shape(evs)).toEqual([`${TOPICS.SELECTION_LISTS_LIST_DELETED}@23`]); // one tombstone, no cascade events
    expect(evs[0].p).toMatchObject({ listId, listKey: 'prio' });
    expect(await db('selection_lists').where({ id: listId }).first()).toBeUndefined();

    // Every row is still pending and strictly ordered; nothing was published (no relay here).
    const all = await db('event_outbox').orderBy('seq');
    expect(all.every((r) => r.status === 'pending' && r.attempts === 0)).toBe(true);
  });

  it('PATCH {status:"archived", name} is list.updated(name) THEN list.archived, in that order, with increasing revisions', async () => {
    let res = await request(app).post('/v1/selection-lists').set(auth()).send({ key: 'combo', name: 'Combo' });
    const id = res.body.id;
    await newEvents();
    res = await request(app).patch(`/v1/selection-lists/${id}`).set(auth()).send({ name: 'Combo 2', status: 'archived' });
    expect(res.status).toBe(200);
    expect(shape(await newEvents())).toEqual([`${TOPICS.SELECTION_LISTS_LIST_UPDATED}@2`, `${TOPICS.SELECTION_LISTS_LIST_ARCHIVED}@3`]);
  });

  describe('events are written only when the mutation succeeds (no event on any failed / refused request)', () => {
    let listId: string;
    beforeAll(async () => {
      const res = await request(app).post('/v1/selection-lists').set(auth()).send({ key: 'guarded', name: 'Guarded' });
      listId = res.body.id;
      await newEvents();
    });

    it('validation failures (400) and missing resources (404) write nothing', async () => {
      const bad = [
        await request(app).post('/v1/selection-lists').set(auth()).send({ key: 'Bad_Key', name: 'x' }),
        await request(app).post('/v1/selection-lists').set(auth()).send({ key: 'ok-key', name: 'x', description: 'd'.repeat(2001) }),
        await request(app).post('/v1/selection-lists').set(auth()).send({ key: 'ok-key', name: 'x', source_locale: 'it' }),
        await request(app).patch(`/v1/selection-lists/${listId}`).set(auth()).send({ key: 'Bad_Key' }),
        await request(app).post(`/v1/selection-lists/${listId}/items`).set(auth()).send({ code: 'has space', label: 'x' }),
        await request(app).put(`/v1/selection-lists/${listId}/translations/fr`).set(auth()).send({ name: 'n'.repeat(201) }),
      ];
      expect(bad.map((r) => r.status)).toEqual([400, 400, 400, 400, 400, 400]);
      const missing = [
        await request(app).patch('/v1/selection-lists/front_sl_doesnotexist').set(auth()).send({ name: 'x' }),
        await request(app).post('/v1/selection-lists/front_sl_doesnotexist/archive').set(auth()),
        await request(app).delete('/v1/selection-lists/front_sl_doesnotexist?purge=true').set(auth()),
        await request(app).put('/v1/selection-lists/front_sl_doesnotexist/translations/fr').set(auth()).send({ name: 'x' }),
        await request(app).post('/v1/selection-lists/front_sl_doesnotexist/items').set(auth()).send({ code: 'A', label: 'a' }),
        await request(app).delete(`/v1/selection-lists/${listId}/items/front_sli_doesnotexist`).set(auth()),
      ];
      expect(missing.map((r) => r.status)).toEqual([404, 404, 404, 404, 404, 404]);
      expect(await newEvents()).toEqual([]);
    });

    it('a conflicting write (409) writes nothing and leaves no half-state', async () => {
      const dup = await request(app).post('/v1/selection-lists').set(auth()).send({ key: 'guarded', name: 'Again' });
      expect(dup.status).toBe(409);
      const other = await request(app).post('/v1/selection-lists').set(auth()).send({ key: 'other-one', name: 'Other' });
      expect(other.status).toBe(201);
      await newEvents();
      const clash = await request(app).patch(`/v1/selection-lists/${other.body.id}`).set(auth()).send({ key: 'guarded' });
      expect(clash.status).toBe(409);
      expect(await newEvents()).toEqual([]);
      // the failed PATCH did not bump the revision either
      expect((await db('selection_lists').where({ id: other.body.id }).first()).revision).toBe('1');
    });

    it('flag OFF: every route answers 404 and writes nothing (the off-path)', async () => {
      setFlagClient({ getBooleanValue: async () => false });
      try {
        const res = [
          await request(app).post('/v1/selection-lists').set(auth()).send({ key: 'flag-off', name: 'x' }),
          await request(app).patch(`/v1/selection-lists/${listId}`).set(auth()).send({ name: 'x' }),
          await request(app).post(`/v1/selection-lists/${listId}/items`).set(auth()).send({ code: 'A', label: 'a' }),
          await request(app).put(`/v1/selection-lists/${listId}/translations/fr`).set(auth()).send({ name: 'x' }),
          await request(app).put(`/v1/selection-lists/${listId}/access/${USER2}`).set(auth()).send({ role: 'list-viewer' }),
          await request(app).delete(`/v1/selection-lists/${listId}?purge=true`).set(auth()),
        ];
        expect(res.map((r) => r.status)).toEqual([404, 404, 404, 404, 404, 404]);
        expect(await newEvents()).toEqual([]);
        expect(await db('selection_lists').where({ key: 'flag-off' }).first()).toBeUndefined();
      } finally {
        setFlagClient({ getBooleanValue: async () => true });
      }
    });

    it('authorization denied (403) writes nothing - authz still comes first; the event layer is not a bypass', async () => {
      process.env.FUZEFRONT_SELECTION_LIST_AUTHZ_ENABLED = 'true';
      const deny = { ...makeNoOpProxy(), check: async () => ({ allow: false }), bulkCheck: async (c: any[]) => c.map(() => ({ allow: false })) };
      _setAuthzClientForTesting(deny as any);
      try {
        const res = [
          await request(app).patch(`/v1/selection-lists/${listId}`).set(auth()).send({ name: 'nope' }),
          await request(app).post('/v1/selection-lists').set(auth()).send({ key: 'denied', name: 'x' }),
          await request(app).delete(`/v1/selection-lists/${listId}?purge=true`).set(auth()),
        ];
        expect(res.map((r) => r.status)).toEqual([403, 403, 403]);
        expect(await newEvents()).toEqual([]);
        expect(await db('selection_lists').where({ id: listId }).first()).toBeDefined();
      } finally {
        delete process.env.FUZEFRONT_SELECTION_LIST_AUTHZ_ENABLED;
        _setAuthzClientForTesting(makeNoOpProxy());
      }
    });

    it('a failure in the Security API grant rolls the new list AND its events back together (atomic create)', async () => {
      const failing = { ...makeNoOpProxy(), grant: async () => { throw new Error('security api down'); } };
      _setAuthzClientForTesting(failing as any);
      try {
        const res = await request(app).post('/v1/selection-lists').set(auth()).send({ key: 'ghost', name: 'Ghost' });
        expect(res.status).toBe(500);
        expect(await newEvents()).toEqual([]);
        expect(await db('selection_lists').where({ key: 'ghost' }).first()).toBeUndefined();
      } finally {
        _setAuthzClientForTesting(makeNoOpProxy());
      }
    });
  });

  it('mixed concurrent mutations across routes (items, patches, access, archive, purge of another list) never deadlock: all of them complete', async () => {
    const mk = async (key: string) => (await request(app).post('/v1/selection-lists').set(auth()).send({ key, name: key })).body.id as string;
    const a = await mk('stress-a');
    const b = await mk('stress-b');
    const seed = await request(app).post(`/v1/selection-lists/${a}/items`).set(auth()).send({ code: 'SEED', label: 'Seed' });
    const seedItem = seed.body.id as string;
    await newEvents();

    const ops: Array<Promise<request.Response>> = [];
    for (let i = 0; i < 6; i++) {
      ops.push(request(app).post(`/v1/selection-lists/${a}/items`).set(auth()).send({ code: `S${i}`, label: `S ${i}` }));
      ops.push(request(app).patch(`/v1/selection-lists/${a}`).set(auth()).send({ name: `Name ${i}` }));
      ops.push(request(app).patch(`/v1/selection-lists/${a}/items/${seedItem}`).set(auth()).send({ label: `Seed ${i}` }));
      ops.push(request(app).put(`/v1/selection-lists/${a}/access/${USER2}`).set(auth()).send({ role: i % 2 ? 'list-viewer' : 'list-editor' }));
      ops.push(request(app).put(`/v1/selection-lists/${a}/translations/fr`).set(auth()).send({ name: `Nom ${i}` }));
      ops.push(request(app).post('/v1/selection-lists').set(auth()).send({ key: `stress-new-${i}`, name: 'new' }));
    }
    // concurrently purge list B while list A is being hammered (org lock first -> no lock-order inversion)
    const purge = request(app).delete(`/v1/selection-lists/${b}?purge=true`).set(auth());
    const results = await Promise.all([...ops, purge]);
    expect(results.slice(0, -1).map((r) => r.status).filter((s) => s >= 500)).toEqual([]);
    expect(results[results.length - 1].status).toBe(204);
    const evs = await newEvents();
    expect(evs.length).toBeGreaterThanOrEqual(ops.length);
    // list A's revisions are unique
    const aRevs = evs.filter((e) => e.p.listId === a && e.rev !== undefined).map((e) => e.rev as number);
    expect(new Set(aRevs).size).toBe(aRevs.length);
  });

  it('concurrent mutations on one list: every request gets its own event and revisions are unique and gap-free', async () => {
    const created = await request(app).post('/v1/selection-lists').set(auth()).send({ key: 'racy', name: 'Racy' });
    const id = created.body.id;
    await newEvents();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => request(app).post(`/v1/selection-lists/${id}/items`).set(auth()).send({ code: `C${i}`, label: `Item ${i}` })),
    );
    expect(results.map((r) => r.status)).toEqual(Array(8).fill(201));
    const evs = await newEvents();
    expect(evs.map((e) => e.topic)).toEqual(Array(8).fill(TOPICS.SELECTION_LISTS_ITEM_CREATED));
    // outbox (commit) order == revision order: no reordering within one list
    expect(evs.map((e) => e.rev)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
