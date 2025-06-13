import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { db } from '../config/database'
import { User } from '../types/shared'

interface AuthenticatedRequest extends Request {
  user?: User
}

export const authenticateToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1] // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      userId: string
    }

    // Fetch user from database
    const userRow = await db.get<any>(
      'SELECT id, email, first_name, last_name, default_app_id, roles FROM users WHERE id = ?',
      [decoded.userId]
    )

    if (!userRow) {
      return res.status(401).json({ error: 'User not found' })
    }

    const user: User = {
      id: userRow.id,
      email: userRow.email,
      firstName: userRow.first_name,
      lastName: userRow.last_name,
      defaultAppId: userRow.default_app_id,
      roles: JSON.parse(userRow.roles || '["user"]'),
    }

    req.user = user
    next()
  } catch (error) {
    return res.status(403).json({ error: 'Invalid token' })
  }
}

export const requireRole = (roles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' })
    }

    const hasRole = roles.some(role => req.user!.roles.includes(role))
    if (!hasRole) {
      return res.status(403).json({ error: 'Insufficient permissions' })
    }

    next()
  }
}
