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
  /** Dev/test convenience switch for the authz call site (routed through the
   *  Security API). Default: false (OFF) OUTSIDE production.  Enable by setting
   *  the env var to 'true'; 'false' reverts to pass-through mode with warning logs.
   *
   *  NOT a production control: in NODE_ENV=production authorization is ALWAYS
   *  enforced and this value is not consulted (see `isAuthzEnforced` below). */
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

/**
 * Is authorization ENFORCED for this request?
 *
 *  - NODE_ENV=production: ALWAYS true. The env var / flag is not read at all, so
 *    an unset, mistyped or `false` value can never silently disable authz on a
 *    released service (docs/security/selection-lists-authz-review-2026-10.md,
 *    H-1: the pre-fix default was pass-through, which let any org member purge
 *    any list and grant themselves list-owner). Production gating of the
 *    feature itself is the release flag `fuzefront.selection-lists.service`
 *    (flags.ts), never this.
 *  - any other NODE_ENV (development, test, CI): honours the env var, default
 *    OFF. This is the dark-deploy / unit-test convenience the flag was created for.
 *
 * Callers must use this — never `getBooleanFlag(FLAGS.AUTHZ_ENABLED, ...)`
 * directly — so the production invariant has exactly one implementation.
 */
export async function isAuthzEnforced(context: FlagContext): Promise<boolean> {
  if (process.env.NODE_ENV === 'production') return true;
  return getBooleanFlag(FLAGS.AUTHZ_ENABLED, false, context);
}
