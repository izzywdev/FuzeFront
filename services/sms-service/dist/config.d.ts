export interface TwilioConfig {
    accountSid: string;
    authToken: string;
    verifyServiceSid: string;
    mock: boolean;
}
export interface Config {
    port: number;
    authSecret: string;
    twilio: TwilioConfig;
    rateLimiter: {
        cooldownMs: number;
        maxPerHour: number;
    };
}
export declare function loadConfig(): Config;
//# sourceMappingURL=config.d.ts.map