import type Stripe from 'stripe';
import {
  ListInvoicesOptions,
  PaymentProvider,
  ProviderHooks,
  ProviderInvoice,
  ProviderInvoicePage,
} from '../payment-provider';

/**
 * Maps a Stripe Invoice to the neutral ProviderInvoice. Defensive about the
 * optional/nullable Stripe fields (number/hosted_invoice_url/invoice_pdf are
 * null on draft invoices). Keeps the EXACT field mapping the previous
 * routes/invoices `mapInvoice` used: amount_due→amountDueCents, currency
 * lowercased, created(unix s)→issuedAt(Date), status defaults to 'draft'.
 */
export function mapStripeInvoice(inv: Stripe.Invoice): ProviderInvoice {
  return {
    providerInvoiceId: inv.id as string,
    number: inv.number ?? null,
    status: inv.status ?? 'draft',
    amountDueCents: inv.amount_due,
    amountPaidCents: inv.amount_paid,
    currency: (inv.currency || '').toLowerCase(),
    hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
    invoicePdfUrl: inv.invoice_pdf ?? null,
    issuedAt: new Date(inv.created * 1000),
  };
}

/** The single Stripe sub-resource the adapter needs (narrowed for testability). */
export interface StripeInvoicesLike {
  invoices: Pick<Stripe.InvoicesResource, 'list'>;
}

/**
 * Stripe implementation of the neutral PaymentProvider port. This adapter is the
 * ONLY new file allowed to depend on the Stripe SDK; every vendor call is routed
 * through `withHooks` so pre/post/error hooks fire without touching call sites.
 */
export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe';

  constructor(
    private readonly stripe: StripeInvoicesLike,
    private readonly hooks: ProviderHooks = {},
  ) {}

  async listInvoices(
    providerCustomerId: string,
    opts: ListInvoicesOptions,
  ): Promise<ProviderInvoicePage> {
    return this.withHooks('listInvoices', { providerCustomerId, limit: opts.limit }, async () => {
      const page = await this.stripe.invoices.list({
        customer: providerCustomerId,
        limit: opts.limit,
        ...(opts.startingAfter ? { starting_after: opts.startingAfter } : {}),
      });
      return {
        invoices: page.data.map(mapStripeInvoice),
        hasMore: page.has_more,
      };
    });
  }

  parseInvoiceEvent(
    evt: unknown,
  ): { providerCustomerId: string; invoice: ProviderInvoice } | null {
    const event = evt as Stripe.Event | undefined;
    const obj = event?.data?.object as Stripe.Invoice | undefined;
    if (!obj || obj.object !== 'invoice' || !obj.id) return null;
    const providerCustomerId =
      typeof obj.customer === 'string' ? obj.customer : obj.customer?.id;
    if (!providerCustomerId) return null;
    return { providerCustomerId, invoice: mapStripeInvoice(obj) };
  }

  /** Wrap a vendor call in the pre/post/error hooks (hooks are best-effort). */
  private async withHooks<T>(
    call: string,
    meta: Record<string, unknown>,
    fn: () => Promise<T>,
  ): Promise<T> {
    await this.hooks.onBeforeCall?.(call, meta);
    try {
      const result = await fn();
      await this.hooks.onAfterCall?.(call, meta);
      return result;
    } catch (err) {
      await this.hooks.onError?.(call, err, meta);
      throw err;
    }
  }
}
