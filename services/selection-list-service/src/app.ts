// app.ts — Express application factory for selection-list-service.
//
// Route mounting order is deliberate:
//   /docs   — unauthenticated (Swagger UI)
//   /health, /ready, /metrics — unauthenticated (liveness, DB readiness,
//           Prometheus); never reachable from outside the cluster (ingress
//           publishes only /api/v1/selection-lists and /api/v1/resolve)
//   /v1/*   — all require a valid JWT (authMiddleware mounted once at /v1),
//           then edge input validation (NUL bytes), then the release flag
//   (last)  — errorHandler: the terminal 500/400 contract error body
//
// /v1/resolve is authenticated like every other /v1 route: the spec (v2.0.0)
// requires a Bearer token carrying an orgId claim, so resolution is org-scoped.

import express, { Application } from 'express';
import { requestLogger } from './lib/logger';
import { asyncHandler, errorHandler } from './lib/http';
import { metricsMiddleware } from './lib/metrics';
import { authMiddleware } from './middleware/auth';
import { requireSelectionListsFlag } from './middleware/flagGate';
import { rejectNulBytes } from './middleware/validateInput';
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
  // Records http_request_duration_seconds{method,route,status_code} for every
  // request that finishes (route = matched pattern, never the raw URL).
  app.use(metricsMiddleware);
  app.use(express.json());

  // Unauthenticated routes
  app.use('/docs', docsRouter);
  app.use(healthRouter); // /health (liveness), /ready (DB), /metrics (Prometheus)

  // All /v1 routes require a valid JWT
  app.use('/v1', authMiddleware);

  // Edge validation: no NUL byte in the path, query or body ever reaches
  // Postgres (SQLSTATE 22021 -> 500 / process crash; review H-4). After auth so
  // an unauthenticated caller still gets 401, not a validation oracle.
  app.use('/v1', rejectNulBytes);

  // Release flag `fuzefront.selection-lists.service` (default OFF): fail closed
  // for EVERY /v1/selection-lists/* route (incl. access, which has no
  // per-handler check) before any router runs. Evaluated after auth so the
  // org/user context is available for targeting.
  app.use('/v1/selection-lists', asyncHandler(requireSelectionListsFlag));

  // S6: quota router is mounted BEFORE listsRouter so GET /quota is matched
  // before the /:listId wildcard pattern in listsRouter.
  app.use('/v1/selection-lists', quotaRouter);

  app.use('/v1/selection-lists', listsRouter);
  app.use('/v1/selection-lists', itemsRouter);
  app.use('/v1/selection-lists', translationsRouter);
  app.use('/v1/selection-lists', accessRouter);
  app.use('/v1', resolveRouter);

  // Terminal error handler — MUST be last. Anything a route (or the async
  // wrapper in lib/http.ts) forwards via next(err) answers the contract error
  // body instead of a stack trace, a hung socket, or a dead process.
  app.use(errorHandler);

  return app;
}
