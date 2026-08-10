// Feature-flag access for the selection-list-service slice (FF-EPIC-17 / FFRNT-201).
//
// Mirrors the pattern established by backend/src/custom-domains/flags.ts and
// backend/applications/src/app-registry/flags.ts — we CONSUME flags here;
// the flag platform/taxonomy is owned by feature-flags-engineer.
//
// Flags used by this slice (owner: platform team):
//
//   - fuzefront.selection-lists.service          (FFRNT-201 / S15)
//       type: release | default: OFF
//       Gates BOTH the selection-list-service deployment (service-side) AND
//       the "Selection Lists" entry in the FuzeFront shell left sidebar (UI,
//       S9). While the service is dark, the shell hides the nav entry;
//       once the service is ready per-org the flag is flipped ON for that org
//       in Unleash.
//       removal criterion: when the service is GA and enabled for 100% of
//       orgs — remove the flag check in the sidebar nav (S9) and drop this
//       guard.
//
// The in-code default is the fail-safe value (OFF for release) so an
// Unleash/client outage fails closed — the feature is simply unavailable.
// The client is resolved lazily; any error returns the default so a missing
// client never breaks a request.

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
 * Import from '@fuzefront/feature-flags' for the same key as a package
 * constant: `FLAG_KEYS.SELECTION_LISTS_SERVICE`.
 */
export const FLAGS = {
  /**
   * Master gate for the selection-list-service and its shell UI entry.
   * Release flag, default OFF. See module doc above for full metadata.
   */
  SELECTION_LISTS_SERVICE: 'fuzefront.selection-lists.service',
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
    // family flag platform is not yet wired; absence -> null -> safe defaults.
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
    // The client's context contract names this `orgId` (packages/feature-flags/
    // src/types.ts). Map organizationId -> orgId so Unleash org-targeted
    // constraints match correctly.
    ...(organizationId ? { orgId: organizationId } : {}),
    ...rest,
  }
}

/**
 * Release flag (default OFF): is the selection-list-service enabled for the
 * calling org? Pass the request context so per-org rollout targeting works.
 *
 * Gate this on BOTH the service startup path and individual request handlers
 * where appropriate — and gate the shell nav entry (S9) via the web catalog
 * (/api/flags -> GET fuzefront.selection-lists.service).
 */
export async function isSelectionListsEnabled(
  ctx?: Partial<FlagContext>
): Promise<boolean> {
  const client = resolveClient()
  if (!client) return false // fail-safe: release default OFF
  try {
    return await client.getBooleanValue(
      FLAGS.SELECTION_LISTS_SERVICE,
      false,
      buildContext(ctx)
    )
  } catch {
    return false
  }
}
