import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  it('returns defaults when no env vars are set', () => {
    delete process.env.PORT;
    delete process.env.KAFKA_BROKERS;
    delete process.env.KAFKA_CLIENT_ID;
    delete process.env.KAFKA_GROUP_ID;

    const cfg = loadConfig();

    expect(cfg.port).toBe(3006);
    expect(cfg.kafka.brokers).toEqual(['fuzeinfra-kafka:9092']);
    expect(cfg.kafka.clientId).toBe('billing-service');
    expect(cfg.kafka.groupId).toBe('billing-service-group');
  });

  it('reads PORT from env', () => {
    process.env.PORT = '4000';
    const cfg = loadConfig();
    expect(cfg.port).toBe(4000);
    delete process.env.PORT;
  });

  it('splits KAFKA_BROKERS on comma', () => {
    process.env.KAFKA_BROKERS = 'broker1:9092,broker2:9092';
    const cfg = loadConfig();
    expect(cfg.kafka.brokers).toHaveLength(2);
    delete process.env.KAFKA_BROKERS;
  });

  it('reads optional billing env vars', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_abc';
    process.env.BILLING_INTERNAL_TOKEN = 'tok_xyz';
    process.env.DATABASE_URL = 'postgres://localhost/billing';

    const cfg = loadConfig();

    expect(cfg.stripeSecretKey).toBe('sk_test_123');
    expect(cfg.stripeWebhookSecret).toBe('whsec_abc');
    expect(cfg.internalToken).toBe('tok_xyz');
    expect(cfg.databaseUrl).toBe('postgres://localhost/billing');

    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.BILLING_INTERNAL_TOKEN;
    delete process.env.DATABASE_URL;
  });
});
