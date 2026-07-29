/**
 * Master feature flag for the multi-tenant-portal capability
 * (FF-EPIC-09-S4 / FF-EPIC-10). RELEASE flag — default OFF. Gates ALL new
 * server behavior introduced by EPIC-09/EPIC-10: portal context resolution,
 * the public boot endpoint, JWT/session portal binding, and (a later PR) the
 * master-admin portal CRUD + provisioning pipeline.
 *
 * Owner: backend-engineer (platform). Removal criterion: delete this flag +
 * both code branches once multi-tenant portals are 100% rolled out and the
 * flag-OFF path is no longer exercised in prod.
 *
 * Read via @fuzefront/feature-flags (OpenFeature) per the `feature-flags`
 * skill — never a hand-wired Unleash/OpenFeature call. Loaded lazily (like
 * src/routes/flags.ts) so a missing/unbuilt package degrades to the in-code
 * default (OFF) rather than crashing route/middleware modules at import time.
 */

// Self-import — see getRequestPortalsEnabled's doc-comment for why this
// exists (makes its internal fallback call mockable via jest.spyOn).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as self from './portalFlag'

export const MULTI_TENANT_PORTALS_FLAG = 'fuzefront.platform.multi-tenant-portals'

export interface PortalFlagContext {
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
    const mod = require('@fuzefront/feature-flags')
    return typeof mod.getClient === 'function' ? mod.getClient() : null
  } catch {
    return null
  }
}

/**
 * Evaluates the master flag for the current request/operation. NEVER throws —
 * any failure (package absent, provider unreachable, evaluation error)
 * degrades to the release-flag fail-safe default: OFF.
 *
 * DO NOT call this directly from a request-path consumer (a route or
 * middleware handling an inbound HTTP request) — use
 * {@link getRequestPortalsEnabled} instead. This raw evaluator is only for:
 * (1) `middleware/portalContext.ts`, the single place that performs the
 * PRIMARY per-request evaluation and stashes it on `req.portalsFlagEnabled`,
 * and (2) non-request-scoped callers (startup code, background jobs) that
 * genuinely have no `req` to share a decision through.
 */
export async function isMultiTenantPortalsEnabled(
  ctx: PortalFlagContext = {}
): Promise<boolean> {
  const client = loadFlagsClient()
  if (!client) return false

  const context = {
    environment:
      ctx.environment ??
      (process.env.NODE_ENV === 'production' ? 'prod' : process.env.FLAG_ENV || 'local'),
    app: 'fuzefront-backend',
    ...(ctx.userId ? { userId: ctx.userId } : {}),
  }

  try {
    return await client.getBooleanValue(MULTI_TENANT_PORTALS_FLAG, false, context)
  } catch {
    return false
  }
}

/**
 * Root-cause fix (gate-code-review round 4) — THE single, shared way every
 * request-path consumer of the multi-tenant-portals flag other than
 * `resolvePortalContext` itself must read its decision. `authenticateToken`,
 * `/current`, and the login-mint path each used to call
 * `isMultiTenantPortalsEnabled` independently (some with `{userId}`, some
 * with `{}`), which can legitimately disagree under per-user/gradual
 * targeting for the SAME request — `resolvePortalContext` sees the flag OFF
 * (no user yet, pre-auth) while a downstream per-user evaluation sees it ON,
 * or vice versa, silently skipping fail-closed checks that assume the flag
 * state already applied. Centralizing "read the cache, and if genuinely
 * absent fall back with the identical {} context shape" here means every
 * future consumer gets the fix for free by construction, instead of each
 * hand-rolling its own copy of this ternary (which is exactly how `/current`
 * regressed after `authenticateToken` and the login path were already fixed
 * in isolation).
 *
 * `req` only needs the one field — accepts anything shaped like an Express
 * Request (or a plain object in tests) rather than importing `express` here.
 */
export async function getRequestPortalsEnabled(req: {
  portalsFlagEnabled?: boolean
}): Promise<boolean> {
  const cached = req.portalsFlagEnabled
  if (typeof cached === 'boolean') return cached
  // resolvePortalContext never ran upstream of this route — fall back to an
  // independent evaluation using the SAME context shape ({}) the primary
  // resolver uses, so the fallback can never diverge in KIND (e.g. by
  // reintroducing {userId} targeting) from the primary resolver's semantics.
  //
  // Routed through `self.isMultiTenantPortalsEnabled` (a self-import of this
  // very module) rather than the bare local identifier: TypeScript's CJS
  // emit calls a same-file function by its local binding, which bypasses
  // `jest.spyOn(moduleNamespace, 'isMultiTenantPortalsEnabled')` — spyOn only
  // mutates the shared `exports` object, and every OTHER (cross-module)
  // caller already goes through that object naturally via `require`/`import`.
  // Without this, tests that mock the flag client can only ever observe
  // this fallback's REAL (production) evaluation, silently diverging from
  // what every other consumer in the same request sees.
  return self.isMultiTenantPortalsEnabled({})
}
