import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { db } from '../config/database'
import { User } from '../types/shared'
import { getRootPortal } from '../repositories/portalRepository'
import { isMultiTenantPortalsEnabled } from '../utils/portalFlag'

export const authenticateToken = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const requestId = req.requestId || 'unknown'
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1] // Bearer TOKEN

  console.log(`🔐 [${requestId}] Auth middleware - checking token:`, {
    hasAuthHeader: !!authHeader,
    hasToken: !!token,
    tokenPreview: token ? `${token.substring(0, 20)}...` : 'none',
    path: req.path,
    method: req.method,
  })

  if (!token) {
    console.log(`❌ [${requestId}] No token provided`)
    return res.status(401).json({ error: 'Access denied. No token provided.' })
  }

  try {
    console.log(`🔍 [${requestId}] Verifying JWT token...`)
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      userId: string
      // FF-EPIC-10-S3 — the portal this token was minted for (routes/auth.ts
      // jwt.sign call sites). Absent on tokens issued before this epic, or
      // whenever the multi-tenant-portals flag was OFF at mint time.
      portalId?: string
    }

    console.log(`✅ [${requestId}] Token verified, fetching user:`, {
      userId: decoded.userId,
    })

    // Fetch user from database
    const userRow = await db('users')
      .select(
        'id',
        'email',
        'first_name',
        'last_name',
        'default_app_id',
        'roles'
      )
      .where('id', decoded.userId)
      .first()

    if (!userRow) {
      console.log(`❌ [${requestId}] User not found in database:`, {
        userId: decoded.userId,
      })
      return res.status(401).json({ error: 'User not found' })
    }

    console.log(`👤 [${requestId}] User authenticated:`, {
      userId: userRow.id,
      email: userRow.email,
      roles: userRow.roles,
    })

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

    // FF-EPIC-10-S3 — token-derived portal binding, NEVER a client-supplied
    // URL/query param. Only active when the master flag is ON, so pre-epic
    // token/session shapes and behavior are unchanged while it's OFF.
    const portalsEnabled = await isMultiTenantPortalsEnabled({ userId: user.id })
    if (portalsEnabled) {
      const resolvedPortal = (req as any).portal // set by resolvePortalContext, if mounted upstream
      if (decoded.portalId) {
        if (resolvedPortal && resolvedPortal.id !== decoded.portalId) {
          // AC3 — a token minted for portal A presented on portal B's Host is
          // rejected outright; the caller must re-authenticate on that portal.
          // Constant format string + arguments, never an interpolated one (a
          // variable as/in the format string lets an injected specifier
          // forge log output) — same convention as utils/feature-flags.ts.
          console.log(
            '❌ [%s] Token portal mismatch: token=%s host=%s',
            requestId,
            decoded.portalId,
            resolvedPortal.id
          )
          return res.status(401).json({ error: 'Invalid token.' })
        }
        user.portalId = decoded.portalId
      } else {
        // AC-risk mitigation — a token issued before this epic (no portal_id
        // claim) is treated as bound to the root portal rather than rejected,
        // so existing sessions don't break on rollout.
        const root = await getRootPortal(db)
        user.portalId = resolvedPortal?.id ?? root?.id
      }
    }

    req.user = user
    next()
  } catch (error) {
    console.log(`❌ [${requestId}] Token verification failed:`, {
      error: error instanceof Error ? error.message : String(error),
      tokenPreview: token ? `${token.substring(0, 20)}...` : 'none',
    })
    return res.status(401).json({ error: 'Invalid token.' })
  }
}

export const requireRole = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' })
    }

    const user = req.user as User; const userRoles = user.roles || []
    const hasRole = roles.some(role => userRoles.includes(role))
    if (!hasRole) {
      return res.status(403).json({ error: 'Insufficient permissions' })
    }

    next()
  }
}
