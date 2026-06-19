// Thin re-export shim. JWT auth middleware now lives in @fuzefront/core. Copied
// domain modules import `../middleware/auth` unchanged; this shim forwards to core.
export { authenticateToken, requireRole } from '@fuzefront/core'
