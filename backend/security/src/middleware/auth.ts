// Thin re-export shim. JWT auth middleware now lives in @fuzeone/core. Copied
// domain modules import `../middleware/auth` unchanged; this shim forwards to core.
export { authenticateToken, requireRole } from '@fuzeone/core'
