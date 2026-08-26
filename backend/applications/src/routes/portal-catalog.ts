// FF-EPIC-12-S3 — the portal app-catalog ADMIN API: add/remove/reorder/config
// the apps in a portal's catalog. Mounted ALONGSIDE routes/app-registry.ts at
// the SAME `/api/v1/app-registry` prefix (see src/index.ts) — this reuses the
// existing host-backend proxy (backend/src/routes/app-registry.ts) with no new
// proxy wiring needed, and stays inside the ALREADY-declared route-ownership
// contract entry for that prefix (deploy/route-ownership.json only tracks
// routes that CROSS a prefix boundary; nothing here does).
//
// AuthZ: platform-admin (this service's existing role-based convention, see
// app-registry/caller.ts) bypasses everything; otherwise the caller must hold
// Permit `manage` on the TARGET portal's own organization (portal-admin
// authority — app-registry/permit.ts's checkPortalAdminPermission). Permit is
// the real authorization boundary; the fuzefront.apps.portal-catalog flag
// below is rollout convenience only (feature-flags skill), never a substitute.
//
// Every route is RATE-LIMITED (120/min), mirroring backend/src/routes/
// adminPortals.ts's adminRateLimiter — CodeQL js/missing-rate-limiting is a
// high-severity gate.
import express, { Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import { authenticateToken } from '../middleware/auth'
import { db } from '../config/database'
import { resolveCaller } from '../app-registry/caller'
import { checkPortalAdminPermission } from '../app-registry/permit'
import {
  portalAppCatalogService,
  PortalAppFkViolationError,
} from '../app-registry/catalog'
import { getRequestPortalCatalogEnabled } from '../app-registry/portalCatalogFlag'
import { isPrefixedIdsEnabled } from '../identity/flags'
import { prefixDtoIds } from '../identity/serializer'

const router = express.Router()

const catalogRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again shortly.' },
})
router.use(catalogRateLimiter)

/**
 * FF-EPIC-12-S5 — release flag gate (default OFF) for the ENTIRE admin
 * surface. When OFF the catalog is dark (503) — mirrors app-registry.ts's own
 * `v1WriteGate` convention for the same reason: a brand-new write surface has
 * no "byte-identical old behavior" to preserve, so gating the whole thing is
 * both simplest and safest.
 */
async function catalogFlagGate(req: Request, res: Response): Promise<boolean> {
  const enabled = await getRequestPortalCatalogEnabled(req as any)
  if (!enabled) {
    res.status(503).json({
      error: 'feature_disabled',
      message: 'The portal app catalog is not yet enabled (fuzefront.apps.portal-catalog)',
    })
    return false
  }
  return true
}

/**
 * Resolves the target portal + authorizes the caller against it. Returns null
 * (having already written the response) on 404/403.
 */
async function loadPortalAndAuthorize(
  req: Request,
  res: Response
): Promise<{ portal: { id: string; organization_id: string }; caller: any } | null> {
  const caller = await resolveCaller((req as any).user)
  const portalId = req.params.portalId
  const portal = await db('portals').where('id', portalId).first()
  if (!portal) {
    res.status(404).json({ error: 'not_found', message: 'Portal not found' })
    return null
  }
  if (!caller.isPlatformAdmin) {
    const permitted = await checkPortalAdminPermission({
      userId: caller.userId,
      organizationId: portal.organization_id,
    })
    if (!permitted) {
      res.status(403).json({
        error: 'forbidden',
        message: 'Missing portal-admin authority for this portal',
      })
      return null
    }
  }
  return { portal, caller }
}

function validatePinnedOrder(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
function validateConfig(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ── GET /portals/:portalId/catalog — list a portal's catalog (S3 AC2, paginated) ──
router.get('/portals/:portalId/catalog', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!(await catalogFlagGate(req, res))) return
    const resolved = await loadPortalAndAuthorize(req, res)
    if (!resolved) return

    const limitRaw = req.query.limit
    const limit = typeof limitRaw === 'string' ? parseInt(limitRaw, 10) : undefined
    if (limit !== undefined && (Number.isNaN(limit) || limit < 1)) {
      return res.status(400).json({ error: 'validation_error', message: 'invalid limit' })
    }
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined

    const result = await portalAppCatalogService.list(resolved.portal.id, { limit, cursor })
    const flagCtx = { orgId: (req as any).user?.organizationId, userId: (req as any).user?.id }
    const prefixed = await isPrefixedIdsEnabled(flagCtx)
    return res.json({
      items: result.items.map((item: any) => prefixDtoIds(item, prefixed, { portalId: 'portal', appId: 'app' })),
      page: { nextCursor: result.nextCursor, hasMore: result.hasMore },
    })
  } catch (err) {
    console.error('[portal-catalog] list error:', err)
    return res.status(500).json({ error: 'internal_error', message: 'Failed to list portal catalog' })
  }
})

// ── POST /portals/:portalId/catalog — enable/add an app (S1 AC2, idempotent) ──
router.post('/portals/:portalId/catalog', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!(await catalogFlagGate(req, res))) return
    const resolved = await loadPortalAndAuthorize(req, res)
    if (!resolved) return

    const body = (req.body ?? {}) as Record<string, unknown>
    const fields: Array<{ path: string; message: string }> = []
    if (typeof body.appId !== 'string' || !body.appId) {
      fields.push({ path: 'appId', message: 'appId is required' })
    }
    if (body.pinnedOrder !== undefined && !validatePinnedOrder(body.pinnedOrder)) {
      fields.push({ path: 'pinnedOrder', message: 'pinnedOrder must be a finite number' })
    }
    if (body.config !== undefined && !validateConfig(body.config)) {
      fields.push({ path: 'config', message: 'config must be an object' })
    }
    if (fields.length) {
      return res.status(400).json({ error: 'validation_error', fields })
    }

    try {
      const entry = await portalAppCatalogService.enable(resolved.portal.id, body.appId as string, {
        pinnedOrder: body.pinnedOrder as number | undefined,
        config: body.config as Record<string, unknown> | undefined,
      })
      const flagCtx = { orgId: (req as any).user?.organizationId, userId: (req as any).user?.id }
      const prefixed = await isPrefixedIdsEnabled(flagCtx)
      return res.status(200).json(prefixDtoIds(entry as any, prefixed, { portalId: 'portal', appId: 'app' }))
    } catch (err) {
      if (err instanceof PortalAppFkViolationError) {
        return res.status(404).json({ error: 'not_found', field: err.field, message: err.message })
      }
      throw err
    }
  } catch (err) {
    console.error('[portal-catalog] enable error:', err)
    return res.status(500).json({ error: 'internal_error', message: 'Failed to enable app for portal' })
  }
})

// ── PATCH /portals/:portalId/catalog/:appId — reorder/config/enable (S3) ──
router.patch(
  '/portals/:portalId/catalog/:appId',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      if (!(await catalogFlagGate(req, res))) return
      const resolved = await loadPortalAndAuthorize(req, res)
      if (!resolved) return

      const body = (req.body ?? {}) as Record<string, unknown>
      const allowed = ['enabled', 'pinnedOrder', 'config']
      const supplied = Object.keys(body)
      if (!supplied.length || supplied.some(key => !allowed.includes(key))) {
        return res.status(400).json({
          error: 'validation_error',
          fields: [{ path: '', message: 'provide at least one supported field (enabled, pinnedOrder, config)' }],
        })
      }
      const fields: Array<{ path: string; message: string }> = []
      if (body.pinnedOrder !== undefined && !validatePinnedOrder(body.pinnedOrder)) {
        fields.push({ path: 'pinnedOrder', message: 'pinnedOrder must be a finite number' })
      }
      if (body.config !== undefined && !validateConfig(body.config)) {
        fields.push({ path: 'config', message: 'config must be an object' })
      }
      if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
        fields.push({ path: 'enabled', message: 'enabled must be a boolean' })
      }
      if (fields.length) {
        return res.status(400).json({ error: 'validation_error', fields })
      }

      const updated = await portalAppCatalogService.update(resolved.portal.id, req.params.appId, {
        enabled: body.enabled as boolean | undefined,
        pinnedOrder: body.pinnedOrder as number | undefined,
        config: body.config as Record<string, unknown> | undefined,
      })
      if (!updated) {
        return res.status(404).json({ error: 'not_found', message: 'App is not in this portal catalog' })
      }
      const flagCtx = { orgId: (req as any).user?.organizationId, userId: (req as any).user?.id }
      const prefixed = await isPrefixedIdsEnabled(flagCtx)
      return res.json(prefixDtoIds(updated as any, prefixed, { portalId: 'portal', appId: 'app' }))
    } catch (err) {
      console.error('[portal-catalog] update error:', err)
      return res.status(500).json({ error: 'internal_error', message: 'Failed to update portal catalog entry' })
    }
  }
)

// ── DELETE /portals/:portalId/catalog/:appId — SOFT-disable (S1 AC3) ──
router.delete(
  '/portals/:portalId/catalog/:appId',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      if (!(await catalogFlagGate(req, res))) return
      const resolved = await loadPortalAndAuthorize(req, res)
      if (!resolved) return

      const updated = await portalAppCatalogService.disable(resolved.portal.id, req.params.appId)
      if (!updated) {
        return res.status(404).json({ error: 'not_found', message: 'App is not in this portal catalog' })
      }
      // Soft-disable — the row (and its config/order) is retained, so return
      // it rather than 204, letting the caller see the disabled state.
      const flagCtx = { orgId: (req as any).user?.organizationId, userId: (req as any).user?.id }
      const prefixed = await isPrefixedIdsEnabled(flagCtx)
      return res.status(200).json(prefixDtoIds(updated as any, prefixed, { portalId: 'portal', appId: 'app' }))
    } catch (err) {
      console.error('[portal-catalog] disable error:', err)
      return res.status(500).json({ error: 'internal_error', message: 'Failed to disable app for portal' })
    }
  }
)

export { router }
export default router
