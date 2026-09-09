// authz.flags.ts — lightweight env-var-based feature flag helper for
// devportal-service, mirroring selection-list-service's authz.flags.ts.
//
// Rather than pulling a full OpenFeature SDK (which requires network I/O),
// this service resolves flags from environment variables for simple on/off
// release gating.
//
// Naming convention: dots (.) and hyphens (-) in a flag key are replaced with
// underscores, and the key is uppercased to form the env-var name.
//   fuzefront.devportal.authz-enabled  →  FUZEFRONT_DEVPORTAL_AUTHZ_ENABLED
//
// Feature flag owner:      backend-engineer (devportal)
// Removal criterion:       once developers.fuzefront.com is GA at 100% rollout.
// Administration:          feature-flags-engineer (Unleash config); this file just reads env.

export const FLAGS = {
  /** Release flag — gates all authz checks (routed through the Security API)
   *  on DevPortalCatalog/DevPortalPlayground endpoints.
   *  Default: false (OFF). Enable by setting env var to 'true'.
   *  Kill-switch: set to 'false' to revert to pass-through mode with warning logs. */
  AUTHZ_ENABLED: 'fuzefront.devportal.authz-enabled',
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
 * Intentionally synchronous-compatible (returns Promise for a future
 * OpenFeature swap-in). Re-read on every call so test code can toggle flags
 * without module-level state.
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
