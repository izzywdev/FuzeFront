// Permit.io authorization for the app-registry surface. Mirrors the host
// backend's checkPermission pattern (backend/src/utils/permit/permission-check.ts)
// and the no-op CI proxy (backend/src/config/permit.ts): the registry authorizes
// via Permit.io and NEVER falls back to a DB role check on a clean deny (that
// would fail OPEN). On a Permit error we fail CLOSED (deny).
//
// The client is lazily resolved so the applications-service does not hard-require
// the permitio SDK at import time, and so unit tests can inject a stub
// authorizer. Feature-flag rollout of authz is convenience only — the real
// authz decision always lives here, never in a flag.

export interface PermitResource {
  type: string
  tenant: string
  key?: string
}

export interface PermitLike {
  check: (
    user: string,
    action: string,
    resource: PermitResource,
    context?: Record<string, unknown>
  ) => Promise<boolean>
}

/** Recursively-resolving no-op proxy — every check() resolves to false (deny). */
function makeNoOpDenyClient(): PermitLike {
  return {
    check: async () => false,
  }
}

let client: PermitLike | null = null

/** Test/DI seam — inject a stub authorizer. */
export function setPermitClient(c: PermitLike | null): void {
  client = c
}

/**
 * Resolves the Permit client. In CI/test (no real PERMIT_API_KEY) we use a
 * no-op DENY client so suites run with no network and no SDK; production loads
 * the real permitio SDK. The real instance is created with throwOnError:false so
 * a PDP outage yields a deny (handled in checkAppRegistryPermission) rather than
 * a thrown 500.
 */
export function getPermitClient(): PermitLike {
  if (client) return client

  const token = process.env.PERMIT_API_KEY || ''
  const isNoOp =
    !token ||
    (process.env.NODE_ENV === 'test' && !token.startsWith('permit_key_')) ||
    token.startsWith('ci-')

  if (isNoOp) {
    client = makeNoOpDenyClient()
    return client
  }

  try {
    // Lazy require so the SDK is only needed where Permit is actually configured.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Permit } = require('permitio')
    client = new Permit({
      token,
      pdp: process.env.PERMIT_PDP_URL || 'http://localhost:7766',
      throwOnError: false,
      log: { level: 'error' },
    }) as PermitLike
  } catch (err) {
    console.error(
      '[app-registry][permit] permitio SDK unavailable — failing closed:',
      err instanceof Error ? err.message : String(err)
    )
    client = makeNoOpDenyClient()
  }
  return client
}

/**
 * Checks an `apps:*` scope for a user against an App resource scoped to a tenant
 * (organization). Fail-CLOSED on any error. `tenant` falls back to the platform
 * tenant for platform-global (org-less) apps.
 */
export async function checkAppRegistryPermission(args: {
  userId: string
  action: 'apps:register' | 'apps:write' | 'apps:activate'
  organizationId?: string | null
  slug?: string
  context?: Record<string, unknown>
}): Promise<boolean> {
  try {
    const tenant = args.organizationId || 'platform'
    const result = await getPermitClient().check(
      args.userId,
      args.action,
      { type: 'App', tenant, key: args.slug },
      args.context
    )
    return Boolean(result)
  } catch (err) {
    console.error(
      `[app-registry][permit] check failed (deny) user=${args.userId} action=${args.action}:`,
      err instanceof Error ? err.message : String(err)
    )
    return false
  }
}
