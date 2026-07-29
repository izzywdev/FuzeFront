// Feature-flag access for the custom-domains slice (FF-EPIC-16 / FFRNT-91).
//
// Mirrors backend/applications/src/app-registry/flags.ts — we CONSUME flags
// here; the flag platform/taxonomy is owned by feature-flags-engineer.
//
// Flags used by this slice (owner: backend-engineer / custom-domains):
//   - fuzefront.platform.portal-domains
//       type: release | default: OFF
//       gates the ENTIRE self-service custom-domain surface: attaching a
//       domain, polling its status, and detaching it. With the flag OFF the
//       platform behaves exactly as it did before this epic — portals remain
//       reachable only at their existing fixed hosts.
//       removal criterion: delete once custom domains are generally available
//       AND FuzeInfra's production enablement (FFRNT-137) has soaked; then drop
//       the flag and the `isCustomDomainsEnabled` guard.
//
// Why gate on a flag at all when the wildcard Ingress rule is always rendered:
// the Ingress is inert without DNS, but calling the Custom Hostname API is not
// — every POST consumes Cloudflare custom-hostname quota (100 included, then
// billed) and every GET is a Cloudflare API call. The flag is what keeps that
// spend deliberate.
//
// This slice deliberately reuses the `fuzefront.platform.*` namespace already
// established by the multi-tenant-portals master switch, so portal addressing
// stays under one taxonomy.

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
  /** The whole custom-domain surface. Release flag, default OFF. */
  PORTAL_DOMAINS: 'fuzefront.platform.portal-domains',
  /**
   * The multi-tenant-portals master switch (FF-EPIC-09-S4). Custom domains are
   * a portal-addressing feature, so they are meaningless with portals off —
   * `isCustomDomainsEnabled` requires BOTH.
   */
  MULTI_TENANT_PORTALS: 'fuzefront.platform.multi-tenant-portals',
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
    app: 'fuzefront-backend',
    // The client's context contract names this `orgId`.
    ...(organizationId ? { orgId: organizationId } : {}),
    ...rest,
  }
}

async function getBoolean(
  key: string,
  fallback: boolean,
  ctx?: Partial<FlagContext>
): Promise<boolean> {
  const client = resolveClient()
  if (!client) return fallback
  try {
    return await client.getBooleanValue(key, fallback, buildContext(ctx))
  } catch {
    return fallback
  }
}

/**
 * Whether the self-service custom-domain surface is available.
 *
 * Requires BOTH the portal master switch and the portal-domains release flag.
 * Both default OFF, so an Unleash outage — or a service where the flag client
 * was never wired — fails closed and the feature is simply unavailable. It
 * never fails *open* onto a path that spends Cloudflare quota.
 */
export async function isCustomDomainsEnabled(
  ctx?: Partial<FlagContext>
): Promise<boolean> {
  const [portals, domains] = await Promise.all([
    getBoolean(FLAGS.MULTI_TENANT_PORTALS, false, ctx),
    getBoolean(FLAGS.PORTAL_DOMAINS, false, ctx),
  ])
  return portals && domains
}
