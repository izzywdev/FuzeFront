// FF-EPIC-11-S2/S6 — user listing/search/profile, portal-scoped via the
// CENTRAL `scopeToPortal` helper (utils/scopeToPortal.ts). See that module's
// doc comment for the full mode contract (unscoped/bypass/scoped/denied).
//
// Every query against `users` here is routed through
// `resolvePortalScopeDecision` + `applyPortalScope` — do NOT add a raw
// `db('users')` read to this file without doing the same (see
// `tests/scope-to-portal-guard.test.ts`).
import express, { Response } from 'express'
import rateLimit from 'express-rate-limit'
import { authenticateToken } from '../middleware/auth'
import { db } from '../config/database'
import { resolvePortalScopeDecision, applyPortalScope } from '../utils/scopeToPortal'

const router = express.Router()

// FF-EPIC-11-S2 — rate-limit these authenticated directory reads
// (CodeQL js/missing-rate-limiting). Same config as adminPortals.ts's
// adminRateLimiter: 120 req/min per client, standard RateLimit headers.
const readLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again shortly.' },
})

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

interface SortKey {
  createdAt: string
  id: string
}

function encodeCursor(row: { created_at: any; id: string }): string {
  const createdAt = new Date(row.created_at).toISOString()
  return Buffer.from(`${createdAt}|${row.id}`, 'utf8').toString('base64url')
}

function decodeCursor(cursor: string): SortKey | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8')
    const idx = decoded.indexOf('|')
    if (idx <= 0) return null
    return { createdAt: decoded.slice(0, idx), id: decoded.slice(idx + 1) }
  } catch {
    return null
  }
}

// `limit` is ALWAYS clamped server-side — a request over MAX_LIMIT is capped,
// never honored unbounded (pagination-standard.md §1).
function clampLimit(raw: unknown): number {
  const n = raw !== undefined ? parseInt(String(raw), 10) : NaN
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT
  return Math.min(n, MAX_LIMIT)
}

function applyKeysetCursor<Q extends { where: any }>(query: Q, cursor: SortKey): Q {
  return (query as any).where(function (this: any) {
    this.where('created_at', '>', cursor.createdAt).orWhere(function (this: any) {
      this.where('created_at', '=', cursor.createdAt).andWhere('id', '>', cursor.id)
    })
  })
}

function rowToUserSummary(row: any) {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name ?? null,
    lastName: row.last_name ?? null,
    homePortalId: row.home_portal_id ?? null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  }
}

const LIST_COLUMNS = ['id', 'email', 'first_name', 'last_name', 'home_portal_id', 'created_at']

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET /api/users — list, portal-scoped, cursor-paginated.
router.get('/', readLimiter, authenticateToken, async (req: any, res: Response) => {
  try {
    const limit = clampLimit(req.query.limit)
    const cursor = req.query.cursor ? String(req.query.cursor) : undefined
    let cursorKey: SortKey | null = null
    if (cursor) {
      cursorKey = decodeCursor(cursor)
      if (!cursorKey) {
        return res.status(400).json({ error: 'INVALID_CURSOR', message: 'Malformed cursor.' })
      }
    }

    // Resolve the scope decision BEFORE touching the DB, so a 'denied'
    // decision (missing/malformed portal context) short-circuits to 403
    // without running a query at all (fail closed, never an unscoped fallback).
    const decision = await resolvePortalScopeDecision(req)
    if (decision.mode === 'denied') {
      return res.status(403).json({
        error: 'PORTAL_CONTEXT_REQUIRED',
        message: 'A valid portal context is required to list users.',
      })
    }

    let query = db('users').select(LIST_COLUMNS)
    query = applyPortalScope(query, decision)
    if (cursorKey) query = applyKeysetCursor(query, cursorKey)

    const rows = await query.orderBy('created_at', 'asc').orderBy('id', 'asc').limit(limit + 1)
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const nextCursor = hasMore ? encodeCursor(page[page.length - 1]) : null

    res.json({
      items: page.map(rowToUserSummary),
      page: { nextCursor, hasMore },
    })
  } catch (error) {
    console.error('Error listing users:', error)
    res.status(500).json({ error: 'Failed to list users' })
  }
})

// GET /api/users/search?q= — search by email/first/last name, portal-scoped,
// cursor-paginated. Mounted BEFORE /:id so "search" is never captured as an id.
router.get('/search', readLimiter, authenticateToken, async (req: any, res: Response) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    if (!q) {
      return res
        .status(400)
        .json({ error: 'QUERY_REQUIRED', message: 'Query parameter "q" is required.' })
    }
    const limit = clampLimit(req.query.limit)
    const cursor = req.query.cursor ? String(req.query.cursor) : undefined
    let cursorKey: SortKey | null = null
    if (cursor) {
      cursorKey = decodeCursor(cursor)
      if (!cursorKey) {
        return res.status(400).json({ error: 'INVALID_CURSOR', message: 'Malformed cursor.' })
      }
    }

    const decision = await resolvePortalScopeDecision(req)
    if (decision.mode === 'denied') {
      return res.status(403).json({
        error: 'PORTAL_CONTEXT_REQUIRED',
        message: 'A valid portal context is required to search users.',
      })
    }

    // Escape LIKE metacharacters in the caller-supplied query (mirrors
    // routes/organizations.ts / routes/adminPortals.ts's identical pattern).
    const pattern = `%${q.replace(/[%_\\]/g, '\\$&')}%`
    let query = db('users')
      .select(LIST_COLUMNS)
      .where(function (this: any) {
        this.whereILike('email', pattern)
          .orWhereILike('first_name', pattern)
          .orWhereILike('last_name', pattern)
      })
    query = applyPortalScope(query, decision)
    if (cursorKey) query = applyKeysetCursor(query, cursorKey)

    const rows = await query.orderBy('created_at', 'asc').orderBy('id', 'asc').limit(limit + 1)
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const nextCursor = hasMore ? encodeCursor(page[page.length - 1]) : null

    res.json({
      items: page.map(rowToUserSummary),
      page: { nextCursor, hasMore },
    })
  } catch (error) {
    console.error('Error searching users:', error)
    res.status(500).json({ error: 'Failed to search users' })
  }
})

// GET /api/users/:id — profile by id, portal-scoped. A cross-portal id (or a
// genuinely nonexistent one) is INDISTINGUISHABLE — both 404 — so a caller can
// never probe whether an id exists outside their portal (no existence leak).
router.get('/:id', readLimiter, authenticateToken, async (req: any, res: Response) => {
  try {
    // A malformed id can never resolve to a row — reject BEFORE hitting the DB
    // (a non-uuid literal otherwise throws a Postgres type error, 500ing the
    // route) and with the SAME 404 as "not found in your portal" (no format
    // oracle either).
    if (!UUID_RE.test(String(req.params.id))) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'User not found.' })
    }

    const decision = await resolvePortalScopeDecision(req)
    if (decision.mode === 'denied') {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'User not found.' })
    }

    let query = db('users')
      .select([...LIST_COLUMNS, 'roles'])
      .where('id', req.params.id)
    query = applyPortalScope(query, decision)

    const row = await query.first()
    if (!row) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'User not found.' })
    }

    res.json({
      ...rowToUserSummary(row),
      roles: Array.isArray(row.roles) ? row.roles : JSON.parse(row.roles || '["user"]'),
    })
  } catch (error) {
    console.error('Error fetching user profile:', error)
    res.status(500).json({ error: 'Failed to fetch user' })
  }
})

export default router
