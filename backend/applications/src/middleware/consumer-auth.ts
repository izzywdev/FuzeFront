// Consumer-registration middleware.
//
// Accepts a pre-shared CONSUMER_REGISTRATION_SECRET as a Bearer token on the
// self-registration routes (POST /apps, POST /apps/:slug/activate). When the
// token matches, the request is treated as a platform-admin service call —
// isPlatformAdmin: true in resolveCaller — so all Permit checks are bypassed.
//
// If the token does NOT match (or CONSUMER_REGISTRATION_SECRET is unset), the
// middleware passes through to the next handler (normally authenticateToken),
// so human OIDC sessions still work unchanged on the same route.
import type { Request, Response, NextFunction } from 'express'
import { authenticateToken } from './auth'

const SYNTHETIC_CONSUMER_USER = {
  id: 'consumer-registration',
  roles: ['admin'] as string[],
}

export function authenticateConsumerOrSession(
  req: Request & { user?: unknown },
  res: Response,
  next: NextFunction
): void {
  const secret = process.env.CONSUMER_REGISTRATION_SECRET
  if (secret) {
    const auth = req.headers.authorization
    if (auth?.startsWith('Bearer ') && auth.slice(7) === secret) {
      req.user = SYNTHETIC_CONSUMER_USER
      return next()
    }
  }
  return authenticateToken(req as any, res, next)
}
