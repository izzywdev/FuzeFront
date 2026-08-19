/**
 * payment-service configuration.
 *
 * The gateway is runnable with ZERO secrets: every provider credential is
 * optional in this scaffold. Without `STRIPE_SECRET_KEY` the service still
 * boots and serves `/health` (degraded mode), mirroring billing-service's
 * no-deps `createApp()`.
 */

/** Which vendor adapter the gateway routes calls through. */
export type PaymentProviderName = 'stripe';

export interface Config {
  /** HTTP port. Defaults to 3007 (billing-service is 3006). */
  port: number;
  /**
   * Active payment provider. Swapping the vendor = adding a sibling adapter
   * under `src/providers/<vendor>/` and pointing this at it. Default 'stripe'.
   */
  provider: PaymentProviderName;
  /**
   * Vendor secret key. OPTIONAL in the scaffold — absent means degraded mode
   * (health only, no live vendor calls).
   */
  stripeSecretKey?: string;
  /**
   * Bearer token proving the caller is an authorized internal consumer
   * (billing-service / the host proxy). Guards the neutral API when set;
   * absent in the scaffold leaves the surface open in local/degraded runs.
   */
  internalToken?: string;
}

export function loadConfig(): Config {
  const provider = (process.env.PAYMENT_PROVIDER || 'stripe').toLowerCase();
  return {
    port: parseInt(process.env.PORT || '3007', 10),
    // Only 'stripe' exists today; unknown values fall back to stripe (the sole
    // adapter). This is the single knob a future vendor swap flips.
    provider: provider === 'stripe' ? 'stripe' : 'stripe',
    stripeSecretKey: process.env.STRIPE_SECRET_KEY,
    internalToken: process.env.PAYMENT_INTERNAL_TOKEN,
  };
}
