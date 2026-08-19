import { Router, Request, Response } from 'express';
import type Stripe from 'stripe';
import { z } from 'zod';
import { CustomerService } from '../services/customer.service';
import { validateBody } from './validate';

const schema = z.object({
  entityType: z.enum(['user', 'organization']),
  entityId: z.string().uuid(),
});

/**
 * POST /api/v1/billing/setup-intent — create a SetupIntent so the client can
 * collect a payment method without an immediate charge (e.g. add a card during
 * a no-card trial). Returns the client_secret for the Payment Element.
 */
export function createSetupIntentRouter(
  stripe: { setupIntents: Pick<Stripe.SetupIntentsResource, 'create'> },
  customers: CustomerService,
): Router {
  const router = Router();
  router.post('/setup-intent', async (req: Request, res: Response) => {
    const parsed = validateBody(schema, req.body);
    if (!parsed.ok) {
      return res.status(400).json({ error: 'invalid request', details: parsed.details });
    }
    try {
      const customer = await customers.ensureCustomer(parsed.data.entityType, parsed.data.entityId);
      const intent = await stripe.setupIntents.create({
        customer: customer.stripeCustomerId,
        usage: 'off_session',
      });
      return res.json({ clientSecret: intent.client_secret });
    } catch (err) {
      return res
        .status(502)
        .json({ error: 'stripe error', message: err instanceof Error ? err.message : String(err) });
    }
  });
  return router;
}
