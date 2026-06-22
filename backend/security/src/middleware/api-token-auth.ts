/**
 * api-token-auth.ts
 *
 * Flexible auth middleware that accepts either:
 *   - An API token (bearer value starts with "ff_live_")
 *   - A JWT (all other bearer values) — delegated to the core authenticateToken
 *
 * Principal mapping for API tokens:
 *   - PAT (owner_type === 'user'): loads user row from DB; builds the same User shape
 *     that core's JWT middleware builds (id, email, firstName, lastName, defaultAppId?, roles).
 *   - Service token (owner_type === 'org'): no user row. Synthetic principal:
 *     { id: 'svc_token:<token.id>', email: '', firstName: '', lastName: '', roles: ['service'] }
 *     The Permit principal key is "svc_token:<token.id>".
 *
 * Rate limiting:
 *   tokenAuthRateLimiter uses skipSuccessfulRequests: true so only non-2xx responses
 *   count toward the limit. Limit = 10 failed token-auth attempts per IP per 60 s.
 *   An 11th consecutive failed attempt from the same IP returns HTTP 429.
 *
 * Security: never log raw token or token_hash; only token.token_prefix may be logged.
 */
import { Request, Response, NextFunction } from 'express'
import rateLimit from 'express-rate-limit'
import { authenticateToken } from './auth'
import { verifyToken, updateLastUsed } from '../services/api-token'
import { db } from '../config/database'

// ---------------------------------------------------------------------------
// Rate limiter — counts only FAILED token-auth attempts (non-2xx responses)
// ---------------------------------------------------------------------------

/**
 * Apply this limiter to routes that accept ff_live_ tokens.
 * Only failed (non-2xx) responses increment the counter, so legitimate
 * traffic is never throttled. The 11th failed attempt within 60 s returns 429.
 */
export const tokenAuthRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many failed authentication attempts, please try again later' },
})

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * authenticateFlexible — express middleware that accepts JWT or API token.
 *
 * If the bearer token starts with "ff_live_" it is treated as an API token
 * and verified via the token service. Otherwise the JWT path is taken by
 * delegating to core's authenticateToken unchanged.
 */
export async function authenticateFlexible(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization
  const value = authHeader?.split(' ')[1]

  if (!value) {
    res.status(401).json({ error: 'No token provided' })
    return
  }

  // JWT path — delegate to core middleware unchanged
  if (!value.startsWith('ff_live_')) {
    authenticateToken(req, res, next)
    return
  }

  // API-token path
  const result = await verifyToken(value)

  if (result.status === 'invalid') {
    res.status(401).json({ error: 'Invalid token' })
    return
  }
  if (result.status === 'revoked') {
    res.status(401).json({ error: 'Token revoked' })
    return
  }
  if (result.status === 'expired') {
    res.status(401).json({ error: 'Token expired' })
    return
  }

  // result.status === 'valid'
  const { token } = result

  if (token.owner_type === 'user') {
    // PAT: load the user row so req.user mirrors the shape core builds
    const userRow = await (db as any)('users')
      .select('id', 'email', 'first_name', 'last_name', 'roles')
      .where({ id: token.owner_id })
      .first()

    if (!userRow) {
      res.status(401).json({ error: 'Token owner not found' })
      return
    }

    req.user = {
      id: userRow.id,
      email: userRow.email,
      firstName: userRow.first_name ?? undefined,
      lastName: userRow.last_name ?? undefined,
      roles: Array.isArray(userRow.roles) ? userRow.roles : [],
    }
  } else {
    // Service token (owner_type === 'org'): synthetic principal
    // Permit principal key: "svc_token:<token.id>"
    req.user = {
      id: `svc_token:${token.id}`,
      email: '',
      firstName: '',
      lastName: '',
      roles: ['service'],
    }
  }

  req.apiToken = {
    id: token.id,
    scopes: token.scopes,
    ownerType: token.owner_type,
    ownerId: token.owner_id,
  }

  // Fire-and-forget — must not block the request
  updateLastUsed(token.id).catch((err: unknown) => {
    console.error('[api-token-auth] updateLastUsed failed for prefix=%s: %s', token.token_prefix, err)
  })

  next()
}
