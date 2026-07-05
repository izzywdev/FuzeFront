import { Request, Response } from 'express';
import type { TwilioVerifyClient } from '../twilio-client';
interface VerifyDeps {
    twilioClient: TwilioVerifyClient;
    verifyServiceSid: string;
}
export declare function makeVerifyHandler(deps: VerifyDeps): (req: Request, res: Response) => Promise<void>;
export {};
//# sourceMappingURL=verify.d.ts.map