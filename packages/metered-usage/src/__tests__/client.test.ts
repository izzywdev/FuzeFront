import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MeteringClient } from '../client';
import type { UsageEvent } from '../types';

// ---------------------------------------------------------------------------
// Minimal KafkaJS mock
// ---------------------------------------------------------------------------

const mockSend = vi.fn().mockResolvedValue(undefined);
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockDisconnect = vi.fn().mockResolvedValue(undefined);

const mockProducer = {
  connect: mockConnect,
  disconnect: mockDisconnect,
  send: mockSend,
};

vi.mock('kafkajs', () => {
  return {
    Kafka: vi.fn().mockImplementation(() => ({
      producer: vi.fn().mockReturnValue(mockProducer),
    })),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(topic?: string): MeteringClient {
  return new MeteringClient({
    kafka: { brokers: ['kafka:9092'] },
    serviceName: 'test-service',
    ...(topic ? { topic } : {}),
  });
}

const sampleEvent: UsageEvent = {
  meterEventName: 'api_calls',
  quantity: 1,
  entityType: 'organization',
  entityId: 'org_01abc',
  timestamp: '2026-10-19T12:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MeteringClient.emit()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls producer.connect() on first emit (lazy connect)', async () => {
    const client = makeClient();
    await client.emit(sampleEvent);
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it('does NOT call connect() a second time on subsequent emits', async () => {
    const client = makeClient();
    await client.emit(sampleEvent);
    await client.emit(sampleEvent);
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it('calls producer.send() with the correct topic (default: billing.usage)', async () => {
    const client = makeClient();
    await client.emit(sampleEvent);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const call = mockSend.mock.calls[0][0] as { topic: string; messages: unknown[] };
    expect(call.topic).toBe('billing.usage');
  });

  it('calls producer.send() with a custom topic when configured', async () => {
    const client = makeClient('custom.topic');
    await client.emit(sampleEvent);

    const call = mockSend.mock.calls[0][0] as { topic: string; messages: unknown[] };
    expect(call.topic).toBe('custom.topic');
  });

  it('serialises the UsageEvent as JSON in the message value', async () => {
    const client = makeClient();
    await client.emit(sampleEvent);

    const call = mockSend.mock.calls[0][0] as {
      messages: Array<{ value: string }>;
    };
    const parsed = JSON.parse(call.messages[0].value) as UsageEvent;

    expect(parsed.meterEventName).toBe(sampleEvent.meterEventName);
    expect(parsed.quantity).toBe(sampleEvent.quantity);
    expect(parsed.entityType).toBe(sampleEvent.entityType);
    expect(parsed.entityId).toBe(sampleEvent.entityId);
    expect(parsed.timestamp).toBe(sampleEvent.timestamp);
  });

  it('sets the message key to "<entityType>:<entityId>"', async () => {
    const client = makeClient();
    await client.emit(sampleEvent);

    const call = mockSend.mock.calls[0][0] as {
      messages: Array<{ key: string }>;
    };
    expect(call.messages[0].key).toBe('organization:org_01abc');
  });

  it('SWALLOWS producer.send() errors — does not throw', async () => {
    mockSend.mockRejectedValueOnce(new Error('Kafka unavailable'));
    const client = makeClient();

    // Must resolve without throwing
    await expect(client.emit(sampleEvent)).resolves.toBeUndefined();
  });

  it('SWALLOWS producer.connect() errors — does not throw', async () => {
    mockConnect.mockRejectedValueOnce(new Error('Connection refused'));
    const client = makeClient();

    await expect(client.emit(sampleEvent)).resolves.toBeUndefined();
  });

  it('resets connectPromise after a connect failure so subsequent emits can retry', async () => {
    // First connect() fails — emit swallows it
    mockConnect.mockRejectedValueOnce(new Error('transient error'));
    const client = makeClient();
    await client.emit(sampleEvent);
    expect(mockSend).not.toHaveBeenCalled();

    // Second connect() succeeds — emit should now produce a message
    mockConnect.mockResolvedValueOnce(undefined);
    await client.emit(sampleEvent);
    expect(mockConnect).toHaveBeenCalledTimes(2);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// flush()
// ---------------------------------------------------------------------------

describe('MeteringClient.flush()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls producer.disconnect() after at least one emit', async () => {
    const client = makeClient();
    await client.emit(sampleEvent); // ensures connected = true
    await client.flush();
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it('does NOT call disconnect() if emit() was never called (not connected)', async () => {
    const client = makeClient();
    await client.flush();
    expect(mockDisconnect).not.toHaveBeenCalled();
  });

  it('does NOT call disconnect() a second time on repeated flush()', async () => {
    const client = makeClient();
    await client.emit(sampleEvent);
    await client.flush();
    await client.flush();
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it('still calls disconnect() when send() fails (producer IS connected)', async () => {
    mockSend.mockRejectedValueOnce(new Error('send failed'));
    const client = makeClient();
    await client.emit(sampleEvent); // connect succeeds, send fails — still connected
    expect(mockDisconnect).not.toHaveBeenCalled();
    await client.flush();
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// fromEnv()
// ---------------------------------------------------------------------------

describe('MeteringClient.fromEnv()', () => {
  it('constructs a client using KAFKA_BROKERS env var', () => {
    const orig = process.env.KAFKA_BROKERS;
    process.env.KAFKA_BROKERS = 'broker1:9092,broker2:9092';

    const client = MeteringClient.fromEnv('env-service');
    expect(client).toBeInstanceOf(MeteringClient);

    process.env.KAFKA_BROKERS = orig;
  });

  it('falls back to kafka:9092 when KAFKA_BROKERS is unset', () => {
    const orig = process.env.KAFKA_BROKERS;
    delete process.env.KAFKA_BROKERS;

    const client = MeteringClient.fromEnv('env-service');
    expect(client).toBeInstanceOf(MeteringClient);

    process.env.KAFKA_BROKERS = orig;
  });
});
