// events.org-updated.db.test.ts - the `identity.org.updated` consumer (docs/planning/selection-lists-events.md 13.0.5).
//
// REAL: Postgres + the real migrations, the real TypedConsumer (fake KafkaJS client, no broker), the
// real handlers. Flags are deliberately left UNSET (no client): the consumer must be flag-independent.

import type { Knex } from 'knex';
import { fromUuid } from '@izzywdev/fuzefront-identity';
import { createTestDb, dbDescribe, TestDb } from './helpers/testDb';

const state: { db: Knex | undefined } = { db: undefined };
jest.mock('../src/db', () => ({
  get db() {
    return state.db;
  },
}));

type EachMessage = (m: { topic: string; message: { value: Buffer | null } }) => Promise<void>;
const runners: Record<string, EachMessage> = {};
const groups: Record<string, string> = {};
const dlqSend = jest.fn().mockResolvedValue(undefined);
function fakeKafka() {
  return {
    consumer: (cfg: { groupId: string }) => {
      let topic = '';
      return {
        connect: jest.fn().mockResolvedValue(undefined),
        subscribe: jest.fn(async (s: { topic: string }) => {
          topic = s.topic;
          groups[topic] = cfg.groupId;
        }),
        run: jest.fn(async ({ eachMessage }: { eachMessage: EachMessage }) => {
          runners[topic] = eachMessage;
        }),
        disconnect: jest.fn().mockResolvedValue(undefined),
      };
    },
    producer: () => ({ connect: jest.fn().mockResolvedValue(undefined), send: dlqSend, disconnect: jest.fn().mockResolvedValue(undefined) }),
  };
}
jest.mock('@fuzefront/shared/kafka', () => {
  const actual = jest.requireActual('@fuzefront/shared/kafka');
  return { ...actual, createKafkaClient: () => fakeKafka() };
});

import { startLifecycleConsumers } from '../src/events/consumer';
import { handleOrgUpdated } from '../src/events/org-updated.handler';
import { setFlagClient } from '../src/flags';

const U1 = '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7c01';
const U2 = '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7c02';
const U3 = '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7c03';
const OWNER = '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b0bb1';

const env = (topic: 'identity.org.created' | 'identity.org.updated', uuid: string, occurredAt: string, over: Record<string, unknown> = {}) => ({
  version: '1.0',
  topic,
  correlationId: `corr-${topic}`,
  occurredAt,
  payload: { organizationId: uuid, slug: 'acme', name: 'Acme', type: 'organization', parentId: null, ownerId: OWNER, isActive: true, ...over },
});
const msg = (v: unknown) => ({ message: { value: Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)) } });

dbDescribe('identity.org.updated consumer (real Postgres, real TypedConsumer)', () => {
  let t: TestDb;
  let db: Knex;
  const deliver = (topic: string, v: unknown) => runners[topic]({ topic, ...msg(v) });
  const created = (uuid: string, at: string, over: Record<string, unknown> = {}) => deliver('identity.org.created', env('identity.org.created', uuid, at, over));
  const updated = (uuid: string, at: string, over: Record<string, unknown> = {}) => deliver('identity.org.updated', env('identity.org.updated', uuid, at, over));
  const proj = (uuid: string) => db('selection_list_ref_index').where({ entity_type: 'organization', entity_id: uuid }).first();

  beforeAll(async () => {
    t = await createTestDb();
    db = t.db;
    state.db = db;
    setFlagClient({ getBooleanValue: async () => false }); // every flag OFF: the projection must still be maintained
    await startLifecycleConsumers();
  });
  afterAll(async () => {
    setFlagClient(null);
    await t.drop();
  });
  beforeEach(() => dlqSend.mockClear());

  it('subscribes identity.org.updated in its OWN consumer group', () => {
    expect(groups['identity.org.updated']).toMatch(/-org-updated$/);
    expect(groups['identity.org.updated']).not.toBe(groups['identity.org.created']);
  });

  it('refreshes is_active, type and name from the payload (flag-independent) and never seeds', async () => {
    await created(U1, '2026-10-04T00:00:00.000Z');
    expect(await proj(U1)).toMatchObject({ is_active: true, org_type: 'organization', org_name: 'Acme', owner_id: fromUuid('user', OWNER) });

    await updated(U1, '2026-10-04T01:00:00.000Z', { isActive: false, type: 'personal', name: 'Acme Renamed' });
    expect(await proj(U1)).toMatchObject({ status: 'active', is_active: false, org_type: 'personal', org_name: 'Acme Renamed', owner_id: fromUuid('user', OWNER) });
    expect(await db('selection_lists').count('* as n').first()).toMatchObject({ n: '0' }); // flags are OFF and nothing seeded

    // Re-activation is learned too.
    await updated(U1, '2026-10-04T02:00:00.000Z', { isActive: true, type: 'organization' });
    expect(await proj(U1)).toMatchObject({ is_active: true, org_type: 'organization' });
  });

  it('is idempotent: a redelivery rewrites the same values', async () => {
    await created(U2, '2026-10-04T00:00:00.000Z');
    await updated(U2, '2026-10-04T01:00:00.000Z', { isActive: false });
    await updated(U2, '2026-10-04T01:00:00.000Z', { isActive: false });
    expect(await proj(U2)).toMatchObject({ is_active: false });
    expect(await db('selection_list_ref_index').where({ entity_id: U2 }).count('* as n').first()).toMatchObject({ n: '1' });
  });

  it('never resurrects a deleted tombstone (status stays deleted; snapshot columns refresh)', async () => {
    await created(U3, '2026-10-04T00:00:00.000Z');
    await db('selection_list_ref_index').where({ entity_id: U3 }).update({ status: 'deleted' });
    await updated(U3, '2026-10-04T05:00:00.000Z', { isActive: true, name: 'Back from the dead?' });
    expect(await proj(U3)).toMatchObject({ status: 'deleted', is_active: true, org_name: 'Back from the dead?' });
  });

  it('ignores a snapshot OLDER than the newest applied one (a late org.created cannot roll back an org.updated)', async () => {
    const uuid = '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7c04';
    await updated(uuid, '2026-10-04T09:00:00.000Z', { isActive: false, name: 'Newest' }); // updated arrives FIRST: the org is inserted as projected
    expect(await proj(uuid)).toMatchObject({ status: 'active', is_active: false, org_name: 'Newest', owner_id: null });

    await created(uuid, '2026-10-04T00:00:00.000Z', { isActive: true, name: 'Oldest' }); // stale snapshot
    expect(await proj(uuid)).toMatchObject({ is_active: false, org_name: 'Newest', owner_id: fromUuid('user', OWNER) }); // owner still learned
  });

  it('does not move the owner on an update (grants must not silently follow an ownership change)', async () => {
    const uuid = '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7c05';
    await created(uuid, '2026-10-04T00:00:00.000Z');
    await updated(uuid, '2026-10-04T01:00:00.000Z', { ownerId: '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b0bb2' });
    expect((await proj(uuid)).owner_id).toBe(fromUuid('user', OWNER));
  });

  it('dead-letters a payload that fails the schema (to identity.org.updated.dlq) and writes nothing', async () => {
    const uuid = '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7c06';
    await deliver('identity.org.updated', env('identity.org.updated', uuid, '2026-10-04T00:00:00.000Z', { organizationId: 'not-a-uuid' }));
    await deliver('identity.org.updated', 'this is not json');
    expect(dlqSend).toHaveBeenCalledTimes(2);
    expect(dlqSend.mock.calls[0][0].topic).toBe('identity.org.updated.dlq');
    expect(await db('selection_list_ref_index').where({ entity_id: uuid }).first()).toBeUndefined();
  });

  it('an infrastructure fault throws (so kafkajs retries); it is not dead-lettered', async () => {
    const broken = { raw: async () => { throw new Error('Connection terminated'); } } as unknown as Knex;
    await expect(
      handleOrgUpdated(env('identity.org.updated', U1, '2026-10-04T00:00:00.000Z') as never, { db: broken }),
    ).rejects.toThrow('Connection terminated');
    expect(dlqSend).not.toHaveBeenCalled();
  });
});
