import express, { Request, Response, NextFunction } from 'express'
import rateLimit from 'express-rate-limit'
import { authenticateToken } from '../middleware/auth'
import { db } from '../config/database'
import { checkOrganizationPermission } from '../utils/permit/permission-check'
import { getRequestPortalsEnabled } from '../utils/portalFlag'
import { invalidatePortalCache } from '../middleware/portalContext'
import { ROOT_ORG_ID } from '../migrations/015_seed_root_platform_organization'
import {
  findPortalById,
  getPortalDomains,
  rowToPortal,
  BillingMode,
  PortalBranding,
  PortalIdentityPolicy,
  PortalStatus,
} from '../repositories/portalRepository'
import { provisionPortal, SlugTakenError } from '../services/portalProvisioning'

/**
 * FF-EPIC-09-S3 — master-admin portal CRUD. Mounted at
 * `/api/v1/admin/portals` (src/index.ts). Contract:
 * services/portal-service/openapi.yaml `admin-portals` tag.
 *
 * Every route here is gated, in order:
 *   1. `authenticateToken` — 401 if no valid session.
 *   2. the master flag (`getRequestPortalsEnabled`) — 404 when OFF, matching
 *      the pre-epic behavior (these routes did not exist before FF-EPIC-09).
 *   3. Permit **platform-admin** — 403 `FORBIDDEN` for any caller who does
 *      not hold `org-admin`/`admin` on the ROOT organization (the ReBAC
 *      parent->child derivation in `permit/schema.ts` is what makes a single
 *      root grant cover every tenant — see `services/rootOrgAdmin.ts`).
 * Never a fallback allow: any unexpected error in the authz check itself
 * fails CLOSED (500), never open.
 */

const router = express.Router()

const adminPortalsRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again shortly.' },
})

interface AdminPortalsRequest extends Request {
  user?: { id: string; email: string; roles: string[]; portalId?: string }
  portalsFlagEnabled?: boolean
}

async function requirePortalsEnabled(
  req: AdminPortalsRequest,
  res: Response
): Promise<boolean> {
  const enabled = await getRequestPortalsEnabled(req)
  if (!enabled) {
    res.status(404).json({
      error: 'NOT_FOUND',
      message: 'Portal capability is not enabled.',
    })
    return false
  }
  return true
}

async function requirePlatformAdmin(
  req: AdminPortalsRequest,
  res: Response,
  action: 'read' | 'manage'
): Promise<boolean> {
  const userId = req.user?.id
  if (!userId) {
    // authenticateToken already guards every route below, so this is
    // defense-in-depth, not the primary 401 path.
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required.' })
    return false
  }

  let allowed: boolean
  try {
    allowed = await checkOrganizationPermission(userId, action, ROOT_ORG_ID)
  } catch (error) {
    console.error('[admin-portals] platform-admin check failed:', error)
    // Fail CLOSED on an authz-check error — never fall back to an allow.
    res.status(500).json({ error: 'INTERNAL', message: 'Authorization check failed.' })
    return false
  }

  if (!allowed) {
    res.status(403).json({
      error: 'FORBIDDEN',
      message: 'Platform admin access required.',
    })
    return false
  }
  return true
}

function gateAdmin(action: 'read' | 'manage') {
  return async (req: AdminPortalsRequest, res: Response, next: NextFunction) => {
    if (!(await requirePortalsEnabled(req, res))) return
    if (!(await requirePlatformAdmin(req, res, action))) return
    next()
  }
}

router.use(adminPortalsRateLimiter)

// ---------------------------------------------------------------------------
// Pagination — cursor encodes (createdAt, id): the sort key + a tiebreaker,
// per governance/pagination-standard.md. Opaque to the client (base64url).
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

export function clampLimit(raw: unknown): number {
  const parsed = parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT
  return Math.min(parsed, MAX_LIMIT)
}

interface Cursor {
  lastCreatedAt: string
  lastId: string
}

export function encodeCursor(createdAt: Date | string, id: string): string {
  const iso = createdAt instanceof Date ? createdAt.toISOString() : new Date(createdAt).toISOString()
  return Buffer.from(JSON.stringify({ lastCreatedAt: iso, lastId: id } satisfies Cursor)).toString(
    'base64url'
  )
}

export function decodeCursor(cursor: string): Cursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (typeof parsed?.lastCreatedAt !== 'string' || typeof parsed?.lastId !== 'string') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

const VALID_STATUSES: PortalStatus[] = [
  'provisioning',
  'provisioned-pending-invite',
  'active',
  'suspended',
]
const VALID_BILLING_MODES: BillingMode[] = ['free', 'platform', 'reseller']
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface FieldError {
  path: string
  message: string
}

function validateCreateBody(body: any): FieldError[] {
  const fields: FieldError[] = []
  if (typeof body?.name !== 'string' || body.name.length < 1 || body.name.length > 120) {
    fields.push({ path: 'name', message: 'name is required (1-120 characters).' })
  }
  if (typeof body?.slug !== 'string' || !SLUG_RE.test(body.slug)) {
    fields.push({
      path: 'slug',
      message: 'slug is required and must match ^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$.',
    })
  }
  if (typeof body?.ownerEmail !== 'string' || !EMAIL_RE.test(body.ownerEmail)) {
    fields.push({ path: 'ownerEmail', message: 'ownerEmail is required and must be a valid email.' })
  }
  if (
    body?.billingMode !== undefined &&
    !VALID_BILLING_MODES.includes(body.billingMode)
  ) {
    fields.push({ path: 'billingMode', message: `billingMode must be one of ${VALID_BILLING_MODES.join(', ')}.` })
  }
  if (body?.branding !== undefined) {
    if (typeof body.branding !== 'object' || body.branding === null || typeof body.branding.name !== 'string') {
      fields.push({ path: 'branding.name', message: 'branding.name is required when branding is provided.' })
    }
  }
  return fields
}

function validateUpdateBody(body: any): FieldError[] {
  const fields: FieldError[] = []
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fields.push({ path: 'body', message: 'A JSON object body is required.' })
    return fields
  }
  if (Object.keys(body).length === 0) {
    fields.push({ path: 'body', message: 'At least one field is required.' })
  }
  if ('slug' in body) {
    fields.push({ path: 'slug', message: 'slug is immutable and cannot be changed.' })
  }
  if ('name' in body && (typeof body.name !== 'string' || body.name.length < 1 || body.name.length > 120)) {
    fields.push({ path: 'name', message: 'name must be 1-120 characters.' })
  }
  if ('status' in body && !VALID_STATUSES.includes(body.status)) {
    fields.push({ path: 'status', message: `status must be one of ${VALID_STATUSES.join(', ')}.` })
  }
  if ('billingMode' in body && !VALID_BILLING_MODES.includes(body.billingMode)) {
    fields.push({ path: 'billingMode', message: `billingMode must be one of ${VALID_BILLING_MODES.join(', ')}.` })
  }
  if (
    'branding' in body &&
    (typeof body.branding !== 'object' || body.branding === null || typeof body.branding.name !== 'string')
  ) {
    fields.push({ path: 'branding.name', message: 'branding.name is required when branding is provided.' })
  }
  return fields
}

function validationError(res: Response, fields: FieldError[]): void {
  res.status(400).json({
    error: 'validation_error',
    message: 'Request body failed validation.',
    fields,
  })
}

// ---------------------------------------------------------------------------
// GET /api/v1/admin/portals — cursor-paginated fleet list.
// ---------------------------------------------------------------------------
router.get(
  '/',
  authenticateToken,
  gateAdmin('read'),
  async (req: AdminPortalsRequest, res: Response) => {
    const limit = clampLimit(req.query.limit)
    const status = typeof req.query.status === 'string' ? req.query.status : undefined
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : undefined
    const cursorParam = typeof req.query.cursor === 'string' ? req.query.cursor : undefined

    if (status && !VALID_STATUSES.includes(status as PortalStatus)) {
      return validationError(res, [
        { path: 'status', message: `status must be one of ${VALID_STATUSES.join(', ')}.` },
      ])
    }

    let cursor: Cursor | null = null
    if (cursorParam) {
      cursor = decodeCursor(cursorParam)
      if (!cursor) {
        return res.status(400).json({
          error: 'INVALID_CURSOR',
          message: 'Malformed pagination cursor.',
        })
      }
    }

    let query = db('portals').orderBy('created_at', 'asc').orderBy('id', 'asc')
    if (status) query = query.where({ status })
    if (q) {
      query = query.where(builder => {
        builder.whereILike('name', `%${q}%`).orWhereILike('slug', `%${q}%`)
      })
    }
    if (cursor) {
      const c = cursor
      query = query.where(builder => {
        builder
          .where('created_at', '>', c.lastCreatedAt)
          .orWhere(b2 => {
            b2.where('created_at', '=', c.lastCreatedAt).andWhere('id', '>', c.lastId)
          })
      })
    }

    const rows = await query.limit(limit + 1)
    const hasMore = rows.length > limit
    const page = rows.slice(0, limit)

    const items = []
    for (const row of page) {
      const domains = await getPortalDomains(row.id, db)
      items.push(rowToPortal(row, domains))
    }

    const last = page[page.length - 1]
    const nextCursor = hasMore && last ? encodeCursor(last.created_at, last.id) : null

    return res.json({ items, page: { nextCursor, hasMore } })
  }
)

// ---------------------------------------------------------------------------
// POST /api/v1/admin/portals — create (provision) a portal.
// ---------------------------------------------------------------------------
router.post(
  '/',
  authenticateToken,
  gateAdmin('manage'),
  async (req: AdminPortalsRequest, res: Response) => {
    const fields = validateCreateBody(req.body)
    if (fields.length > 0) return validationError(res, fields)

    try {
      const result = await provisionPortal(
        {
          name: req.body.name,
          slug: req.body.slug,
          ownerEmail: req.body.ownerEmail,
          billingMode: req.body.billingMode,
          branding: req.body.branding,
          identityPolicy: req.body.identityPolicy,
        },
        req.user!.id
      )

      if (!result.ok || !result.portal) {
        console.error(
          '[admin-portals] createPortal provisioning did not complete:',
          result.failedStep,
          result.error
        )
        return res.status(500).json({
          error: 'INTERNAL',
          message: result.error ?? 'Portal provisioning did not complete.',
        })
      }

      return res.status(201).json(result.portal)
    } catch (error) {
      if (error instanceof SlugTakenError) {
        return res.status(409).json({ error: 'SLUG_TAKEN', message: error.message })
      }
      console.error('[admin-portals] createPortal failed:', error)
      return res.status(500).json({
        error: 'INTERNAL',
        message: 'Unexpected error provisioning the portal.',
      })
    }
  }
)

// ---------------------------------------------------------------------------
// GET /api/v1/admin/portals/{portalId} — read one.
// ---------------------------------------------------------------------------
router.get(
  '/:portalId',
  authenticateToken,
  gateAdmin('read'),
  async (req: AdminPortalsRequest, res: Response) => {
    const row = await findPortalById(req.params.portalId, db)
    if (!row) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Portal not found.' })
    }
    const domains = await getPortalDomains(row.id, db)
    return res.json(rowToPortal(row, domains))
  }
)

// ---------------------------------------------------------------------------
// PATCH /api/v1/admin/portals/{portalId} — partial update (incl. suspend/resume
// via `status`).
// ---------------------------------------------------------------------------
router.patch(
  '/:portalId',
  authenticateToken,
  gateAdmin('manage'),
  async (req: AdminPortalsRequest, res: Response) => {
    const fields = validateUpdateBody(req.body)
    if (fields.length > 0) return validationError(res, fields)

    const row = await findPortalById(req.params.portalId, db)
    if (!row) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Portal not found.' })
    }

    const body = req.body as {
      name?: string
      status?: PortalStatus
      billingMode?: BillingMode
      branding?: PortalBranding
      identityPolicy?: PortalIdentityPolicy
    }

    if (body.status === 'suspended' && row.is_root) {
      return res.status(409).json({
        error: 'ROOT_PORTAL_PROTECTED',
        message: 'The root portal cannot be suspended.',
      })
    }

    const updates: Record<string, any> = { updated_at: new Date() }
    if (body.name !== undefined) updates.name = body.name
    if (body.status !== undefined) updates.status = body.status
    if (body.billingMode !== undefined) updates.billing_mode = body.billingMode
    if (body.branding !== undefined) updates.branding = JSON.stringify(body.branding)
    if (body.identityPolicy !== undefined) {
      updates.identity_policy = JSON.stringify(body.identityPolicy)
    }

    await db('portals').where({ id: row.id }).update(updates)

    // Suspend/resume must take effect immediately for the resolver
    // (middleware/portalContext.ts) — its cache TTL would otherwise leave a
    // just-suspended portal reachable for up to PORTAL_RESOLUTION_CACHE_TTL_MS.
    if (body.status !== undefined) invalidatePortalCache(row.id)

    const updatedRow = await findPortalById(row.id, db)
    const domains = await getPortalDomains(row.id, db)
    return res.json(rowToPortal(updatedRow, domains))
  }
)

// ---------------------------------------------------------------------------
// Suspend / resume — semantic equivalents of PATCH { status }, idempotent.
// ---------------------------------------------------------------------------
async function setLifecycleStatus(
  req: AdminPortalsRequest,
  res: Response,
  targetStatus: 'active' | 'suspended'
): Promise<void> {
  const row = await findPortalById(req.params.portalId, db)
  if (!row) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Portal not found.' })
    return
  }

  if (targetStatus === 'suspended' && row.is_root) {
    res.status(409).json({
      error: 'ROOT_PORTAL_PROTECTED',
      message: 'The root portal cannot be suspended.',
    })
    return
  }

  if (row.status !== targetStatus) {
    await db('portals')
      .where({ id: row.id })
      .update({ status: targetStatus, updated_at: new Date() })
    invalidatePortalCache(row.id)
  }

  const updatedRow = await findPortalById(row.id, db)
  const domains = await getPortalDomains(row.id, db)
  res.json(rowToPortal(updatedRow, domains))
}

router.post(
  '/:portalId/suspend',
  authenticateToken,
  gateAdmin('manage'),
  async (req: AdminPortalsRequest, res: Response) => {
    await setLifecycleStatus(req, res, 'suspended')
  }
)

router.post(
  '/:portalId/resume',
  authenticateToken,
  gateAdmin('manage'),
  async (req: AdminPortalsRequest, res: Response) => {
    await setLifecycleStatus(req, res, 'active')
  }
)

export default router
