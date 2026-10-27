import type { NextFunction, Request, Response } from 'express'
import type { Identity } from '@fuzefront/security-client'
import { isUuid, parseId, toUuid } from '@izzywdev/fuzefront-identity'

export interface PlatformIdentity extends Pick<Identity, 'userId' | 'tenantId' | 'roles'> {
  tenantId: string
}
const identities = new WeakMap<Request, PlatformIdentity>()

function canonicalTenant(value: string): string {
  return isUuid(value) ? value.toLowerCase() : toUuid(parseId('organization', value))
}

export function requestIdentity(request: Request) { return identities.get(request) }

export function requirePlatformPermission(resource: string, action: string) {
  return async (request: Request, response: Response, next: NextFunction) => {
    const authorization = request.header('authorization')
    const baseUrl = process.env.FUZEFRONT_SECURITY_URL?.replace(/\/$/, '')
    if (process.env.FUZEQUALITY_DEV_AUTH_BYPASS === 'true' && process.env.NODE_ENV !== 'production') {
      identities.set(request, { userId: 'local-developer', tenantId: 'local', roles: ['admin'] })
      return next()
    }
    if (!authorization?.startsWith('Bearer ')) return response.status(401).json({ error: 'Authentication required', code: 'IDENTITY_MISSING' })
    if (!baseUrl) return response.status(503).json({ error: 'Platform security is unavailable', code: 'SECURITY_UNAVAILABLE' })
    try {
      const identityHeaders: Record<string, string> = { authorization }
      // The session token identifies the principal, while the portal's current
      // workspace selects the tenant. Treat the header only as a hint: the
      // FuzeFront Security endpoint canonicalizes it and proves active
      // membership before returning identity.tenantId.
      const tenantHint = request.header('x-fuzefront-tenant-id')
      const sessionUrl = new URL(`${baseUrl}/api/v1/security/session`)
      if (tenantHint) sessionUrl.searchParams.set('tenant', tenantHint)
      const sessionResponse = await fetch(sessionUrl, { headers: identityHeaders })
      if (!sessionResponse.ok) {
        if (sessionResponse.status === 400) {
          return response.status(400).json({ error: 'Invalid tenant selection', code: 'TENANT_INVALID' })
        }
        if (sessionResponse.status === 403) {
          return response.status(403).json({ error: 'Active tenant membership required', code: 'TENANT_FORBIDDEN' })
        }
        if (sessionResponse.status >= 500) {
          return response.status(503).json({ error: 'Platform security is unavailable', code: 'SECURITY_UNAVAILABLE' })
        }
        return response.status(401).json({ error: 'Authentication required', code: 'IDENTITY_INVALID' })
      }
      const body = await sessionResponse.json() as { identity?: Partial<Identity> }
      if (!body.identity?.userId || !body.identity.tenantId) return response.status(403).json({ error: 'A tenant-scoped identity is required', code: 'TENANT_UNRESOLVED' })
      const identity = body.identity as PlatformIdentity
      // A selected workspace is part of the authorization boundary. Even
      // though Security proves membership, do not silently fall back to a
      // token's default tenant if an older or misconfigured Security service
      // ignores the requested tenant selector.
      // Security returns the storage-shaped UUID after proving membership,
      // while the portal may carry the equivalent public `org_...` TypeID.
      // Compare the canonical values so identifier presentation cannot turn a
      // valid, proven organization session into a context-mismatch failure.
      const canonicalTenantHint = tenantHint ? canonicalTenant(tenantHint) : null
      if (canonicalTenantHint && identity.tenantId.toLowerCase() !== canonicalTenantHint) {
        return response.status(409).json({
          error: 'The resolved tenant does not match the active portal workspace',
          code: 'TENANT_CONTEXT_MISMATCH',
        })
      }
      const decisionResponse = await fetch(`${baseUrl}/api/v1/security/authz/check`, {
        method: 'POST',
        headers: { ...identityHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ subject: identity.userId, tenant: identity.tenantId, resource: { type: resource }, action }),
      })
      if (!decisionResponse.ok) return response.status(403).json({ error: 'Authorization decision unavailable; denying', code: 'DECISION_UNAVAILABLE' })
      const decision = await decisionResponse.json() as { allow?: boolean }
      if (decision.allow !== true) return response.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' })
      identities.set(request, identity)
      next()
    } catch {
      response.status(503).json({ error: 'Platform security is unavailable', code: 'SECURITY_UNAVAILABLE' })
    }
  }
}

export function requirePlatformAdminPermission(resource: string, action: string) {
  const requirePermission = requirePlatformPermission(resource, action)
  return (request: Request, response: Response, next: NextFunction) =>
    requirePermission(request, response, () => {
      const identity = requestIdentity(request)
      if (!identity?.roles?.includes('admin')) {
        return response.status(403).json({ error: 'Platform administrator access required', code: 'PLATFORM_ADMIN_REQUIRED' })
      }
      next()
    })
}
