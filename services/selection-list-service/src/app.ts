// app.ts — Express application factory for selection-list-service.
//
// Route mounting order is deliberate:
//   /docs   — unauthenticated (Swagger UI)
//   /health — unauthenticated (k8s liveness/readiness probes)
//   /v1/*   — all require a valid JWT (authMiddleware mounted once at /v1)
//
// The /v1/resolve route is special: per the OpenAPI spec it accepts both an
// authenticated Bearer token AND unauthenticated in-cluster calls. That nuance
// is handled inside the resolve route itself in S8; for now the stub is gated
// behind authMiddleware like all other /v1 routes.

import express, { Application } from 'express';
import { authMiddleware } from './middleware/auth';
import { requireSelectionListsFlag } from './middleware/flagGate';
import healthRouter from './routes/health';
import docsRouter from './routes/docs';
import quotaRouter from './routes/quota';
import listsRouter from './routes/lists';
import itemsRouter from './routes/items';
import translationsRouter from './routes/translations';
import accessRouter from './routes/access';
import resolveRouter from './routes/resolve';

export function createApp(): Application {
  const app = express();
  app.use(express.json());

  // Unauthenticated routes
  app.use('/docs', docsRouter);
  app.use('/health', healthRouter);

  // All /v1 routes require a valid JWT
  app.use('/v1', authMiddleware);

  // Release flag `fuzefront.selection-lists.service` (default OFF): fail closed
  // for EVERY /v1/selection-lists/* route (incl. access, which has no
  // per-handler check) before any router runs. Evaluated after auth so the
  // org/user context is available for targeting.
  app.use('/v1/selection-lists', requireSelectionListsFlag);

  // S6: quota router is mounted BEFORE listsRouter so GET /quota is matched
  // before the /:listId wildcard pattern in listsRouter.
  app.use('/v1/selection-lists', quotaRouter);

  app.use('/v1/selection-lists', listsRouter);
  app.use('/v1/selection-lists', itemsRouter);
  app.use('/v1/selection-lists', translationsRouter);
  app.use('/v1/selection-lists', accessRouter);
  app.use('/v1', resolveRouter);

  return app;
}
