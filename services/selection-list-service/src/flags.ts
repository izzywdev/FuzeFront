// flags.ts — Feature flag helpers for selection-list-service.
//
// Reads flags via the family OpenFeature client (`@fuzefront/feature-flags`).
// Lazy-require pattern: if the package is absent the client is null and every
// function returns its fail-safe default — never throws, never hangs.
//
// Flags consumed by this service (owner: backend-engineer / selection-list):
//
//   fuzefront.selection-list.service-enabled
//     type: release   default: OFF
//     Gates the entire selection-list-service API surface (ship dark, release
//     deliberately). Any route that serves data checks this flag first; 404 if OFF.
//     removal criterion: delete once selection-list-service is 100% rolled out
//     and stable across all orgs (100% rollout confirmed in monitoring).
//
// The in-code default is the fail-safe value (OFF for release) so an Unleash
// outage degrades safely: the route acts as if the service does not yet exist.

export interface FlagClientLike {
  getBooleanValue(
    key: string,
    defaultValue: boolean,
    context?: Record<string, unknown>
  ): Promise<boolean>;
}

export const FLAGS = {
  SERVICE_ENABLED: 'fuzefront.selection-list.service-enabled',
} as const;

// Test/DI seam — pin flag values in unit tests.
let _injected: FlagClientLike | null = null;

/** Install a test client. Pass null to restore the lazy-require path. */
export function setFlagClient(c: FlagClientLike | null): void {
  _injected = c;
}

function resolveClient(): FlagClientLike | null {
  if (_injected) return _injected;
  try {
    // Lazy require so the service degrades gracefully if the package is not yet
    // wired (absence → null → safe defaults). Mirrors the pattern in
    // backend/applications/src/app-registry/flags.ts.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@fuzefront/feature-flags');
    return typeof mod.getClient === 'function' ? mod.getClient() : null;
  } catch {
    return null;
  }
}

function buildContext(ctx?: { orgId?: string; userId?: string }): Record<string, unknown> {
  return {
    environment: process.env.NODE_ENV === 'production' ? 'prod' : (process.env.FLAG_ENV || 'local'),
    app: 'selection-list-service',
    ...(ctx?.orgId ? { orgId: ctx.orgId } : {}),
    ...(ctx?.userId ? { userId: ctx.userId } : {}),
  };
}

/**
 * release flag (default OFF): is the selection-list-service surface enabled
 * for this caller/org? Returns false when the flag store is unreachable.
 */
export async function isSelectionListsEnabled(
  ctx?: { orgId?: string; userId?: string }
): Promise<boolean> {
  const client = resolveClient();
  if (!client) return false; // fail-safe: release default OFF
  try {
    return await client.getBooleanValue(FLAGS.SERVICE_ENABLED, false, buildContext(ctx));
  } catch {
    return false;
  }
}
