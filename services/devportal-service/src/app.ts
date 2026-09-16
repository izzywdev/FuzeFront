// app.ts — Express application factory for devportal-service.
//
// Route mounting order:
//   /docs        — unauthenticated (Swagger UI, this service's OWN contract)
//   /health      — unauthenticated (k8s liveness/readiness probes)
//   /auth/*      — unauthenticated (OIDC login/callback/logout — these ARE
//                  how a session gets created, so they can't require one)
//   /internal/*  — shared-secret only, never on the public ingress
//   /v1/*        — devportal session required (authMiddleware mounted once)

import express, { Application } from 'express';
import cookieParser from 'cookie-parser';
import { authMiddleware } from './middleware/auth';
import healthRouter from './routes/health';
import docsRouter from './routes/docs';
import authRouter from './routes/auth';
import specsRouter from './routes/specs';
import catalogRouter from './routes/catalog';
import playgroundRouter from './routes/playground';
import accessRouter from './routes/access';

export function createApp(): Application {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  app.use('/docs', docsRouter);
  app.use('/health', healthRouter);
  app.use('/auth', authRouter);

  // Service-to-service only — MUST stay off the public ingress
  // (deploy/helm/fuzefront/templates/ingress.yaml never routes /internal/*).
  app.use('/internal', specsRouter);

  app.use('/v1', authMiddleware);
  app.use('/v1', catalogRouter);
  app.use('/v1', playgroundRouter);
  app.use('/v1', accessRouter);

  return app;
}
