/**
 * Feature-flag access for config-service (FFRNT-255 / FF-EPIC-17-S8).
 *
 * Reads flags via the family OpenFeature client (`@fuzefront/feature-flags`),
 * per `.claude/skills/feature-flags/SKILL.md`. This service CONSUMES the
 * flag; the flag platform/taxonomy is owned by `feature-flags-engineer`
 * (registry entry: `packages/feature-flags/flag-registry.yaml`).
 *
 * Lazy-require pattern, matching `backend/applications/src/app-registry/
 * flags.ts` and `services/selection-list-service/src/flags.ts`: if the
 * package is not installed/wired for this service, `resolveClient()` returns
 * null and every function returns its fail-safe default — never throws,
 * never hangs, never treats an evaluation failure as "on".
 *
 * ── fuzefront.platform.config-management ───────────────────────────────────
 *   type: release | default: OFF | owner: platform team
 *   Per FF-EPIC-17-S8's Acceptance Criteria, this flag gates CONSUMERS
 *   reading configuration FROM config-service (i.e. whether some other
 *   FuzeFront service resolves its settings through config-service vs. its
 *   own pre-existing configuration source) — it does NOT gate config-service's
 *   own existence: `/health` always answers, and the `/v1/*` read/write
 *   surface (FFRNT-157/158) is never 503'd by this flag. That is a deliberate
 *   difference from `fuzefront.app-registry.v1-registry-write`'s 503 gate,
 *   which config-service's own routes intentionally do NOT replicate here.
 *
 *   config-service exposes its own evaluation of the flag on `GET /health`
 *   (`configManagementEnabled`) so a consumer that cannot reach Unleash
 *   directly (or wants a single source of truth) can observe the same
 *   rollout decision the service itself would give a caller, without that
 *   decision affecting whether `/health` or the `/v1/*` contract routes
 *   respond. Each CONSUMING service is still responsible for evaluating this
 *   flag itself (via `@fuzefront/feature-flags`, with its own org/user
 *   context) before deciding whether to call config-service at all — see
 *   FFRNT-260 (consumer integration guide, out of scope here).
 *
 *   removal criterion: once config-service is GA and every consumer reads
 *   through it at 100% rollout, delete this flag and the `configManagementEnabled`
 *   field on `/health`.
 */

export interface FlagContext {
  environment: string;
  organizationId?: string | null;
  userId?: string;
  app: string;
}

export interface FlagClientLike {
  getBooleanValue(key: string, defaultValue: boolean, context?: Record<string, unknown>): Promise<boolean>;
}

export const FLAGS = {
  /** release flag, default OFF — see module doc above. */
  CONFIG_MANAGEMENT: 'fuzefront.platform.config-management',
} as const;

// Test/DI seam — pin flag values in unit tests with an in-memory client.
let injected: FlagClientLike | null = null;

/** Install a test client. Pass null to restore the lazy-require path. */
export function setFlagClient(c: FlagClientLike | null): void {
  injected = c;
}

function resolveClient(): FlagClientLike | null {
  if (injected) return injected;
  try {
    // Lazy require so config-service degrades gracefully if the package is
    // not yet wired for this service — absence -> null -> safe defaults.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@fuzefront/feature-flags');
    return typeof mod.getClient === 'function' ? mod.getClient() : null;
  } catch {
    return null;
  }
}

function buildContext(ctx?: Partial<FlagContext>): Record<string, unknown> {
  const { organizationId, ...rest } = ctx ?? {};
  return {
    environment: process.env.NODE_ENV === 'production' ? 'prod' : process.env.FLAG_ENV || 'local',
    app: 'config-service',
    // The client context contract names this `orgId` (packages/feature-flags/
    // src/types.ts) — map organizationId -> orgId so org-targeted Unleash
    // constraints match correctly.
    ...(organizationId ? { orgId: organizationId } : {}),
    ...rest,
  };
}

/**
 * release flag (default OFF): should consumers read their configuration
 * through config-service? Fail-safe OFF on any resolution error (missing
 * client, Unleash unreachable, provider error) — the prior-stable behaviour
 * per AC4.
 */
export async function isConfigManagementEnabled(ctx?: Partial<FlagContext>): Promise<boolean> {
  const client = resolveClient();
  if (!client) return false; // fail-safe: release default OFF
  try {
    return await client.getBooleanValue(FLAGS.CONFIG_MANAGEMENT, false, buildContext(ctx));
  } catch {
    return false;
  }
}
