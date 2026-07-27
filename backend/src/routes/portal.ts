import express, { Request, Response } from 'express'
import { authenticateToken } from '../middleware/auth'
import { db } from '../config/database'
import {
  findPortalById,
  getPortalDomains,
  rowToPortal,
  rowToPortalContext,
} from '../repositories/portalRepository'
import { isMultiTenantPortalsEnabled } from '../utils/portalFlag'

/**
 * FF-EPIC-10-S2 — public portal-context boot endpoint + the caller's own
 * portal. Mounted at /api/v1/portal (see src/index.ts).
 *
 * Both routes are gated by the master flag: OFF -> 404 (the pre-epic
 * behavior — these routes did not exist before this epic).
 */

const router = express.Router()

/**
 * GET /api/v1/portal/context — PUBLIC, unauthenticated. Renders before login.
 * `req.portal` is set by the global `resolvePortalContext` middleware
 * (src/middleware/portalContext.ts), which already fails closed (403
 * PORTAL_SUSPENDED / 404 unresolved) and is itself flag-gated — so `!req.portal`
 * here covers BOTH "flag is off" and "genuinely nothing resolved".
 */
router.get('/context', async (req: Request, res: Response) => {
  const portal = (req as any).portal
  if (!portal) {
    return res.status(404).json({
      error: 'NOT_FOUND',
      message: 'No portal context available.',
    })
  }
  return res.json(rowToPortalContext(portal))
})

/**
 * GET /api/v1/portal/current — the caller's OWN portal, resolved strictly
 * from the authenticated session (`req.user.portalId`, set by
 * authenticateToken from the JWT `portal_id` claim) — never from a
 * client-supplied id/query/Host.
 */
router.get('/current', authenticateToken, async (req: any, res: Response) => {
  const enabled = await isMultiTenantPortalsEnabled({ userId: req.user?.id })
  if (!enabled) {
    return res.status(404).json({
      error: 'NOT_FOUND',
      message: 'Portal capability is not enabled.',
    })
  }

  const portalId: string | undefined = req.user?.portalId
  if (!portalId) {
    return res.status(403).json({
      error: 'FORBIDDEN_PORTAL',
      message: 'No portal is bound to this session.',
    })
  }

  const row = await findPortalById(portalId, db)
  if (!row) {
    // The bound portalId no longer resolves to a real portal — never leak
    // cross-tenant data by falling back to anything else.
    return res.status(403).json({
      error: 'FORBIDDEN_PORTAL',
      message: 'The bound portal could not be found.',
    })
  }

  const domains = await getPortalDomains(row.id, db)
  return res.json(rowToPortal(row, domains))
})

export default router
