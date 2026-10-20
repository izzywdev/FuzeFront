import express, { Application, Request, Response } from 'express';
import { tracingMiddleware } from '@fuzefront/telemetry';
import {
  createChatStreamLimiter,
  createConfirmLimiter,
  createGlobalLimiter,
} from './middleware/ratelimit';
import { createChatRouter, ChatRouterDeps } from './routes/chat';

export interface AppDeps {
  /** Wired chat dependencies. When omitted, only /health is served. */
  chat?: ChatRouterDeps;
}

export function createApp(deps: AppDeps = {}): Application {
  const app = express();
  // Starts/continues a per-request span, exposing req.traceId/req.spanId for
  // log correlation. Mounted before any other middleware so the span wraps
  // the whole request lifecycle (OTLP export to FuzeInfra's Collector, never
  // Tempo/Loki directly — see @fuzefront/telemetry's docs/TRACE_CONTRACT.md).
  app.use(tracingMiddleware());
  app.use(express.json());

  // Health endpoint — UNAUTHENTICATED (also used by Helm readiness/liveness probes).
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'chat-service' });
  });

  if (deps.chat) {
    // Global limiter (100/min) across all chat routes, then per-route limiters
    // for the expensive stream (20/min) and confirm (60/min) endpoints (§10f).
    // Auth runs inside the chat router (createChatRouter mounts authenticateToken).
    app.use('/chat', createGlobalLimiter());
    app.use('/chat/stream', createChatStreamLimiter());
    app.use('/chat/confirm', createConfirmLimiter());
    app.use('/chat', createChatRouter(deps.chat));
  }

  return app;
}
