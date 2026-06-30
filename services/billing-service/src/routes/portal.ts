import { Router, Response } from 'express';
import type Stripe from 'stripe';
import { z } from 'zod';
import { CustomerRepository } from '../repositories/customer.repository';
import { BillingRequest, requireActorContext } from '../middleware/auth';
import { validateBody } from './validate';
import { sendStripeError } from './stripe-error';

const schema = z.object({
  returnUrl: z.string().url(),
});

export interface PortalDeps {
  // Narrow to the single Stripe call we make so unit tests can stub it.
  stripe: { billingPortal: { sessions: Pick<Stripe.BillingPortal.SessionsResource, 'create'> } };
  customerRepo: CustomerRepository;
}

/**
 * POST /api/v1/billing/portal — open a Stripe Customer Portal session for the
 * proxy-authorized entity and return its url for the browser to redirect to.
 * Mounted behind the internal-token guard (app.ts); requireActorContext here
 * re-derives the SERVER-DERIVED entity so the portal is always scoped to the
 * authorized customer — the entity is NEVER taken from the request body.
 *
 * Unlike GET /invoices, an entity with no billing customer cannot open a portal
 * (there is nothing to manage) -> 409, not an empty success.
 */
export function createPortalRouter(deps: PortalDeps): Router {
  const router = Router();

  router.post('/portal', requireActorContext(), async (req: BillingRequest, res: Response) => {
    const parsed = validateBody(schema, req.body);
    if (!parsed.ok) {
      return res.status(400).json({ error: 'invalid request', details: parsed.details });
    }
    const { returnUrl } = parsed.data;

    const actor = req.actor!; // requireActorContext guarantees this
    const customer = await deps.customerRepo.findByEntity(actor.entityType, actor.entityId);
    if (!customer) {
      return res.status(409).json({
        error: 'no billing customer',
        message:
          'this entity has no Stripe billing customer yet — there is nothing to manage in the portal',
      });
    }

    try {
      const session = await deps.stripe.billingPortal.sessions.create({
        customer: customer.stripeCustomerId,
        return_url: returnUrl,
      });
      return res.status(200).json({ url: session.url });
    } catch (err) {
      return sendStripeError(res, err);
    }
  });

  return router;
}
