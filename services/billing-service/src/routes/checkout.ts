import { createHash } from 'node:crypto';
import { Router, Response } from 'express';
import type Stripe from 'stripe';
import { z } from 'zod';
import { CustomerService } from '../services/customer.service';
import { PlanService } from '../services/plan.service';
import { BillingRequest, requireActorContext } from '../middleware/auth';
import { validateBody } from './validate';
import { sendStripeError } from './stripe-error';

/**
 * Build the Checkout-Session idempotency key.
 *
 * BUG 1 fix — the key MUST incorporate a stable fingerprint of the request
 * parameters. A purely org+price+user key is OVER-deterministic: Stripe's 24h
 * idempotency window rejects a reuse with *different* params
 * ("Keys for idempotent requests can only be used with the same parameters they
 * were first used with"), which in prod poisoned an org's key for ~24h when the
 * successUrl/cancelUrl changed.
 *
 * By hashing {organizationId, userId, priceId, mode, successUrl, cancelUrl} we
 * keep TRUE retries idempotent (identical inputs -> identical key, so rapid
 * double-clicks dedupe to one session) while a changed param set yields a NEW
 * key — a fresh session instead of a hard Stripe error.
 */
export function checkoutIdempotencyKey(parts: {
  organizationId: string;
  userId: string;
  priceId: string;
  mode: string;
  successUrl: string;
  cancelUrl: string;
}): string {
  // Order is fixed and explicit so the digest is deterministic across calls.
  const fingerprint = JSON.stringify([
    parts.organizationId,
    parts.userId,
    parts.priceId,
    parts.mode,
    parts.successUrl,
    parts.cancelUrl,
  ]);
  const hash = createHash('sha256').update(fingerprint).digest('hex').slice(0, 16);
  // Keep the human-readable prefix for log/dashboard correlation; the hash makes
  // it param-sensitive. (Stripe idempotency keys allow up to 255 chars.)
  return `checkout-${parts.organizationId}-${parts.priceId}-${parts.userId}-${hash}`;
}

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

      const mode = 'subscription';
      const session = await deps.stripe.checkout.sessions.create(
        {
          mode,
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
        // Idempotency: a retry of the SAME actor+org+plan AND SAME params won't
        // create a second Checkout Session (Stripe replays the original within
        // 24h). The key embeds a param fingerprint (BUG 1) so a changed
        // success/cancel URL yields a fresh key instead of a 24h-poisoning
        // "same parameters" idempotency error.
        {
          idempotencyKey: checkoutIdempotencyKey({
            organizationId,
            userId: actor.actorUserId,
            priceId,
            mode,
            successUrl,
            cancelUrl,
          }),
        },
      );

      return res.status(200).json({ url: session.url, sessionId: session.id });
    } catch (err) {
      // BUG 2: classify Stripe errors. Client/validation/idempotency-conflict
      // map to 4xx/409 (so Cloudflare/the browser sees the real cause); only
      // genuine upstream/unknown failures map to 502.
      return sendStripeError(res, err);
    }
  });

  return router;
}
