import { Router, Response } from 'express';
import type Stripe from 'stripe';
import { CustomerRepository } from '../repositories/customer.repository';
import { BillingRequest, requireActorContext } from '../middleware/auth';
import { sendStripeError } from './stripe-error';

/** Default page size and clamp bounds for GET /invoices. */
const DEFAULT_LIMIT = 20;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

/**
 * The contract-frozen invoice projection. We expose ONLY these fields (a stable
 * subset of the Stripe Invoice) so the billing UI never depends on the raw
 * Stripe object shape. amountDue/amountPaid are cents (Stripe minor units),
 * currency is lowercased, created is ISO-8601 derived from the unix seconds.
 */
export interface BillingInvoiceView {
  id: string;
  number: string | null;
  created: string;
  amountDue: number;
  amountPaid: number;
  currency: string;
  status: string;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
}

export interface InvoicesDeps {
  // Narrow to the single Stripe call we make so unit tests can stub it.
  stripe: { invoices: Pick<Stripe.InvoicesResource, 'list'> };
  customerRepo: CustomerRepository;
}

/**
 * Maps a Stripe Invoice to the frozen BillingInvoiceView. Defensive about the
 * optional/nullable Stripe fields: number/hosted_invoice_url/invoice_pdf are
 * `null` when Stripe has not produced them (e.g. draft invoices).
 */
export function mapInvoice(inv: Stripe.Invoice): BillingInvoiceView {
  return {
    id: inv.id,
    number: inv.number ?? null,
    created: new Date(inv.created * 1000).toISOString(),
    amountDue: inv.amount_due,
    amountPaid: inv.amount_paid,
    currency: (inv.currency || '').toLowerCase(),
    status: inv.status ?? 'draft',
    hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
    invoicePdf: inv.invoice_pdf ?? null,
  };
}

/** Clamp/parse the `limit` query param to [MIN_LIMIT, MAX_LIMIT]. */
export function parseLimit(raw: unknown): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : typeof raw === 'number' ? raw : NaN;
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.trunc(n)));
}

/**
 * GET /api/v1/billing/invoices — list the proxy-authorized entity's Stripe
 * invoices (read-only). Mounted behind the internal-token guard (app.ts);
 * requireActorContext here re-derives the SERVER-DERIVED entity so identity is
 * never taken from a client query/body. A new entity with no billing customer
 * is NOT an error — it just has no invoices.
 *
 * Cursor pagination uses an opaque cursor that is a Stripe invoice id passed to
 * `starting_after`. nextCursor is the id of the LAST invoice on the page when
 * Stripe reports has_more, else null.
 */
export function createInvoicesRouter(deps: InvoicesDeps): Router {
  const router = Router();

  router.get('/invoices', requireActorContext(), async (req: BillingRequest, res: Response) => {
    const actor = req.actor!; // requireActorContext guarantees this

    const limit = parseLimit(req.query.limit);
    const cursorRaw = req.query.cursor;
    const cursor = typeof cursorRaw === 'string' && cursorRaw.trim() ? cursorRaw.trim() : undefined;

    const customer = await deps.customerRepo.findByEntity(actor.entityType, actor.entityId);
    if (!customer) {
      // No billing relationship yet -> no invoices. Absence is not an error.
      return res.status(200).json({ invoices: [], nextCursor: null });
    }

    try {
      const page = await deps.stripe.invoices.list({
        customer: customer.stripeCustomerId,
        limit,
        ...(cursor ? { starting_after: cursor } : {}),
      });

      const invoices = page.data.map(mapInvoice);
      const nextCursor =
        page.has_more && invoices.length > 0 ? invoices[invoices.length - 1].id : null;

      return res.status(200).json({ invoices, nextCursor });
    } catch (err) {
      return sendStripeError(res, err);
    }
  });

  return router;
}
