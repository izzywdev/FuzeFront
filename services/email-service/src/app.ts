import express, { Application, NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { SUPPORTED_TEMPLATES } from '@fuzefront/shared/kafka';
import { EmailProvider } from './providers';
import { renderTemplate } from './templates';
import { maskEmail } from './utils/mask';
import { classifyProviderError } from './utils/provider-error';

export interface AppDeps {
  /** Provider used by POST /send. When absent, /send answers 503. */
  provider?: EmailProvider;
  from?: string;
  /** Bearer secret required on POST /send (fail-closed when empty). */
  authSecret?: string;
}

const sendBodySchema = z
  .object({
    to: z.string().email(),
    template: z.enum(SUPPORTED_TEMPLATES),
    data: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

function bearerMatches(header: string | undefined, secret: string): boolean {
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  // timingSafeEqual throws on length mismatch, so compare lengths first.
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createApp(deps: AppDeps = {}): Application {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'email-service' });
  });

  // INTERNAL ONLY: synchronous delivery for service-to-service callers that need
  // a transactional message now (security-service: verify-email, password-reset).
  // Same shared-secret bearer pattern as sms-service; the route must not be
  // exposed through the public ingress. Fails closed when no secret is configured.
  app.post(
    '/send',
    (req: Request, res: Response, next: NextFunction) => {
      if (!deps.authSecret) {
        res.status(401).json({ error: 'email-service not configured (no auth secret)' });
        return;
      }
      if (!bearerMatches(req.headers['authorization'], deps.authSecret)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      next();
    },
    async (req: Request, res: Response) => {
      if (!deps.provider) {
        res.status(503).json({ error: 'email provider not configured' });
        return;
      }
      const parsed = sendBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid request body' });
        return;
      }
      const { to, template, data } = parsed.data;
      try {
        const rendered = renderTemplate(template, data);
        const result = await deps.provider.send({
          to,
          from: deps.from,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        });
        console.info(`[email-send] ${template} sent to ${maskEmail(to)}`);
        res.status(202).json({ accepted: true, messageId: result.messageId });
      } catch (err) {
        // Never log the raw provider message (can echo recipient/body) nor the
        // template data (carries the single-use token) - stable code only.
        const code = classifyProviderError(err instanceof Error ? err.message : String(err));
        console.error(`[email-send] ${template} to ${maskEmail(to)} FAILED: ${code}`);
        res.status(502).json({ error: 'delivery failed', code });
      }
    },
  );

  return app;
}
