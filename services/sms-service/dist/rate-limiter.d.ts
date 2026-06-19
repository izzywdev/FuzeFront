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
    constructor(opts: RateLimiterOptions);
    /**
     * Check if a send is allowed for the given phone + IP.
     * Records the attempt if allowed; throws RateLimitError if not.
     * Cooldown is per-(phone,IP); maxPerHour is phone-wide (across all IPs).
     */
    check(phone: string, ip: string): void;
}
export {};
//# sourceMappingURL=rate-limiter.d.ts.map