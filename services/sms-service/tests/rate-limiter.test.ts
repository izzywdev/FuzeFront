import { RateLimiter, RateLimitError } from '../src/rate-limiter';

describe('RateLimiter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('allows the first request', () => {
    const rl = new RateLimiter({ cooldownMs: 30_000, maxPerHour: 5 });
    expect(() => rl.check('+15551234567', '127.0.0.1')).not.toThrow();
  });

  it('blocks a second request within the cooldown window', () => {
    const rl = new RateLimiter({ cooldownMs: 30_000, maxPerHour: 5 });
    rl.check('+15551234567', '127.0.0.1');
    expect(() => rl.check('+15551234567', '127.0.0.1')).toThrow(RateLimitError);
  });

  it('allows a request after the cooldown passes', () => {
    const rl = new RateLimiter({ cooldownMs: 30_000, maxPerHour: 5 });
    rl.check('+15551234567', '127.0.0.1');
    jest.advanceTimersByTime(31_000);
    expect(() => rl.check('+15551234567', '127.0.0.1')).not.toThrow();
  });

  it('blocks after maxPerHour is exceeded (different IPs, same phone)', () => {
    const rl = new RateLimiter({ cooldownMs: 0, maxPerHour: 3 });
    rl.check('+15551234567', '1.1.1.1');
    jest.advanceTimersByTime(1);
    rl.check('+15551234567', '2.2.2.2');
    jest.advanceTimersByTime(1);
    rl.check('+15551234567', '3.3.3.3');
    jest.advanceTimersByTime(1);
    expect(() => rl.check('+15551234567', '4.4.4.4')).toThrow(RateLimitError);
  });

  it('blocks after maxPerHour is exceeded (same phone, same IP)', () => {
    const rl = new RateLimiter({ cooldownMs: 0, maxPerHour: 2 });
    rl.check('+15559999999', '10.0.0.1');
    jest.advanceTimersByTime(1);
    rl.check('+15559999999', '10.0.0.1');
    jest.advanceTimersByTime(1);
    expect(() => rl.check('+15559999999', '10.0.0.1')).toThrow(RateLimitError);
  });

  it('resets hourly count after one hour passes', () => {
    const rl = new RateLimiter({ cooldownMs: 0, maxPerHour: 2 });
    rl.check('+15551234567', '1.1.1.1');
    jest.advanceTimersByTime(1);
    rl.check('+15551234567', '2.2.2.2');
    jest.advanceTimersByTime(3_601_000);
    expect(() => rl.check('+15551234567', '3.3.3.3')).not.toThrow();
  });

  it('different phones do not share state', () => {
    const rl = new RateLimiter({ cooldownMs: 30_000, maxPerHour: 5 });
    rl.check('+15551111111', '127.0.0.1');
    expect(() => rl.check('+15552222222', '127.0.0.1')).not.toThrow();
  });
});
