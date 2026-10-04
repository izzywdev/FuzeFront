// flags.ts — Feature flag helpers for selection-list-service (FFRNT-201 / S15).
//
// Reads flags via the family OpenFeature client (`@fuzefront/feature-flags`).
// Lazy-require pattern: if the package is absent the client is null and every
// function returns its fail-safe default — never throws, never hangs.
//
// This file is in src/ (the TypeScript rootDir) so it compiles with the routes.
// The service-root flags.ts (outside src/) uses the same pattern and the same
// flag key; keep them in sync if either is updated.
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
 * Local/CI escape hatch: force specific flags ON where there is no Unleash to
 * target them in (comma-separated flag keys in `FLAGS_FORCE_ON`).
 *
 * WHY THIS EXISTS. Every route in this service is gated behind
 * `isSelectionListsEnabled()`, a release flag whose default is OFF and whose
 * only source of truth is Unleash. CI has no Unleash, so the client degrades
 * to the default and EVERY route answers 404 "Service not enabled." — which is
 * correct behaviour, and which made the whole integration/acceptance suite
 * unpassable by construction (134 of 148 tests failing on a service that was
 * working exactly as designed).
 *
 * HARD-GATED TO NON-PRODUCTION, deliberately, so a stray env var can never
 * light up a dark feature in prod — prod targeting is done in Unleash, never
 * by env. This mirrors `backend/src/routes/flags.ts`'s `FLAGS_FORCE_ON`
 * exactly, including that gate; it is the same escape hatch, applied at the
 * service's own flag helper rather than at the host's flag route.
 */
function isForcedOn(key: string): boolean {
  if (process.env.NODE_ENV === 'production') return false
  return (process.env.FLAGS_FORCE_ON || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .includes(key)
}

/**
 * Release flag (default OFF): is the selection-list-service enabled for the
 * calling org? Pass the request context so per-org rollout targeting works.
 */
export async function isSelectionListsEnabled(
  ctx?: Partial<FlagContext>
): Promise<boolean> {
  if (isForcedOn(FLAGS.SELECTION_LISTS_SERVICE)) return true
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
  if (isForcedOn(FLAGS.SELECTION_LISTS_SEED_DEFAULTS)) return true
  const client = resolveClient()
  if (!client) return false // fail-safe: release default OFF
  try {
    return await client.getBooleanValue(FLAGS.SELECTION_LISTS_SEED_DEFAULTS, false, buildContext(ctx))
  } catch (err) {
    logger.warn({ err, flag: FLAGS.SELECTION_LISTS_SEED_DEFAULTS }, 'flag evaluation failed — using fail-safe default OFF')
    return false
  }
}
