import express, { Application, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import {
  NotificationRouterDeps,
  createNotificationRouter,
} from './routes/notifications';

export interface AppDeps {
  /** Wired notification dependencies. When omitted, only /health is served. */
  notifications?: NotificationRouterDeps;
  rateLimit?: { windowMs: number; max: number };
}

export function createApp(deps: AppDeps = {}): Application {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  // UNAUTHENTICATED — also the Helm readiness/liveness probe target.
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'notification-service' });
  });

  if (deps.notifications) {
    const limits = deps.rateLimit ?? { windowMs: 60_000, max: 240 };

    // The badge polls and the panel opens often, so the ceiling is generous —
    // it exists to stop a runaway client, not to shape normal traffic.
    //
    // The SSE stream is EXEMPT: it is one long-lived request, so counting it
    // would do nothing useful, and a reconnect storm is already bounded by the
    // hub's per-user stream cap.
    const limiter = rateLimit({
      windowMs: limits.windowMs,
      max: limits.max,
      standardHeaders: true,
      legacyHeaders: false,
      skip: req => req.path === '/stream',
    });

    app.use('/notifications', limiter);
    app.use('/notifications', createNotificationRouter(deps.notifications));
  }

  return app;
}
