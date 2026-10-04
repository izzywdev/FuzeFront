// outbox.relay.db.test.ts - the per-organization ordered relay on REAL Postgres.
//
// Proves (plan section 6 step 4, test T-O3): an org's later event is never
// published while an earlier one is pending retry; other orgs are not held up;
// bounded retries then DLQ + `failed`; schema-invalid rows park at once; a failed
// DLQ copy never loses an event; two relay instances never double-publish or
// reorder (SKIP LOCKED on the head row); graceful shutdown; fail-safe loop.

import type { Knex } from 'knex';
import { fromUuid } from '@izzywdev/fuzefront-identity';
import { TOPICS } from '@fuzefront/shared/kafka';
import { createTestDb, dbDescribe, TestDb } from './helpers/testDb';
import { enqueueEvent } from '../src/events/outbox';
import {
  OutboxRecord,
  drainOutboxOnce,
  pruneSentOutbox,
  refreshOutboxGauges,
  startOutboxRelay,
} from '../src/events/outboxRelay';
import { registry, outboxFailedGauge, outboxPendingGauge } from '../src/lib/metrics';

const ORG_A = fromUuid('organization', '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7d01');
const ORG_B = fromUuid('organization', '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7d02');
const ORG_C = fromUuid('organization', '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7d03');
const USER = fromUuid('user', '0195a8f2-aaaa-7a11-8b2d-3f4e5a6b7d01');

let n = 0;
/** Enqueue one valid list.deleted event for `org` in its own committed transaction. */
async function seed(db: Knex, org: string, tag?: string): Promise<{ eventId: string; listId: string }> {
  const listId = `front_sl_r${(++n).toString(36)}x`;
  const out = await db.transaction((trx) =>
    enqueueEvent(trx, {
      topic: TOPICS.SELECTION_LISTS_LIST_DELETED,
      organizationId: org,
      correlationId: tag ?? `req-${n}`,
      payload: { actor: { type: 'user', userId: USER }, listId, listKey: 'some-key', listRevision: n },
    }),
  );
  return { eventId: out.eventId, listId };
}

const status = async (db: Knex, id: string) => db('event_outbox').where({ id }).first();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

dbDescribe('outbox relay on real Postgres', () => {
  let t: TestDb;
  let db: Knex;

  beforeAll(async () => {
    t = await createTestDb(12);
    db = t.db;
  });
  afterAll(async () => {
    await t.drop();
  });
  beforeEach(async () => {
    await db.raw('TRUNCATE event_outbox');
  });

  // ------------------------------------------------------------------- basics

  it('publishes pending rows in seq order and marks them sent', async () => {
    const e1 = await seed(db, ORG_A);
    const e2 = await seed(db, ORG_A);
    const e3 = await seed(db, ORG_A);
    const published: OutboxRecord[] = [];

    const r = await drainOutboxOnce({
      db,
      publish: async (rec) => void published.push(rec),
      deadLetter: async () => undefined,
    });

    expect(published.map((p) => p.id)).toEqual([e1.eventId, e2.eventId, e3.eventId]);
    expect(r).toMatchObject({ sent: 3, retried: 0, parked: 0, orgs: 1 });
    for (const e of [e1, e2, e3]) {
      const row = await status(db, e.eventId);
      expect(row).toMatchObject({ status: 'sent', attempts: 1, last_error: null });
      expect(row.sent_at).toBeInstanceOf(Date);
    }
    // the record carries what the publisher needs
    expect(published[0]).toMatchObject({ organizationId: ORG_A, topic: TOPICS.SELECTION_LISTS_LIST_DELETED, attempts: 0 });
    expect(published[0].createdAt).toBeInstanceOf(Date);
    expect((published[0].payload as any).eventId).toBe(e1.eventId);
  });

  it('does nothing (and holds no locks) when the outbox is empty', async () => {
    const publish = jest.fn();
    const r = await drainOutboxOnce({ db, publish, deadLetter: jest.fn() });
    expect(r).toMatchObject({ sent: 0, orgs: 0 });
    expect(publish).not.toHaveBeenCalled();
  });

  // ------------------------------------------------- per-org ordering (T-O3)

  describe('per-organization ordering', () => {
    it('never publishes an org\'s later event past an earlier one that failed; other orgs are unaffected; order resumes on recovery', async () => {
      const a1 = await seed(db, ORG_A);
      const a2 = await seed(db, ORG_A);
      const a3 = await seed(db, ORG_A);
      const b1 = await seed(db, ORG_B);
      const b2 = await seed(db, ORG_B);

      const order: string[] = [];
      let failA1 = true;
      const publish = async (rec: OutboxRecord) => {
        if (rec.id === a1.eventId && failA1) throw new Error('broker unavailable');
        order.push(rec.id);
      };
      const opts = { db, publish, deadLetter: async () => undefined };

      const pass1 = await drainOutboxOnce(opts);
      // org A blocked at its head: a2/a3 NOT published; org B fully published
      expect(order).toEqual([b1.eventId, b2.eventId]);
      expect(pass1).toMatchObject({ sent: 2, retried: 1, parked: 0 });
      expect(await status(db, a1.eventId)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'broker unavailable' });
      expect((await status(db, a2.eventId)).status).toBe('pending');
      expect((await status(db, a2.eventId)).attempts).toBe(0); // never even attempted
      expect((await status(db, a3.eventId)).attempts).toBe(0);

      // still failing: still nothing for A
      await drainOutboxOnce(opts);
      expect(order).toEqual([b1.eventId, b2.eventId]);
      expect((await status(db, a1.eventId)).attempts).toBe(2);

      // recovery: A drains strictly in order a1, a2, a3
      failA1 = false;
      await drainOutboxOnce(opts);
      expect(order).toEqual([b1.eventId, b2.eventId, a1.eventId, a2.eventId, a3.eventId]);
      expect((await status(db, a3.eventId)).status).toBe('sent');
    });

    it('a row appended while an earlier one waits is still published after it (insertion order is commit order)', async () => {
      const a1 = await seed(db, ORG_A);
      let fail = true;
      const order: string[] = [];
      const opts = {
        db,
        publish: async (rec: OutboxRecord) => {
          if (fail) throw new Error('down');
          order.push(rec.id);
        },
        deadLetter: async () => undefined,
      };
      await drainOutboxOnce(opts);
      const a2 = await seed(db, ORG_A);
      await drainOutboxOnce(opts);
      fail = false;
      await drainOutboxOnce(opts);
      expect(order).toEqual([a1.eventId, a2.eventId]);
    });
  });

  // --------------------------------------------------------- retry / DLQ

  describe('bounded retries, parking and the DLQ', () => {
    it('after 10 failed attempts the row is copied to the DLQ and marked failed; the org then continues', async () => {
      const bad = await seed(db, ORG_A);
      const next = await seed(db, ORG_A);
      const dead: Array<{ rec: OutboxRecord; reason: string }> = [];
      const published: string[] = [];
      const opts = {
        db,
        publish: async (rec: OutboxRecord) => {
          if (rec.id === bad.eventId) throw new Error('poison');
          published.push(rec.id);
        },
        deadLetter: async (rec: OutboxRecord, reason: string) => void dead.push({ rec, reason }),
      };

      for (let i = 1; i <= 9; i++) {
        const r = await drainOutboxOnce(opts);
        expect(r).toMatchObject({ retried: 1, parked: 0 });
        expect(await status(db, bad.eventId)).toMatchObject({ status: 'pending', attempts: i });
        expect(published).toEqual([]); // the org stays blocked the whole time
        expect(dead).toHaveLength(0);
      }

      const tenth = await drainOutboxOnce(opts);
      expect(tenth).toMatchObject({ parked: 1, sent: 1 }); // parked, then the NEXT row went out in the same pass
      expect(await status(db, bad.eventId)).toMatchObject({ status: 'failed', attempts: 10, last_error: 'poison' });
      expect(dead).toHaveLength(1);
      expect(dead[0].rec.id).toBe(bad.eventId);
      expect(dead[0].reason).toMatch(/^max_attempts: poison/);
      expect(published).toEqual([next.eventId]);

      // a failed row is never retried
      const again = await drainOutboxOnce(opts);
      expect(again).toMatchObject({ sent: 0, parked: 0 });
      expect(dead).toHaveLength(1);
    });

    it('a schema-invalid row is parked immediately (a bug; retrying cannot help) and never published', async () => {
      const bad = await seed(db, ORG_A);
      const good = await seed(db, ORG_A);
      // corrupt the stored payload (drift): listRevision no longer a positive integer
      await db.raw(`UPDATE event_outbox SET payload = jsonb_set(payload, '{listRevision}', '"x"') WHERE id = ?`, [bad.eventId]);
      const published: string[] = [];
      const dead: string[] = [];
      const r = await drainOutboxOnce({
        db,
        publish: async (rec) => void published.push(rec.id),
        deadLetter: async (rec, reason) => void dead.push(`${rec.id}|${reason}`),
      });
      expect(r).toMatchObject({ parked: 1, sent: 1 });
      expect(published).toEqual([good.eventId]);
      expect(dead[0]).toMatch(new RegExp(`^${bad.eventId}\\|schema_invalid: payload invalid: listRevision`));
      expect(await status(db, bad.eventId)).toMatchObject({ status: 'failed', attempts: 1 });
      expect((await status(db, bad.eventId)).last_error).toMatch(/payload invalid/);
    });

    it('a FAILED DLQ copy never loses the event: the row stays pending (org blocked) and only the DLQ copy is retried', async () => {
      const bad = await seed(db, ORG_A);
      const next = await seed(db, ORG_A);
      let dlqUp = false;
      const publishCalls: string[] = [];
      const dead: string[] = [];
      const opts = {
        db,
        maxAttempts: 3,
        publish: async (rec: OutboxRecord) => {
          publishCalls.push(rec.id);
          if (rec.id === bad.eventId) throw new Error('poison');
        },
        deadLetter: async (rec: OutboxRecord) => {
          if (!dlqUp) throw new Error('dlq down');
          dead.push(rec.id);
        },
      };

      await drainOutboxOnce(opts); // attempt 1
      await drainOutboxOnce(opts); // attempt 2
      const third = await drainOutboxOnce(opts); // attempt 3 -> park -> DLQ down
      expect(third).toMatchObject({ parked: 0, deadLetterFailed: 1, sent: 0 });
      expect(await status(db, bad.eventId)).toMatchObject({ status: 'pending', attempts: 3 });
      expect((await status(db, bad.eventId)).last_error).toMatch(/dlq copy failed: dlq down/);
      expect((await status(db, next.eventId)).status).toBe('pending'); // blocked behind it

      const publishesSoFar = publishCalls.length;
      dlqUp = true;
      const recovered = await drainOutboxOnce(opts);
      expect(recovered).toMatchObject({ parked: 1, sent: 1 });
      expect(dead).toEqual([bad.eventId]);
      expect(await status(db, bad.eventId)).toMatchObject({ status: 'failed' });
      // the poison event was NOT published again; only `next` was
      expect(publishCalls.slice(publishesSoFar)).toEqual([next.eventId]);
    });
  });

  // -------------------------------------------------- SKIP LOCKED, 2 instances

  describe('two relay instances (FOR UPDATE SKIP LOCKED on the org head)', () => {
    it('instance B skips an org instance A is mid-publish on - it cannot publish that org\'s later rows - but works the other orgs', async () => {
      const a1 = await seed(db, ORG_A);
      const a2 = await seed(db, ORG_A);
      const b1 = await seed(db, ORG_B);

      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let aStarted!: () => void;
      const started = new Promise<void>((r) => (aStarted = r));
      const publishedByA: string[] = [];
      const publishedByB: string[] = [];

      const drainA = drainOutboxOnce({
        db,
        maxOrgsPerPass: 1, // A takes only the oldest org (ORG_A)
        publish: async (rec) => {
          if (rec.id === a1.eventId) {
            aStarted();
            await gate; // A is mid-publish of a1 and holds the org A head lock
          }
          publishedByA.push(rec.id);
        },
        deadLetter: async () => undefined,
      });
      await started;

      const rB = await drainOutboxOnce({
        db,
        publish: async (rec) => void publishedByB.push(rec.id),
        deadLetter: async () => undefined,
      });
      expect(publishedByB).toEqual([b1.eventId]); // only the other org
      expect(rB.orgs).toBe(1);
      expect((await status(db, a2.eventId)).status).toBe('pending'); // NOT published out from under A

      release();
      await drainA;
      expect(publishedByA).toEqual([a1.eventId, a2.eventId]); // A finishes its org in order
    });

    it('two relays draining concurrently publish every event exactly once, in per-org order, never two at once for one org', async () => {
      const orgs = [ORG_A, ORG_B, ORG_C];
      const expected: Record<string, string[]> = {};
      for (let round = 0; round < 8; round++) {
        for (const org of orgs) {
          const e = await seed(db, org);
          (expected[org] ??= []).push(e.eventId);
        }
      }

      const publishedOrder: Record<string, string[]> = {};
      const inFlight = new Set<string>();
      let overlap = false;
      const counts: Record<string, number> = {};
      const mkPublish = (who: string) => async (rec: OutboxRecord) => {
        if (inFlight.has(rec.organizationId)) overlap = true; // two relays inside one org at once
        inFlight.add(rec.organizationId);
        await sleep(8);
        (publishedOrder[rec.organizationId] ??= []).push(rec.id);
        counts[who] = (counts[who] ?? 0) + 1;
        inFlight.delete(rec.organizationId);
      };

      const loop = async (who: string) => {
        for (let i = 0; i < 40; i++) {
          // batchSize 3 forces many claim rounds so the instances really interleave
          const r = await drainOutboxOnce({ db, batchSize: 3, publish: mkPublish(who), deadLetter: async () => undefined });
          if (r.orgs === 0 && (await db('event_outbox').where({ status: 'pending' }).count({ c: '*' }).first()).c === '0') break;
          await sleep(2);
        }
      };
      await Promise.all([loop('A'), loop('B')]);

      expect(overlap).toBe(false);
      for (const org of orgs) expect(publishedOrder[org]).toEqual(expected[org]); // exactly once, in order
      const sentRows = await db('event_outbox').where({ status: 'sent' });
      expect(sentRows).toHaveLength(24);
      expect(sentRows.every((r) => r.attempts === 1)).toBe(true);
      expect(Object.keys(counts).length).toBeGreaterThanOrEqual(1);
    });
  });

  // ------------------------------------------------------------- shutdown

  describe('lifecycle', () => {
    it('stop() waits for the in-flight pass, then nothing more is published', async () => {
      const first = await seed(db, ORG_A);
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let inPublish!: () => void;
      const entered = new Promise<void>((r) => (inPublish = r));
      const published: string[] = [];

      const relay = startOutboxRelay({
        db,
        intervalMs: 5,
        sentRetentionHours: 0,
        publish: async (rec) => {
          inPublish();
          await gate;
          published.push(rec.id);
        },
        deadLetter: async () => undefined,
      });
      await entered;

      let stopped = false;
      const stopping = relay.stop().then(() => (stopped = true));
      await sleep(100);
      expect(stopped).toBe(false); // still waiting on the in-flight publish

      release();
      await stopping;
      expect(published).toEqual([first.eventId]);
      expect((await status(db, first.eventId)).status).toBe('sent');

      // after stop: new rows are NOT picked up
      const late = await seed(db, ORG_A);
      await sleep(80);
      expect((await status(db, late.eventId)).status).toBe('pending');
    });

    it('stop() while idle resolves immediately and a stopped relay never schedules again', async () => {
      const relay = startOutboxRelay({ db, intervalMs: 5, sentRetentionHours: 0, publish: async () => undefined, deadLetter: async () => undefined });
      await relay.stop();
      const e = await seed(db, ORG_A);
      await sleep(60);
      expect((await status(db, e.eventId)).status).toBe('pending');
    });

    it('shouldStop between rows leaves the rest pending (nothing lost, nothing out of order)', async () => {
      const e1 = await seed(db, ORG_A);
      const e2 = await seed(db, ORG_A);
      const e3 = await seed(db, ORG_A);
      let stop = false;
      const published: string[] = [];
      await drainOutboxOnce({
        db,
        shouldStop: () => stop,
        publish: async (rec) => {
          published.push(rec.id);
          stop = true; // shutdown arrives after the first row
        },
        deadLetter: async () => undefined,
      });
      expect(published).toEqual([e1.eventId]);
      expect((await status(db, e1.eventId)).status).toBe('sent');
      expect((await status(db, e2.eventId)).status).toBe('pending');
      expect((await status(db, e3.eventId)).status).toBe('pending');
    });

    it('is fail-safe: a DB/transaction failure inside a pass is contained (no throw, no unhandled rejection) and retried', async () => {
      let calls = 0;
      const brokenDb: any = {
        transaction: async () => {
          calls++;
          throw new Error('connection terminated');
        },
        raw: async () => {
          throw new Error('connection terminated');
        },
      };
      const unhandled = jest.fn();
      process.on('unhandledRejection', unhandled);
      const relay = startOutboxRelay({ db: brokenDb, intervalMs: 5, maxBackoffMs: 20, sentRetentionHours: 0, publish: async () => undefined, deadLetter: async () => undefined });
      await sleep(250);
      await relay.stop();
      process.off('unhandledRejection', unhandled);
      expect(calls).toBeGreaterThan(1); // kept retrying
      expect(unhandled).not.toHaveBeenCalled();
    });

    it('backs off while publishing fails instead of hammering the broker', async () => {
      await seed(db, ORG_A);
      let calls = 0;
      const relay = startOutboxRelay({
        db,
        intervalMs: 20,
        maxBackoffMs: 1000,
        sentRetentionHours: 0,
        publish: async () => {
          calls++;
          throw new Error('down');
        },
        deadLetter: async () => undefined,
      });
      await sleep(500);
      await relay.stop();
      // Without backoff a 20ms interval would attempt ~25 times; exponential backoff (40,80,160,...) ~4.
      expect(calls).toBeGreaterThanOrEqual(2);
      expect(calls).toBeLessThanOrEqual(7);
    });
  });

  // ---------------------------------------------------- housekeeping / metrics

  describe('housekeeping and metrics', () => {
    it('prunes only sent rows older than the retention window', async () => {
      const old = await seed(db, ORG_A);
      const recent = await seed(db, ORG_A);
      const pending = await seed(db, ORG_A);
      await db.raw(`UPDATE event_outbox SET status='sent', sent_at = now() - interval '10 days' WHERE id = ?`, [old.eventId]);
      await db.raw(`UPDATE event_outbox SET status='sent', sent_at = now() - interval '1 hour' WHERE id = ?`, [recent.eventId]);
      expect(await pruneSentOutbox(db, 24 * 7)).toBe(1);
      expect(await status(db, old.eventId)).toBeUndefined();
      expect(await status(db, recent.eventId)).toBeDefined();
      expect(await status(db, pending.eventId)).toBeDefined();
    });

    it('exposes pending / failed gauges and published / parked counters in the shared prom registry', async () => {
      await seed(db, ORG_A);
      await seed(db, ORG_A);
      const bad = await seed(db, ORG_B);
      await db.raw(`UPDATE event_outbox SET status='failed', attempts=10 WHERE id = ?`, [bad.eventId]);
      await refreshOutboxGauges(db);
      expect((await outboxPendingGauge.get()).values[0].value).toBe(2);
      expect((await outboxFailedGauge.get()).values[0].value).toBe(1);

      await drainOutboxOnce({ db, publish: async () => undefined, deadLetter: async () => undefined });
      const text = await registry.metrics();
      expect(text).toMatch(/selection_list_outbox_published_total\{[^}]*topic="selection-lists\.list\.deleted"[^}]*\} [1-9]/);
      expect(text).toContain('selection_list_outbox_parked_total');
      expect(text).toContain('selection_list_outbox_oldest_pending_age_seconds');
    });
  });
});
