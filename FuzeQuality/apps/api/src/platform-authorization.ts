import type { NextFunction, Request, Response } from 'express'

export interface PlatformIdentity { userId: string; tenantId: string; roles?: string[] }
const identities = new WeakMap<Request, PlatformIdentity>()

export function requestIdentity(request: Request) { return identities.get(request) }

export function requirePlatformPermission(resource: string, action: string) {
  return async (request: Request, response: Response, next: NextFunction) => {
    const authorization = request.header('authorization')
    const baseUrl = process.env.FUZEFRONT_SECURITY_URL?.replace(/\/$/, '')
    if (process.env.FUZEQUALITY_DEV_AUTH_BYPASS === 'true' && process.env.NODE_ENV !== 'production') {
      identities.set(request, { userId: 'local-developer', tenantId: 'local' })
      return next()
    }
    if (!authorization?.startsWith('Bearer ')) return response.status(401).json({ error: 'Authentication required', code: 'IDENTITY_MISSING' })
    if (!baseUrl) return response.status(503).json({ error: 'Platform security is unavailable', code: 'SECURITY_UNAVAILABLE' })
    try {
      const sessionResponse = await fetch(`${baseUrl}/api/v1/security/session`, { headers: { authorization } })
      if (!sessionResponse.ok) return response.status(401).json({ error: 'Authentication required', code: 'IDENTITY_INVALID' })
      const body = await sessionResponse.json() as { identity?: Partial<PlatformIdentity> }
      if (!body.identity?.userId || !body.identity.tenantId) return response.status(403).json({ error: 'A tenant-scoped identity is required', code: 'TENANT_UNRESOLVED' })
      const identity = body.identity as PlatformIdentity
      const decisionResponse = await fetch(`${baseUrl}/api/v1/security/authz/check`, {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/json' },
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
