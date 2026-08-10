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
//   - fuzefront.apps-registry.object-level-authz
//       type: release | default: OFF | owner: backend-engineer / appsec
//       Gates the appsec #100 fix (CRITICAL-1, CRITICAL-2, HIGH-3, HIGH-4) on
//       the LEGACY /api/apps registry (routes/apps.ts): object-level, org-scoped
//       authorization on activate/delete (replacing bare platform requireRole
//       (['admin'])); authenticated + org-bound POST /register (was fully open);
//       authenticated + object-level POST /:id/heartbeat (was fully open); and
//       org-membership/visibility scoping on GET / and GET /health (was
//       unscoped — every authenticated caller saw every app on the platform).
//       OFF is the exact pre-fix (parity) behavior this router already shipped
//       with in applications-service — merged dark deliberately because
//       clock-app/src/sdk.ts and task-manager-app/src/registration.ts call
//       POST /api/apps/register ANONYMOUSLY (no Authorization header) from the
//       browser at app bootstrap; flipping this ON is a real behavior change for
//       those callers, not a pure hardening, and must be coordinated (migrate
//       them to an authenticated flow, or confirm they're fully superseded by
//       the v1 app-registry's builtin provisioning) before rollout.
//       removal criterion: once verified 100% rolled out with no legitimate
//       caller denied (in particular self-registration), delete the flag and
//       the pre-fix branches, leaving only the fixed behavior.
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
  LEGACY_OBJECT_LEVEL_AUTHZ: 'fuzefront.apps-registry.object-level-authz',
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
 * release flag (default OFF): is the appsec #100 object-level-authz fix live on
 * the legacy /api/apps registry? See the FLAGS.LEGACY_OBJECT_LEVEL_AUTHZ doc
 * comment above for exactly what OFF vs ON means and why it defaults dark.
 */
export async function isLegacyObjectLevelAuthzEnabled(
  ctx?: Partial<FlagContext>
): Promise<boolean> {
  const client = resolveClient()
  if (!client) return false // fail-safe: release default OFF
  try {
    return await client.getBooleanValue(
      FLAGS.LEGACY_OBJECT_LEVEL_AUTHZ,
      false,
      buildContext(ctx)
    )
  } catch {
    return false
  }
}
