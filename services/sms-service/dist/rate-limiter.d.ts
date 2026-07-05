export declare class RateLimitError extends Error {
    constructor(message: string);
}
interface RateLimiterOptions {
    cooldownMs: number;
    maxPerHour: number;
}
export declare class RateLimiter {
    private readonly cooldownMs;
    private readonly maxPerHour;
    private readonly state;
    private readonly sweepTimer;
    constructor(opts: RateLimiterOptions);
    /** Cancel the background sweep timer (call on shutdown). */
    destroy(): void;
    /** Remove entries idle for longer than the longest window (1 hour). */
    _sweep(): void;
    /**
     * Check if a send is allowed for the given phone + IP.
     * Records the attempt if allowed; throws RateLimitError if not.
     *
     * Phone is the protected resource, so the phone-level cooldown is the
     * primary guard.  An attacker varying their IP cannot bypass it.
     * Phone+IP keying is retained as a secondary defence (burst from one IP).
     */
    check(phone: string, ip: string): void;
}
export {};
//# sourceMappingURL=rate-limiter.d.ts.map