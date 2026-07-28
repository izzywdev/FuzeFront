import express, { Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import { authenticateToken } from '../middleware/auth'
import { db } from '../config/database'
import {
  bootstrapPortalContext,
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

// Public boot fetch — same express-rate-limit convention/limits as the
// authenticated flags-read endpoint (routes/flags.ts flagsRateLimiter): the
// shell fetches this once per boot, so a generous per-client ceiling is
// invisible to real users while bounding host/slug enumeration abuse.
const portalContextRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again shortly.' },
})

// /current performs an authorization decision (resolves + returns the
// caller's own portal from their session-bound portalId) — tighter than the
// public context limiter since a legitimate caller fetches it rarely (once
// per admin-console/session load), and this is exactly the
// enumeration/brute-force surface a missing rate limit exposes.
const portalCurrentRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again shortly.' },
})

/**
 * GET /api/v1/portal/context — PUBLIC, unauthenticated. Renders before login.
 * `req.portal` is set by the global `resolvePortalContext` middleware
 * (src/middleware/portalContext.ts), which already fails closed (403
 * PORTAL_SUSPENDED) and is itself flag-gated.
 *
 * `!req.portal` covers three distinct cases, disambiguated via
 * `req.portalsFlagEnabled` (also set by resolvePortalContext):
 *   - flag OFF (`portalsFlagEnabled` false/undefined)      -> 404, unchanged pre-epic behavior.
 *   - flag ON, BOOTSTRAP MODE (no root portal seeded yet)   -> 200, the generic
 *     platform default (bootstrapPortalContext()) so the shell can still
 *     paint a login screen and the fresh install isn't bricked.
 */
router.get('/context', portalContextRateLimiter, async (req: Request, res: Response) => {
  const portal = req.portal
  if (!portal) {
    if (req.portalsFlagEnabled) {
      return res.json(bootstrapPortalContext())
    }
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
router.get('/current', portalCurrentRateLimiter, authenticateToken, async (req: any, res: Response) => {
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
