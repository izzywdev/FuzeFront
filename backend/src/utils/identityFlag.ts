/**
 * FF-EPIC-11-S6 — the `fuzefront.identity.portal-scoped-users` flag: gates ALL
 * of S2's user listing/search/profile portal-scoping enforcement.
 *
 * Type: release. Owner: backend-engineer (identity). Default: OFF (Unleash
 * admin default, per the `feature-flags` skill — the enforcement path is dark
 * until deliberately rolled out). Removal criterion: delete this flag + the
 * unscoped ('unscoped' mode in utils/scopeToPortal.ts) code path once
 * portal-scoped identity is 100% rolled out and the flag-OFF path is no longer
 * exercised in prod.
 *
 * *** IDENTITY DEVIATION FROM THE NORMAL RELEASE-FLAG RULE (S6 AC4) ***
 * A normal release flag fails closed to OFF (its default) when the flag
 * service is unreachable — the safe default is "the new code doesn't run".
 * For cross-tenant IDENTITY visibility that direction is backwards: an
 * unreachable flag store must never silently reopen the global,
 * every-portal's-users-visible-to-everyone view. So here, and ONLY here,
 * "unreachable" fails closed to ENFORCED (scoping ON, cross-portal visibility
 * denied) — the opposite of the flag's own administrative OFF default. This is
 * implemented by passing `true` (not `false`) as the OpenFeature/Unleash
 * client SDK's own fallback value below; when Unleash IS reachable and the
 * flag is genuinely (administratively) OFF, it still correctly evaluates to
 * `false` — this only changes what happens when evaluation itself fails.
 *
 * Read via @fuzeone/feature-flags (OpenFeature) per the `feature-flags`
 * skill — never a hand-wired Unleash/OpenFeature call. Loaded lazily (mirrors
 * utils/portalFlag.ts) so a missing/unbuilt package degrades to the fail-safe
 * default rather than crashing route/middleware modules at import time.
 */

// Self-import — mirrors utils/portalFlag.ts's identical trick: makes
// getRequestPortalScopingEnabled's internal fallback call to
// isPortalScopedUsersEnabled mockable via jest.spyOn (which only mutates the
// shared `exports` object; a same-file call by local binding would bypass it).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as self from './identityFlag'

export const PORTAL_SCOPED_USERS_FLAG = 'fuzefront.identity.portal-scoped-users'

export interface IdentityFlagContext {
  userId?: string
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
    const mod = require('@fuzeone/feature-flags')
    return typeof mod.getClient === 'function' ? mod.getClient() : null
  } catch {
    return null
  }
}

/**
 * Evaluates the portal-scoped-users flag for the current request/operation.
 * NEVER throws. See the module doc above for why the fail-safe value here is
 * `true` (enforced) rather than the usual release-flag `false` (off).
 */
export async function isPortalScopedUsersEnabled(
  ctx: IdentityFlagContext = {}
): Promise<boolean> {
  const client = loadFlagsClient()
  // No flags package resolvable at all (unbuilt/absent in this environment) —
  // same "unreachable" fail-closed-to-enforced direction as the try/catch
  // below, for consistency.
  if (!client) return true

  const context = {
    environment:
      ctx.environment ??
      (process.env.NODE_ENV === 'production' ? 'prod' : process.env.FLAG_ENV || 'local'),
    app: 'fuzefront-backend',
    ...(ctx.userId ? { userId: ctx.userId } : {}),
  }

  try {
    // The `true` here (not `false`) is the S6 AC4 deviation — see module doc.
    return await client.getBooleanValue(PORTAL_SCOPED_USERS_FLAG, true, context)
  } catch {
    return true
  }
}

/**
 * The single, shared, per-request way every consumer of the
 * portal-scoped-users flag must read its decision (mirrors
 * utils/portalFlag.ts's getRequestPortalsEnabled) — caches the result on
 * `req.portalScopingFlagEnabled` so a request that calls `scopeToPortal` more
 * than once evaluates the flag exactly once, and so two call sites in the same
 * request can never observe a differing decision under gradual/per-user
 * targeting.
 */
export async function getRequestPortalScopingEnabled(req: {
  portalScopingFlagEnabled?: boolean
  user?: { id?: string }
}): Promise<boolean> {
  const cached = req.portalScopingFlagEnabled
  if (typeof cached === 'boolean') return cached

  // Routed through `self.isPortalScopedUsersEnabled` (a self-import of this
  // very module), not the bare local identifier — see the self-import comment
  // above for why (TypeScript's CJS emit calls a same-file function by its
  // local binding, which bypasses jest.spyOn on the module namespace).
  const enabled = await self.isPortalScopedUsersEnabled({ userId: req.user?.id })
  req.portalScopingFlagEnabled = enabled
  return enabled
}
