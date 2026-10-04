// events.consumer.test.ts — the Kafka lifecycle consumers end to end through the
// REAL TypedConsumer/TypedProducer (shared/src/kafka) with a fake KafkaJS client:
//
//   - a valid identity.org.deleted message reaches the handler and the DLQ is
//     UNTOUCHED on success
//   - an invalid payload / non-JSON message is dead-lettered to `<topic>.dlq`
//     and the handler is not run
//   - a handler failure is NOT dead-lettered: it propagates to kafkajs (retry),
//     so a handler bug is loud instead of silently parked
//
// Needs @fuzefront/shared built (the CI job builds it before the unit run).

const mockHandleOrg = jest.fn();
const mockHandleUser = jest.fn();
jest.mock('../src/events/org-deleted.handler', () => ({ handleOrgDeleted: (...a: unknown[]) => mockHandleOrg(...a) }));
jest.mock('../src/events/user-deleted.handler', () => ({ handleUserDeleted: (...a: unknown[]) => mockHandleUser(...a) }));

type EachMessage = (m: { topic: string; message: { value: Buffer | null } }) => Promise<void>;

const runners: Record<string, EachMessage> = {};
const dlqSend = jest.fn().mockResolvedValue(undefined);

function fakeKafka() {
  return {
    consumer: ({ groupId }: { groupId: string }) => {
      let topic = '';
      return {
        connect: jest.fn().mockResolvedValue(undefined),
        subscribe: jest.fn(async (s: { topic: string }) => {
          topic = s.topic;
        }),
        run: jest.fn(async ({ eachMessage }: { eachMessage: EachMessage }) => {
          runners[topic || groupId] = eachMessage;
        }),
        disconnect: jest.fn().mockResolvedValue(undefined),
      };
    },
    producer: () => ({
      connect: jest.fn().mockResolvedValue(undefined),
      send: dlqSend,
      disconnect: jest.fn().mockResolvedValue(undefined),
    }),
  };
}

jest.mock('@fuzefront/shared/kafka', () => {
  const actual = jest.requireActual('@fuzefront/shared/kafka');
  return { ...actual, createKafkaClient: () => fakeKafka() };
});

import { startLifecycleConsumers } from '../src/events/consumer';

const ORG = '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7c8d';
const envelope = (payload: unknown) => ({
  version: '1.0',
  topic: 'identity.org.deleted',
  correlationId: 'corr-1',
  occurredAt: '2026-10-04T00:00:00.000Z',
  payload,
});
const msg = (v: unknown) => ({ topic: 'identity.org.deleted', message: { value: Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)) } });

beforeEach(() => {
  // shared's TypedConsumer logs every dead-letter via console.error (not ours to change).
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  mockHandleOrg.mockReset().mockResolvedValue(undefined);
  mockHandleUser.mockReset().mockResolvedValue(undefined);
  dlqSend.mockClear();
  for (const k of Object.keys(runners)) delete runners[k];
});

it('success: the handler runs and the DLQ producer is never used', async () => {
  await startLifecycleConsumers();
  await runners['identity.org.deleted'](msg(envelope({ organizationId: ORG, slug: 'acme', ownerId: null, cascade: 'hard' })));
  expect(mockHandleOrg).toHaveBeenCalledTimes(1);
  expect(mockHandleOrg.mock.calls[0][0].payload).toMatchObject({ organizationId: ORG, cascade: 'hard' });
  expect(dlqSend).not.toHaveBeenCalled();
});

it('an invalid payload is dead-lettered to identity.org.deleted.dlq and the handler is NOT run', async () => {
  await startLifecycleConsumers();
  await runners['identity.org.deleted'](msg(envelope({ organizationId: 'not-a-uuid', slug: 'x', ownerId: null, cascade: 'hard' })));
  expect(mockHandleOrg).not.toHaveBeenCalled();
  expect(dlqSend).toHaveBeenCalledTimes(1);
  expect(dlqSend.mock.calls[0][0].topic).toBe('identity.org.deleted.dlq');
});

it('a non-JSON message is dead-lettered', async () => {
  await startLifecycleConsumers();
  await runners['identity.org.deleted'](msg('{not json'));
  expect(mockHandleOrg).not.toHaveBeenCalled();
  expect(dlqSend).toHaveBeenCalledTimes(1);
});

it('a handler FAILURE propagates to kafkajs (loud, retried) and is NOT dead-lettered', async () => {
  mockHandleOrg.mockRejectedValue(new Error('column "org_id" does not exist'));
  await startLifecycleConsumers();
  await expect(
    runners['identity.org.deleted'](msg(envelope({ organizationId: ORG, slug: 'acme', ownerId: null, cascade: 'soft' }))),
  ).rejects.toThrow('does not exist');
  expect(dlqSend).not.toHaveBeenCalled();
});

it('subscribes both lifecycle topics and disconnect() tears everything down', async () => {
  const { disconnect } = await startLifecycleConsumers();
  expect(Object.keys(runners).sort()).toEqual(['identity.org.deleted', 'identity.user.deleted']);
  await expect(disconnect()).resolves.toBeUndefined();
});
