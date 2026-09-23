// authz.flags.ts — lightweight env-var-based feature flag helper for
// billing-service's cutover off the embedded Permit SDK, mirroring
// services/selection-list-service/src/middleware/authz.flags.ts and
// services/config-service's equivalent (same env-var-reader shape, kept
// deliberately identical across the three migrated services rather than
// introducing a real OpenFeature/Unleash dependency here).
//
// Naming convention: dots (.) and hyphens (-) in a flag key are replaced with
// underscores, and the key is uppercased to form the env-var name.
//   fuzefront.billing.authz-enabled  →  FUZEFRONT_BILLING_AUTHZ_ENABLED
//
// Feature flag owner:      backend-engineer (billing-service)
// Removal criterion:       after the Security-API-backed plan sync has run in
//                           production for >= 2 sprints with no regression in
//                           the billing.subscription.changed / Permit ABAC
//                           attribute freshness, remove the flag and the
//                           dead OFF-path (delete the "flag OFF -> skip"
//                           branch below, keep the Security API path).
// Administration:          feature-flags-engineer (Unleash config); this file
//                           just reads env until this service's flags are
//                           migrated onto the real OpenFeature client, same
//                           as the other two services in this migration.

export const FLAGS = {
  /** Release flag — gates whether syncPlanToPermit calls FuzeFront's Security
   *  API (setAttributes) at all.
   *  Default: false (OFF) — merging this migration is a DARK deploy; billing
   *  is LIVE in production and the actual cutover is a separate, deliberate
   *  flag flip in a deploy window (see the PR this flag shipped in).
   *  Kill-switch: set back to 'false' to revert to a no-op (the DB mirror +
   *  billing.subscription.changed projection are unaffected either way —
   *  this flag only gates the Permit ABAC attribute sync). */
  AUTHZ_ENABLED: 'fuzefront.billing.authz-enabled',
} as const;

export type FlagKey = (typeof FLAGS)[keyof typeof FLAGS];

export interface FlagContext {
  /** The billing entity this sync concerns — 'user' or 'organization'
   *  (mapped to the Security API's 'user'/'tenant' subject types). */
  entityType?: string;
  entityId?: string;
}

/**
 * Resolve a boolean feature flag.
 *
 * Resolution order:
 *   1. Environment variable derived from flagKey (see naming convention above).
 *   2. defaultValue passed by the caller.
 *
 * Intentionally synchronous-compatible (returns a Promise for a future
 * OpenFeature swap-in). The env-var is re-read on every call so test code can
 * toggle the flag without module-level state.
 */
export async function getBooleanFlag(
  flagKey: string,
  defaultValue: boolean,
  _context: FlagContext,
): Promise<boolean> {
  const envKey = flagKey.toUpperCase().replace(/\./g, '_').replace(/-/g, '_');
  const envValue = process.env[envKey];
  if (envValue === 'true') return true;
  if (envValue === 'false') return false;
  return defaultValue;
}
