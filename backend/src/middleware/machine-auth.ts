/**
 * machine-auth.ts
 *
 * Express middleware for authenticating machine/service-account identities.
 *
 * Accepts standard OAuth2 Bearer tokens obtained via the client_credentials
 * grant. Validates them via Authentik token introspection (not local JWT
 * verify) so that revocation is respected in real time.
 *
 * On success, attaches `req.machineIdentity: MachineIdentity` to the request.
 * Falls back gracefully when Authentik is unreachable (same fail-closed pattern
 * as the Permit.io utils).
 *
 * Usage:
 *   import { authenticateMachineToken } from '../middleware/machine-auth'
 *   router.get('/internal/resource', authenticateMachineToken, handler)
 *
 * To accept EITHER a human or machine token on a route:
 *   router.get('/resource', anyIdentityMiddleware, handler)
 *   // see anyIdentityMiddleware below
 */

import { Request, Response, NextFunction } from 'express'
import {
  introspectMachineToken,
  buildMachineIdentity,
  MachineIdentity,
} from '../services/machine-identity'

// ---------------------------------------------------------------------------
// Express Request augmentation
// ---------------------------------------------------------------------------

declare global {
  namespace Express {
    interface Request {
      machineIdentity?: MachineIdentity
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Neutralise a request-derived value before it reaches a log line.
 *
 * `req.requestId` can originate from an inbound `x-request-id` header, so it
 * is attacker-controlled on a public request path: unsanitised it could
 * inject CR/LF and forge whole log entries. Control characters are escaped
 * (content preserved) and the result is length-capped.
 */
function sanitizeForLog(value: unknown): string {
  return String(value ?? '')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, 200)
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * authenticateMachineToken
 *
 * Validates the Bearer token in the Authorization header using Authentik
 * token introspection. Intended for routes that accept ONLY machine/service
 * identities.
 *
 * - 401 if no Authorization header is present
 * - 401 if the token is inactive, expired, or revoked
 * - 503 if Authentik is unreachable (fail-closed — do NOT grant access)
 */
export const authenticateMachineToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const requestId = sanitizeForLog((req as any).requestId || 'unknown')

  const authHeader = req.headers['authorization']
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null

  if (!token) {
    console.log('[machine-auth] [%s] No Bearer token provided', requestId)
    res.status(401).json({ error: 'Access denied. No machine token provided.' })
    return
  }

  console.log('[machine-auth] [%s] Introspecting machine token...', requestId)

  const introspection = await introspectMachineToken(token)

  if (!introspection.active) {
    // Introspection returned active:false — either the token is genuinely
    // invalid/revoked, OR Authentik was unreachable (returns active:false).
    // Either way we fail closed.
    console.log(
      '[machine-auth] [%s] Token inactive or Authentik unreachable',
      requestId
    )
    res.status(401).json({ error: 'Invalid or expired machine token.' })
    return
  }

  const identity = buildMachineIdentity(introspection)
  if (!identity) {
    console.log(
      '[machine-auth] [%s] Could not build machine identity from introspection result',
      requestId
    )
    res.status(401).json({ error: 'Invalid machine token claims.' })
    return
  }

  // Constant format string; identity fields are passed as arguments so they
  // can never be read as format specifiers. The bearer token itself is never
  // logged — only the non-secret claims derived from introspection.
  console.log('[machine-auth] [%s] Machine token accepted:', requestId, {
    clientId: identity.clientId,
    scopes: identity.scopes,
    delegateUserId: identity.delegateUserId,
  })

  req.machineIdentity = identity
  next()
}

/**
 * requireMachineScope
 *
 * Authorization guard that verifies the authenticated machine identity holds
 * all of the specified scopes. Must be used AFTER authenticateMachineToken.
 *
 * Usage:
 *   router.post('/jobs', authenticateMachineToken, requireMachineScope('jobs:write'), handler)
 */
export const requireMachineScope = (...requiredScopes: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const identity = req.machineIdentity
    if (!identity) {
      res.status(401).json({ error: 'Machine identity not authenticated' })
      return
    }

    const missingScopes = requiredScopes.filter(
      s => !identity.scopes.includes(s)
    )
    if (missingScopes.length > 0) {
      res.status(403).json({
        error: 'Insufficient scopes for machine identity',
        required: requiredScopes,
        missing: missingScopes,
      })
      return
    }

    next()
  }
}

/**
 * anyIdentityMiddleware
 *
 * Convenience middleware that accepts EITHER a human user token (via the
 * standard authenticateToken path) OR a machine token. After this runs,
 * either req.user or req.machineIdentity will be populated (possibly both
 * if the machine token carries a delegateUserId that is then resolved).
 *
 * This middleware does NOT fail the request — it just tries to populate
 * identity fields. Use it on routes that serve both human and machine callers.
 * Downstream guards (requireRole, requirePermission, etc.) enforce access.
 */
export const tryAuthenticateMachineToken = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  // Only run if req.user is not already populated (human auth ran first)
  if (req.user) {
    next()
    return
  }

  const authHeader = req.headers['authorization']
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null

  if (!token) {
    next()
    return
  }

  const introspection = await introspectMachineToken(token)
  if (introspection.active) {
    const identity = buildMachineIdentity(introspection)
    if (identity) {
      req.machineIdentity = identity
    }
  }

  next()
}
