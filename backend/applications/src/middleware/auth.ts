// Thin re-export shim. JWT auth middleware lives in @fuzeone/core. Copied domain
// modules import `../middleware/auth` unchanged; this shim forwards to core.
export { authenticateToken, requireRole } from '@fuzeone/core'
