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

  it('payments defaults: empty product allowlist (fail closed), usd/eur, 5M cent cap', () => {
    delete process.env.BILLING_PRODUCT_KEYS;
    delete process.env.BILLING_PAYMENT_CURRENCIES;
    delete process.env.BILLING_PAYMENT_MAX_TOTAL_CENTS;

    const cfg = loadConfig();

    expect(cfg.payments.productKeys).toEqual([]);
    expect(cfg.payments.currencies).toEqual(['usd', 'eur']);
    expect(cfg.payments.maxTotalCents).toBe(5_000_000);
  });

  it('parses BILLING_PRODUCT_KEYS / CURRENCIES as trimmed, lowercased CSV', () => {
    process.env.BILLING_PRODUCT_KEYS = ' mendys-datasets , Other-Product ,';
    process.env.BILLING_PAYMENT_CURRENCIES = 'USD, gbp';
    process.env.BILLING_PAYMENT_MAX_TOTAL_CENTS = '250000';

    const cfg = loadConfig();

    expect(cfg.payments.productKeys).toEqual(['mendys-datasets', 'other-product']);
    expect(cfg.payments.currencies).toEqual(['usd', 'gbp']);
    expect(cfg.payments.maxTotalCents).toBe(250000);

    delete process.env.BILLING_PRODUCT_KEYS;
    delete process.env.BILLING_PAYMENT_CURRENCIES;
    delete process.env.BILLING_PAYMENT_MAX_TOTAL_CENTS;
  });

  it('falls back to the default cent cap on a non-numeric/zero override', () => {
    process.env.BILLING_PAYMENT_MAX_TOTAL_CENTS = 'not-a-number';
    expect(loadConfig().payments.maxTotalCents).toBe(5_000_000);
    process.env.BILLING_PAYMENT_MAX_TOTAL_CENTS = '0';
    expect(loadConfig().payments.maxTotalCents).toBe(5_000_000);
    delete process.env.BILLING_PAYMENT_MAX_TOTAL_CENTS;
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
