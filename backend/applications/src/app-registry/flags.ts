// Feature-flag access for the app-registry slice. Reads flags via the family
// OpenFeature client (`@fuzefront/feature-flags`) per the feature-flags skill —
// we CONSUME flags here; the flag platform/taxonomy is owned by
// feature-flags-engineer.
//
// Flags used by this slice (owner: backend-engineer / app-registry):
//   - fuzefront.app-registry.v1-registry-write
//       type: release | default: OFF
//       gates the NEW versioned write paths (register/update/delete/activate/
//       suspend) so the contract surface can merge dark and be released
//       deliberately. Read GETs are NOT gated (safe to expose).
//       removal criterion: delete once /api/v1/app-registry is 100% rolled out
//       and stable; then drop the flag + the off-path 503 branch.
//   - fuzefront.app-registry.kafka-events-kill-switch
//       type: ops-kill-switch | default: ON
//       circuit-breaker for emitting Kafka events on the registry write path
//       (the expensive/risky async fan-out). Flip OFF to stop emitting without a
//       redeploy. removal criterion: only if Kafka emission is removed.
//   - fuzefront.apps.portal-catalog (FF-EPIC-12-S5)
//       type: release | default: OFF
//       gates BOTH S2's list() portal-catalog filter (the org-less/public-app
//       leak fix) AND S3's catalog admin API enforcement. OFF ⇒ byte-identical
//       pre-epic behavior (org-less/public apps stay globally visible, the
//       admin API 503s as not-yet-enabled). Deliberately the SAME fail-safe
//       direction as every other release flag here (OFF on an unreachable flag
//       store) — S2's own filter fails CLOSED on a *resolved-but-malformed*
//       portal context (see app-registry/portalContext.ts), which is a
//       different failure mode than "the flag service itself is down" (S5
//       AC4: an unreachable flag store degrades to this flag's own OFF
//       default, i.e. the prior stable global-visibility behavior).
//       owner: backend-engineer (platform). removal criterion: delete this
//       flag + the pre-epic unscoped branch in list() once the portal catalog
//       is 100% rolled out and the flag-OFF path is no longer exercised.
//   - fuzefront.apps.build-with-agent
//       type: release | default: OFF
//       gates the build-session API (routes/app-builds.ts). owner:
//       backend-engineer. removal criterion: delete once build-with-agent is
//       100% rolled out and stable for one release cycle.
//   - fuzefront.apps.creator-ownership
//       type: release | default: OFF
//       gates writing apps.created_by_user_id, assigning the creator Permit
//       role, and exposing createdBy/creator on App DTOs. owner:
//       backend-engineer. removal criterion: delete once rolled out to 100% and
//       the Permit App#creator policy is live. NEVER a substitute for Permit.
//   - fuzefront.apps.marketplace-publishing
//       type: release | default: OFF
//       gates the publication-request endpoints. owner: backend-engineer.
//       removal criterion: delete once rolled out to 100% and stable.
//
// The in-code default is the fail-safe value (OFF for release, ON for
// kill-switch) so an Unleash/client outage fails safe. The client is resolved
// lazily and any error → the default, so a missing client never breaks a request.

export interface FlagContext {
  environment: string
  organizationId?: string | null
  userId?: string
  app: string
}

export interface FlagClientLike {
  getBooleanValue(
    key: string,
    defaultValue: boolean,
    context?: Record<string, unknown>
  ): Promise<boolean>
}

export const FLAGS = {
  V1_REGISTRY_WRITE: 'fuzefront.app-registry.v1-registry-write',
  KAFKA_EVENTS_KILL_SWITCH: 'fuzefront.app-registry.kafka-events-kill-switch',
  PORTAL_CATALOG: 'fuzefront.apps.portal-catalog',
  /**
   * fuzefront.ref-index.enforce-ref-checks
   * type: release | default: OFF
   * owner: backend-engineer (app-registry / P2)
   * When ON: assertRefExists uses mode:'enforce' — foreign-key violations 422.
   * When OFF: mode:'warn' — logs a warning but allows the request through.
   * removal criterion: delete once ref_index projection is stable in prod and
   *   enforcement is the permanent behavior (no traffic with missing refs).
   */
  REF_INDEX_ENFORCE: 'fuzefront.ref-index.enforce-ref-checks',
  BUILD_WITH_AGENT: 'fuzefront.apps.build-with-agent',
  CREATOR_OWNERSHIP: 'fuzefront.apps.creator-ownership',
  MARKETPLACE_PUBLISHING: 'fuzefront.apps.marketplace-publishing',
} as const

let injected: FlagClientLike | null = null

/** Test/DI seam — pin flag values with an in-memory client. */
export function setFlagClient(c: FlagClientLike | null): void {
  injected = c
}

function resolveClient(): FlagClientLike | null {
  if (injected) return injected
  try {
    // Lazy require so the service does not hard-require the client where the
    // family flag platform is not yet wired; absence → null → safe defaults.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@fuzefront/feature-flags')
    const client = typeof mod.getClient === 'function' ? mod.getClient() : null
    return client
  } catch {
    return null
  }
}

function buildContext(ctx?: Partial<FlagContext>): Record<string, unknown> {
  const { organizationId, ...rest } = ctx ?? {}
  return {
    environment: process.env.NODE_ENV === 'production' ? 'prod' : process.env.FLAG_ENV || 'local',
    app: 'applications-service',
    // The client's context contract names this `orgId` (packages/feature-flags/
    // src/types.ts). Emitting `organizationId` meant any org-targeted Unleash
    // constraint silently never matched; map it onto the contract name.
    ...(organizationId ? { orgId: organizationId } : {}),
    ...rest,
  }
}

/**
 * release flag (default OFF): is the new /api/v1/app-registry WRITE surface
 * released for this caller/org? Pass the request context so rollout can target
 * by org/user.
 */
export async function isV1WriteEnabled(ctx?: Partial<FlagContext>): Promise<boolean> {
  const client = resolveClient()
  if (!client) return false // fail-safe: release default OFF
  try {
    return await client.getBooleanValue(FLAGS.V1_REGISTRY_WRITE, false, buildContext(ctx))
  } catch {
    return false
  }
}

/**
 * ops-kill-switch (default ON): may we emit Kafka events on the write path?
 * Returns true (emit) unless explicitly killed.
 */
export async function isKafkaEmitEnabled(ctx?: Partial<FlagContext>): Promise<boolean> {
  const client = resolveClient()
  if (!client) return true // fail-safe: kill-switch default ON
  try {
    return await client.getBooleanValue(FLAGS.KAFKA_EVENTS_KILL_SWITCH, true, buildContext(ctx))
  } catch {
    return true
  }
}

/**
 * FF-EPIC-12-S5 — release flag (default OFF): is the per-portal app catalog
 * (S2's list() filter + S3's admin API) released for this caller/org? See the
 * module doc above for the fail-safe-direction rationale.
 */
export async function isPortalCatalogEnabled(ctx?: Partial<FlagContext>): Promise<boolean> {
  const client = resolveClient()
  if (!client) return false // fail-safe: release default OFF
  try {
    return await client.getBooleanValue(FLAGS.PORTAL_CATALOG, false, buildContext(ctx))
  } catch {
    return false
  }
}

/**
 * FFRNT P2 — release flag (default OFF): should ref-index checks use
 * mode:'enforce' (reject with 422) rather than mode:'warn' (log, allow)?
 *
 * OFF (default): projection degrades gracefully — unknown orgs log a warning.
 * ON: strict — any organizationId not in the local ref_index returns 422.
 */
export async function isRefEnforceEnabled(ctx?: Partial<FlagContext>): Promise<boolean> {
  const client = resolveClient()
  if (!client) return false // fail-safe: release default OFF
  try {
    return await client.getBooleanValue(FLAGS.REF_INDEX_ENFORCE, false, buildContext(ctx))
  } catch {
    return false
  }
}

/** Shared fail-safe release-flag read (default OFF; any error/no client → OFF). */
async function releaseFlag(key: string, ctx?: Partial<FlagContext>): Promise<boolean> {
  const client = resolveClient()
  if (!client) return false
  try {
    return await client.getBooleanValue(key, false, buildContext(ctx))
  } catch {
    return false
  }
}

/** release flag (default OFF): the build-with-FuzeAgent session API. */
export function isBuildWithAgentEnabled(ctx?: Partial<FlagContext>): Promise<boolean> {
  return releaseFlag(FLAGS.BUILD_WITH_AGENT, ctx)
}

/** release flag (default OFF): creator ownership (created_by + creator role + DTO). */
export function isCreatorOwnershipEnabled(ctx?: Partial<FlagContext>): Promise<boolean> {
  return releaseFlag(FLAGS.CREATOR_OWNERSHIP, ctx)
}

/** release flag (default OFF): marketplace publication-request endpoints. */
export function isMarketplacePublishingEnabled(ctx?: Partial<FlagContext>): Promise<boolean> {
  return releaseFlag(FLAGS.MARKETPLACE_PUBLISHING, ctx)
}
