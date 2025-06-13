'use strict'
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod }
  }
Object.defineProperty(exports, '__esModule', { value: true })
exports.requireRole = exports.authenticateToken = void 0
const jsonwebtoken_1 = __importDefault(require('jsonwebtoken'))
const database_1 = require('../config/database')
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1] // Bearer TOKEN
  if (!token) {
    return res.status(401).json({ error: 'Access token required' })
  }
  try {
    const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET)
    // Fetch user from database
    const userRow = await (0, database_1.db)('users')
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
      return res.status(401).json({ error: 'User not found' })
    }
    const user = {
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
exports.authenticateToken = authenticateToken
const requireRole = roles => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' })
    }
    const hasRole = roles.some(role => req.user.roles.includes(role))
    if (!hasRole) {
      return res.status(403).json({ error: 'Insufficient permissions' })
    }
    next()
  }
}
exports.requireRole = requireRole
//# sourceMappingURL=auth.js.map
