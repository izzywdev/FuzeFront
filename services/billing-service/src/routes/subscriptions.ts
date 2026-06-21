import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { SubscriptionService } from '../services/subscription.service';
import { SubscriptionRepository } from '../repositories/subscription.repository';

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
): Router {
  const router = Router();

  // POST /subscriptions — create/upgrade
  router.post('/subscriptions', async (req: Request, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid request', details: parsed.error.flatten() });
    }
    try {
      const result = await service.create(parsed.data);
      return res.status(201).json(result);
    } catch (err) {
      return res.status(502).json({ error: 'stripe error', message: errMsg(err) });
    }
  });

  // GET /subscriptions/:entityId? — by stripe subscription id path param here is the stripe sub id
  router.get('/subscriptions/:stripeSubscriptionId', async (req: Request, res: Response) => {
    const sub = await repo.findByStripeId(req.params.stripeSubscriptionId);
    if (!sub) return res.status(404).json({ error: 'not found' });
    return res.json({ subscription: sub });
  });

  // PATCH /subscriptions/:stripeSubscriptionId — change plan / seats
  router.patch('/subscriptions/:stripeSubscriptionId', async (req: Request, res: Response) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid request', details: parsed.error.flatten() });
    }
    try {
      const sub = await service.update(req.params.stripeSubscriptionId, parsed.data);
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
