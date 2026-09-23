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
   * Origin of FuzeFront's Security API (e.g. `http://fuzefront-security:3002`).
   * The internal API verifies incoming managed service tokens against its
   * `/api/v1/security/tokens/introspect` contract. Required whenever the neutral
   * API is mounted (i.e. a vendor key is set) — its absence fails the app closed
   * at startup, never open. Replaces the retired `PAYMENT_INTERNAL_TOKEN`.
   */
  securityServiceUrl?: string;
}

export function loadConfig(): Config {
  const provider = (process.env.PAYMENT_PROVIDER || 'stripe').toLowerCase();
  return {
    port: parseInt(process.env.PORT || '3007', 10),
    // Only 'stripe' exists today; unknown values fall back to stripe (the sole
    // adapter). This is the single knob a future vendor swap flips.
    provider: provider === 'stripe' ? 'stripe' : 'stripe',
    stripeSecretKey: process.env.STRIPE_SECRET_KEY,
    securityServiceUrl: process.env.SECURITY_SERVICE_URL,
  };
}
