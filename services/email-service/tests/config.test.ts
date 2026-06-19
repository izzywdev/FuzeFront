import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  it('reads required env vars', () => {
    process.env.KAFKA_BROKERS = 'localhost:9092';
    process.env.EMAIL_FROM = 'noreply@example.com';
    process.env.EMAIL_PROVIDER = 'smtp';
    process.env.SMTP_HOST = 'localhost';
    process.env.SMTP_PORT = '1025';

    const cfg = loadConfig();

    expect(cfg.kafka.brokers).toEqual(['localhost:9092']);
    expect(cfg.email.from).toBe('noreply@example.com');
    expect(cfg.email.provider).toBe('smtp');
  });

  it('splits KAFKA_BROKERS on comma', () => {
    process.env.KAFKA_BROKERS = 'broker1:9092,broker2:9092';
    const cfg = loadConfig();
    expect(cfg.kafka.brokers).toHaveLength(2);
  });
});
