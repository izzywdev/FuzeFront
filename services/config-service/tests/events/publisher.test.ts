import { TOPICS, configChangedSchemaV1 } from '@fuzefront/shared/kafka';
import {
  ChangedEventProducer,
  KafkaConfigChangePublisher,
  createConfigChangePublisher,
} from '../../src/events/publisher';

const payload = {
  namespace: 'fuzefront.chat',
  scope: { scopeType: 'org' as const, scopeId: 'o-1' },
  changedKeys: ['a', 'b'],
};

function fakeProducer(overrides: Partial<ChangedEventProducer> = {}) {
  const sent: Array<{ topic: string; event: any; key?: string }> = [];
  const producer: ChangedEventProducer = {
    connect: jest.fn(async () => {}),
    send: jest.fn(async (topic, event, _schema, options) => {
      sent.push({ topic, event, key: options?.key });
    }),
    disconnect: jest.fn(async () => {}),
    ...overrides,
  };
  return { producer, sent };
}

describe('createConfigChangePublisher', () => {
  it('returns null when KAFKA_BROKERS is unset or blank (no crash, no emit)', () => {
    expect(createConfigChangePublisher({})).toBeNull();
    expect(createConfigChangePublisher({ KAFKA_BROKERS: ' , ' })).toBeNull();
  });
  it('returns a publisher (without connecting) when brokers are set', () => {
    expect(createConfigChangePublisher({ KAFKA_BROKERS: 'kafka:9092' })).not.toBeNull();
  });
});

describe('KafkaConfigChangePublisher', () => {
  it('publishes the envelope on config.changed, keyed by (namespace, scope)', async () => {
    const { producer, sent } = fakeProducer();
    await new KafkaConfigChangePublisher(producer).configChanged(payload, 'corr-1');
    expect(sent).toHaveLength(1);
    expect(sent[0].topic).toBe(TOPICS.CONFIG_CHANGED);
    expect(sent[0].key).toBe('fuzefront.chat:org:o-1');
    expect(sent[0].event).toMatchObject({ topic: 'config.changed', version: '1.0', correlationId: 'corr-1', payload });
    expect(new Date(sent[0].event.occurredAt).toString()).not.toBe('Invalid Date');
    expect(() => configChangedSchemaV1.parse(sent[0].event.payload)).not.toThrow();
  });

  it('connects once across many publishes', async () => {
    const { producer } = fakeProducer();
    const pub = new KafkaConfigChangePublisher(producer);
    await pub.configChanged(payload);
    await pub.configChanged(payload);
    expect(producer.connect).toHaveBeenCalledTimes(1);
  });

  it('swallows a send failure (never rejects)', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { producer } = fakeProducer({ send: jest.fn(async () => { throw new Error('broker down'); }) });
    await expect(new KafkaConfigChangePublisher(producer).configChanged(payload)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    expect(String(spy.mock.calls[0][0])).not.toMatch(/secret/);
    spy.mockRestore();
  });

  it('a failed connect is non-fatal and is retried on the next publish', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const connect = jest.fn().mockRejectedValueOnce(new Error('refused')).mockResolvedValue(undefined);
    const { producer, sent } = fakeProducer({ connect });
    const pub = new KafkaConfigChangePublisher(producer);
    await expect(pub.configChanged(payload)).resolves.toBeUndefined();
    expect(sent).toHaveLength(0);
    await pub.configChanged(payload);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(sent).toHaveLength(1);
    spy.mockRestore();
  });
});
