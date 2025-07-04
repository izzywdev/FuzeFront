import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { db } from '../config/database'
import { User } from '../types/shared'

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
