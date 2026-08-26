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
import { getRequestPortalsEnabled } from '../utils/portalFlag'
import { isPrefixedIdsEnabled } from '../identity/flags'
import { prefixDtoIds } from '../identity/serializer'

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
 * `!req.portal` covers four distinct cases, disambiguated via
 * `req.portalsFlagEnabled` and `req.portalResolutionDegraded` (both set by
 * resolvePortalContext):
 *   - flag OFF (`portalsFlagEnabled` false/undefined)      -> 404, unchanged pre-epic behavior.
 *   - flag ON, DEGRADED (a transient host-lookup/infra error)  -> 503, fail
 *     CLOSED. Round-8 fix (gate-code-review) — this used to be
 *     indistinguishable from genuine bootstrap and silently served generic
 *     bootstrap branding for a host that may map to a SUSPENDED portal
 *     during the transient error window: the suspension leak just moved from
 *     root-branding to generic-branding, still failing OPEN. A transient
 *     error must never resolve to ANY branding decision — retry instead.
 *   - flag ON, BOOTSTRAP MODE (no root portal seeded yet, NOT degraded) -> 200,
 *     the generic platform default (bootstrapPortalContext()) so the shell can
 *     still paint a login screen and the fresh install isn't bricked.
 */
router.get('/context', portalContextRateLimiter, async (req: Request, res: Response) => {
  const portal = req.portal
  if (!portal) {
    if (req.portalResolutionDegraded) {
      return res.status(503).json({
        error: 'PORTAL_RESOLUTION_UNAVAILABLE',
        message: 'Portal context is temporarily unavailable, please retry.',
      })
    }
    if (req.portalsFlagEnabled) {
      const prefixed = await isPrefixedIdsEnabled()
      return res.json(prefixDtoIds(bootstrapPortalContext() as any, prefixed, { id: 'portal' }))
    }
    return res.status(404).json({
      error: 'NOT_FOUND',
      message: 'No portal context available.',
    })
  }
  const prefixed = await isPrefixedIdsEnabled()
  return res.json(prefixDtoIds(rowToPortalContext(portal) as any, prefixed, { id: 'portal' }))
})

/**
 * GET /api/v1/portal/current — the caller's OWN portal, resolved strictly
 * from the authenticated session (`req.user.portalId`, set by
 * authenticateToken from the JWT `portal_id` claim) — never from a
 * client-supplied id/query/Host.
 */
router.get('/current', portalCurrentRateLimiter, authenticateToken, async (req: any, res: Response) => {
  // Root cause A fix (gate-code-review round 4) — this handler used to
  // independently re-evaluate the flag with {userId}, which could disagree
  // with resolvePortalContext's (and authenticateToken's) decision for the
  // SAME request. Reuses the one shared per-request decision instead — see
  // utils/portalFlag.ts's getRequestPortalsEnabled doc-comment.
  const enabled = await getRequestPortalsEnabled(req)
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
  const flagCtx = { userId: req.user?.id }
  const prefixed = await isPrefixedIdsEnabled(flagCtx)
  const dto = rowToPortal(row, domains)
  const prefixedDto = prefixDtoIds(dto as any, prefixed, { id: 'portal', organizationId: 'organization' })
  return res.json({
    ...prefixedDto,
    domains: (dto as any).domains?.map((d: any) => prefixDtoIds(d, prefixed, { portalId: 'portal' })) ?? [],
  })
})

export default router
