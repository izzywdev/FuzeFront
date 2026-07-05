import express, { Router, Request, Response } from 'express';
import type Stripe from 'stripe';
import { EventRepository } from '../repositories/event.repository';
import { HandlerContext } from '../handlers/types';
import { routeWebhookEvent } from '../handlers/webhook-router';

export interface WebhookDeps {
  /** Only the webhooks resource is needed for signature verification. */
  stripe: { webhooks: Pick<Stripe.Webhooks, 'constructEvent'> };
  webhookSecret: string;
  events: EventRepository;
  ctx: HandlerContext;
}

/**
 * Stripe webhook receiver. MUST be mounted with express.raw so the body is the
 * exact bytes Stripe signed — JSON parsing would break signature verification.
 *
 * Flow: verify signature → dedup on stripe_event_id → route to handler → 200.
 * Duplicate deliveries return 200 immediately without re-processing.
 */
export function createWebhookRouter(deps: WebhookDeps): Router {
  const router = Router();

  router.post(
    '/webhooks/stripe',
    express.raw({ type: 'application/json' }),
    async (req: Request, res: Response) => {
      const sig = req.headers['stripe-signature'];
      if (!sig) {
        return res.status(400).send('Missing stripe-signature header');
      }

      let event: Stripe.Event;
      try {
        event = deps.stripe.webhooks.constructEvent(
          req.body as Buffer,
          sig as string,
          deps.webhookSecret,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return res.status(400).send(`Webhook Error: ${msg}`);
      }

      // Idempotency: only the first delivery of this event id is processed.
      const isNew = await deps.events.recordIfNew(event.id, event.type, event);
      if (!isNew) {
        return res.status(200).json({ received: true, duplicate: true });
      }

      try {
        await routeWebhookEvent(event, deps.ctx);
      } catch (err) {
        // Returning 500 makes Stripe retry; the dedup row is already written,
        // so a retry would short-circuit. We therefore log and return 200 to
        // avoid a poison-pill loop — the event is captured in stripe_events
        // for manual replay/inspection.
        console.error(
          `[webhooks] handler error for ${event.type} (${event.id}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      return res.status(200).json({ received: true });
    },
  );

  return router;
}
