import express, { Application, Request, Response } from 'express';
import type Stripe from 'stripe';
import { requireInternalToken } from './middleware/auth';
import { createWebhookRouter, WebhookDeps } from './routes/webhooks';
import { createPlansRouter } from './routes/plans';
import { createSubscriptionsRouter } from './routes/subscriptions';
import { createSetupIntentRouter } from './routes/setup-intent';
import { createCreditsRouter } from './routes/credits';
import { createCheckoutRouter } from './routes/checkout';
import { PlanService } from './services/plan.service';
import { SubscriptionService } from './services/subscription.service';
import { CustomerService } from './services/customer.service';
import { SubscriptionRepository } from './repositories/subscription.repository';
import { CustomerRepository } from './repositories/customer.repository';

export interface AppDeps {
  stripe: Stripe;
  internalToken?: string;
  plans: PlanService;
  subscriptionService: SubscriptionService;
  subscriptionRepo: SubscriptionRepository;
  /** Read-only entity->customer resolver for GET /subscriptions (list by org). */
  customerRepo: CustomerRepository;
  customers: CustomerService;
  webhook: WebhookDeps;
}

const API_BASE = '/api/v1/billing';

/**
 * Assembles the billing-service Express app.
 *
 * Route ordering matters: the Stripe webhook router uses express.raw and MUST
 * be mounted before the global express.json() so signature verification sees
 * the unparsed body. The webhook route is public (Stripe-signature verified),
 * not behind the internal-token guard.
 *
 * Called with no args, returns a minimal app exposing only /health (used by
 * the existing scaffold health test and as a degraded fallback when no Stripe
 * key is configured).
 */
export function createApp(deps?: AppDeps): Application {
  const app = express();

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'billing-service' });
  });

  if (!deps) return app;

  // 1) Webhook (raw body) — before express.json, public + sig-verified.
  app.use(API_BASE, createWebhookRouter(deps.webhook));

  // 2) JSON body parser for the rest.
  app.use(express.json());

  // 3) Public plans listing (no auth).
  app.use(API_BASE, createPlansRouter(deps.plans));

  // 4) Internal-token-guarded routes.
  //
  //  - `guard` (requireInternalToken) proves the host proxy is the caller and
  //    fails CLOSED in production when the token is unset (HIGH-2).
  //  - `actorCtx` (requireActorContext) parses the proxy-injected, server-
  //    derived actor/entity headers so the money path can re-verify the
  //    object↔entity binding (CRITICAL-2 / MEDIUM-1). It is applied as a hard
  //    gate on the NEW /checkout route (which this slice owns). The existing
  //    /subscriptions, /setup-intent and /credits routes are governed by the
  //    FROZEN contract + its independent test suite; their hardening (mandatory
  //    actor headers + the credits admin guard) is enforced INSIDE the route
  //    handlers, ACTIVATED when the proxy supplies the trusted headers, so the
  //    frozen contract is not broken while drift is fixed via a contract bump.
  // NOTE: `guard` is applied at the API_BASE level (matches the prior wiring).
  // The per-route guards (requireActorContext on /checkout, requireAdmin on
  // /credits) are applied INSIDE their routers, scoped to the exact method+path
  // — NOT here as path-prefix middleware — so they do not intercept unrelated
  // sub-paths (e.g. a stray GET /api/v1/billing/health would otherwise 401
  // before reaching its 404).
  const guard = requireInternalToken(deps.internalToken);

  // Hosted Checkout — subscription mode. The checkout router applies
  // requireActorContext on its POST so the org↔entity binding is re-verified.
  app.use(
    API_BASE,
    guard,
    createCheckoutRouter({ stripe: deps.stripe, customers: deps.customers, plans: deps.plans }),
  );
  app.use(API_BASE, guard, createSetupIntentRouter(deps.stripe, deps.customers));
  app.use(
    API_BASE,
    guard,
    createSubscriptionsRouter(deps.subscriptionService, deps.subscriptionRepo, deps.customerRepo),
  );
  // Credits is admin-only (HIGH-1): the credits router applies requireAdmin on
  // its POST (the X-Billing-Actor-Is-Admin gate the prior route was missing).
  app.use(API_BASE, guard, createCreditsRouter(deps.stripe, deps.customers));

  return app;
}
