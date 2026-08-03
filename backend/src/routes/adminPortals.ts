import express, { NextFunction, Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import type { Knex } from 'knex'
import { db } from '../config/database'
import { authenticateToken, requireRole } from '../middleware/auth'
import {
  getPortalDomains,
  rowToPortal,
  type BillingMode,
  type PortalBranding,
  type PortalIdentityPolicy,
  type PortalStatus,
} from '../repositories/portalRepository'
import { provisionPortal, SlugTakenError } from '../services/portalProvisioning'

type Middleware = (request: Request, response: Response, next: NextFunction) => unknown

export interface AdminPortalStore {
  list(input: {
    status?: PortalStatus
    query?: string
    limit: number
    cursor?: string
  }): Promise<{ items: ReturnType<typeof rowToPortal>[]; nextCursor: string | null }>
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
      const items = await Promise.all(
        pageRows.map(async row => rowToPortal(row, await getPortalDomains(row.id, database)))
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

  router.get('/', adminRateLimiter, authenticate, authorize, async (request, response) => {
    const limit = Math.min(100, Math.max(1, Number.parseInt(String(request.query.limit ?? '25'), 10) || 25))
    const status = typeof request.query.status === 'string'
      ? request.query.status as PortalStatus
      : undefined
    const query = typeof request.query.q === 'string'
      ? request.query.q.slice(0, 200)
      : undefined
    const cursor = typeof request.query.cursor === 'string' ? request.query.cursor : undefined
    const result = await store.list({ status, query, limit, cursor })
    response.status(200).json({
      items: result.items,
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
