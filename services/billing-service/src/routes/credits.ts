import { Router, Request, Response } from 'express';
import type Stripe from 'stripe';
import { z } from 'zod';
import { CustomerService } from '../services/customer.service';
import { validateBody } from './validate';

/**
 * MEDIUM-1: bound the credit amount. Previously `amount` was an unbounded
 * integer, so a compromised/buggy admin call could issue an arbitrarily large
 * (or zero/negative) balance adjustment. We require a positive amount and cap
 * it at $100,000 (10,000,000 cents) per call — large enough for any legitimate
 * goodwill credit, small enough to blunt a fat-finger / abuse.
 */
const MAX_CREDIT_CENTS = 10_000_000;

const schema = z.object({
  entityType: z.enum(['user', 'organization']),
  entityId: z.string().uuid(),
  // cents; positive credits the customer. Bounded (MEDIUM-1).
  amount: z.number().int().positive().max(MAX_CREDIT_CENTS),
  note: z.string().max(500).optional(),
});

/**
 * POST /api/v1/billing/credits — admin-only. Adds a one-time customer balance
 * adjustment (credit) via Stripe customer balance transactions.
 */
export function createCreditsRouter(
  stripe: { customers: { createBalanceTransaction: Stripe.CustomersResource['createBalanceTransaction'] } },
  customers: CustomerService,
): Router {
  const router = Router();
  router.post('/credits', async (req: Request, res: Response) => {
    const parsed = validateBody(schema, req.body);
    if (!parsed.ok) {
      return res.status(400).json({ error: 'invalid request', details: parsed.details });
    }
    try {
      const customer = await customers.ensureCustomer(parsed.data.entityType, parsed.data.entityId);
      // Stripe treats a negative balance as account credit; flip the sign so a
      // positive `amount` (credit) reduces what the customer owes.
      const txn = await stripe.customers.createBalanceTransaction(customer.stripeCustomerId, {
        amount: -parsed.data.amount,
        currency: 'usd',
        description: parsed.data.note ?? 'manual credit',
      });
      return res.status(201).json({ id: txn.id, endingBalance: txn.ending_balance });
    } catch (err) {
      return res
        .status(502)
        .json({ error: 'stripe error', message: err instanceof Error ? err.message : String(err) });
    }
  });
  return router;
}
