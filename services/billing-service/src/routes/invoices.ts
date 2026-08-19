import { Router, Response } from 'express';
import { BillingRequest, requireActorContext } from '../middleware/auth';
import { InvoiceService } from '../services/invoice.service';
import { sendStripeError } from './stripe-error';

// Re-export the neutral view shape from the repository so existing importers of
// `BillingInvoiceView` from this module keep working after the DB-backed rewrite.
export type { BillingInvoiceView } from '../repositories/invoice.repository';

/** Default page size and clamp bounds for GET /invoices. */
const DEFAULT_LIMIT = 20;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

export interface InvoicesDeps {
  /** Vendor-neutral, DB-backed invoice read/sync service. */
  service: InvoiceService;
}

/** Clamp/parse the `limit` query param to [MIN_LIMIT, MAX_LIMIT]. */
export function parseLimit(raw: unknown): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : typeof raw === 'number' ? raw : NaN;
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.trunc(n)));
}

/**
 * Invoice routes for the proxy-authorized entity. Mounted behind the
 * internal-token guard (app.ts); `requireActorContext` re-derives the
 * SERVER-DERIVED entity so identity is never taken from a client query/body.
 *
 *  - GET  /invoices       reads the local, provider-synced invoice store
 *                         (opaque keyset cursor). An entity with no billing
 *                         customer is NOT an error — it just has no invoices.
 *  - POST /invoices/sync  forces a provider→store resync and returns {synced}.
 *                         Idempotent.
 */
export function createInvoicesRouter(deps: InvoicesDeps): Router {
  const router = Router();

  router.get('/invoices', requireActorContext(), async (req: BillingRequest, res: Response) => {
    const actor = req.actor!; // requireActorContext guarantees this

    const limit = parseLimit(req.query.limit);
    const cursorRaw = req.query.cursor;
    const cursor = typeof cursorRaw === 'string' && cursorRaw.trim() ? cursorRaw.trim() : undefined;

    try {
      const page = await deps.service.list(
        { entityType: actor.entityType, entityId: actor.entityId },
        { limit, cursor },
      );
      return res.status(200).json(page);
    } catch (err) {
      return sendStripeError(res, err);
    }
  });

  router.post('/invoices/sync', requireActorContext(), async (req: BillingRequest, res: Response) => {
    const actor = req.actor!; // requireActorContext guarantees this

    try {
      const synced = await deps.service.syncEntity({
        entityType: actor.entityType,
        entityId: actor.entityId,
      });
      return res.status(200).json({ synced });
    } catch (err) {
      return sendStripeError(res, err);
    }
  });

  return router;
}
