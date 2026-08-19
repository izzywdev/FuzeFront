import express, { Application, Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import type { TwilioVerifyClient } from './twilio-client';
import type { RateLimiter } from './rate-limiter';
import { makeSendHandler } from './routes/send';
import { makeVerifyHandler } from './routes/verify';

export interface AppDeps {
  authSecret: string;
  twilioClient: TwilioVerifyClient;
  verifyServiceSid: string;
  rateLimiter: RateLimiter;
}

export function createApp(deps: AppDeps): Application {
  const app = express();
  // Trust exactly one proxy hop (the ingress).  This lets Express set req.ip
  // from the ingress-written X-Forwarded-For entry rather than from the raw
  // header, which a client could forge arbitrarily.
  app.set('trust proxy', 1);
  app.use(express.json());

  // Health — no auth required
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'sms-service' });
  });

  // Shared-secret auth middleware for all /sms/* routes
  app.use('/sms', (req: Request, res: Response, next: NextFunction) => {
    if (!deps.authSecret) {
      // No secret configured — reject all (prevents accidental open access)
      res.status(401).json({ error: 'SMS service not configured (no auth secret)' });
      return;
    }
    const header = req.headers['authorization'];
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    // Constant-time comparison to prevent timing side-channel attacks.
    // Length check is required first because timingSafeEqual throws when
    // buffer lengths differ.
    const secretBuf = Buffer.from(deps.authSecret);
    const tokenBuf = token ? Buffer.from(token) : Buffer.alloc(0);
    const valid =
      token !== undefined &&
      tokenBuf.length === secretBuf.length &&
      timingSafeEqual(tokenBuf, secretBuf);
    if (!valid) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  });

  app.post(
    '/sms/send',
    makeSendHandler({
      twilioClient: deps.twilioClient,
      verifyServiceSid: deps.verifyServiceSid,
      rateLimiter: deps.rateLimiter,
    })
  );

  app.post(
    '/sms/verify',
    makeVerifyHandler({
      twilioClient: deps.twilioClient,
      verifyServiceSid: deps.verifyServiceSid,
    })
  );

  return app;
}
