import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { db } from '../config/database'
import { User } from '../types/shared'

/**
 * JWT auth middleware shared by every FuzeFront backend service. Depends only on
 * `db` (the @fuzefront/core knex singleton, configured by the consuming service)
 * and `JWT_SECRET`. No Permit / business logic — that stays in the owning
 * service. Verifies the bearer token and loads the user row into `req.user`.
 */
export const authenticateToken = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const requestId = req.requestId || 'unknown'
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1] // Bearer TOKEN

  if (!token) {
    console.log(`❌ [${requestId}] No token provided`)
    return res.status(401).json({ error: 'Access denied. No token provided.' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      userId: string
      sessionId?: string
    }

    // Revocation is enforced HERE, on the request path, or it does not exist.
    //
    // The session JWT is stateless HS256, so signature validity alone says
    // nothing about whether the session still lives. `logout()` and any
    // device-revoke delete the `sessions` row — but until this check existed,
    // nothing on the request path read that table, so a "logged out" token kept
    // authenticating every route until `exp` (up to 24h). Revocation was
    // enforced only by GET /session ("me"), i.e. effectively nowhere.
    //
    // Run in parallel with the user load: this is a PK lookup, so the added
    // cost is one concurrent round-trip, not a serial one.
    const [userRow, session] = await Promise.all([
      db('users')
        .select(
          'id',
          'email',
          'first_name',
          'last_name',
          'default_app_id',
          'roles'
        )
        .where('id', decoded.userId)
        .first(),
      decoded.sessionId
        ? db('sessions').select('id', 'expires_at').where('id', decoded.sessionId).first()
        : Promise.resolve(undefined),
    ])

    if (!userRow) {
      console.log(`❌ [${requestId}] User not found in database:`, {
        userId: decoded.userId,
      })
      return res.status(401).json({ error: 'User not found' })
    }

    if (decoded.sessionId) {
      if (!session) {
        // Signed-out, device-revoked, or reaped. Deny.
        console.log(`❌ [${requestId}] Session revoked`, { sessionId: decoded.sessionId })
        return res.status(401).json({ error: 'Session revoked' })
      }
      if (session.expires_at && new Date(session.expires_at).getTime() < Date.now()) {
        console.log(`❌ [${requestId}] Session expired`, { sessionId: decoded.sessionId })
        return res.status(401).json({ error: 'Session expired' })
      }
    } else {
      // Every current mint site includes `sessionId`, so absence means a token
      // issued by an older build. Those age out with the 24h TTL; allowing them
      // keeps this deploy from signing everyone out mid-session. Not a new
      // weakness — an attacker cannot strip the claim without the signing key,
      // and holding that key lets them mint anything anyway.
      // TODO: once a release has fully rolled (>24h), make this branch a 401.
      console.warn(`⚠️ [${requestId}] Session token has no sessionId — pre-rollout token, revocation cannot be enforced`)
    }

    const user: User = {
      id: userRow.id,
      email: userRow.email,
      firstName: userRow.first_name,
      lastName: userRow.last_name,
      defaultAppId: userRow.default_app_id,
      roles: Array.isArray(userRow.roles)
        ? userRow.roles
        : JSON.parse(userRow.roles || '["user"]'),
    }

    req.user = user
    next()
  } catch (error) {
    console.log(`❌ [${requestId}] Token verification failed:`, {
      error: error instanceof Error ? error.message : String(error),
    })
    return res.status(401).json({ error: 'Invalid token.' })
  }
}

export const requireRole = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' })
    }

    const user = req.user as User
    const userRoles = user.roles || []
    const hasRole = roles.some(role => userRoles.includes(role))
    if (!hasRole) {
      return res.status(403).json({ error: 'Insufficient permissions' })
    }

    next()
  }
}
