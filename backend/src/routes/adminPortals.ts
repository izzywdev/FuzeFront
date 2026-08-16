import express, { NextFunction, Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import type { Knex } from 'knex'
import { db } from '../config/database'
import { authenticateToken, requireRole } from '../middleware/auth'
import {
  getPortalDomains,
  getPortalIdentityMode,
  getPortalLaunchUrl,
  rowToPortal,
  type BillingMode,
  type IdentityMode,
  type PortalBranding,
  type PortalIdentityPolicy,
  type PortalStatus,
} from '../repositories/portalRepository'
import { provisionPortal, SlugTakenError } from '../services/portalProvisioning'
import { isPortalsDirectoryEnabled } from '../utils/portalsDirectoryFlag'
import { resolvePortalReadManageCapabilities } from '../utils/portalReadManageCapabilities'

type Middleware = (request: Request, response: Response, next: NextFunction) => unknown

// Portals Directory (backend slice S1) — the fleet-list DTO enriched with
// `identityMode`. Optional (not part of `rowToPortal`'s base return type) so
// existing `AdminPortalStore` mocks/consumers that predate this field stay
// valid without modification; `createAdminPortalStore().list()` below always
// populates it (cheap — already selected on the row), and the router decides
// whether to actually emit it on the wire based on the feature flag.
export type AdminPortalListItem = ReturnType<typeof rowToPortal> & {
  identityMode?: IdentityMode
}

export interface AdminPortalStore {
  list(input: {
    status?: PortalStatus
    query?: string
    limit: number
    cursor?: string
  }): Promise<{ items: AdminPortalListItem[]; nextCursor: string | null }>
  create(input: {
    actorUserId: string
    name: string
    slug: string
    ownerEmail: string
    billingMode: BillingMode
    branding?: PortalBranding
    identityPolicy?: PortalIdentityPolicy
  }): Promise<ReturnType<typeof rowToPortal>>
  get(portalId: string): Promise<ReturnType<typeof rowToPortal> | null>
  update(portalId: string, patch: {
    name?: string
    status?: PortalStatus
    billingMode?: BillingMode
    branding?: PortalBranding
    identityPolicy?: PortalIdentityPolicy
  }): Promise<ReturnType<typeof rowToPortal> | null>
}

function encodeCursor(id: string): string {
  return Buffer.from(id, 'utf8').toString('base64url')
}

function decodeCursor(cursor: string): string | null {
  try {
    return Buffer.from(cursor, 'base64url').toString('utf8') || null
  } catch {
    return null
  }
}

function validEmail(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 3 || value.length > 320 || /\s/.test(value)) {
    return false
  }
  const at = value.indexOf('@')
  return at > 0 && at === value.lastIndexOf('@') && value.indexOf('.', at + 2) > at + 1
}

export function createAdminPortalStore(database: Knex = db): AdminPortalStore {
  return {
    async list(input) {
      const query = database('portals').orderBy('id', 'asc').limit(input.limit + 1)
      if (input.status) query.where('status', input.status)
      if (input.query) {
        const pattern = `%${input.query.replace(/[%_\\]/g, '\\$&')}%`
        query.andWhere(builder =>
          builder.whereILike('name', pattern).orWhereILike('slug', pattern)
        )
      }
      if (input.cursor) {
        const id = decodeCursor(input.cursor)
        if (id) query.andWhere('id', '>', id)
      }

      const rows = await query
      const hasMore = rows.length > input.limit
      const pageRows = rows.slice(0, input.limit)
      const items: AdminPortalListItem[] = await Promise.all(
        pageRows.map(async row => ({
          ...rowToPortal(row, await getPortalDomains(row.id, database)),
          identityMode: getPortalIdentityMode(row),
        }))
      )
      return {
        items,
        nextCursor: hasMore ? encodeCursor(pageRows[pageRows.length - 1].id) : null,
      }
    },
    async create(input) {
      // FF-EPIC-09-S2 — drives the resumable, advisory-locked provisioning
      // pipeline (org -> Permit tenant -> ReBAC instance/parent-link -> portal
      // row -> default subdomain -> owner invite) instead of a single bare
      // insert. Idempotent/resumable on retry for the same slug, serializes
      // concurrent same-slug requests (-> SlugTakenError), and emits
      // `portal.created` exactly once at the provisioned-pending-invite
      // checkpoint regardless of whether the owner-invite step itself
      // succeeds. See services/portalProvisioning.ts.
      const result = await provisionPortal(
        {
          name: input.name,
          slug: input.slug,
          ownerEmail: input.ownerEmail,
          billingMode: input.billingMode,
          branding: input.branding,
          identityPolicy: input.identityPolicy,
        },
        input.actorUserId,
        { db: database }
      )

      if (!result.ok || !result.portal) {
        const error = new Error(
          result.error ?? `Portal provisioning for slug '${input.slug}' did not complete`
        ) as Error & { code: string; failedStep?: string }
        error.code = 'PROVISIONING_FAILED'
        error.failedStep = result.failedStep
        throw error
      }
      return result.portal
    },
    async get(portalId) {
      const row = await database('portals').where({ id: portalId }).first()
      if (!row) return null
      return rowToPortal(row, await getPortalDomains(portalId, database))
    },
    async update(portalId, patch) {
      const existing = await database('portals').where({ id: portalId }).first()
      if (!existing) return null
      if (existing.is_root && patch.status === 'suspended') {
        const error = new Error('ROOT_PORTAL_PROTECTED') as Error & { code: string }
        error.code = 'ROOT_PORTAL_PROTECTED'
        throw error
      }
      const changes: Record<string, unknown> = { updated_at: new Date() }
      if (patch.name !== undefined) changes.name = patch.name
      if (patch.status !== undefined) changes.status = patch.status
      if (patch.billingMode !== undefined) changes.billing_mode = patch.billingMode
      if (patch.branding !== undefined) changes.branding = JSON.stringify(patch.branding)
      if (patch.identityPolicy !== undefined) {
        changes.identity_policy = JSON.stringify(patch.identityPolicy)
      }
      await database('portals').where({ id: portalId }).update(changes)
      const row = await database('portals').where({ id: portalId }).first()
      return rowToPortal(row, await getPortalDomains(portalId, database))
    },
  }
}

export function createAdminPortalRouter(deps: {
  store?: AdminPortalStore
  authenticate?: Middleware
  authorize?: Middleware
} = {}) {
  const router = express.Router()
  const store = deps.store ?? createAdminPortalStore()
  const authenticate = deps.authenticate ?? authenticateToken
  const authorize = deps.authorize ?? requireRole(['admin'])
  const adminRateLimiter = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Try again shortly.' },
  })

  function parseListQuery(request: Request) {
    const limit = Math.min(100, Math.max(1, Number.parseInt(String(request.query.limit ?? '25'), 10) || 25))
    const status = typeof request.query.status === 'string'
      ? request.query.status as PortalStatus
      : undefined
    const query = typeof request.query.q === 'string'
      ? request.query.q.slice(0, 200)
      : undefined
    const cursor = typeof request.query.cursor === 'string' ? request.query.cursor : undefined
    return { limit, status, query, cursor }
  }

  // Portals Directory (backend slice S1 + S5 read-vs-no-access refinement) —
  // `GET /` is gated by the SAME release flag (`fuzefront.platform.portals-directory`,
  // default OFF) at TWO layers now:
  //   - S1 (response shape): `identityMode`/`launchUrl` only ever appear when
  //     ON.
  //   - S5 (authorization): flag OFF keeps the pre-existing blanket
  //     `requireRole(['admin'])` gate (`authorize` below) — byte-identical to
  //     pre-S5 behavior, including its 403 body. Flag ON REPLACES that gate
  //     with a per-portal Permit `read`/`manage` check on each portal's
  //     owning organization (`resolvePortalReadManageCapabilities`): a
  //     caller with `read` (not `manage`) now gets 200 with read-only rows
  //     instead of a hard 403; a caller with `read` over NONE of the
  //     portals this query would otherwise return still gets the same 403
  //     no-access response the blanket gate used to produce. A portal the
  //     caller cannot `read` is NEVER returned (BOLA-safe filtering, not
  //     after-the-fact leakage) — see `docs/planning` BOLA convention used
  //     throughout this file's sibling routes.
  // `authorize` is therefore deliberately NOT in this route's middleware
  // array — it is invoked manually, only on the flag-OFF branch, so the
  // flag-ON branch can admit a non-admin caller with real Permit `read`
  // authority.
  router.get('/', adminRateLimiter, authenticate, async (request, response) => {
    const { limit, status, query, cursor } = parseListQuery(request)
    const directoryEnabled = await isPortalsDirectoryEnabled({
      userId: request.user?.id,
    })

    if (!directoryEnabled) {
      // Flag OFF: byte-identical to pre-S5 behavior — blanket admin-role
      // gate (synchronous `requireRole`/injected `authorize`), no
      // capability fields, `identityMode` stripped (the store always
      // attaches it — see AdminPortalListItem).
      let authorized = false
      authorize(request, response, () => {
        authorized = true
      })
      if (!authorized) return // authorize() already sent 401/403

      const result = await store.list({ status, query, limit, cursor })
      const items = result.items.map(({ identityMode, ...rest }) => rest)
      return response.status(200).json({
        items,
        page: { nextCursor: result.nextCursor },
      })
    }

    // Flag ON (S5): per-portal read-vs-manage refinement.
    if (!request.user?.id) {
      return response.status(401).json({ error: 'Authentication required' })
    }

    const result = await store.list({ status, query, limit, cursor })
    const capabilities = await resolvePortalReadManageCapabilities(
      request.user.id,
      result.items.map(item => item.organizationId)
    )
    const readableItems = result.items.filter(
      item => capabilities.get(item.organizationId)?.canRead === true
    )

    if (result.items.length > 0 && readableItems.length === 0) {
      // No portal this query would otherwise return is readable by this
      // caller — the SAME no-access response the blanket
      // requireRole(['admin']) gate used to produce. Never a leaked
      // "page exists but every row was filtered" 200.
      return response.status(403).json({ error: 'Insufficient permissions' })
    }

    const items = readableItems.map(item => {
      const capability = capabilities.get(item.organizationId)
      const canManage = capability?.canManage === true
      // `canOpen` — authority to LAUNCH the portal. No separate Permit
      // `open`/`launch` action exists on `Organization` today (see
      // `permit/schema.ts`), so this intentionally mirrors `canManage`;
      // kept as its own field so a future distinct launch authority is
      // additive, not a contract break.
      const canOpen = canManage
      const { identityMode, ...rest } = item
      return {
        ...rest,
        identityMode: identityMode ?? 'soft',
        canManage,
        canOpen,
        // Only include `launchUrl` when the caller may actually open the
        // portal — a read-only viewer must never receive the launch host.
        ...(canOpen ? { launchUrl: getPortalLaunchUrl(item) } : {}),
      }
    })

    return response.status(200).json({
      items,
      page: { nextCursor: result.nextCursor },
    })
  })

  router.post('/', adminRateLimiter, authenticate, authorize, async (request: any, response) => {
    const body = request.body ?? {}
    const fields: Array<{ path: string; message: string }> = []
    if (typeof body.name !== 'string' || body.name.trim().length < 1 || body.name.length > 120) {
      fields.push({ path: 'name', message: 'name must contain 1 to 120 characters' })
    }
    if (typeof body.slug !== 'string' || !/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(body.slug)) {
      fields.push({ path: 'slug', message: 'slug must be a lowercase URL-safe identifier' })
    }
    if (!validEmail(body.ownerEmail)) {
      fields.push({ path: 'ownerEmail', message: 'ownerEmail must be a valid email address' })
    }
    if (fields.length) {
      return response.status(400).json({ error: 'validation_error', fields })
    }

    try {
      const portal = await store.create({
        actorUserId: request.user.id,
        name: body.name.trim(),
        slug: body.slug,
        ownerEmail: body.ownerEmail,
        billingMode: body.billingMode ?? 'free',
        branding: body.branding,
        identityPolicy: body.identityPolicy,
      })
      return response.status(201).json(portal)
    } catch (error: any) {
      if (error instanceof SlugTakenError || error?.code === '23505') {
        return response.status(409).json({ error: 'SLUG_TAKEN' })
      }
      throw error
    }
  })

  router.get('/:portalId', adminRateLimiter, authenticate, authorize, async (request, response) => {
    const portal = await store.get(request.params.portalId)
    if (!portal) {
      return response.status(404).json({ error: 'NOT_FOUND' })
    }
    return response.status(200).json(portal)
  })

  router.patch('/:portalId', adminRateLimiter, authenticate, authorize, async (request, response) => {
    const body = request.body ?? {}
    const allowed = ['name', 'status', 'billingMode', 'branding', 'identityPolicy']
    const supplied = Object.keys(body)
    if (!supplied.length || supplied.some(key => !allowed.includes(key))) {
      return response.status(400).json({
        error: 'validation_error',
        fields: [{ path: '', message: 'provide at least one supported mutable field' }],
      })
    }
    if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 120)) {
      return response.status(400).json({
        error: 'validation_error',
        fields: [{ path: 'name', message: 'name must contain 1 to 120 characters' }],
      })
    }
    try {
      const updated = await store.update(request.params.portalId, {
        name: body.name?.trim(),
        status: body.status,
        billingMode: body.billingMode,
        branding: body.branding,
        identityPolicy: body.identityPolicy,
      })
      if (!updated) return response.status(404).json({ error: 'NOT_FOUND' })
      return response.status(200).json(updated)
    } catch (error: any) {
      if (error?.code === 'ROOT_PORTAL_PROTECTED') {
        return response.status(409).json({ error: 'ROOT_PORTAL_PROTECTED' })
      }
      throw error
    }
  })

  router.post('/:portalId/suspend', adminRateLimiter, authenticate, authorize, async (request, response) => {
    try {
      const updated = await store.update(request.params.portalId, { status: 'suspended' })
      if (!updated) return response.status(404).json({ error: 'NOT_FOUND' })
      return response.status(200).json(updated)
    } catch (error: any) {
      if (error?.code === 'ROOT_PORTAL_PROTECTED') {
        return response.status(409).json({ error: 'ROOT_PORTAL_PROTECTED' })
      }
      throw error
    }
  })

  router.post('/:portalId/resume', adminRateLimiter, authenticate, authorize, async (request, response) => {
    const updated = await store.update(request.params.portalId, { status: 'active' })
    if (!updated) return response.status(404).json({ error: 'NOT_FOUND' })
    return response.status(200).json(updated)
  })

  return router
}

export default createAdminPortalRouter()
