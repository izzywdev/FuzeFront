import { Request, Response } from 'express';
import { z } from 'zod';
import type { TwilioVerifyClient } from '../twilio-client';

const E164_RE = /^\+[1-9]\d{6,14}$/;
const CODE_RE = /^\d{4,8}$/;

const verifySchema = z.object({
  to: z.string().regex(E164_RE, 'Phone number must be in E.164 format'),
  code: z.string().regex(CODE_RE, 'Code must be 4–8 digits'),
});

interface VerifyDeps {
  twilioClient: TwilioVerifyClient;
  verifyServiceSid: string;
}

export function makeVerifyHandler(deps: VerifyDeps) {
  return async function verifyHandler(req: Request, res: Response): Promise<void> {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) {
      // Cast to access error — zod's SafeParseReturnType discriminant is not
      // always narrowed in older ts-jest setups
      const failure = parsed as { success: false; error: { errors: Array<{ message: string }> } };
      const msg = failure.error.errors[0]?.message ?? 'Invalid request';
      res.status(400).json({ error: msg });
      return;
    }
    const { to, code } = parsed.data;

    // verificationChecks.create returns status: 'approved' | 'pending' | 'canceled' | 'expired'
    // It does NOT throw on wrong code — pending means wrong code.
    const check = await deps.twilioClient.verify.v2
      .services(deps.verifyServiceSid)
      .verificationChecks.create({ to, code });

    res.json({ verified: check.status === 'approved' });
  };
}
