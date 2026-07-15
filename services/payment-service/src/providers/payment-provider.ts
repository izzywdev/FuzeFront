/**
 * The vendor-neutral Payment Provider port (payment-service).
 *
 * This is the SUPERSET the gateway exposes to billing-service and other
 * consumers. It intentionally aligns with — and extends — billing-service's own
 * `PaymentProvider` port (`services/billing-service/src/providers/payment-provider.ts`):
 * that port is the CLIENT that will point at this gateway once the money path is
 * migrated here. Names/DTOs are kept compatible (cents, `Date`, lowercased
 * currency, `providerCustomerId`/`providerInvoiceId`) so the seam is a drop-in.
 *
 * Domain/route code depends ONLY on this interface and its neutral DTOs — never
 * on a vendor SDK. `providers/stripe/StripePaymentProvider` is the ONLY place
 * allowed to touch Stripe; swapping vendors = adding a sibling adapter.
 *
 * Every vendor call is wrapped in `ProviderHooks` (onBeforeCall/onAfterCall/
 * onError) — the pre/post hook seam where metrics, transforms, idempotency, or
 * retries are added centrally without touching call sites.
 */

/** A customer, normalised to FuzeFront's neutral shape. */
export interface ProviderCustomer {
  /** The provider's own customer id (confined to the adapter + DB uniqueness). */
  providerCustomerId: string;
  /** Contact email, when the provider has one. */
  email: string | null;
  /** Display name, when the provider has one. */
  name: string | null;
  /** Free-form key/value metadata echoed back from the provider. */
  metadata: Record<string, string>;
}

/** Input to create (or upsert) a provider customer. */
export interface CreateCustomerInput {
  email?: string;
  name?: string;
  /**
   * The FuzeFront entity this customer represents. Kept neutral: the gateway
   * never leaks vendor concepts back to callers.
   */
  entityType?: 'user' | 'organization';
  entityId?: string;
  metadata?: Record<string, string>;
}

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

/** Neutral checkout mode. */
export type CheckoutMode = 'subscription' | 'payment' | 'setup';

/** A single priced line item for a `payment`-mode checkout. */
export interface CheckoutLineItem {
  name: string;
  description?: string;
  unitAmountCents: number;
  quantity: number;
}

/** Input to open a hosted checkout session (vendor-agnostic). */
export interface CreateCheckoutSessionInput {
  mode: CheckoutMode;
  providerCustomerId?: string;
  /** ISO 4217, lowercased. Required for `payment` mode. */
  currency?: string;
  /** Priced line items for `payment` mode. */
  lineItems?: CheckoutLineItem[];
  /** Provider price id for `subscription` mode. */
  priceId?: string;
  successUrl: string;
  cancelUrl: string;
  /** Opaque correlation id echoed on the resulting webhook. */
  clientReferenceId?: string;
  metadata?: Record<string, string>;
}

/** A hosted checkout session, normalised. */
export interface ProviderCheckoutSession {
  /** The provider's session id. */
  providerSessionId: string;
  /** Provider-hosted URL to redirect the customer to; null when unavailable. */
  url: string | null;
  mode: CheckoutMode;
}

/** Input to begin collecting a payment method without an immediate charge. */
export interface SetupPaymentMethodInput {
  providerCustomerId: string;
  /** off_session so the collected method can be charged later. */
  usage?: 'on_session' | 'off_session';
  metadata?: Record<string, string>;
}

/** The client secret a front-end needs to complete payment-method setup. */
export interface ProviderPaymentMethodSetup {
  /** Client secret for the provider's payment element. */
  clientSecret: string;
  /** The setup object id at the provider. */
  providerSetupId: string;
}

/** A parsed, neutralised provider webhook. */
export interface ProviderWebhookEvent {
  /** Provider that emitted the event (e.g. 'stripe'). */
  provider: string;
  /** The provider's event id (for idempotency). */
  providerEventId: string;
  /** Neutral event type (e.g. 'invoice.paid', 'checkout.completed'). */
  type: string;
  /** The neutralised payload, when the gateway understands the event. */
  data: Record<string, unknown>;
}

/**
 * The neutral payment-provider port. The invoice + customer + checkout +
 * payment-method + webhook surface is the FROZEN contract for this gateway; the
 * live vendor wiring lands adapter-by-adapter behind it.
 */
export interface PaymentProvider {
  /** Provider identity, persisted alongside provider ids (e.g. 'stripe'). */
  readonly name: string;

  /** Create (or upsert) a provider customer for a FuzeFront entity. */
  createCustomer(input: CreateCustomerInput): Promise<ProviderCustomer>;

  /** Fetch a provider customer by its provider id; null when unknown. */
  getCustomer(providerCustomerId: string): Promise<ProviderCustomer | null>;

  /** Page the customer's invoices from the provider. */
  listInvoices(
    providerCustomerId: string,
    opts: ListInvoicesOptions,
  ): Promise<ProviderInvoicePage>;

  /** Open a hosted checkout session (subscription / payment / setup). */
  createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<ProviderCheckoutSession>;

  /** Begin collecting a payment method without an immediate charge. */
  setupPaymentMethod(
    input: SetupPaymentMethodInput,
  ): Promise<ProviderPaymentMethodSetup>;

  /**
   * Verify + parse a raw provider webhook into a neutral event. Returns null
   * when the event is not one the gateway persists.
   */
  parseWebhook(
    provider: string,
    rawBody: Buffer | string,
    signature: string | undefined,
  ): ProviderWebhookEvent | null;

  /**
   * Parse a provider webhook event into a neutral {providerCustomerId, invoice}.
   * Kept for exact alignment with billing-service's port. Returns null when the
   * event is not an invoice event we can persist.
   */
  parseInvoiceEvent(
    evt: unknown,
  ): { providerCustomerId: string; invoice: ProviderInvoice } | null;
}

/**
 * Pre/post/error hooks wrapped around every vendor call — the pre/post hook seam.
 * All optional and best-effort: a hook throwing must not mask the underlying
 * call result.
 */
export interface ProviderHooks {
  onBeforeCall?: (call: string, meta?: Record<string, unknown>) => void | Promise<void>;
  onAfterCall?: (call: string, meta?: Record<string, unknown>) => void | Promise<void>;
  onError?: (call: string, err: unknown, meta?: Record<string, unknown>) => void | Promise<void>;
}
