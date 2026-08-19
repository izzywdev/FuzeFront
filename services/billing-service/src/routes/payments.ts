import { createHash } from 'node:crypto';
import { Router, Response } from 'express';
import type Stripe from 'stripe';
import { z } from 'zod';
import { CustomerService } from '../services/customer.service';
import { CustomerRepository } from '../repositories/customer.repository';
import { PaymentRepository } from '../repositories/payment.repository';
import { PaymentsConfig } from '../config';
import { BillingPayment, PaymentStatus } from '../types';
import { BillingRequest, requireActorContext } from '../middleware/auth';
import { validateBody } from './validate';
import { sendStripeError } from './stripe-error';

/**
 * Build the payment-Checkout-Session idempotency key.
 *
 * Same scheme as checkout.ts (BUG 1): the key embeds a stable fingerprint of
 * ALL request parameters, so TRUE retries (identical inputs — rapid
 * double-clicks, network replays) dedupe to one Stripe session, while ANY
 * changed parameter (different line items, urls, order) yields a NEW key —
 * a fresh session instead of a 24h "same parameters" idempotency error.
 */
export interface PaymentLineItemInput {
  name: string;
  description?: string;
  unitAmountCents: number;
  quantity: number;
}

export function paymentCheckoutIdempotencyKey(parts: {
  actorUserId: string;
  productKey: string;
  externalOrderId: string;
  entityType: string;
  entityId: string;
  currency: string;
  lineItems: PaymentLineItemInput[];
  successUrl: string;
  cancelUrl: string;
}): string {
  // Order is fixed and explicit so the digest is deterministic across calls.
  const fingerprint = JSON.stringify([
    parts.actorUserId,
    parts.productKey,
    parts.externalOrderId,
    parts.entityType,
    parts.entityId,
    parts.currency,
    parts.lineItems.map((li) => [li.name, li.description ?? null, li.unitAmountCents, li.quantity]),
    parts.successUrl,
    parts.cancelUrl,
  ]);
  const hash = createHash('sha256').update(fingerprint).digest('hex').slice(0, 16);
  // Human-readable prefix for log/dashboard correlation; the hash makes it
  // param-sensitive. (Stripe idempotency keys allow up to 255 chars.)
  return `payment-checkout-${parts.productKey}-${parts.entityId}-${hash}`;
}

/**
 * POST /api/v1/billing/payments/checkout — hosted Stripe Checkout Session in
 * ONE-TIME `payment` mode for allowlisted consumer products (e.g. the
 * MendysRobotics datasets marketplace, productKey `mendys-datasets`). The
 * caller supplies priced line items; we build Stripe `price_data` from them —
 * no catalogue price required. Card data never touches our surface (hosted
 * Checkout, exactly like POST /checkout).
 *
 * Auth model (GATING — money path, mirrors /checkout):
 *   - The internal-token guard (app.ts) proves the host proxy is the caller.
 *   - `requireActorContext` supplies the SERVER-DERIVED, proxy-authorized
 *     actor + entity via trusted headers (X-Billing-* / X-FF-*).
 *   - CRITICAL-2: we re-verify the body's `entityType`/`entityId` MATCH the
 *     proxy-authorized entity before creating any Stripe object. A client
 *     cannot make us bill another entity by passing a foreign id in the body.
 *   - MEDIUM-1-style server bounds: productKey allowlist, currency allowlist,
 *     per-line and order-total cent caps — we never trust client amounts
 *     beyond the configured ceiling.
 */
const lineItemSchema = z.object({
  name: z.string().min(1).max(250),
  description: z.string().min(1).max(500).optional(),
  unitAmountCents: z.number().int().positive(),
  quantity: z.number().int().positive(),
});

const schema = z.object({
  productKey: z.string().min(1),
  externalOrderId: z.string().min(1).max(200),
  entityType: z.enum(['user', 'organization']),
  entityId: z.string().uuid(),
  currency: z.string().length(3),
  lineItems: z.array(lineItemSchema).min(1).max(50),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

export interface PaymentsDeps {
  stripe: {
    checkout: { sessions: Pick<Stripe.Checkout.SessionsResource, 'create' | 'retrieve'> };
  };
  customers: CustomerService;
  /** Read-only entity resolver for the GET fallback's ownership re-check. */
  customerRepo: CustomerRepository;
  payments: PaymentRepository;
  config: PaymentsConfig;
}

export function createPaymentsRouter(deps: PaymentsDeps): Router {
  const router = Router();

  // requireActorContext runs FIRST (scoped to this route): it 401s when the
  // proxy-injected actor/entity headers are absent so the entity re-check
  // below can never be bypassed by a client body field.
  router.post(
    '/payments/checkout',
    requireActorContext(),
    async (req: BillingRequest, res: Response) => {
      const parsed = validateBody(schema, req.body);
      if (!parsed.ok) {
        return res.status(400).json({ error: 'invalid request', details: parsed.details });
      }
      const body = parsed.data;
      const currency = body.currency.toLowerCase();
      // Under this service's `strict: false` tsconfig, zod's inferred output
      // type degrades to all-optional — re-assert the validated shape once.
      const lineItems = body.lineItems as PaymentLineItemInput[];

      // CRITICAL-2: re-verify the target entity against the proxy-authorized
      // one. requireActorContext guarantees req.actor; fail closed regardless.
      const actor = req.actor;
      if (!actor) {
        return res.status(401).json({ error: 'missing actor context' });
      }
      if (actor.entityType !== body.entityType || actor.entityId !== body.entityId) {
        return res.status(403).json({
          error: 'forbidden',
          message: 'entityType/entityId does not match the authorized billing entity',
        });
      }

      // Product-key allowlist (BILLING_PRODUCT_KEYS). Empty allowlist =
      // payment path disabled (fail closed / merge-dark switch).
      if (!deps.config.productKeys.includes(body.productKey.toLowerCase())) {
        return res.status(400).json({
          error: 'invalid productKey',
          message: `productKey "${body.productKey}" is not allowlisted for payment checkout`,
        });
      }

      // Currency allowlist.
      if (!deps.config.currencies.includes(currency)) {
        return res.status(400).json({
          error: 'invalid currency',
          message: `currency "${currency}" is not supported (allowed: ${deps.config.currencies.join(', ')})`,
        });
      }

      // Per-line + order-total cent bounds (server-side money cap).
      const max = deps.config.maxTotalCents;
      let totalCents = 0;
      for (const li of lineItems) {
        const lineTotal = li.unitAmountCents * li.quantity;
        if (li.unitAmountCents > max || lineTotal > max) {
          return res.status(400).json({
            error: 'amount out of bounds',
            message: `line item "${li.name}" exceeds the ${max} cent limit`,
          });
        }
        totalCents += lineTotal;
      }
      if (totalCents > max) {
        return res.status(400).json({
          error: 'amount out of bounds',
          message: `order total ${totalCents} exceeds the ${max} cent limit`,
        });
      }

      try {
        const customer = await deps.customers.ensureCustomer(body.entityType, body.entityId);

        const session = await deps.stripe.checkout.sessions.create(
          {
            mode: 'payment',
            customer: customer.stripeCustomerId,
            line_items: lineItems.map((li) => ({
              price_data: {
                currency,
                product_data: {
                  name: li.name,
                  ...(li.description ? { description: li.description } : {}),
                },
                unit_amount: li.unitAmountCents,
              },
              quantity: li.quantity,
            })),
            success_url: body.successUrl,
            cancel_url: body.cancelUrl,
            // Stamp session AND intent so every webhook (session-shaped or
            // PaymentIntent-shaped) can correlate back to the product order.
            metadata: { productKey: body.productKey, externalOrderId: body.externalOrderId },
            payment_intent_data: {
              metadata: { productKey: body.productKey, externalOrderId: body.externalOrderId },
            },
            client_reference_id: body.externalOrderId,
          },
          {
            idempotencyKey: paymentCheckoutIdempotencyKey({
              actorUserId: actor.actorUserId,
              productKey: body.productKey,
              externalOrderId: body.externalOrderId,
              entityType: body.entityType,
              entityId: body.entityId,
              currency,
              lineItems,
              successUrl: body.successUrl,
              cancelUrl: body.cancelUrl,
            }),
          },
        );

        // Mirror the session as 'pending' immediately so reconciliation
        // (GET /payments/sessions/:id) works before the first webhook lands.
        // Best-effort: the Stripe session already exists; if the mirror write
        // fails the webhook upsert (or the GET's live-Stripe fallback)
        // converges the row later.
        try {
          await deps.payments.upsert({
            sessionId: session.id,
            paymentIntentId:
              typeof session.payment_intent === 'string'
                ? session.payment_intent
                : session.payment_intent?.id ?? null,
            productKey: body.productKey,
            externalOrderId: body.externalOrderId,
            entityType: body.entityType,
            entityId: body.entityId,
            amountTotalCents: session.amount_total ?? totalCents,
            currency,
            status: 'pending',
          });
        } catch (err) {
          console.error(
            `[payments] failed to mirror pending session ${session.id}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }

        return res.status(200).json({ sessionId: session.id, url: session.url });
      } catch (err) {
        // BUG 2 classification (see stripe-error.ts): client/validation/
        // idempotency-conflict map to 4xx/409; genuine upstream failures to 502.
        return sendStripeError(res, err);
      }
    },
  );

  /**
   * GET /api/v1/billing/payments/sessions/:sessionId — reconciliation polling.
   * Returns the local mirror row; when the row is missing (mirror write lost /
   * DB restored) falls back to live Stripe, but ONLY for sessions whose
   * metadata carries an allowlisted productKey, and re-mirrors the row.
   * Ownership is re-verified against the proxy-authorized entity (403).
   */
  router.get(
    '/payments/sessions/:sessionId',
    requireActorContext(),
    async (req: BillingRequest, res: Response) => {
      const actor = req.actor!; // requireActorContext guarantees this
      const sessionId = req.params.sessionId;

      const row = await deps.payments.getBySessionId(sessionId);
      if (row) {
        if (row.entityType !== actor.entityType || row.entityId !== actor.entityId) {
          return res.status(403).json({
            error: 'forbidden',
            message: 'session does not belong to the authorized billing entity',
          });
        }
        return res.status(200).json({ payment: row });
      }

      // Live-Stripe fallback for a lost mirror row.
      let session: Stripe.Checkout.Session;
      try {
        session = await deps.stripe.checkout.sessions.retrieve(sessionId);
      } catch (err) {
        // An unknown session id is a 404 on our surface, not a Stripe 5xx.
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 404 || (err as { code?: string })?.code === 'resource_missing') {
          return res.status(404).json({ error: 'payment session not found' });
        }
        return sendStripeError(res, err);
      }

      const productKey = (session.metadata?.productKey ?? '').toLowerCase();
      if (
        session.mode !== 'payment' ||
        !productKey ||
        !deps.config.productKeys.includes(productKey)
      ) {
        // Not a payment-mode session of a known product — as far as this
        // surface is concerned it does not exist.
        return res.status(404).json({ error: 'payment session not found' });
      }

      // Ownership: resolve the local entity from the session's Stripe customer
      // and re-verify it against the proxy-authorized entity (fail closed).
      const stripeCustomerId =
        typeof session.customer === 'string' ? session.customer : session.customer?.id;
      const entity = stripeCustomerId
        ? await deps.customerRepo.findByStripeCustomerId(stripeCustomerId)
        : null;
      if (!entity) {
        return res.status(404).json({ error: 'payment session not found' });
      }
      if (entity.entityType !== actor.entityType || entity.entityId !== actor.entityId) {
        return res.status(403).json({
          error: 'forbidden',
          message: 'session does not belong to the authorized billing entity',
        });
      }

      const payment: BillingPayment = await deps.payments.upsert({
        sessionId: session.id,
        paymentIntentId:
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id ?? null,
        productKey: session.metadata?.productKey ?? productKey,
        externalOrderId: session.metadata?.externalOrderId ?? session.client_reference_id ?? '',
        entityType: entity.entityType,
        entityId: entity.entityId,
        amountTotalCents: session.amount_total ?? 0,
        currency: (session.currency ?? '').toLowerCase(),
        status: paymentStatusFromSession(session),
      });

      return res.status(200).json({ payment });
    },
  );

  return router;
}

/** Derive the mirror status from a live Stripe Checkout Session. */
export function paymentStatusFromSession(session: {
  status?: Stripe.Checkout.Session.Status | null;
  payment_status?: Stripe.Checkout.Session.PaymentStatus | null;
}): PaymentStatus {
  if (session.status === 'expired') return 'expired';
  if (session.payment_status === 'paid') return 'paid';
  return 'pending';
}
