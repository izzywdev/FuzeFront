import express, { Application, Request, Response, Router } from 'express';

export function createApp(): Application {
  const app = express();
  app.use(express.json());

  // Health endpoint — UNAUTHENTICATED (also used by Helm readiness/liveness probes)
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'chat-service' });
  });

  // Authenticated router skeleton — chat routes are mounted by later units.
  // Auth + rate-limit middleware will be applied here when routes are added.
  const chatRouter = Router();
  // Future: app.use('/chat', authMiddleware, rateLimitMiddleware, chatRouter);
  void chatRouter; // referenced in later units

  return app;
}
