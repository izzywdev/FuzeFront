import { Application } from 'express';
import type { TwilioVerifyClient } from './twilio-client';
import type { RateLimiter } from './rate-limiter';
export interface AppDeps {
    authSecret: string;
    twilioClient: TwilioVerifyClient;
    verifyServiceSid: string;
    rateLimiter: RateLimiter;
}
export declare function createApp(deps: AppDeps): Application;
//# sourceMappingURL=app.d.ts.map