// app.ts — Express application factory for selection-list-service.
//
// Route mounting order is deliberate:
//   /docs   — unauthenticated (Swagger UI)
//   /health — unauthenticated (k8s liveness/readiness probes)
//   /v1/*   — all require a valid JWT (authMiddleware mounted once at /v1)
//
// /v1/resolve is authenticated like every other /v1 route: the spec (v2.0.0)
// requires a Bearer token carrying an orgId claim, so resolution is org-scoped.

import express, { Application } from 'express';
import { requestLogger } from './lib/logger';
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
  // First: binds reqId + request-scoped pino child logger (and ALS context)
  // for every route, including /health and /docs.
  app.use(requestLogger);
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
