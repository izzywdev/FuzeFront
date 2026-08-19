/**
 * Vendor-neutral payment-provider port.
 *
 * Domain/route/webhook code depends ONLY on this interface and its neutral DTOs —
 * never on the Stripe SDK. `StripePaymentProvider` (providers/stripe/*) is the
 * only place besides the existing `stripe-client.ts` allowed to `import Stripe`,
 * so the vendor can be swapped (or moved behind the payment-service gateway)
 * without touching call sites.
 *
 * Every vendor call is wrapped in `ProviderHooks` (onBeforeCall/onAfterCall/
 * onError) so metrics, transforms, or retries can be added centrally.
 */

/** A provider invoice, normalised to FuzeFront's neutral shape (cents, Date). */
export interface ProviderInvoice {
  /** The provider's own invoice id (confined to the adapter + DB uniqueness). */
  providerInvoiceId: string;
  /** Human-facing invoice number; null when the provider has not issued one. */
  number: string | null;
  /** Neutral status: draft|open|paid|void|uncollectible. */
  status: string;
  /** Amount due in the currency's minor unit (cents). */
  amountDueCents: number;
  /** Amount paid in the currency's minor unit (cents). */
  amountPaidCents: number;
  /** ISO 4217 code, lowercased. */
  currency: string;
  /** Provider-hosted invoice page URL; null when unavailable. */
  hostedInvoiceUrl: string | null;
  /** Provider-hosted invoice PDF URL; null when unavailable. */
  invoicePdfUrl: string | null;
  /** Issue timestamp. */
  issuedAt: Date;
}

/** Options for a single page of `listInvoices`. */
export interface ListInvoicesOptions {
  /** Page size. */
  limit: number;
  /** Opaque provider cursor for the next page (the provider's paging token). */
  startingAfter?: string;
}

/** One page of provider invoices. */
export interface ProviderInvoicePage {
  invoices: ProviderInvoice[];
  hasMore: boolean;
}

/**
 * The neutral payment-provider port. Only the invoice surface is modelled here
 * for this slice; checkout/subscriptions/etc. will be migrated behind the same
 * boundary later.
 */
export interface PaymentProvider {
  /** Provider identity, persisted in billing.invoices.provider (e.g. 'stripe'). */
  readonly name: string;

  /** Page the entity's invoices from the provider. */
  listInvoices(
    providerCustomerId: string,
    opts: ListInvoicesOptions,
  ): Promise<ProviderInvoicePage>;

  /**
   * Parse a provider webhook event into a neutral {providerCustomerId, invoice}.
   * Returns null when the event is not an invoice event we can persist.
   */
  parseInvoiceEvent(
    evt: unknown,
  ): { providerCustomerId: string; invoice: ProviderInvoice } | null;
}

/**
 * Pre/post/error hooks wrapped around every vendor call. All optional and
 * best-effort — a hook throwing must not mask the underlying call result.
 */
export interface ProviderHooks {
  onBeforeCall?: (call: string, meta?: Record<string, unknown>) => void | Promise<void>;
  onAfterCall?: (call: string, meta?: Record<string, unknown>) => void | Promise<void>;
  onError?: (call: string, err: unknown, meta?: Record<string, unknown>) => void | Promise<void>;
}
