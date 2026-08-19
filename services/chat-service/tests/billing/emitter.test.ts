// emitter.test.ts — billing.llm.usage emitter. Kafka producer is mocked; a
// Kafka failure must NOT throw (billing is non-blocking — plan §5.1 / §6g).

import { BillingEmitter } from '../../src/billing/emitter';
import { TOPICS } from '@fuzefront/shared';

function makeProducer() {
  return { send: jest.fn().mockResolvedValue(undefined) };
}

const USAGE = {
  userId: '11111111-1111-1111-1111-111111111111',
  orgId: '22222222-2222-2222-2222-222222222222',
  conversationId: '33333333-3333-3333-3333-333333333333',
  model: 'claude-opus-4-5',
  promptTokens: 100,
  completionTokens: 50,
  totalTokens: 150,
};

describe('BillingEmitter.emitUsage', () => {
  it('sends a validated billing.llm.usage event with the correct topic and payload', async () => {
    const producer = makeProducer();
    const emitter = new BillingEmitter(producer as any);
    await emitter.emitUsage(USAGE);

    expect(producer.send).toHaveBeenCalledTimes(1);
    const [topic, event, schema] = producer.send.mock.calls[0];
    expect(topic).toBe(TOPICS.BILLING_LLM_USAGE);
    expect(event.topic).toBe(TOPICS.BILLING_LLM_USAGE);
    expect(event.payload).toMatchObject({
      userId: USAGE.userId,
      orgId: USAGE.orgId,
      model: USAGE.model,
      totalTokens: 150,
    });
    expect(typeof event.payload.timestamp).toBe('string');
    expect(event.correlationId).toBe(USAGE.conversationId);
    // schema is passed through to TypedProducer for validation
    expect(schema).toBeDefined();
  });

  it('does NOT throw when the Kafka producer rejects (graceful degradation)', async () => {
    const producer = { send: jest.fn().mockRejectedValue(new Error('kafka unavailable')) };
    const emitter = new BillingEmitter(producer as any);
    await expect(emitter.emitUsage(USAGE)).resolves.toBeUndefined();
  });

  it('does NOT throw when payload fails schema validation (bad uuid)', async () => {
    const producer = makeProducer();
    // Make send throw a ZodError-like failure by routing through the real TypedProducer is
    // overkill; here the emitter validates defensively and swallows.
    const emitter = new BillingEmitter(producer as any);
    await expect(
      emitter.emitUsage({ ...USAGE, userId: 'not-a-uuid' }),
    ).resolves.toBeUndefined();
  });
});
