import express, { Application, Request, Response } from 'express';
import type Stripe from 'stripe';
import { requireInternalToken } from './middleware/auth';
import { createWebhookRouter, WebhookDeps } from './routes/webhooks';
import { createPlansRouter } from './routes/plans';
import { createSubscriptionsRouter } from './routes/subscriptions';
import { createSetupIntentRouter } from './routes/setup-intent';
import { createCreditsRouter } from './routes/credits';
import { PlanService } from './services/plan.service';
import { SubscriptionService } from './services/subscription.service';
import { CustomerService } from './services/customer.service';
import { SubscriptionRepository } from './repositories/subscription.repository';

export interface AppDeps {
  stripe: Stripe;
  internalToken?: string;
  plans: PlanService;
  subscriptionService: SubscriptionService;
  subscriptionRepo: SubscriptionRepository;
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
  const guard = requireInternalToken(deps.internalToken);
  app.use(API_BASE, guard, createSetupIntentRouter(deps.stripe, deps.customers));
  app.use(API_BASE, guard, createSubscriptionsRouter(deps.subscriptionService, deps.subscriptionRepo));
  app.use(API_BASE, guard, createCreditsRouter(deps.stripe, deps.customers));

  return app;
}
