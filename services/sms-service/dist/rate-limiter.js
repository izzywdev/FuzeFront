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
// Sweep interval: remove entries that have been idle for at least 1 hour.
// NOTE: This limiter is in-process only. A multi-replica deployment must use a
// shared store (Redis — available via FuzeInfra) for consistent enforcement.
const SWEEP_INTERVAL_MS = 3600000; // 1 hour
class RateLimiter {
    constructor(opts) {
        this.state = new Map();
        this.sweepTimer = null;
        this.cooldownMs = opts.cooldownMs;
        this.maxPerHour = opts.maxPerHour;
        // Periodic sweep to prevent unbounded Map growth. Safe to skip in tests
        // (cooldownMs === 0 and maxPerHour is large) by not scheduling the timer
        // when we are clearly in a zero-cooldown test context.  The caller can
        // also call destroy() to cancel explicitly.
        if (typeof setInterval !== 'undefined' && opts.cooldownMs > 0) {
            this.sweepTimer = setInterval(() => this._sweep(), SWEEP_INTERVAL_MS);
            // Don't prevent process exit (Node.js unref behaviour).
            if (this.sweepTimer && typeof this.sweepTimer.unref === 'function') {
                this.sweepTimer.unref();
            }
        }
    }
    /** Cancel the background sweep timer (call on shutdown). */
    destroy() {
        if (this.sweepTimer !== null) {
            clearInterval(this.sweepTimer);
        }
    }
    /** Remove entries idle for longer than the longest window (1 hour). */
    _sweep() {
        const cutoff = Date.now() - SWEEP_INTERVAL_MS;
        for (const [key, state] of this.state.entries()) {
            if (state.lastSentAt < cutoff) {
                this.state.delete(key);
            }
        }
    }
    /**
     * Check if a send is allowed for the given phone + IP.
     * Records the attempt if allowed; throws RateLimitError if not.
     *
     * Phone is the protected resource, so the phone-level cooldown is the
     * primary guard.  An attacker varying their IP cannot bypass it.
     * Phone+IP keying is retained as a secondary defence (burst from one IP).
     */
    check(phone, ip) {
        const now = Date.now();
        // ── Primary guard: per-phone cooldown ───────────────────────────────────
        const phoneState = this.state.get(phone) ?? { lastSentAt: 0, hourlySends: [] };
        if (this.cooldownMs > 0 && now - phoneState.lastSentAt < this.cooldownMs) {
            throw new RateLimitError(`Rate limited: wait ${Math.ceil((this.cooldownMs - (now - phoneState.lastSentAt)) / 1000)}s before retrying`);
        }
        // ── Per-phone hourly cap ────────────────────────────────────────────────
        const hourAgo = now - 3600000;
        const recentSends = phoneState.hourlySends.filter((t) => t > hourAgo);
        if (recentSends.length >= this.maxPerHour) {
            throw new RateLimitError(`Rate limited: max ${this.maxPerHour} SMS per hour exceeded for this number`);
        }
        // ── Secondary guard: per-(phone,IP) cooldown ────────────────────────────
        // Provides additional defence against burst from a single IP even when
        // the phone-level window allows it (e.g. first send on a fresh hour).
        const perIpKey = `__perip__${phone}::${ip}`;
        const perIpState = this.state.get(perIpKey) ?? { lastSentAt: 0, hourlySends: [] };
        if (this.cooldownMs > 0 && now - perIpState.lastSentAt < this.cooldownMs) {
            throw new RateLimitError(`Rate limited: wait ${Math.ceil((this.cooldownMs - (now - perIpState.lastSentAt)) / 1000)}s before retrying`);
        }
        // ── Record the send ─────────────────────────────────────────────────────
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