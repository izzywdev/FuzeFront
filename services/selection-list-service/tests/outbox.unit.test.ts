// outbox.unit.test.ts - the outbox WRITER (events/outbox.ts) without a database.
//
// A recording fake stands in for the transaction so these tests pin the writer's
// contract: validate-before-insert, topic allow-list, eventId minting, the
// per-org lock being taken first, the wire-id helpers. Atomicity with real data
// changes and ordering are proven against real Postgres in outbox.db.test.ts.

import fs from 'fs';
import path from 'path';
import { TOPICS } from '@fuzefront/shared/kafka';
import {
  OutboxPayloadInvalidError,
  OutboxTopicError,
  PRODUCED_TOPICS,
  WireIdError,
  enqueueEvent,
  mintEventId,
  wireOrgId,
  wireUserId,
} from '../src/events/outbox';

interface FakeTrx {
  (table: string): { insert: (row: Record<string, unknown>) => Promise<void> };
  raw: jest.Mock;
  inserts: Array<{ table: string; row: Record<string, any> }>;
  order: string[];
}

/** The recording fake, typed as the writer's executor (it implements exactly the subset the writer uses). */
function fakeTrx(): FakeTrx & import('../src/events/outbox').OutboxExecutor {
  const order: string[] = [];
  const inserts: Array<{ table: string; row: Record<string, any> }> = [];
  const trx: any = (table: string) => ({
    insert: async (row: Record<string, unknown>) => {
      order.push(`insert:${table}`);
      inserts.push({ table, row });
    },
  });
  trx.raw = jest.fn((sql: string, bindings?: unknown[]) => {
    if (sql.startsWith('SELECT pg_advisory_xact_lock')) order.push('lock');
    return { sql, bindings };
  });
  trx.inserts = inserts;
  trx.order = order;
  return trx as FakeTrx & import('../src/events/outbox').OutboxExecutor;
}

const fixtures: Record<string, Record<string, any>> = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', '..', 'shared', 'tests', 'fixtures', 'selection-lists', 'published-examples.json'), 'utf8'),
);

const ORG = 'org_01h455vb4pex5vsknk084sn02q';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('wire id helpers', () => {
  it('passes a TypeID through and converts a bare UUID to its TypeID', () => {
    expect(wireOrgId(ORG)).toBe(ORG);
    const converted = wireOrgId('0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7c8d');
    expect(converted).toMatch(/^org_[0-9a-z]+$/);
    expect(wireUserId('0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7c8d')).toMatch(/^usr_[0-9a-z]+$/);
  });

  it('refuses anything that is neither (a bug, never silently published)', () => {
    expect(() => wireOrgId('acme')).toThrow(WireIdError);
    expect(() => wireUserId('usr_UPPER')).toThrow(WireIdError);
    expect(() => wireOrgId('usr_01h455vb4pex5vsknk084sn02q')).toThrow(WireIdError);
  });
});

describe('mintEventId', () => {
  it('is a UUIDv7 and unique per call', () => {
    const ids = new Set(Array.from({ length: 200 }, () => mintEventId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(UUID_RE);
  });
});

describe('enqueueEvent', () => {
  it('writes one pending row inside the given trx: eventId == row id, org key, correlation id, locked first', async () => {
    const trx = fakeTrx();
    const { listId, listKey, listRevision, actor, list } = fixtures[TOPICS.SELECTION_LISTS_LIST_CREATED];

    const out = await enqueueEvent(trx, {
      topic: TOPICS.SELECTION_LISTS_LIST_CREATED,
      organizationId: ORG,
      correlationId: 'req-123',
      payload: { actor, listId, listKey, listRevision, list },
    });

    expect(trx.inserts).toHaveLength(1);
    const { table, row } = trx.inserts[0];
    expect(table).toBe('event_outbox');
    expect(row).toMatchObject({
      id: out.eventId,
      organization_id: ORG,
      topic: TOPICS.SELECTION_LISTS_LIST_CREATED,
      correlation_id: 'req-123',
      status: 'pending',
      attempts: 0,
    });
    expect(out.eventId).toMatch(UUID_RE);
    expect(out.payload).toMatchObject({ eventId: out.eventId, organizationId: ORG, listRevision });
    // The per-org lock precedes the insert (writers of one org serialise to commit).
    expect(trx.order).toEqual(['lock', 'insert:event_outbox']);
    // created_at is the INSERT time (clock_timestamp), not the txn start (now()).
    expect(row.created_at).toMatchObject({ sql: 'clock_timestamp()' });
    // payload goes in as an explicit jsonb cast of the validated JSON.
    expect(row.payload).toMatchObject({ sql: '?::jsonb' });
    expect(JSON.parse((row.payload as any).bindings[0])).toEqual(out.payload);
  });

  it('every produced topic accepts its contract example (P2: payloads validate for every topic)', async () => {
    for (const topic of PRODUCED_TOPICS) {
      const example = fixtures[topic];
      expect(example).toBeDefined();
      const { eventId: _e, organizationId, ...rest } = example;
      const trx = fakeTrx();
      const out = await enqueueEvent(trx, { topic, organizationId, payload: rest });
      expect(trx.inserts).toHaveLength(1);
      expect(out.payload.organizationId).toBe(organizationId);
    }
    // 13 change topics + seed.completed + seed.failed; seed.requested is consumed, never produced.
    expect(PRODUCED_TOPICS.size).toBe(15);
    expect(PRODUCED_TOPICS.has(TOPICS.SELECTION_LISTS_SEED_REQUESTED)).toBe(false);
  });

  it('rejects an invalid payload BEFORE touching the table (a bug, not user error)', async () => {
    const trx = fakeTrx();
    const { actor, listId, listKey, list } = fixtures[TOPICS.SELECTION_LISTS_LIST_CREATED];

    await expect(
      enqueueEvent(trx, {
        topic: TOPICS.SELECTION_LISTS_LIST_CREATED,
        organizationId: ORG,
        // listRevision missing + a snapshot with a bad key
        payload: { actor, listId, listKey, list: { ...list, key: 'Bad_Key' } },
      }),
    ).rejects.toBeInstanceOf(OutboxPayloadInvalidError);
    expect(trx.inserts).toHaveLength(0);

    const err = await enqueueEvent(trx, {
      topic: TOPICS.SELECTION_LISTS_LIST_CREATED,
      organizationId: ORG,
      payload: { actor, listId, listKey, list: { ...list, key: 'Bad_Key' } },
    }).catch((e) => e);
    expect(err.code).toBe('OUTBOX_PAYLOAD_INVALID');
    expect(err.issues.join('|')).toMatch(/listRevision/);
    expect(err.issues.join('|')).toMatch(/list\.key/);
  });

  it('enforces cross-field schema rules (archived must carry status archived; previousKey iff key changed)', async () => {
    const archived = fixtures[TOPICS.SELECTION_LISTS_LIST_ARCHIVED];
    const { eventId: _a, organizationId: o1, ...archivedRest } = archived;
    await expect(
      enqueueEvent(fakeTrx(), {
        topic: TOPICS.SELECTION_LISTS_LIST_ARCHIVED,
        organizationId: o1,
        payload: { ...archivedRest, list: { ...archived.list, status: 'active' } },
      }),
    ).rejects.toBeInstanceOf(OutboxPayloadInvalidError);

    const updated = fixtures[TOPICS.SELECTION_LISTS_LIST_UPDATED];
    const { eventId: _u, organizationId: o2, ...updatedRest } = updated;
    await expect(
      enqueueEvent(fakeTrx(), {
        topic: TOPICS.SELECTION_LISTS_LIST_UPDATED,
        organizationId: o2,
        payload: { ...updatedRest, changedFields: ['name'], previousKey: 'oops' },
      }),
    ).rejects.toBeInstanceOf(OutboxPayloadInvalidError);
  });

  it('refuses topics this service does not produce (unknown, or consumed-only seed.requested)', async () => {
    const trx = fakeTrx();
    await expect(enqueueEvent(trx, { topic: 'identity.org.created', organizationId: ORG, payload: {} })).rejects.toBeInstanceOf(OutboxTopicError);
    await expect(
      enqueueEvent(trx, { topic: TOPICS.SELECTION_LISTS_SEED_REQUESTED, organizationId: ORG, payload: {} }),
    ).rejects.toBeInstanceOf(OutboxTopicError);
    expect(trx.inserts).toHaveLength(0);
  });

  it('cannot be tricked into reusing a caller-chosen eventId / organizationId', async () => {
    const trx = fakeTrx();
    const { eventId: _e, organizationId, ...rest } = fixtures[TOPICS.SELECTION_LISTS_LIST_DELETED];
    const out = await enqueueEvent(trx, {
      topic: TOPICS.SELECTION_LISTS_LIST_DELETED,
      organizationId,
      payload: { ...rest, eventId: '00000000-0000-4000-8000-000000000000', organizationId: 'org_attacker' },
    });
    expect(out.eventId).not.toBe('00000000-0000-4000-8000-000000000000');
    expect(out.payload.organizationId).toBe(organizationId);
    expect(trx.inserts[0].row.organization_id).toBe(organizationId);
  });

  it('strips fields the published schema does not know (no accidental data leak into the topic)', async () => {
    const trx = fakeTrx();
    const { eventId: _e, organizationId, ...rest } = fixtures[TOPICS.SELECTION_LISTS_ACCESS_REVOKED];
    const out = await enqueueEvent(trx, {
      topic: TOPICS.SELECTION_LISTS_ACCESS_REVOKED,
      organizationId,
      payload: { ...rest, internalNote: 'secret', token: 'secret' },
    });
    expect(out.payload).not.toHaveProperty('internalNote');
    expect(out.payload).not.toHaveProperty('token');
  });

  it('defaults correlationId to the eventId when there is no request context', async () => {
    const trx = fakeTrx();
    const { eventId: _e, organizationId, ...rest } = fixtures[TOPICS.SELECTION_LISTS_LIST_DELETED];
    const out = await enqueueEvent(trx, { topic: TOPICS.SELECTION_LISTS_LIST_DELETED, organizationId, payload: rest });
    expect(out.correlationId).toBe(out.eventId);
  });
});
