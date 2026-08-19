import { Request, Response } from 'express';
import type { TwilioVerifyClient } from '../twilio-client';
import { RateLimiter } from '../rate-limiter';
interface SendDeps {
    twilioClient: TwilioVerifyClient;
    verifyServiceSid: string;
    rateLimiter: RateLimiter;
}
export declare function makeSendHandler(deps: SendDeps): (req: Request, res: Response) => Promise<void>;
export {};
//# sourceMappingURL=send.d.ts.map