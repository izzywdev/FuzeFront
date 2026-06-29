import { Router, Response } from 'express';
import type Stripe from 'stripe';
import { z } from 'zod';
import { CustomerService } from '../services/customer.service';
import { PlanService } from '../services/plan.service';
import { BillingRequest, requireActorContext } from '../middleware/auth';
import { validateBody } from './validate';

/**
 * POST /api/v1/billing/checkout — create a hosted Stripe Checkout Session
 * (subscription mode). The browser is redirected to the returned Stripe-hosted
 * URL where Stripe collects card details; on completion Stripe fires
 * `checkout.session.completed` (handled by the webhook) which activates the
 * local subscription mirror.
 *
 * We use HOSTED Checkout (not in-app Elements) for the live-charge flow: Stripe
 * hosts the card form, so no raw card data ever touches our surface.
 *
 * Auth model (GATING — money path):
 *   - The internal-token guard (app.ts) proves the host proxy is the caller.
 *   - `requireActorContext` (app.ts) supplies the SERVER-DERIVED, proxy-
 *     authorized actor + entity via trusted headers (X-Billing-* / X-FF-*).
 *   - CRITICAL-2: we re-verify the body's `organizationId` MATCHES the
 *     proxy-authorized org (req.actor) before creating any Stripe object. A
 *     client cannot make us bill another org by passing a foreign id in the
 *     body — the authorized entity wins.
 *   - MEDIUM-1: planId is validated against the active plan catalogue
 *     (unknown plan → 400); we never trust a client-supplied priceId.
 */
const schema = z.object({
  planId: z.string().min(1),
  organizationId: z.string().uuid(),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

export interface CheckoutDeps {
  stripe: { checkout: { sessions: Pick<Stripe.Checkout.SessionsResource, 'create'> } };
  customers: CustomerService;
  plans: PlanService;
}

export function createCheckoutRouter(deps: CheckoutDeps): Router {
  const router = Router();

  // requireActorContext runs FIRST (scoped to this route): it 401s when the
  // proxy-injected actor/entity headers are absent so the org re-check below
  // can never be bypassed by a client body field.
  router.post('/checkout', requireActorContext(), async (req: BillingRequest, res: Response) => {
    const parsed = validateBody(schema, req.body);
    if (!parsed.ok) {
      return res.status(400).json({ error: 'invalid request', details: parsed.details });
    }
    const { planId, organizationId, successUrl, cancelUrl } = parsed.data;

    // CRITICAL-2: re-verify the target org against the proxy-authorized entity.
    // requireActorContext guarantees req.actor is present; if for some reason it
    // is not, fail closed.
    const actor = req.actor;
    if (!actor) {
      return res.status(401).json({ error: 'missing actor context' });
    }
    if (actor.entityType !== 'organization' || actor.entityId !== organizationId) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'organizationId does not match the authorized billing entity',
      });
    }

    // MEDIUM-1: resolve+validate the plan against the active catalogue. Unknown
    // plan ids (or non-purchasable tiers) are rejected — we never accept a
    // client-supplied raw priceId.
    let priceId: string;
    try {
      priceId = await deps.plans.resolvePriceId(planId);
    } catch (err) {
      return res.status(400).json({
        error: 'invalid plan',
        message: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      const customer = await deps.customers.ensureCustomer('organization', organizationId);

      const session = await deps.stripe.checkout.sessions.create(
        {
          mode: 'subscription',
          customer: customer.stripeCustomerId,
          line_items: [{ price: priceId, quantity: 1 }],
          success_url: successUrl,
          cancel_url: cancelUrl,
          subscription_data: { metadata: { organizationId } },
          // Stamp the session too so the checkout.session.completed handler can
          // resolve the org without an extra Stripe round-trip.
          metadata: { organizationId, planId },
          client_reference_id: organizationId,
        },
        // Idempotency: a retry of the same actor+org+plan won't create a second
        // Checkout Session (Stripe replays the original response within 24h).
        { idempotencyKey: `checkout-${organizationId}-${priceId}-${actor.actorUserId}` },
      );

      return res.status(200).json({ url: session.url, sessionId: session.id });
    } catch (err) {
      return res.status(502).json({
        error: 'stripe error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return router;
}
