import express, { Application, Request, RequestHandler, Response } from 'express';
import { tracingMiddleware } from '@fuzefront/telemetry';
import type { MachineTokenVerifier } from '@fuzefront/service-auth';
import { createInternalAuth } from './middleware/auth';
import { createPaymentsRouter, createWebhookRouter } from './routes/payments';
import { PaymentProvider } from './providers/payment-provider';

export interface AppDeps {
  /** The active vendor adapter behind the neutral port. */
  provider: PaymentProvider;
  /**
   * Origin of FuzeFront's Security API used to verify incoming managed service
   * tokens on the internal API (e.g. `http://fuzefront-security:3002`). Required
   * in a real run — its absence fails the app closed at assembly time. Ignored
   * when `verifier` is injected.
   */
  securityServiceUrl?: string;
  /** Pre-built machine-token verifier. Test seam; overrides `securityServiceUrl`. */
  verifier?: MachineTokenVerifier;
}

const API_BASE = '/api/v1/payments';

/**
 * Assembles the payment-service Express app.
 *
 * Route ordering matters: the webhook router uses `express.raw` and MUST be
 * mounted before the global `express.json()` so signature verification sees the
 * unparsed body (same discipline as billing-service's webhook route).
 *
 * Called with NO args it returns a minimal app exposing only `/health` — the
 * degraded fallback used when no vendor key is configured (mirrors
 * billing-service's no-deps `createApp()`), and what the health test asserts.
 */
export function createApp(deps?: AppDeps): Application {
  const app = express();

  // Starts/continues a per-request span, exposing req.traceId/req.spanId for
  // log correlation. Mounted before any other middleware so the span wraps
  // the whole request lifecycle (OTLP export to FuzeInfra's Collector, never
  // Tempo/Loki directly — see @fuzefront/telemetry's docs/TRACE_CONTRACT.md).
  // Cast needed because @fuzefront/telemetry's RequestHandler type is built
  // against Express 4 types while this service is on Express 5 — same
  // mismatch (and same fix) as middleware/auth.ts's requireMachineAuth() cast.
  app.use(tracingMiddleware() as unknown as RequestHandler);

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'payment-service' });
  });

  if (!deps) return app;

  // 1) Webhook (raw body) — before express.json, public + signature-verified.
  app.use(API_BASE, express.raw({ type: '*/*' }), createWebhookRouter({ provider: deps.provider }));

  // 2) JSON body parser for the rest of the neutral API.
  app.use(express.json());

  // 3) Managed-service-token-guarded neutral Payment Provider API. Fails closed:
  //    an unauthenticated/invalid caller gets 401 with no "open when unset"
  //    fallback (see createInternalAuth).
  app.use(
    API_BASE,
    createInternalAuth({ securityServiceUrl: deps.securityServiceUrl, verifier: deps.verifier }),
    createPaymentsRouter({ provider: deps.provider }),
  );

  return app;
}
