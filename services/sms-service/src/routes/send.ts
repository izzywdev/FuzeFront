import { Request, Response } from 'express';
import { z } from 'zod';
import type { TwilioVerifyClient } from '../twilio-client';
import { RateLimiter, RateLimitError } from '../rate-limiter';

const E164_RE = /^\+[1-9]\d{6,14}$/;

const sendSchema = z.object({
  to: z.string().regex(E164_RE, 'Phone number must be in E.164 format (e.g. +15551234567)'),
});

interface SendDeps {
  twilioClient: TwilioVerifyClient;
  verifyServiceSid: string;
  rateLimiter: RateLimiter;
}

export function makeSendHandler(deps: SendDeps) {
  return async function sendHandler(req: Request, res: Response): Promise<void> {
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) {
      // Cast to access error — zod's SafeParseReturnType discriminant is not
      // always narrowed in older ts-jest setups
      const failure = parsed as { success: false; error: { errors: Array<{ message: string }> } };
      const msg = failure.error.errors[0]?.message ?? 'Invalid request';
      res.status(400).json({ error: msg });
      return;
    }
    const { to } = parsed.data;
    // req.ip is set by Express when app.set('trust proxy', 1) is configured,
    // which honours the ingress-set X-Forwarded-For rather than the raw header
    // that an attacker could freely forge.
    const ip = req.ip ?? 'unknown';

    try {
      deps.rateLimiter.check(to, ip);
    } catch (err) {
      if (err instanceof RateLimitError) {
        res.status(429).json({ error: err.message });
        return;
      }
      throw err;
    }

    await deps.twilioClient.verify.v2
      .services(deps.verifyServiceSid)
      .verifications.create({ to, channel: 'sms' });

    res.json({ ok: true });
  };
}
