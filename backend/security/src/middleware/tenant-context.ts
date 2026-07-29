/**
 * Resolves the identity tenant for an inbound request and makes it the ambient
 * tenant for everything downstream.
 *
 * security-service fronts several tenants, each backed by its own Authentik
 * instance and therefore its own account directory. The request host is what
 * distinguishes them, so this middleware must run BEFORE any handler that
 * touches identity.
 *
 * FAIL CLOSED. If no tenant claims the host, the request is rejected — it is
 * never served by "the first" or "the default" tenant. Falling back would
 * authenticate the user against the wrong directory, silently rejoining two
 * directories that are deliberately separate. That is the exact failure this
 * design exists to prevent, so it is worth a hard 400.
 *
 * In legacy single-tenant mode (`SECURITY_TENANTS` unset) resolution always
 * succeeds, so mounting this is a no-op for existing deployments.
 */
import { NextFunction, Request, Response } from 'express'
import { logger } from '../lib/logger'
import {
  AuthentikTenant,
  isMultiTenant,
  normaliseHost,
  resolveTenantByHost,
  runWithTenant,
} from '../providers/authentik/tenants'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** The identity tenant serving this request. Set by tenantContext. */
      identityTenant?: AuthentikTenant
    }
  }
}

/**
 * Prefer Express's `req.hostname`, which already honours the trust-proxy
 * setting, and fall back to the raw Host header. X-Forwarded-Host is NOT read
 * directly: behind the ingress it is caller-supplied, and letting it pick the
 * tenant would let a client choose which directory to authenticate against.
 */
function requestHost(req: Request): string {
  return normaliseHost(req.hostname || req.headers.host)
}

export function tenantContext(req: Request, res: Response, next: NextFunction): void {
  const host = requestHost(req)
  const tenant = resolveTenantByHost(host)

  if (!tenant) {
    logger.warn({ host, path: req.path }, 'tenant: rejected request from unclaimed host')
    res.status(400).json({
      error: 'unknown_host',
      message: 'This host is not configured for authentication.',
    })
    return
  }

  req.identityTenant = tenant
  // Bind for the remainder of the request so code far from the route — which
  // cannot reasonably take a tenant parameter — reads the right configuration.
  runWithTenant(tenant, () => next())
}

/**
 * Assert that a session/token minted for `tokenTenantId` is being presented to
 * the tenant that issued it. A session is only valid within its own directory;
 * accepting one across tenants would let an account in one silo act in another.
 */
export function assertTenantMatches(
  req: Request,
  tokenTenantId: string | undefined
): { ok: true } | { ok: false; reason: string } {
  const expected = req.identityTenant?.id
  if (!expected) return { ok: false, reason: 'no tenant context on request' }

  if (!tokenTenantId) {
    // Sessions minted before tenancy existed carry no tenant claim. Accept them
    // only while single-tenant, where there is nothing to confuse them with.
    if (!isMultiTenant()) return { ok: true }
    return { ok: false, reason: 'token carries no tenant claim' }
  }

  if (tokenTenantId !== expected) {
    return { ok: false, reason: `token is for tenant "${tokenTenantId}", host serves "${expected}"` }
  }
  return { ok: true }
}
