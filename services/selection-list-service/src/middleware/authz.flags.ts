// authz.flags.ts — lightweight env-var-based feature flag helper for selection-list-service.
// (Renamed from permit.flags.ts alongside middleware/permit.ts -> middleware/authz.ts:
// the flag itself was never Permit-specific — it gates this service's authz call
// site generally, first against Permit directly and now against FuzeFront's
// Security API — but the old filename read that way and no longer should.)
//
// Rather than pulling a full OpenFeature SDK (which requires network I/O), this
// service resolves flags from environment variables for simple on/off release gating.
//
// Naming convention: dots (.) and hyphens (-) in a flag key are replaced with
// underscores, and the key is uppercased to form the env-var name.
//   fuzefront.selection-list.authz-enabled  →  FUZEFRONT_SELECTION_LIST_AUTHZ_ENABLED
//
// Feature flag owner:      backend-engineer (selection-list-service)
// Removal criterion:       after FFRNT-190 is validated in production for ≥ 2 sprints.
// Administration:          feature-flags-engineer (Unleash config); this file just reads env.

export const FLAGS = {
  /** Release flag — gates all authz checks (routed through the Security API)
   *  on list-access endpoints.
   *  Default: false (OFF).  Enable by setting env var to 'true'.
   *  Kill-switch: set to 'false' to revert to pass-through mode with warning logs. */
  AUTHZ_ENABLED: 'fuzefront.selection-list.authz-enabled',
} as const;

export type FlagKey = typeof FLAGS[keyof typeof FLAGS];

export interface FlagContext {
  userId?: string;
  orgId?: string;
  appId?: string;
}

/**
 * Resolve a boolean feature flag.
 *
 * Resolution order:
 *   1. Environment variable derived from flagKey (see naming convention above).
 *   2. defaultValue passed by the caller.
 *
 * This is intentionally synchronous-compatible (returns Promise for future
 * OpenFeature swap-in).  The env-var is re-read on every call so that
 * test code can toggle flags without module-level state.
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
