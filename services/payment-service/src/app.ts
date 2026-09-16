import express, { Application, NextFunction, Request, Response } from 'express';
import { requireMachineAuth, type MachineTokenVerifier } from '@fuzefront/service-auth';
import { createPaymentsRouter, createWebhookRouter } from './routes/payments';
import { PaymentProvider } from './providers/payment-provider';

export interface AppDeps {
  /** The active vendor adapter behind the neutral port. */
  provider: PaymentProvider;
  /**
   * Machine-token verifier used to authenticate callers of the neutral Payment
   * Provider API (billing-service / the host proxy), built by the caller
   * (`index.ts`) via `@fuzefront/service-auth`'s `createMachineTokenVerifier({
   * baseUrl: SECURITY_SERVICE_URL })`, or injected directly by tests.
   *
   * ABSENT means unconfigured — see the fail-closed gating in `createApp` below.
   * Replaces the retired `internalToken?: string` (static `PAYMENT_INTERNAL_TOKEN`
   * bearer).
   */
  verifier?: MachineTokenVerifier;
}

const API_BASE = '/api/v1/payments';

/**
 * Deny-all guard mounted in place of `requireMachineAuth` when no verifier is
 * configured (`SECURITY_SERVICE_URL` unset). This is the fail-CLOSED flip from
 * the old `PAYMENT_INTERNAL_TOKEN` behaviour, which was OPEN when the token was
 * unset — every request here is rejected, and `next()` is never called.
 */
function machineAuthNotConfigured(_req: Request, res: Response, _next: NextFunction): void {
  res.status(503).json({ error: 'machine auth not configured' });
}

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

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'payment-service' });
  });

  if (!deps) return app;

  // 1) Webhook (raw body) — before express.json, public + signature-verified.
  app.use(API_BASE, express.raw({ type: '*/*' }), createWebhookRouter({ provider: deps.provider }));

  // 2) JSON body parser for the rest of the neutral API.
  app.use(express.json());

  // 3) Neutral Payment Provider API. Fails CLOSED:
  //    - verifier present  -> gate with `requireMachineAuth` (401 on missing/
  //      invalid/inactive token, from `@fuzefront/service-auth`).
  //    - verifier ABSENT   -> deny-all 503 guard; never calls next(). This is
  //      the deliberate flip from the old "open when PAYMENT_INTERNAL_TOKEN is
  //      unset" behaviour.
  const guard = deps.verifier
    ? // `@fuzefront/service-auth` types its handler against express 4 (its
      // optional peer's @types default); payment-service is on express 5. The
      // two `Request` type copies are structurally incompatible (`param` etc.),
      // so bridge them at this single boundary — it is a plain express
      // middleware function at runtime.
      (requireMachineAuth({ verifier: deps.verifier }) as unknown as express.RequestHandler)
    : machineAuthNotConfigured;

  app.use(API_BASE, guard, createPaymentsRouter({ provider: deps.provider }));

  return app;
}
