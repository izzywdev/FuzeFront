import Stripe from 'stripe';

/**
 * Pinned Stripe API version for the entire service. Bump deliberately — a new
 * version can change webhook payload shapes and proration math.
 */
export const STRIPE_API_VERSION = '2024-06-20' as const;

let singleton: Stripe | undefined;

/**
 * Returns a process-wide singleton Stripe client built from STRIPE_SECRET_KEY.
 * Throws if the key is missing — billing-service cannot operate without it.
 *
 * Tests should NOT call this; they inject a mocked Stripe instance into the
 * service constructors instead (see tests/*). This keeps all network access
 * out of the unit suite.
 */
export function getStripe(secretKey = process.env.STRIPE_SECRET_KEY): Stripe {
  if (singleton) return singleton;
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY is required to initialise the Stripe client');
  }
  singleton = new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
    typescript: true,
  });
  return singleton;
}

/** Test-only: reset the memoised singleton between tests. */
export function __resetStripeForTests(): void {
  singleton = undefined;
}
