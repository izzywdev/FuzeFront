/**
 * Delivery guarantees of the outbox relay — docs/planning/selection-lists-events.md §6 and the
 * plan's ordering/delivery tests O1-O3. Kafka-free: the relay (`dist/events/outboxRelay.js`) takes
 * its transport as two injected functions, so the suite supplies fakes and drives real outbox rows
 * (created through the real HTTP API) against the real Postgres.
 *
 *   O1  published with key = organizationId (the partition key), envelope version "1.0"
 *   O2  10 failed attempts -> parked (`failed`) and copied to `<topic>.dlq`; a parked row does not
 *       block the org's later rows; a schema-invalid row is parked at once
 *   O3  per-org order is preserved across a transient failure: row N+1 is never published while
 *       row N of the same org is pending retry
 *
 * The relay claims every org's head row, so the fakes only fail for THIS file's org and pass the
 * rest through (marking other test files' rows `sent` is harmless: they assert on topics/payloads).
 */
import { mintTestToken } from '../helpers/auth';
import { rawFetch } from '../helpers/client';
import { closeDb, dbQuery } from '../helpers/db';
import { allEvents, payloadErrors, TOPICS } from '../helpers/outbox';
import { newOrg, newUser, newUuid } from '../helpers/seed-harness';

import { drainOutboxOnce } from '../../../services/selection-list-service/dist/events/outboxRelay';
import { makeOutboxPublisher } from '../../../services/selection-list-service/dist/events/outboxPublisher';
import { db } from '../../../services/selection-list-service/dist/db';

afterAll(async () => {
  await db.destroy();
  await closeDb();
});

/** The relay claims the head row of up to this many orgs per pass; the shared test DB holds many orgs' rows. */
const ALL_ORGS = 1_000_000;

type Rec = { id: string; seq: string; organizationId: string; topic: string; payload: any; attempts: number };

/** An org with three outbox rows: list.created, access.granted, item.created. */
async function orgWithEvents() {
  const org = newOrg();
  const user = newUser();
  const tok = mintTestToken({ userId: user.wire, organizationId: org.wire });
  const list = await rawFetch('/v1/selection-lists', { method: 'POST', token: tok, body: JSON.stringify({ key: `relay-${newUuid().slice(0, 8)}`, name: 'Relay' }) });
  expect(list.status).toBe(201);
  const item = await rawFetch(`/v1/selection-lists/${(list.body as { id: string }).id}/items`, { method: 'POST', token: tok, body: JSON.stringify({ code: 'R1', label: 'R1' }) });
  expect(item.status).toBe(201);
  const rows = await allEvents(org.wire);
  expect(rows.map((r) => r.topic)).toEqual([TOPICS.SELECTION_LISTS_LIST_CREATED, TOPICS.SELECTION_LISTS_ACCESS_GRANTED, TOPICS.SELECTION_LISTS_ITEM_CREATED]);
  return { org, rows };
}

const statusOf = async (orgWire: string) => (await dbQuery('SELECT id, seq::text, status, attempts FROM event_outbox WHERE organization_id = $1 ORDER BY seq', [orgWire]));

describe('O1: the relay publishes with key = organizationId, in the versioned envelope', () => {
  it('hands the real publisher a producer call keyed by the org, carrying a schema-valid payload', async () => {
    const { org, rows } = await orgWithEvents();
    const sends: Array<{ topic: string; event: any; key?: string }> = [];
    const producer = {
      send: async (topic: string, event: any, _schema: unknown, options?: { key?: string }) => {
        sends.push({ topic, event, key: options?.key });
      },
      raw: { send: async () => undefined },
      disconnect: async () => undefined,
    };
    const publisher = makeOutboxPublisher(async () => producer as never);
    await drainOutboxOnce({ db, maxOrgsPerPass: ALL_ORGS, publish: publisher.publish, deadLetter: publisher.deadLetter });

    const mine = sends.filter((s) => s.event.payload.organizationId === org.wire);
    expect(mine.map((s) => s.topic)).toEqual(rows.map((r) => r.topic)); // same order as seq
    for (const s of mine) {
      expect(s.key).toBe(org.wire);
      expect(s.event.version).toBe('1.0');
      expect(s.event.topic).toBe(s.topic);
      expect(payloadErrors(s.topic, s.event.payload)).toEqual([]);
      expect(new Date(s.event.occurredAt).toString()).not.toBe('Invalid Date');
    }
    expect((await statusOf(org.wire)).map((r) => r.status)).toEqual(['sent', 'sent', 'sent']);
  });
});

describe('O3: per-org ordering across a transient publish failure', () => {
  it('row N+1 is not published while row N is pending retry; after recovery everything flows in seq order', async () => {
    const { org, rows } = await orgWithEvents();
    const published: Rec[] = [];
    let failFirst = true;
    const publish = async (r: Rec) => {
      if (r.organizationId !== org.wire) return;
      if (failFirst && r.id === rows[0].id) throw new Error('broker unavailable');
      published.push(r);
    };
    const deadLetter = jest.fn().mockResolvedValue(undefined);

    const pass1 = await drainOutboxOnce({ db, maxOrgsPerPass: ALL_ORGS, publish: publish as never, deadLetter });
    expect(pass1.retried).toBeGreaterThanOrEqual(1);
    expect(published).toEqual([]); // rows 2 and 3 of THIS org waited behind row 1
    let st = await statusOf(org.wire);
    expect(st.map((r) => r.status)).toEqual(['pending', 'pending', 'pending']);
    expect(st[0].attempts).toBe(1);
    expect(st[1].attempts).toBe(0);

    failFirst = false;
    await drainOutboxOnce({ db, maxOrgsPerPass: ALL_ORGS, publish: publish as never, deadLetter });
    expect(published.map((r) => r.id)).toEqual(rows.map((r) => r.id)); // strictly in seq order
    st = await statusOf(org.wire);
    expect(st.map((r) => r.status)).toEqual(['sent', 'sent', 'sent']);
    expect(deadLetter).not.toHaveBeenCalled();
  });

  it('a failing org does not block other orgs (head-of-line blocking is per org)', async () => {
    const bad = await orgWithEvents();
    const good = await orgWithEvents();
    const publish = async (r: Rec) => {
      if (r.organizationId === bad.org.wire) throw new Error('poison for one org');
    };
    await drainOutboxOnce({ db, maxOrgsPerPass: ALL_ORGS, publish: publish as never, deadLetter: jest.fn().mockResolvedValue(undefined) as never });
    expect((await statusOf(good.org.wire)).map((r) => r.status)).toEqual(['sent', 'sent', 'sent']);
    expect((await statusOf(bad.org.wire)).map((r) => r.status)).toEqual(['pending', 'pending', 'pending']);
    // drain the bad org so its rows do not stay pending forever for other runs
    await drainOutboxOnce({ db, maxOrgsPerPass: ALL_ORGS, publish: (async () => undefined) as never, deadLetter: jest.fn() as never });
  });
});

describe('O2: ten failures park the row, copy it to <topic>.dlq, and unblock the org', () => {
  it('stays pending through attempt 9, is parked on the 10th; later rows then flow', async () => {
    const { org, rows } = await orgWithEvents();
    const deadLettered: Array<{ topic: string; id: string; reason: string }> = [];
    const publishedAfter: string[] = [];
    const publish = async (r: Rec) => {
      if (r.organizationId !== org.wire) return;
      if (r.id === rows[0].id) throw new Error('permanently broken');
      publishedAfter.push(r.id);
    };
    const deadLetter = async (r: Rec, reason: string) => {
      if (r.organizationId === org.wire) deadLettered.push({ topic: r.topic, id: r.id, reason });
    };
    for (let pass = 1; pass <= 9; pass++) {
      await drainOutboxOnce({ db, maxOrgsPerPass: ALL_ORGS, publish: publish as never, deadLetter: deadLetter as never });
    }
    let st = await statusOf(org.wire);
    expect(st[0]).toMatchObject({ status: 'pending', attempts: 9 });
    expect(deadLettered).toEqual([]);
    expect(publishedAfter).toEqual([]); // still head-of-line blocked

    await drainOutboxOnce({ db, maxOrgsPerPass: ALL_ORGS, publish: publish as never, deadLetter: deadLetter as never });
    st = await statusOf(org.wire);
    expect(st[0]).toMatchObject({ status: 'failed', attempts: 10 });
    expect(deadLettered).toHaveLength(1);
    expect(deadLettered[0]).toMatchObject({ id: rows[0].id, topic: TOPICS.SELECTION_LISTS_LIST_CREATED });

    // a parked row no longer blocks its org: the next pass (or the same one) delivers the rest
    await drainOutboxOnce({ db, maxOrgsPerPass: ALL_ORGS, publish: publish as never, deadLetter: deadLetter as never });
    expect(publishedAfter).toEqual([rows[1].id, rows[2].id]);
    expect((await statusOf(org.wire)).map((r) => r.status)).toEqual(['failed', 'sent', 'sent']);
  });

  it('the real publisher dead-letters to the .dlq topic keyed by org, with eventId/attempts/payload', async () => {
    const { org, rows } = await orgWithEvents();
    const raw: Array<{ topic: string; messages: Array<{ key?: string; value: string }> }> = [];
    const producer = {
      send: async (_t: string, event: any) => {
        if (event.payload.organizationId === org.wire && event.payload.eventId === rows[0].id) throw new Error('down');
      },
      raw: { send: async (p: any) => void raw.push(p) },
      disconnect: async () => undefined,
    };
    const publisher = makeOutboxPublisher(async () => producer as never);
    for (let i = 0; i < 10; i++) await drainOutboxOnce({ db, maxOrgsPerPass: ALL_ORGS, publish: publisher.publish, deadLetter: publisher.deadLetter });
    const mine = raw.filter((r) => r.messages[0].key === org.wire);
    expect(mine).toHaveLength(1);
    expect(mine[0].topic).toBe(`${TOPICS.SELECTION_LISTS_LIST_CREATED}.dlq`);
    const body = JSON.parse(mine[0].messages[0].value);
    expect(body.raw).toMatchObject({ eventId: rows[0].id, topic: TOPICS.SELECTION_LISTS_LIST_CREATED, organizationId: org.wire });
    // OBSERVATION (reported, not a frozen-contract violation): the DLQ copy reports the attempts made
    // BEFORE the final one (9), while event_outbox.attempts says 10. The plan fixes neither number for
    // the DLQ body, so only the lower bound is asserted.
    expect(body.raw.attempts).toBeGreaterThanOrEqual(9);
    expect(body.reason).toBeTruthy();
    expect(body.raw.payload).toEqual(rows[0].payload);
  });

  it('a schema-invalid row is a producer bug: parked at once (no retries), dead-lettered, never published', async () => {
    const org = newOrg();
    const id = newUuid();
    await dbQuery(
      `INSERT INTO event_outbox (id, organization_id, topic, payload, correlation_id, status, attempts)
       VALUES ($1, $2, $3, $4::jsonb, 'sl7-bad', 'pending', 0)`,
      [id, org.wire, TOPICS.SELECTION_LISTS_LIST_CREATED, JSON.stringify({ eventId: id, organizationId: org.wire, nonsense: true })],
    );
    const published: string[] = [];
    const dead: string[] = [];
    await drainOutboxOnce({
      db,
      publish: (async (r: Rec) => void (r.organizationId === org.wire && published.push(r.id))) as never,
      deadLetter: (async (r: Rec) => void (r.organizationId === org.wire && dead.push(r.id))) as never,
    });
    expect(published).toEqual([]);
    expect(dead).toEqual([id]);
    expect((await statusOf(org.wire))[0]).toMatchObject({ status: 'failed' });
  });
});
