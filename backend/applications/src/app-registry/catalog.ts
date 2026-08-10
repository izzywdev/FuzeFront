// FF-EPIC-12-S1 — the per-portal app-catalog entitlement service. Owns all
// reads/writes of `portal_apps` (migration 007): enable/disable/reorder/config,
// plus the cursor-paginated listing S3's admin API exposes. No HTTP concerns
// here — routes (routes/portal-catalog.ts) call into this, mirroring
// app-registry/service.ts's own separation.
import { db } from '../config/database'

export interface PortalAppCatalogEntry {
  portalId: string
  appId: string
  enabled: boolean
  pinnedOrder: number
  config: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

/**
 * AC4 — a clear, FK-violation-mapped error (never a silent no-op or an
 * unhandled DB exception) when `enable()` targets a `portal_id`/`app_id` that
 * does not exist. `field` tells the route layer which reference was bad, so
 * the 404 body can say so.
 */
export class PortalAppFkViolationError extends Error {
  readonly field: 'portal' | 'app'
  constructor(field: 'portal' | 'app', message: string) {
    super(message)
    this.name = 'PortalAppFkViolationError'
    this.field = field
  }
}

function rowToEntry(row: any): PortalAppCatalogEntry {
  return {
    portalId: row.portal_id,
    appId: row.app_id,
    enabled: Boolean(row.enabled),
    pinnedOrder: Number(row.pinned_order),
    config: typeof row.config === 'string' ? JSON.parse(row.config) : (row.config ?? {}),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

/**
 * Maps a Postgres FK-violation (23503) on `portal_apps` to a typed error the
 * route layer can turn into a 404. Postgres identifies the failing constraint
 * by name (`portal_apps_portal_id_foreign` / `portal_apps_app_id_foreign`,
 * knex's default naming) and, redundantly, in `detail` (`Key (portal_id)=...`).
 * Checked in priority order (constraint name first — more reliable than
 * parsing free-text detail) with a safe default so an unrecognized 23503 still
 * maps to SOMETHING useful rather than reaching the caller as a raw DB error.
 */
function mapInsertError(err: any): Error {
  if (err?.code === '23503') {
    const constraint: string = String(err.constraint || '')
    const detail: string = String(err.detail || err.message || '')
    const isPortal = /portal_id/i.test(constraint) || /\(portal_id\)/i.test(detail)
    const isApp = /app_id/i.test(constraint) || /\(app_id\)/i.test(detail)
    const field: 'portal' | 'app' = isApp && !isPortal ? 'app' : 'portal'
    return new PortalAppFkViolationError(
      field,
      field === 'portal'
        ? 'The referenced portal does not exist'
        : 'The referenced app does not exist'
    )
  }
  return err
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

function encodeCursor(row: { pinned_order: any; app_id: string }): string {
  return Buffer.from(`${row.pinned_order}|${row.app_id}`, 'utf8').toString('base64url')
}

function decodeCursor(cursor: string): { pinnedOrder: number; appId: string } | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8')
    const idx = decoded.indexOf('|')
    if (idx < 0) return null
    const pinnedOrder = Number(decoded.slice(0, idx))
    const appId = decoded.slice(idx + 1)
    if (!Number.isFinite(pinnedOrder) || !appId) return null
    return { pinnedOrder, appId }
  } catch {
    return null
  }
}

export interface CatalogListParams {
  limit?: number
  cursor?: string
}

export interface CatalogListResult {
  items: PortalAppCatalogEntry[]
  nextCursor: string | null
  hasMore: boolean
}

export class PortalAppCatalogService {
  /**
   * AC2 — idempotent enable. Re-enabling an already-enabled (or previously
   * disabled) app for a portal never creates a duplicate row: it flips/creates
   * the ONE row keyed by the (portal_id, app_id) unique constraint.
   *
   * `pinnedOrder`/`config`, when omitted, are left UNCHANGED on an existing
   * row (rather than reset to defaults) — this is what makes AC3's
   * disable-then-re-enable preserve prior config/order: disable() only flips
   * `enabled`, and a bare re-enable (no new order/config passed) must not
   * clobber what disable() preserved.
   */
  async enable(
    portalId: string,
    appId: string,
    opts: { pinnedOrder?: number; config?: Record<string, unknown> } = {}
  ): Promise<PortalAppCatalogEntry> {
    const now = new Date()
    const existing = await db('portal_apps')
      .where({ portal_id: portalId, app_id: appId })
      .first()

    if (existing) {
      const patch: Record<string, unknown> = { enabled: true, updated_at: now }
      if (opts.pinnedOrder !== undefined) patch.pinned_order = opts.pinnedOrder
      if (opts.config !== undefined) patch.config = JSON.stringify(opts.config)
      await db('portal_apps').where({ portal_id: portalId, app_id: appId }).update(patch)
    } else {
      try {
        await db('portal_apps').insert({
          portal_id: portalId,
          app_id: appId,
          enabled: true,
          pinned_order: opts.pinnedOrder ?? 0,
          config: JSON.stringify(opts.config ?? {}),
          created_at: now,
          updated_at: now,
        })
      } catch (err: any) {
        if (err?.code === '23505') {
          // Concurrent first-enable race (two requests both saw "no existing
          // row"): fall back to an update rather than surfacing a spurious
          // conflict — enable() is documented idempotent, this is the same
          // outcome reached a different way.
          const patch: Record<string, unknown> = { enabled: true, updated_at: now }
          if (opts.pinnedOrder !== undefined) patch.pinned_order = opts.pinnedOrder
          if (opts.config !== undefined) patch.config = JSON.stringify(opts.config)
          await db('portal_apps').where({ portal_id: portalId, app_id: appId }).update(patch)
        } else {
          throw mapInsertError(err)
        }
      }
    }

    const row = await db('portal_apps').where({ portal_id: portalId, app_id: appId }).first()
    if (!row) throw new Error('enable: row not found after upsert')
    return rowToEntry(row)
  }

  /**
   * AC3 — SOFT-disable. Flips `enabled = false` and RETAINS the row (config,
   * pinned_order, and the row itself all survive) so a later enable() can
   * restore it without re-specifying order/config. Never deletes.
   * Returns null if no such (portal_id, app_id) row exists (route → 404).
   */
  async disable(portalId: string, appId: string): Promise<PortalAppCatalogEntry | null> {
    const updated = await db('portal_apps')
      .where({ portal_id: portalId, app_id: appId })
      .update({ enabled: false, updated_at: new Date() })
    if (!updated) return null
    const row = await db('portal_apps').where({ portal_id: portalId, app_id: appId }).first()
    return row ? rowToEntry(row) : null
  }

  /**
   * Partial update of pinned_order/config/enabled — covers reorder (S3) and
   * config edits without a full enable() call. Only fields explicitly present
   * in `patch` are changed. Returns null if no such row exists (route → 404).
   */
  async update(
    portalId: string,
    appId: string,
    patch: { pinnedOrder?: number; config?: Record<string, unknown>; enabled?: boolean }
  ): Promise<PortalAppCatalogEntry | null> {
    const changes: Record<string, unknown> = { updated_at: new Date() }
    if (patch.pinnedOrder !== undefined) changes.pinned_order = patch.pinnedOrder
    if (patch.config !== undefined) changes.config = JSON.stringify(patch.config)
    if (patch.enabled !== undefined) changes.enabled = patch.enabled

    const updated = await db('portal_apps')
      .where({ portal_id: portalId, app_id: appId })
      .update(changes)
    if (!updated) return null
    const row = await db('portal_apps').where({ portal_id: portalId, app_id: appId }).first()
    return row ? rowToEntry(row) : null
  }

  async get(portalId: string, appId: string): Promise<PortalAppCatalogEntry | null> {
    const row = await db('portal_apps').where({ portal_id: portalId, app_id: appId }).first()
    return row ? rowToEntry(row) : null
  }

  /**
   * S3 AC2 — cursor-paginated listing of a portal's catalog for the admin
   * management view. `limit` is clamped server-side; the cursor walks
   * (pinned_order, app_id) deterministically — app_id is the stable
   * tiebreaker the epic's own risk note calls for.
   */
  async list(portalId: string, params: CatalogListParams): Promise<CatalogListResult> {
    const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)

    let query = db('portal_apps').where('portal_id', portalId)

    if (params.cursor) {
      const decoded = decodeCursor(params.cursor)
      if (decoded) {
        query = query.where(builder => {
          builder
            .where('pinned_order', '>', decoded.pinnedOrder)
            .orWhere(sub => {
              sub
                .where('pinned_order', '=', decoded.pinnedOrder)
                .andWhere('app_id', '>', decoded.appId)
            })
        })
      }
    }

    const rows = await query
      .orderBy('pinned_order', 'asc')
      .orderBy('app_id', 'asc')
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const nextCursor = hasMore ? encodeCursor(page[page.length - 1]) : null

    return { items: page.map(rowToEntry), nextCursor, hasMore }
  }
}

export const portalAppCatalogService = new PortalAppCatalogService()
