// outbox.publisher.test.ts - the Kafka transport + bootstrap wiring (events/outboxPublisher.ts),
// with a fake producer (no broker). The relay semantics are in outbox.relay.db.test.ts.

import { TOPICS, dlqTopic } from '@fuzefront/shared/kafka';
import { ENVELOPE_VERSION, makeOutboxPublisher, startOutboxRelayFromEnv, ProducerLike } from '../src/events/outboxPublisher';
import { OutboxRecord } from '../src/events/outboxRelay';

const ORG = 'org_01h455vb4pex5vsknk084sn02q';
const payload = {
  eventId: '0195a8f2-7c1e-7b3a-9f00-1a2b3c4d5e04',
  organizationId: ORG,
  actor: { type: 'user', userId: 'usr_01h455vb4pex5vsknk084sn02q' },
  listId: 'front_sl_01h455vb4pex5vsknk084sn02q',
  listKey: 'priority',
  listRevision: 7,
};

const record = (over: Partial<OutboxRecord> = {}): OutboxRecord => ({
  id: payload.eventId,
  seq: '12',
  organizationId: ORG,
  topic: TOPICS.SELECTION_LISTS_LIST_DELETED,
  payload,
  correlationId: 'req-abc',
  attempts: 3,
  createdAt: new Date('2026-10-04T12:34:56.000Z'),
  ...over,
});

function fakeProducer() {
  const sent: Array<{ topic: string; event: any; key?: string }> = [];
  const raw: Array<{ topic: string; messages: Array<{ key?: string; value: string }> }> = [];
  const producer: ProducerLike = {
    send: jest.fn(async (topic: string, event: any, schema: any, options?: { key?: string }) => {
      schema.parse(event.payload); // what TypedProducer does
      sent.push({ topic, event, key: options?.key });
    }) as any,
    raw: { send: jest.fn(async (p: any) => void raw.push(p)) },
    disconnect: jest.fn(async () => undefined),
  };
  return { producer, sent, raw };
}

describe('makeOutboxPublisher', () => {
  it('publishes the envelope: version 1.0, row correlation id, commit time as occurredAt, org as partition key', async () => {
    const f = fakeProducer();
    const { publish } = makeOutboxPublisher(async () => f.producer);
    await publish(record());
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0].topic).toBe(TOPICS.SELECTION_LISTS_LIST_DELETED);
    expect(f.sent[0].key).toBe(ORG);
    expect(f.sent[0].event).toEqual({
      version: ENVELOPE_VERSION,
      topic: TOPICS.SELECTION_LISTS_LIST_DELETED,
      correlationId: 'req-abc',
      occurredAt: '2026-10-04T12:34:56.000Z',
      payload,
    });
    expect(ENVELOPE_VERSION).toBe('1.0');
  });

  it('a producer failure propagates (the relay turns it into a retry); a schema-violating payload is refused before send', async () => {
    const failing = fakeProducer();
    (failing.producer.send as jest.Mock).mockRejectedValueOnce(new Error('broker down'));
    await expect(makeOutboxPublisher(async () => failing.producer).publish(record())).rejects.toThrow('broker down');

    const f = fakeProducer();
    await expect(makeOutboxPublisher(async () => f.producer).publish(record({ payload: { ...payload, listRevision: 0 } }))).rejects.toThrow();
    expect(f.sent).toHaveLength(0);
  });

  it('a connect failure propagates', async () => {
    const { publish } = makeOutboxPublisher(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(publish(record())).rejects.toThrow('ECONNREFUSED');
  });

  it('dead-letters to <topic>.dlq with the event, org key and the reason', async () => {
    const f = fakeProducer();
    const { deadLetter } = makeOutboxPublisher(async () => f.producer);
    await deadLetter(record(), 'max_attempts: poison');
    expect(f.raw).toHaveLength(1);
    expect(f.raw[0].topic).toBe(dlqTopic(TOPICS.SELECTION_LISTS_LIST_DELETED));
    expect(f.raw[0].topic).toBe('selection-lists.list.deleted.dlq');
    expect(f.raw[0].messages[0].key).toBe(ORG);
    const body = JSON.parse(f.raw[0].messages[0].value);
    expect(body).toMatchObject({
      reason: 'max_attempts: poison',
      raw: { eventId: payload.eventId, topic: TOPICS.SELECTION_LISTS_LIST_DELETED, organizationId: ORG, correlationId: 'req-abc', attempts: 3, payload },
    });
    expect(typeof body.parkedAt).toBe('string');
  });
});

describe('startOutboxRelayFromEnv', () => {
  const db: any = { transaction: jest.fn(), raw: jest.fn() };

  it('does NOT start (returns null, touches nothing) when KAFKA_BROKERS is unset or blank', () => {
    expect(startOutboxRelayFromEnv({ db, env: {} })).toBeNull();
    expect(startOutboxRelayFromEnv({ db, env: { KAFKA_BROKERS: '  ' } })).toBeNull();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('starts when KAFKA_BROKERS is set, never throws, and stop() + disconnect() are safe even though no broker was ever contacted', async () => {
    const handle = startOutboxRelayFromEnv({ db, env: { KAFKA_BROKERS: 'broker-1:9092,broker-2:9092', OUTBOX_RELAY_INTERVAL_MS: '5000' } });
    expect(handle).not.toBeNull();
    await handle!.stop();
    await handle!.disconnect();
  });
});
