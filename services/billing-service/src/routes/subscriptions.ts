import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { SubscriptionService } from '../services/subscription.service';
import { SubscriptionRepository } from '../repositories/subscription.repository';
import { CustomerRepository } from '../repositories/customer.repository';
import { CreateSubscriptionRequest, UpdateSubscriptionRequest } from '../types';
import { validateBody } from './validate';
import { requireActorContext, BillingRequest } from '../middleware/auth';

const createSchema = z.object({
  entityType: z.enum(['user', 'organization']),
  entityId: z.string().uuid(),
  priceId: z.string().min(1),
  trial: z.boolean().optional(),
  trialPeriodDays: z.number().int().positive().optional(),
  seatQuantity: z.number().int().positive().optional(),
  paymentMethodId: z.string().optional(),
});

const updateSchema = z.object({
  priceId: z.string().min(1).optional(),
  seatQuantity: z.number().int().positive().optional(),
});

export function createSubscriptionsRouter(
  service: SubscriptionService,
  repo: SubscriptionRepository,
  customerRepo: CustomerRepository,
): Router {
  const router = Router();

  // GET /subscriptions?... — current subscription for the proxy-authorized
  // entity. Read-only. The host proxy is the trust boundary: it has already
  // authenticated the platform JWT and authorized the caller against the target
  // entity (object-level / BOLA defence), then injected the SERVER-DERIVED actor
  // context as the trusted X-Billing-*/X-FF-* headers. requireActorContext
  // re-derives that here (and rejects when the proxy did not set it). We then
  // resolve the entity -> billing customer -> current subscription, returning
  // { subscription: <view> | null }. Absence is NOT an error (the UI treats null
  // as "no current subscription"), so we 200 {subscription:null} rather than 404.
  //
  // NOTE: registered BEFORE GET /subscriptions/:stripeSubscriptionId so the
  // param route does not shadow this collection route.
  router.get(
    '/subscriptions',
    requireActorContext(),
    async (req: BillingRequest, res: Response) => {
      const actor = req.actor!; // requireActorContext guarantees this
      const customer = await customerRepo.findByEntity(actor.entityType, actor.entityId);
      if (!customer) {
        // The entity has no billing customer yet -> no subscription.
        return res.json({ subscription: null });
      }
      const sub = await repo.findByCustomer(customer.id);
      return res.json({ subscription: sub ?? null });
    },
  );

  // POST /subscriptions — create/upgrade
  router.post('/subscriptions', async (req: Request, res: Response) => {
    const parsed = validateBody(createSchema, req.body);
    if (!parsed.ok) {
      return res.status(400).json({ error: 'invalid request', details: parsed.details });
    }
    try {
      const result = await service.create(parsed.data as CreateSubscriptionRequest);
      return res.status(201).json(result);
    } catch (err) {
      return res.status(502).json({ error: 'stripe error', message: errMsg(err) });
    }
  });

  // GET /subscriptions/:stripeSubscriptionId
  router.get('/subscriptions/:stripeSubscriptionId', async (req: Request, res: Response) => {
    const sub = await repo.findByStripeId(req.params.stripeSubscriptionId);
    if (!sub) return res.status(404).json({ error: 'not found' });
    return res.json({ subscription: sub });
  });

  // PATCH /subscriptions/:stripeSubscriptionId — change plan / seats
  router.patch('/subscriptions/:stripeSubscriptionId', async (req: Request, res: Response) => {
    const parsed = validateBody(updateSchema, req.body);
    if (!parsed.ok) {
      return res.status(400).json({ error: 'invalid request', details: parsed.details });
    }
    try {
      const sub = await service.update(
        req.params.stripeSubscriptionId,
        parsed.data as UpdateSubscriptionRequest,
      );
      return res.json({ subscription: sub });
    } catch (err) {
      return res.status(502).json({ error: 'stripe error', message: errMsg(err) });
    }
  });

  // DELETE /subscriptions/:stripeSubscriptionId — cancel at period end
  router.delete('/subscriptions/:stripeSubscriptionId', async (req: Request, res: Response) => {
    try {
      const sub = await service.cancel(req.params.stripeSubscriptionId);
      return res.json({ subscription: sub });
    } catch (err) {
      return res.status(502).json({ error: 'stripe error', message: errMsg(err) });
    }
  });

  return router;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
