/**
 * ============================================================================
 *  VENDOR SEAM — THIS is where the payment vendor lives.
 * ============================================================================
 *
 * This adapter is the ONLY file in payment-service allowed to touch the Stripe
 * SDK. Every other file speaks the vendor-neutral `PaymentProvider` port. To
 * swap vendors (or run two in parallel behind a flag), add a SIBLING adapter —
 * e.g. `providers/adyen/AdyenPaymentProvider` — that implements the same port,
 * and point `config.provider` at it. No call site changes.
 *
 * SCAFFOLD STATUS: every vendor call throws `NotImplemented` (→ HTTP 501). The
 * gateway progressively absorbs the live Stripe interaction currently in
 * billing-service, method by method, behind this seam. Until then this is NOT
 * the live money path.
 *
 * The Stripe SDK is loaded LAZILY (`loadStripe()`) so the gateway boots and
 * serves /health with ZERO secrets and without the SDK being reachable — the
 * vendor is only touched once a method is actually wired + invoked with a key.
 */
import { NotImplemented } from '../../errors';
import {
  CreateCheckoutSessionInput,
  CreateCustomerInput,
  ListInvoicesOptions,
  PaymentProvider,
  ProviderCheckoutSession,
  ProviderCustomer,
  ProviderHooks,
  ProviderInvoice,
  ProviderInvoicePage,
  ProviderPaymentMethodSetup,
  ProviderWebhookEvent,
  SetupPaymentMethodInput,
} from '../payment-provider';

/** Minimal shape we need from the Stripe client (kept local so tsc/runtime do
 *  not depend on the Stripe SDK being installed in the scaffold). Replace with
 *  `import type Stripe from 'stripe'` once methods are wired. */
interface StripeLike {
  customers: unknown;
  invoices: unknown;
  checkout: unknown;
  setupIntents: unknown;
  webhooks: unknown;
}

export interface StripePaymentProviderOptions {
  /** Vendor secret key. Absent → the adapter stays inert (scaffold). */
  secretKey?: string;
  /** Optional preconstructed client (injected in tests). */
  client?: StripeLike;
  /** Pre/post/error hooks fired around every vendor call. */
  hooks?: ProviderHooks;
}

export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe';

  private readonly secretKey?: string;
  private readonly hooks: ProviderHooks;
  private client?: StripeLike;

  constructor(opts: StripePaymentProviderOptions = {}) {
    this.secretKey = opts.secretKey;
    this.client = opts.client;
    this.hooks = opts.hooks ?? {};
  }

  /**
   * Lazily construct the Stripe client on first real use. Kept private so the
   * SDK import lives ONLY here. Throws if no key is configured (degraded mode).
   */
  private loadStripe(): StripeLike {
    if (this.client) return this.client;
    if (!this.secretKey) {
      throw new NotImplemented('stripe client (no STRIPE_SECRET_KEY configured)');
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Stripe = require('stripe');
    this.client = new Stripe(this.secretKey) as StripeLike;
    return this.client;
  }

  async createCustomer(_input: CreateCustomerInput): Promise<ProviderCustomer> {
    return this.withHooks('createCustomer', {}, async () => {
      throw new NotImplemented('createCustomer');
    });
  }

  async getCustomer(providerCustomerId: string): Promise<ProviderCustomer | null> {
    return this.withHooks('getCustomer', { providerCustomerId }, async () => {
      throw new NotImplemented('getCustomer');
    });
  }

  async listInvoices(
    providerCustomerId: string,
    opts: ListInvoicesOptions,
  ): Promise<ProviderInvoicePage> {
    return this.withHooks(
      'listInvoices',
      { providerCustomerId, limit: opts.limit },
      async () => {
        throw new NotImplemented('listInvoices');
      },
    );
  }

  async createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<ProviderCheckoutSession> {
    return this.withHooks('createCheckoutSession', { mode: input.mode }, async () => {
      throw new NotImplemented('createCheckoutSession');
    });
  }

  async setupPaymentMethod(
    input: SetupPaymentMethodInput,
  ): Promise<ProviderPaymentMethodSetup> {
    return this.withHooks(
      'setupPaymentMethod',
      { providerCustomerId: input.providerCustomerId },
      async () => {
        throw new NotImplemented('setupPaymentMethod');
      },
    );
  }

  parseWebhook(
    _provider: string,
    _rawBody: Buffer | string,
    _signature: string | undefined,
  ): ProviderWebhookEvent | null {
    // Signature verification + neutral mapping land with the webhook migration.
    throw new NotImplemented('parseWebhook');
  }

  parseInvoiceEvent(
    _evt: unknown,
  ): { providerCustomerId: string; invoice: ProviderInvoice } | null {
    throw new NotImplemented('parseInvoiceEvent');
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
