// flags.ts — Feature flag helpers for selection-list-service (FFRNT-201 / S15).
//
// Reads flags via the family OpenFeature client (`@fuzefront/feature-flags`).
// Lazy-require pattern: if the package is absent the client is null and every
// function returns its fail-safe default — never throws, never hangs.
//
// This file is in src/ (the TypeScript rootDir) so it compiles with the routes.
//
// Local/CI with no Unleash: there is no per-service escape hatch here. Flags are
// forced ON only through the ONE explicit offline OpenFeature provider in
// `@fuzefront/feature-flags`, installed by `lib/featureFlags.ts initFeatureFlags()`
// when `FUZE_FLAGS_PROVIDER=offline` (refused in production). So the on-path CI
// exercises runs through the real OpenFeature client exactly as production does,
// instead of short-circuiting before it.
//
// Flags consumed by this service (owner: feature-flags-engineer):
//
//   fuzefront.selection-lists.service             (FFRNT-201 / S15)
//     type: release | default: OFF
//     Gates BOTH the selection-list-service API (service-side) AND the
//     "Selection Lists" shell nav entry (S9). OFF = dark; ON = released for
//     that org/env.
//     Registry ref: packages/feature-flags/flag-registry.yaml
//     removal criterion: when 100% of orgs are enabled → remove flag and both
//     guards (route-level here + shell nav in S9).
//
//   fuzefront.selection-lists.seed-defaults       (SL5 / SL6)
//     type: release | default: OFF | owner: izzywdev
//     Gates BOTH default-seeding consumers (identity.org.created seeding and
//     selection-lists.seed.requested handling, plus the reconciler). Server-side
//     only (web_exposed: false). Independent of, and additionally requires, the
//     master gate above. Read via isSeedDefaultsEnabled(); fails closed.
//     Registry ref: packages/feature-flags/flag-registry.yaml
//     removal criterion: seeding ON for all orgs for 30 days with zero
//     selection-lists.seed.failed in the window -> remove flag + both guards.
//
// The in-code default is OFF (release fail-safe) so an Unleash outage degrades
// safely: the route acts as if the service does not yet exist for the org.

import { logger } from './lib/logger'

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

/**
 * Typed flag-key constants for this slice.
 */
export const FLAGS = {
  /**
   * Master gate for the selection-list-service and its shell UI entry.
   * Release flag, default OFF. See module doc above for full metadata.
   */
  SELECTION_LISTS_SERVICE: 'fuzefront.selection-lists.service',
  /**
   * Gates BOTH default-seeding consumers (org-created seeding + seed-requested).
   * Release flag, default OFF, server-only. Mirrors
   * `FLAG_KEYS.SELECTION_LISTS_SEED_DEFAULTS` in @fuzefront/feature-flags.
   */
  SELECTION_LISTS_SEED_DEFAULTS: 'fuzefront.selection-lists.seed-defaults',
} as const

// Test/DI seam — pin flag values in unit tests with an in-memory client.
let _injected: FlagClientLike | null = null

/** Install a test client. Pass null to restore the lazy-require path. */
export function setFlagClient(c: FlagClientLike | null): void {
  _injected = c
}

function resolveClient(): FlagClientLike | null {
  if (_injected) return _injected
  try {
    // Lazy require so the service degrades gracefully if the package is not yet
    // wired (absence → null → safe defaults). Mirrors the pattern in
    // backend/applications/src/app-registry/flags.ts.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@fuzefront/feature-flags')
    return typeof mod.getClient === 'function' ? mod.getClient() : null
  } catch {
    return null
  }
}

function buildContext(ctx?: Partial<FlagContext>): Record<string, unknown> {
  const { organizationId, ...rest } = ctx ?? {}
  return {
    environment:
      process.env.NODE_ENV === 'production' ? 'prod' : process.env.FLAG_ENV || 'local',
    app: 'selection-list-service',
    // The client context contract names this `orgId` (packages/feature-flags/
    // src/types.ts). Map organizationId -> orgId so Unleash org-targeted
    // constraints match correctly.
    ...(organizationId ? { orgId: organizationId } : {}),
    ...rest,
  }
}

/**
 * Release flag (default OFF): is the selection-list-service enabled for the
 * calling org? Pass the request context so per-org rollout targeting works.
 */
export async function isSelectionListsEnabled(
  ctx?: Partial<FlagContext>
): Promise<boolean> {
  const client = resolveClient()
  if (!client) return false // fail-safe: release default OFF
  try {
    return await client.getBooleanValue(FLAGS.SELECTION_LISTS_SERVICE, false, buildContext(ctx))
  } catch (err) {
    logger.warn({ err, flag: FLAGS.SELECTION_LISTS_SERVICE }, 'flag evaluation failed — using fail-safe default OFF')
    return false
  }
}

/**
 * Release flag (default OFF): is default-list seeding enabled for the org in
 * `ctx`? Gates BOTH seeding consumers (identity.org.created and
 * selection-lists.seed.requested) and the reconciler — each must call this per
 * message with `{ organizationId }` so per-org rollout targeting works.
 *
 * Independent of `isSelectionListsEnabled` (seeding ALSO requires the master
 * gate; callers check both). Fails closed: no client, or any client error,
 * yields false. Never throws.
 */
export async function isSeedDefaultsEnabled(
  ctx?: Partial<FlagContext>
): Promise<boolean> {
  const client = resolveClient()
  if (!client) return false // fail-safe: release default OFF
  try {
    return await client.getBooleanValue(FLAGS.SELECTION_LISTS_SEED_DEFAULTS, false, buildContext(ctx))
  } catch (err) {
    logger.warn({ err, flag: FLAGS.SELECTION_LISTS_SEED_DEFAULTS }, 'flag evaluation failed — using fail-safe default OFF')
    return false
  }
}
