/**
 * Identity feature-flag access for the main backend slice.
 *
 * Reads flags via the family OpenFeature client (@fuzefront/feature-flags) per
 * the feature-flags skill — we CONSUME flags here; the flag platform/taxonomy
 * is owned by feature-flags-engineer.
 *
 * Flags consumed by this slice:
 *   - fuzefront.identity.prefixed-ids
 *       type: release | default: OFF
 *       owner: backend-engineer (identity)
 *       When ON, API responses return TypeID wire form (org_01h…, app_01h…, etc.)
 *       instead of bare UUID. Implements the dual-accept window from
 *       governance/identifier-standard.md §8.
 *       removal criterion: delete once all clients have migrated to prefixed
 *       ids AND the backfill is complete.
 *
 * In-code defaults are the fail-safe values (OFF for release).
 */

export const IDENTITY_FLAGS = {
  PREFIXED_IDS: 'fuzefront.identity.prefixed-ids',
} as const

export interface FlagContext {
  environment?: string
  orgId?: string
  userId?: string
  app?: string
}

export interface FlagClientLike {
  getBooleanValue(
    key: string,
    defaultValue: boolean,
    context?: Record<string, unknown>
  ): Promise<boolean>
}

let injected: FlagClientLike | null = null

/** Test/DI seam — pin flag values with an in-memory client. */
export function setIdentityFlagClient(c: FlagClientLike | null): void {
  injected = c
}

function resolveClient(): FlagClientLike | null {
  if (injected) return injected
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@fuzefront/feature-flags')
    return typeof mod.getClient === 'function' ? mod.getClient() : null
  } catch {
    return null
  }
}

function buildContext(ctx?: Partial<FlagContext>): Record<string, unknown> {
  const { orgId, ...rest } = ctx ?? {}
  return {
    environment: process.env.NODE_ENV === 'production' ? 'prod' : (process.env.FLAG_ENV ?? 'local'),
    app: 'fuzefront-backend',
    ...(orgId ? { orgId } : {}),
    ...rest,
  }
}

/**
 * Release flag (default OFF): should this response use TypeID wire-form ids?
 */
export async function isPrefixedIdsEnabled(ctx?: Partial<FlagContext>): Promise<boolean> {
  const client = resolveClient()
  if (!client) return false
  try {
    return await client.getBooleanValue(IDENTITY_FLAGS.PREFIXED_IDS, false, buildContext(ctx))
  } catch {
    return false
  }
}
