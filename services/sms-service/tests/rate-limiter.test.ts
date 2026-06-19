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
    rl.destroy();
  });

  it('blocks a second request within the phone-level cooldown window', () => {
    const rl = new RateLimiter({ cooldownMs: 30_000, maxPerHour: 5 });
    rl.check('+15551234567', '127.0.0.1');
    // Same phone, DIFFERENT IP — must still be blocked (phone is the primary guard)
    expect(() => rl.check('+15551234567', '9.9.9.9')).toThrow(RateLimitError);
    rl.destroy();
  });

  it('blocks same phone same IP within cooldown', () => {
    const rl = new RateLimiter({ cooldownMs: 30_000, maxPerHour: 5 });
    rl.check('+15551234567', '127.0.0.1');
    expect(() => rl.check('+15551234567', '127.0.0.1')).toThrow(RateLimitError);
    rl.destroy();
  });

  it('allows a request after the cooldown passes', () => {
    const rl = new RateLimiter({ cooldownMs: 30_000, maxPerHour: 5 });
    rl.check('+15551234567', '127.0.0.1');
    jest.advanceTimersByTime(31_000);
    expect(() => rl.check('+15551234567', '127.0.0.1')).not.toThrow();
    rl.destroy();
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
    rl.destroy();
  });

  it('blocks after maxPerHour is exceeded (same phone, same IP)', () => {
    const rl = new RateLimiter({ cooldownMs: 0, maxPerHour: 2 });
    rl.check('+15559999999', '10.0.0.1');
    jest.advanceTimersByTime(1);
    rl.check('+15559999999', '10.0.0.1');
    jest.advanceTimersByTime(1);
    expect(() => rl.check('+15559999999', '10.0.0.1')).toThrow(RateLimitError);
    rl.destroy();
  });

  it('resets hourly count after one hour passes', () => {
    const rl = new RateLimiter({ cooldownMs: 0, maxPerHour: 2 });
    rl.check('+15551234567', '1.1.1.1');
    jest.advanceTimersByTime(1);
    rl.check('+15551234567', '2.2.2.2');
    jest.advanceTimersByTime(3_601_000);
    expect(() => rl.check('+15551234567', '3.3.3.3')).not.toThrow();
    rl.destroy();
  });

  it('different phones do not share state', () => {
    const rl = new RateLimiter({ cooldownMs: 30_000, maxPerHour: 5 });
    rl.check('+15551111111', '127.0.0.1');
    expect(() => rl.check('+15552222222', '127.0.0.1')).not.toThrow();
    rl.destroy();
  });

  describe('_sweep', () => {
    it('removes entries older than 1 hour', () => {
      const rl = new RateLimiter({ cooldownMs: 0, maxPerHour: 5 });
      rl.check('+15550000001', '1.1.1.1');
      // Advance past the sweep cutoff
      jest.advanceTimersByTime(3_601_000);
      rl._sweep();
      // After sweep, the phone can send again without hitting the hourly cap
      expect(() => rl.check('+15550000001', '2.2.2.2')).not.toThrow();
      rl.destroy();
    });

    it('retains entries within the 1-hour window', () => {
      const rl = new RateLimiter({ cooldownMs: 0, maxPerHour: 1 });
      rl.check('+15550000002', '1.1.1.1');
      // Only 30 min have passed — entry must survive the sweep
      jest.advanceTimersByTime(1_800_000);
      rl._sweep();
      // Should still be blocked (maxPerHour=1, hour not elapsed)
      expect(() => rl.check('+15550000002', '2.2.2.2')).toThrow(RateLimitError);
      rl.destroy();
    });
  });
});
