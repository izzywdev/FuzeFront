export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

interface RateLimiterOptions {
  cooldownMs: number; // minimum ms between sends per (phone, IP)
  maxPerHour: number; // max sends per phone per hour (across all IPs)
}

interface PhoneState {
  lastSentAt: number; // epoch ms of the last send
  hourlySends: number[]; // timestamps of sends in the rolling hour window
}

export class RateLimiter {
  private readonly cooldownMs: number;
  private readonly maxPerHour: number;
  private readonly state = new Map<string, PhoneState>();

  constructor(opts: RateLimiterOptions) {
    this.cooldownMs = opts.cooldownMs;
    this.maxPerHour = opts.maxPerHour;
  }

  /**
   * Check if a send is allowed for the given phone + IP.
   * Records the attempt if allowed; throws RateLimitError if not.
   * Cooldown is per-(phone,IP); maxPerHour is phone-wide (across all IPs).
   */
  check(phone: string, ip: string): void {
    const now = Date.now();

    // Per-(phone,IP) cooldown
    const perIpKey = `__perip__${phone}::${ip}`;
    const perIpState = this.state.get(perIpKey) ?? { lastSentAt: 0, hourlySends: [] };
    if (this.cooldownMs > 0 && now - perIpState.lastSentAt < this.cooldownMs) {
      throw new RateLimitError(
        `Rate limited: wait ${Math.ceil((this.cooldownMs - (now - perIpState.lastSentAt)) / 1000)}s before retrying`
      );
    }

    // Per-phone hourly cap
    const phoneState = this.state.get(phone) ?? { lastSentAt: 0, hourlySends: [] };
    const hourAgo = now - 3_600_000;
    const recentSends = phoneState.hourlySends.filter((t) => t > hourAgo);
    if (recentSends.length >= this.maxPerHour) {
      throw new RateLimitError(
        `Rate limited: max ${this.maxPerHour} SMS per hour exceeded for this number`
      );
    }

    // Record the send
    perIpState.lastSentAt = now;
    this.state.set(perIpKey, perIpState);

    recentSends.push(now);
    phoneState.hourlySends = recentSends;
    phoneState.lastSentAt = now;
    this.state.set(phone, phoneState);
  }
}
