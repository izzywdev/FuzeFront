"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimiter = exports.RateLimitError = void 0;
class RateLimitError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RateLimitError';
    }
}
exports.RateLimitError = RateLimitError;
class RateLimiter {
    constructor(opts) {
        this.state = new Map();
        this.cooldownMs = opts.cooldownMs;
        this.maxPerHour = opts.maxPerHour;
    }
    /**
     * Check if a send is allowed for the given phone + IP.
     * Records the attempt if allowed; throws RateLimitError if not.
     * Cooldown is per-(phone,IP); maxPerHour is phone-wide (across all IPs).
     */
    check(phone, ip) {
        const now = Date.now();
        // Per-(phone,IP) cooldown
        const perIpKey = `__perip__${phone}::${ip}`;
        const perIpState = this.state.get(perIpKey) ?? { lastSentAt: 0, hourlySends: [] };
        if (this.cooldownMs > 0 && now - perIpState.lastSentAt < this.cooldownMs) {
            throw new RateLimitError(`Rate limited: wait ${Math.ceil((this.cooldownMs - (now - perIpState.lastSentAt)) / 1000)}s before retrying`);
        }
        // Per-phone hourly cap
        const phoneState = this.state.get(phone) ?? { lastSentAt: 0, hourlySends: [] };
        const hourAgo = now - 3600000;
        const recentSends = phoneState.hourlySends.filter((t) => t > hourAgo);
        if (recentSends.length >= this.maxPerHour) {
            throw new RateLimitError(`Rate limited: max ${this.maxPerHour} SMS per hour exceeded for this number`);
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
exports.RateLimiter = RateLimiter;
//# sourceMappingURL=rate-limiter.js.map