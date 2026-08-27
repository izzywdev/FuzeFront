/**
 * Feature flag for JWKS-based verification of S2S (service-to-service)
 * client_credentials tokens (izzywdev/FuzeFront#648 — platform S2S identity
 * foundation).
 *
 * RELEASE flag — default OFF, per the feature-flags skill. `verifyMachineTokenViaJwks`
 * (src/services/jwks-verify.ts) is a new, security-adjacent code path (it accepts a
 * bearer token as proof of identity based on a locally-verified signature, with no
 * revocation check): it must not activate anywhere until deliberately rolled out,
 * even though nothing currently calls it from a live request path. The existing
 * `authenticateMachineToken` middleware (src/middleware/machine-auth.ts) keeps using
 * Authentik token INTROSPECTION as the default machine-auth path — introspection
 * respects revocation in real time; JWKS verification does not (a revoked token
 * still verifies until it expires). JWKS verification is for callers that need pure
 * signature verification (e.g. no network round-trip to the IdP per request) and
 * accept that revocation lag, on a per-consumer opt-in basis.
 *
 * Owner: backend-engineer (platform). Removal criterion: once a consumer is
 * deliberately migrated onto the JWKS path in prod and that rollout is stable,
 * either flip the flag ON by default (ops-kill-switch style) or remove the flag and
 * always verify via JWKS for that consumer's route.
 *
 * Read via @fuzefront/feature-flags (OpenFeature) per the `feature-flags` skill —
 * never a hand-wired Unleash/OpenFeature call. Loaded lazily so a missing/unbuilt
 * package degrades to the in-code default (OFF) rather than crashing at import time.
 */

// Self-import so `isS2SJwksAuthEnabled`'s callers observe overrides applied via
// `jest.spyOn(s2sJwksFlagModule, 'isS2SJwksAuthEnabled')` even when called from
// inside this same module (see utils/portalFlag.ts for the identical rationale).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as self from './s2sJwksFlag'

export const S2S_JWKS_AUTH_FLAG = 'fuzefront.platform.s2s-jwks-auth'

export interface S2SJwksFlagContext {
  /** The calling service's own client_id, when known (not the caller's — this
   * process's own identity, for context/targeting only). */
  app?: string
  environment?: string
}

interface FlagsClient {
  getBooleanValue(
    key: string,
    def: boolean,
    ctx?: Record<string, unknown>
  ): Promise<boolean>
}

function loadFlagsClient(): FlagsClient | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@fuzefront/feature-flags')
    return typeof mod.getClient === 'function' ? mod.getClient() : null
  } catch {
    return null
  }
}

/**
 * Evaluates the S2S JWKS-auth release flag. NEVER throws — any failure (package
 * absent, provider unreachable, evaluation error) degrades to the release-flag
 * fail-safe default: OFF, which is also the fail-safe direction for a
 * security-adjacent capability (an unreachable flag store must not silently turn
 * ON a new auth path).
 */
export async function isS2SJwksAuthEnabled(
  ctx: S2SJwksFlagContext = {}
): Promise<boolean> {
  const client = loadFlagsClient()
  if (!client) return false

  const context = {
    environment:
      ctx.environment ??
      (process.env.NODE_ENV === 'production' ? 'prod' : process.env.FLAG_ENV || 'local'),
    app: ctx.app ?? 'fuzefront-backend',
  }

  try {
    return await client.getBooleanValue(S2S_JWKS_AUTH_FLAG, false, context)
  } catch {
    return false
  }
}
