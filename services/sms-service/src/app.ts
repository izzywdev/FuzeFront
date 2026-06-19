import express, { Application, Request, Response, NextFunction } from 'express';
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
    if (!token || token !== deps.authSecret) {
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
