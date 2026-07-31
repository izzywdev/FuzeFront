import express, { NextFunction, Request, Response } from 'express'
import type { Knex } from 'knex'
import { db } from '../config/database'
import { authenticateToken, requireRole } from '../middleware/auth'
import { getPortalDomains, rowToPortal, type PortalStatus } from '../repositories/portalRepository'

type Middleware = (request: Request, response: Response, next: NextFunction) => unknown

export interface AdminPortalStore {
  list(input: {
    status?: PortalStatus
    query?: string
    limit: number
    cursor?: string
  }): Promise<{ items: ReturnType<typeof rowToPortal>[]; nextCursor: string | null }>
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

  return router
}

export default createAdminPortalRouter()
