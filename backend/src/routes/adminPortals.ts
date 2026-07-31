import express, { NextFunction, Request, Response } from 'express'
import type { Knex } from 'knex'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../config/database'
import { authenticateToken, requireRole } from '../middleware/auth'
import {
  generatePortalId,
  getPortalDomains,
  rowToPortal,
  type BillingMode,
  type PortalBranding,
  type PortalIdentityPolicy,
  type PortalStatus,
} from '../repositories/portalRepository'

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
      const organizationId = uuidv4()
      const portalId = generatePortalId()
      await database.transaction(async transaction => {
        await transaction('organizations').insert({
          id: organizationId,
          name: input.name,
          slug: input.slug,
          parent_id: null,
          owner_id: input.actorUserId,
          type: 'organization',
          settings: JSON.stringify({}),
          metadata: JSON.stringify({ portalId }),
          is_active: true,
          provisioning_state: 'pending',
        })
        await transaction('organization_memberships').insert({
          id: uuidv4(),
          user_id: input.actorUserId,
          organization_id: organizationId,
          role: 'owner',
          status: 'active',
          joined_at: new Date(),
          permissions: JSON.stringify({}),
          metadata: JSON.stringify({ invitedOwnerEmail: input.ownerEmail }),
        })
        await transaction('portals').insert({
          id: portalId,
          organization_id: organizationId,
          slug: input.slug,
          name: input.name,
          status: 'provisioned-pending-invite',
          billing_mode: input.billingMode,
          branding: JSON.stringify(input.branding ?? { name: input.name }),
          identity_policy: JSON.stringify(input.identityPolicy ?? {
            allowPasswordLogin: true,
            allowSelfSignup: false,
          }),
          owner_email: input.ownerEmail,
          is_root: false,
        })
        await transaction('portal_domains').insert({
          id: uuidv4(),
          portal_id: portalId,
          domain: `${input.slug}.fuzefront.com`,
          kind: 'subdomain',
          is_primary: true,
          verification_status: 'verified',
          tls_status: 'pending',
        })
      })
      const row = await database('portals').where({ id: portalId }).first()
      return rowToPortal(row, await getPortalDomains(portalId, database))
    },
    async get(portalId) {
      const row = await database('portals').where({ id: portalId }).first()
      if (!row) return null
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

  router.get('/', authenticate, authorize, async (request, response) => {
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

  router.post('/', authenticate, authorize, async (request: any, response) => {
    const body = request.body ?? {}
    const fields: Array<{ path: string; message: string }> = []
    if (typeof body.name !== 'string' || body.name.trim().length < 1 || body.name.length > 120) {
      fields.push({ path: 'name', message: 'name must contain 1 to 120 characters' })
    }
    if (typeof body.slug !== 'string' || !/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(body.slug)) {
      fields.push({ path: 'slug', message: 'slug must be a lowercase URL-safe identifier' })
    }
    if (typeof body.ownerEmail !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.ownerEmail)) {
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
      if (error?.code === '23505') {
        return response.status(409).json({ error: 'SLUG_TAKEN' })
      }
      throw error
    }
  })

  router.get('/:portalId', authenticate, authorize, async (request, response) => {
    const portal = await store.get(request.params.portalId)
    if (!portal) {
      return response.status(404).json({ error: 'NOT_FOUND' })
    }
    return response.status(200).json(portal)
  })

  return router
}

export default createAdminPortalRouter()
