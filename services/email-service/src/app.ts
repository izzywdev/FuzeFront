import express, { Application, Request, Response } from 'express';
import { tracingMiddleware } from '@fuzefront/telemetry';

export function createApp(): Application {
  const app = express();
  // Starts/continues a per-request span, exposing req.traceId/req.spanId for
  // log correlation. Mounted before any other middleware so the span wraps
  // the whole request lifecycle (OTLP export to FuzeInfra's Collector, never
  // Tempo/Loki directly — see @fuzefront/telemetry's docs/TRACE_CONTRACT.md).
  app.use(tracingMiddleware());
  app.use(express.json());

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'email-service' });
  });

  return app;
}
