import { HandlerContext } from './types';

/**
 * Persists an invoice.* webhook into the local billing.invoices store.
 *
 * Runs for `invoice.paid|invoice.payment_succeeded|invoice.payment_failed|
 * invoice.finalized|invoice.updated` (see webhook-router). It resolves the
 * customer by the provider's customer id and upserts the neutral invoice — so
 * GET /invoices stays fresh without waiting for a full resync. The existing
 * invoice-paid / invoice-failed NOTIFY handlers still fire alongside this.
 *
 * No-ops (never throws) when the provider/invoiceRepo are not wired, the event
 * is not a parseable invoice event, or no local customer matches.
 */
export async function handleInvoiceSynced(
  event: unknown,
  ctx: HandlerContext,
): Promise<void> {
  if (!ctx.provider || !ctx.invoiceRepo) return;

  const parsed = ctx.provider.parseInvoiceEvent(event);
  if (!parsed) return;

  const customer = await ctx.customers.findByStripeCustomerId(parsed.providerCustomerId);
  if (!customer) {
    console.warn(`[invoice-synced] no local customer for ${parsed.providerCustomerId}`);
    return;
  }

  await ctx.invoiceRepo.upsertFromProvider(customer.id, parsed.invoice);
}
