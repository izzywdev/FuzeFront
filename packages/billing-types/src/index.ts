/**
 * Canonical billing plan tier types — single source of truth for tier names
 * across billing-service, backend, feature-flags catalog, and Stripe metadata.
 *
 * Canonical tiers (from fuzefront.com/pricing, the customer-facing source):
 *   Free | Starter | Growth | Enterprise
 */

export const PlanTier = {
  FREE: 'free',
  STARTER: 'starter',
  GROWTH: 'growth',
  ENTERPRISE: 'enterprise',
} as const;

export type PlanTier = typeof PlanTier[keyof typeof PlanTier];

/** All canonical tiers in ascending order (Free < Starter < Growth < Enterprise). */
export const PLAN_TIER_ORDER: PlanTier[] = ['free', 'starter', 'growth', 'enterprise'];

/**
 * Returns true when `actual` is at least as high as `required` in the plan hierarchy.
 * Used for plan-tier enforcement: planTierAtLeast('growth', 'starter') === true.
 */
export function planTierAtLeast(actual: PlanTier, required: PlanTier): boolean {
  return PLAN_TIER_ORDER.indexOf(actual) >= PLAN_TIER_ORDER.indexOf(required);
}

/** Display names keyed by tier for UI rendering. */
export const PLAN_TIER_DISPLAY: Record<PlanTier, string> = {
  free: 'Free',
  starter: 'Starter',
  growth: 'Growth',
  enterprise: 'Enterprise',
};

/**
 * Maps legacy tier names (from old billing-service or Stripe products) to their
 * canonical equivalent. Used during migration to normalize stored values.
 */
export const LEGACY_TIER_MAP: Record<string, PlanTier> = {
  // billing-service STATIC_DEFAULT_PLANS legacy names
  professional: 'growth',
  scale: 'growth',
  // Stripe bootstrap script legacy names
  test: 'free',
  builder: 'starter',
  business: 'growth',
  // Legacy billing basic plan
  basic: 'starter',
  // Pass-through for already-canonical values
  free: 'free',
  starter: 'starter',
  growth: 'growth',
  enterprise: 'enterprise',
};

/**
 * Normalizes any tier string (including legacy values) to a canonical PlanTier.
 * Returns 'free' for unrecognised values (fail-safe: least privileged tier).
 */
export function normalizeTier(raw: string): PlanTier {
  const lower = raw.toLowerCase();
  return (LEGACY_TIER_MAP[lower] as PlanTier | undefined) ?? 'free';
}
