// outbox.db.test.ts - the outbox writer + domain emitters against REAL Postgres
// with the real migrations: atomicity with the data change, per-org write
// serialisation, listRevision monotonicity, and the exact payload each emitter
// builds (every one is validated against its shared Zod schema by enqueueEvent,
// so a successful emit IS a schema-valid payload).

import type { Knex } from 'knex';
import { fromUuid } from '@izzywdev/fuzefront-identity';
import { TOPICS } from '@fuzefront/shared/kafka';
import { createTestDb, dbDescribe, TestDb } from './helpers/testDb';
import {
  OutboxPayloadInvalidError,
  bumpListRevision,
  enqueueEvent,
} from '../src/events/outbox';
import {
  EventContext,
  emitAccessGranted,
  emitAccessRevoked,
  emitItemChanged,
  emitItemCreated,
  emitItemDeleted,
  emitItemReordered,
  emitItemTranslationUpserted,
  emitListChanged,
  emitListCreated,
  emitListDeleted,
  emitListTranslationUpserted,
  emitTranslationDeleted,
  readItem,
  readList,
  systemEventContext,
} from '../src/events/emitters';

const ORG_A = fromUuid('organization', '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7c01');
const ORG_B = fromUuid('organization', '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7c02');
const USER = fromUuid('user', '0195a8f2-aaaa-7a11-8b2d-3f4e5a6b7c01');
const OTHER_USER = fromUuid('user', '0195a8f2-aaaa-7a11-8b2d-3f4e5a6b7c02');

let seqId = 0;
let keyN = 0;
const lid = () => `front_sl_t${(++seqId).toString(36)}${Date.now().toString(36)}`;
const iid = () => `front_sli_t${(++seqId).toString(36)}${Date.now().toString(36)}`;

const ctxFor = (organizationId: string = ORG_A): EventContext => ({
  organizationId,
  actor: { type: 'user', userId: USER },
  correlationId: 'req-test',
});

async function insertList(db: Knex | Knex.Transaction, over: Record<string, unknown> = {}) {
  const id = (over.id as string) ?? lid();
  await db.raw(
    `INSERT INTO selection_lists (id, organization_id, key, source_locale, status, created_by)
     VALUES (?, ?, ?, 'en', 'active', ?)`,
    [id, (over.organization_id as string) ?? ORG_A, (over.key as string) ?? `list-${++keyN}-key`, USER],
  );
  await db.raw(
    `INSERT INTO selection_list_translations (list_id, locale, name, description, is_machine)
     VALUES (?, 'en', ?, ?, false)`,
    [id, (over.name as string) ?? 'Countries', (over.description as string) ?? null],
  );
  return id;
}

async function insertItem(db: Knex | Knex.Transaction, listId: string, code: string, sortOrder = 100) {
  const id = iid();
  await db.raw(`INSERT INTO selection_list_items (id, list_id, code, sort_order, status, created_by) VALUES (?, ?, ?, ?, 'active', ?)`, [
    id, listId, code, sortOrder, USER,
  ]);
  await db.raw(`INSERT INTO selection_list_item_translations (item_id, locale, label, is_machine) VALUES (?, 'en', ?, false)`, [id, `Label ${code}`]);
  return id;
}

const outbox = (db: Knex, org?: string) => {
  const q = db('event_outbox').orderBy('seq');
  return org ? q.where({ organization_id: org }) : q;
};

dbDescribe('outbox writer + emitters on real Postgres', () => {
  let t: TestDb;
  let db: Knex;

  beforeAll(async () => {
    t = await createTestDb();
    db = t.db;
  });
  afterAll(async () => {
    await t.drop();
  });
  beforeEach(async () => {
    await db.raw('TRUNCATE event_outbox, selection_list_access, selection_list_item_translations, selection_list_items, selection_list_translations, selection_lists CASCADE');
  });

  // ------------------------------------------------------------------ atomicity

  describe('atomicity with the data change', () => {
    it('commits the event together with the data', async () => {
      const id = lid();
      await db.transaction(async (trx) => {
        await insertList(trx, { id });
        await emitListCreated(trx, ctxFor(), id);
      });
      const rows = await outbox(db);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ topic: TOPICS.SELECTION_LISTS_LIST_CREATED, organization_id: ORG_A, status: 'pending', attempts: 0, correlation_id: 'req-test' });
      expect(rows[0].payload).toMatchObject({ listId: id, listRevision: 1, organizationId: ORG_A, eventId: rows[0].id });
      expect(await db('selection_lists').where({ id }).first()).toBeTruthy();
    });

    it('rolls the event back with the data when the transaction fails', async () => {
      const id = lid();
      await expect(
        db.transaction(async (trx) => {
          await insertList(trx, { id });
          await emitListCreated(trx, ctxFor(), id);
          throw new Error('boom after the event was enqueued');
        }),
      ).rejects.toThrow('boom');
      expect(await outbox(db)).toHaveLength(0);
      expect(await db('selection_lists').where({ id }).first()).toBeUndefined();
    });

    it('an invalid payload fails the request transaction: the data change is rolled back, nothing is persisted', async () => {
      const id = lid();
      await expect(
        db.transaction(async (trx) => {
          await insertList(trx, { id });
          // a route bug: snapshot violates the frozen contract (key with an underscore)
          await enqueueEvent(trx, {
            topic: TOPICS.SELECTION_LISTS_LIST_CREATED,
            organizationId: ORG_A,
            payload: {
              actor: { type: 'user', userId: USER },
              listId: id,
              listKey: 'ok-key',
              listRevision: 1,
              list: { listId: id, key: 'Bad_Key', sourceLocale: 'en', status: 'active', name: 'x', description: null, seed: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
            },
          });
        }),
      ).rejects.toBeInstanceOf(OutboxPayloadInvalidError);
      expect(await outbox(db)).toHaveLength(0);
      expect(await db('selection_lists').where({ id }).first()).toBeUndefined();
    });

    it('a source-locale change with no text in the new locale still yields a valid event (name falls back like the HTTP read)', async () => {
      const id = await insertList(db, { name: 'Countries' });
      await db.transaction(async (trx) => {
        const before = await readList(trx, id);
        await trx.raw(`UPDATE selection_lists SET source_locale = 'fr' WHERE id = ?`, [id]);
        await emitListChanged(trx, ctxFor(), id, before);
      });
      const [row] = await outbox(db);
      expect(row.payload.changedFields).toEqual(['sourceLocale']);
      expect(row.payload.list).toMatchObject({ sourceLocale: 'fr', name: 'Countries' });
    });
  });

  // ------------------------------------------------------------------ ordering

  describe('per-organization write serialisation', () => {
    it('a second transaction of the SAME org cannot enqueue until the first commits; another org is not blocked', async () => {
      const a = await insertList(db, { organization_id: ORG_A });
      const b = await insertList(db, { organization_id: ORG_A });
      const c = await insertList(db, { organization_id: ORG_B });

      let release!: () => void;
      const hold = new Promise<void>((r) => (release = r));
      let aEnqueued!: () => void;
      const aHasLock = new Promise<void>((r) => (aEnqueued = r));

      const txA = db.transaction(async (trx) => {
        await emitListCreated(trx, ctxFor(ORG_A), a);
        aEnqueued();
        await hold; // keep the txn (and the org lock) open
      });
      await aHasLock;

      let bDone = false;
      const txB = db.transaction(async (trx) => {
        await emitListCreated(trx, ctxFor(ORG_A), b);
      }).then(() => (bDone = true));

      // org B is independent: completes while A still holds org A's lock
      await db.transaction(async (trx) => emitListCreated(trx, ctxFor(ORG_B), c));

      await new Promise((r) => setTimeout(r, 400));
      expect(bDone).toBe(false); // blocked behind A

      release();
      await txA;
      await txB;
      expect(bDone).toBe(true);

      const rowsA = await outbox(db, ORG_A);
      expect(rowsA.map((r) => r.payload.listId)).toEqual([a, b]); // seq order == commit order
      expect(rowsA[0].created_at.getTime()).toBeLessThanOrEqual(rowsA[1].created_at.getTime());
    });

    it('many concurrent same-org writers all land; seq is strictly increasing and created_at never goes backwards', async () => {
      const ids = await Promise.all(Array.from({ length: 12 }, () => insertList(db)));
      await Promise.all(ids.map((id) => db.transaction(async (trx) => emitListCreated(trx, ctxFor(), id))));
      const rows = await outbox(db, ORG_A);
      expect(rows).toHaveLength(12);
      for (let i = 1; i < rows.length; i++) {
        expect(BigInt(rows[i].seq)).toBeGreaterThan(BigInt(rows[i - 1].seq));
        expect(rows[i].created_at.getTime()).toBeGreaterThanOrEqual(rows[i - 1].created_at.getTime());
      }
    });
  });

  // ------------------------------------------------------------------ revision

  describe('listRevision', () => {
    it('list.created carries the row revision (1); every later event bumps it, strictly increasing, one per event', async () => {
      const id = lid();
      await db.transaction(async (trx) => {
        await insertList(trx, { id });
        await emitListCreated(trx, ctxFor(), id);
      });
      const item = await db.transaction(async (trx) => {
        const i = await insertItem(trx, id, 'US');
        await emitItemCreated(trx, ctxFor(), id, i);
        return i;
      });
      await db.transaction(async (trx) => {
        const before = await readItem(trx, item);
        await trx.raw(`UPDATE selection_list_item_translations SET label = 'United States' WHERE item_id = ?`, [item]);
        await emitItemChanged(trx, ctxFor(), id, item, before);
      });
      await db.transaction(async (trx) => {
        await trx.raw(`INSERT INTO selection_list_translations (list_id, locale, name) VALUES (?, 'fr', 'Pays')`, [id]);
        await emitListTranslationUpserted(trx, ctxFor(), id, 'fr');
      });

      const revs = (await outbox(db)).map((r) => r.payload.listRevision);
      expect(revs).toEqual([1, 2, 3, 4]);
      expect((await db('selection_lists').where({ id }).first()).revision).toBe('4');
    });

    it('bumpListRevision on a missing list throws (never silently publishes revision 0)', async () => {
      await expect(db.transaction((trx) => bumpListRevision(trx, ORG_A, 'front_sl_nothere'))).rejects.toThrow(/does not exist/);
    });

    it('access events carry no revision and do not bump it', async () => {
      const id = await insertList(db);
      await db.transaction(async (trx) => {
        await emitAccessGranted(trx, ctxFor(), id, { userId: OTHER_USER, role: 'list-editor', previousRole: null });
        await emitAccessRevoked(trx, ctxFor(), id, { userId: OTHER_USER, role: 'list-editor' });
      });
      const rows = await outbox(db);
      expect(rows.map((r) => r.topic)).toEqual([TOPICS.SELECTION_LISTS_ACCESS_GRANTED, TOPICS.SELECTION_LISTS_ACCESS_REVOKED]);
      expect(rows[0].payload).not.toHaveProperty('listRevision');
      expect((await db('selection_lists').where({ id }).first()).revision).toBe('1');
    });
  });

  // ------------------------------------------------------------------ emitters

  describe('list emitters', () => {
    it('emitListChanged: rename key -> list.updated with changedFields + previousKey (no archived event)', async () => {
      const id = await insertList(db, { key: 'old-key' });
      await db.transaction(async (trx) => {
        const before = await readList(trx, id);
        await trx.raw(`UPDATE selection_lists SET key = 'new-key' WHERE id = ?`, [id]);
        const out = await emitListChanged(trx, ctxFor(), id, before);
        expect(out).toHaveLength(1);
      });
      const [row] = await outbox(db);
      expect(row.topic).toBe(TOPICS.SELECTION_LISTS_LIST_UPDATED);
      expect(row.payload).toMatchObject({ changedFields: ['key'], previousKey: 'old-key', listKey: 'new-key', list: { key: 'new-key' } });
    });

    it('emitListChanged: name + description change -> one list.updated listing both', async () => {
      const id = await insertList(db, { name: 'A', description: 'd1' });
      await db.transaction(async (trx) => {
        const before = await readList(trx, id);
        await trx.raw(`UPDATE selection_list_translations SET name = 'B', description = 'd2' WHERE list_id = ? AND locale = 'en'`, [id]);
        await emitListChanged(trx, ctxFor(), id, before);
      });
      const [row] = await outbox(db);
      expect(row.payload.changedFields.sort()).toEqual(['description', 'name']);
      expect(row.payload.previousKey).toBeNull();
      expect(row.payload.list).toMatchObject({ name: 'B', description: 'd2' });
    });

    it('emitListChanged: active -> archived is list.archived ONLY (never list.updated{status})', async () => {
      const id = await insertList(db);
      await db.transaction(async (trx) => {
        const before = await readList(trx, id);
        await trx.raw(`UPDATE selection_lists SET status = 'archived' WHERE id = ?`, [id]);
        await emitListChanged(trx, ctxFor(), id, before);
      });
      const rows = await outbox(db);
      expect(rows.map((r) => r.topic)).toEqual([TOPICS.SELECTION_LISTS_LIST_ARCHIVED]);
      expect(rows[0].payload.list.status).toBe('archived');
    });

    it('emitListChanged: rename AND archive in one request -> list.updated then list.archived, revisions increasing', async () => {
      const id = await insertList(db, { key: 'before-key' });
      await db.transaction(async (trx) => {
        const before = await readList(trx, id);
        await trx.raw(`UPDATE selection_lists SET key = 'after-key', status = 'archived' WHERE id = ?`, [id]);
        const out = await emitListChanged(trx, ctxFor(), id, before);
        expect(out).toHaveLength(2);
      });
      const rows = await outbox(db);
      expect(rows.map((r) => r.topic)).toEqual([TOPICS.SELECTION_LISTS_LIST_UPDATED, TOPICS.SELECTION_LISTS_LIST_ARCHIVED]);
      expect(rows[0].payload.changedFields).toEqual(['key']);
      expect(rows[1].payload.listRevision).toBeGreaterThan(rows[0].payload.listRevision);
    });

    it('emitListChanged: archived -> active (restore) is list.updated with status in changedFields', async () => {
      const id = await insertList(db);
      await db.raw(`UPDATE selection_lists SET status = 'archived' WHERE id = ?`, [id]);
      await db.transaction(async (trx) => {
        const before = await readList(trx, id);
        await trx.raw(`UPDATE selection_lists SET status = 'active' WHERE id = ?`, [id]);
        await emitListChanged(trx, ctxFor(), id, before);
      });
      const [row] = await outbox(db);
      expect(row.topic).toBe(TOPICS.SELECTION_LISTS_LIST_UPDATED);
      expect(row.payload.changedFields).toEqual(['status']);
    });

    it('emitListChanged: a request that changes nothing (already archived, or same values) emits nothing and does not bump', async () => {
      const id = await insertList(db);
      await db.raw(`UPDATE selection_lists SET status = 'archived' WHERE id = ?`, [id]);
      await db.transaction(async (trx) => {
        const before = await readList(trx, id);
        await trx.raw(`UPDATE selection_lists SET status = 'archived', updated_at = now() WHERE id = ?`, [id]);
        expect(await emitListChanged(trx, ctxFor(), id, before)).toEqual([]);
      });
      expect(await outbox(db)).toHaveLength(0);
      expect((await db('selection_lists').where({ id }).first()).revision).toBe('1');
    });

    it('emitListDeleted: thin tombstone with the bumped revision, emitted before the purge deletes the row', async () => {
      const id = await insertList(db, { key: 'doomed' });
      await db.transaction(async (trx) => {
        await emitListDeleted(trx, ctxFor(), id);
        await trx.raw('DELETE FROM selection_list_translations WHERE list_id = ?', [id]);
        await trx.raw('DELETE FROM selection_lists WHERE id = ?', [id]);
      });
      const [row] = await outbox(db);
      expect(row.topic).toBe(TOPICS.SELECTION_LISTS_LIST_DELETED);
      expect(row.payload).toMatchObject({ listId: id, listKey: 'doomed', listRevision: 2 });
      expect(row.payload).not.toHaveProperty('list');
      expect(await db('selection_lists').where({ id }).first()).toBeUndefined(); // the tombstone outlives the row
    });

    it('seeded rows carry their provenance in the snapshot (seed.userModified included)', async () => {
      const id = await insertList(db, { key: 'platform-prio' });
      await db.raw(
        `UPDATE selection_lists SET seed_source='platform', seed_key='platform-defaults', seed_list_key='platform-prio', seed_version=2, seed_hash='h', seed_user_modified=true WHERE id=?`,
        [id],
      );
      await db.transaction(async (trx) => emitListCreated(trx, systemEventContext(ORG_A, 'platform'), id));
      const [row] = await outbox(db);
      expect(row.payload.list.seed).toEqual({ source: 'platform', packKey: 'platform-defaults', packVersion: 2, userModified: true });
      expect(row.payload.actor).toEqual({ type: 'system', principal: 'selection-list-service', seedSource: 'platform' });
    });

    it('a bare-UUID organization id (identity-event form) is rendered as the org_ TypeID on the wire and as the ordering key', async () => {
      const uuid = '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7c99';
      const id = await insertList(db, { organization_id: uuid });
      await db.transaction(async (trx) => emitListCreated(trx, ctxFor(uuid), id));
      const [row] = await outbox(db);
      expect(row.organization_id).toBe(fromUuid('organization', uuid));
      expect(row.payload.organizationId).toBe(fromUuid('organization', uuid));
    });
  });

  describe('item emitters', () => {
    it('emitItemCreated: full item snapshot, list key + revision', async () => {
      const id = await insertList(db, { key: 'prio' });
      const item = await db.transaction(async (trx) => {
        const i = await insertItem(trx, id, 'HIGH', 300);
        await emitItemCreated(trx, ctxFor(), id, i);
        return i;
      });
      const [row] = await outbox(db);
      expect(row.topic).toBe(TOPICS.SELECTION_LISTS_ITEM_CREATED);
      expect(row.payload).toMatchObject({ listKey: 'prio', listRevision: 2, item: { itemId: item, code: 'HIGH', label: 'Label HIGH', sortOrder: 300, status: 'active', seed: null } });
    });

    it('emitItemChanged: sort_order+label -> item.updated{label,sortOrder}; archive -> item.archived; restore -> updated{status}', async () => {
      const id = await insertList(db);
      const item = await insertItem(db, id, 'A', 100);

      await db.transaction(async (trx) => {
        const before = await readItem(trx, item);
        await trx.raw(`UPDATE selection_list_items SET sort_order = 250 WHERE id = ?`, [item]);
        await trx.raw(`UPDATE selection_list_item_translations SET label = 'Renamed' WHERE item_id = ?`, [item]);
        await emitItemChanged(trx, ctxFor(), id, item, before);
      });
      await db.transaction(async (trx) => {
        const before = await readItem(trx, item);
        await trx.raw(`UPDATE selection_list_items SET status = 'archived' WHERE id = ?`, [item]);
        await emitItemChanged(trx, ctxFor(), id, item, before);
      });
      await db.transaction(async (trx) => {
        const before = await readItem(trx, item);
        await trx.raw(`UPDATE selection_list_items SET status = 'active' WHERE id = ?`, [item]);
        await emitItemChanged(trx, ctxFor(), id, item, before);
      });
      const rows = await outbox(db);
      expect(rows.map((r) => r.topic)).toEqual([
        TOPICS.SELECTION_LISTS_ITEM_UPDATED,
        TOPICS.SELECTION_LISTS_ITEM_ARCHIVED,
        TOPICS.SELECTION_LISTS_ITEM_UPDATED,
      ]);
      expect(rows[0].payload.changedFields.sort()).toEqual(['label', 'sortOrder']);
      expect(rows[1].payload.item.status).toBe('archived');
      expect(rows[2].payload.changedFields).toEqual(['status']);
      expect(rows.map((r) => r.payload.listRevision)).toEqual([2, 3, 4]);
    });

    it('emitItemChanged: no change -> no event', async () => {
      const id = await insertList(db);
      const item = await insertItem(db, id, 'A');
      await db.transaction(async (trx) => {
        const before = await readItem(trx, item);
        expect(await emitItemChanged(trx, ctxFor(), id, item, before)).toEqual([]);
      });
      expect(await outbox(db)).toHaveLength(0);
    });

    it('emitItemDeleted after the row is gone: itemId + code only; no translation events for the cascade', async () => {
      const id = await insertList(db);
      const item = await insertItem(db, id, 'GONE');
      await db.transaction(async (trx) => {
        await trx.raw('DELETE FROM selection_list_item_translations WHERE item_id = ?', [item]);
        await trx.raw('DELETE FROM selection_list_items WHERE id = ?', [item]);
        await emitItemDeleted(trx, ctxFor(), id, { itemId: item, code: 'GONE' });
      });
      const rows = await outbox(db);
      expect(rows).toHaveLength(1);
      expect(rows[0].payload).toMatchObject({ itemId: item, code: 'GONE', listRevision: 2 });
    });

    it('emitItemReordered: the full resulting order of ACTIVE items, sorted by sortOrder', async () => {
      const id = await insertList(db);
      const a = await insertItem(db, id, 'A', 100);
      const b = await insertItem(db, id, 'B', 200);
      const arch = await insertItem(db, id, 'ARCH', 300);
      await db.raw(`UPDATE selection_list_items SET status = 'archived' WHERE id = ?`, [arch]);
      await db.transaction(async (trx) => {
        await trx.raw(`UPDATE selection_list_items SET sort_order = 100 WHERE id = ?`, [b]);
        await trx.raw(`UPDATE selection_list_items SET sort_order = 200 WHERE id = ?`, [a]);
        await emitItemReordered(trx, ctxFor(), id);
      });
      const [row] = await outbox(db);
      expect(row.topic).toBe(TOPICS.SELECTION_LISTS_ITEM_REORDERED);
      expect(row.payload.order).toEqual([
        { itemId: b, code: 'B', sortOrder: 100 },
        { itemId: a, code: 'A', sortOrder: 200 },
      ]);
    });
  });

  describe('translation emitters', () => {
    it('list + item translation.upserted carry the written text and isMachine; translation.deleted both shapes', async () => {
      const id = await insertList(db, { name: 'Countries' });
      const item = await insertItem(db, id, 'US');
      await db.transaction(async (trx) => {
        await trx.raw(`INSERT INTO selection_list_translations (list_id, locale, name, description, is_machine) VALUES (?, 'fr', '[MT] Countries', null, true)`, [id]);
        await emitListTranslationUpserted(trx, ctxFor(), id, 'fr');
        await trx.raw(`INSERT INTO selection_list_item_translations (item_id, locale, label, description, is_machine) VALUES (?, 'fr', 'Etats-Unis', 'desc', false)`, [item]);
        await emitItemTranslationUpserted(trx, ctxFor(), id, item, 'fr');
        await trx.raw(`DELETE FROM selection_list_item_translations WHERE item_id = ? AND locale = 'fr'`, [item]);
        await emitTranslationDeleted(trx, ctxFor(), id, 'fr', { itemId: item, itemCode: 'US' });
        await trx.raw(`DELETE FROM selection_list_translations WHERE list_id = ? AND locale = 'fr'`, [id]);
        await emitTranslationDeleted(trx, ctxFor(), id, 'fr');
      });
      const rows = await outbox(db);
      expect(rows.map((r) => r.topic)).toEqual([
        TOPICS.SELECTION_LISTS_TRANSLATION_UPSERTED,
        TOPICS.SELECTION_LISTS_TRANSLATION_UPSERTED,
        TOPICS.SELECTION_LISTS_TRANSLATION_DELETED,
        TOPICS.SELECTION_LISTS_TRANSLATION_DELETED,
      ]);
      expect(rows[0].payload).toMatchObject({ locale: 'fr', isMachine: true, target: { kind: 'list', name: '[MT] Countries', description: null } });
      expect(rows[1].payload).toMatchObject({ locale: 'fr', isMachine: false, target: { kind: 'item', itemId: item, itemCode: 'US', label: 'Etats-Unis', description: 'desc' } });
      expect(rows[2].payload.target).toEqual({ kind: 'item', itemId: item, itemCode: 'US' });
      expect(rows[3].payload.target).toEqual({ kind: 'list' });
      expect(rows.map((r) => r.payload.listRevision)).toEqual([2, 3, 4, 5]);
    });
  });
});
