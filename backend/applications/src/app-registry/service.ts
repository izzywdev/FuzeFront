// app-registry data/service layer over the `apps` table. Maps DB rows to the
// FROZEN `App` contract shape (services/app-registry-service/openapi.yaml), owns
// the lifecycle state machine, BOLA-safe visibility filtering, and opaque cursor
// pagination. No HTTP concerns here — routes call into this.
import { db } from '../config/database'
import {
  AppManifest,
  AppMode,
  AppStatus,
  Visibility,
  DEFAULT_NAV_ORDER,
  DEFAULT_NAV_SECTION,
  navSectionRank,
} from './manifest.schema'

/**
 * Derived side-menu ordering columns for a manifest. `manifest.nav` is the source
 * of truth; these columns exist only so the list query can ORDER BY / keyset-paginate
 * in SQL. Recompute on EVERY write so a manifest update re-ranks the app.
 */
export function navColumns(manifest: AppManifest): {
  nav_rank: number
  nav_order: number
} {
  return {
    nav_rank: navSectionRank(manifest.nav?.section ?? DEFAULT_NAV_SECTION),
    nav_order: manifest.nav?.order ?? DEFAULT_NAV_ORDER,
  }
}

/** The App contract shape returned by the API (matches openapi App schema). */
export interface AppRecord {
  slug: string
  status: AppStatus
  mode: AppMode
  builtin: boolean
  organizationId: string | null
  manifest: AppManifest
  isHealthy: boolean | null
  lastSeenAt: string | null
  createdAt: string
  updatedAt: string
}

export interface AppCaller {
  userId: string
  /** Org memberships of the caller (org ids). Used for `organization` visibility. */
  organizationIds: string[]
  roles: string[]
  isPlatformAdmin: boolean
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

function rowToApp(row: any): AppRecord {
  const manifest: AppManifest =
    typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest
  return {
    slug: row.slug,
    status: row.status,
    mode: row.mode,
    builtin: Boolean(row.builtin),
    organizationId: row.organization_id ?? null,
    manifest,
    isHealthy: row.is_healthy === null || row.is_healthy === undefined ? null : Boolean(row.is_healthy),
    lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
  }
}

/**
 * Visibility / BOLA predicate. A caller may READ an app when:
 *  - they are a platform admin (sees all), OR
 *  - visibility is public|marketplace (everyone), OR
 *  - visibility is organization AND the app's org is one the caller belongs to, OR
 *  - visibility is private AND the app's org is one the caller belongs to (owner org).
 * An org-less (platform-global) app is treated as public for read.
 */
export function canRead(app: AppRecord, caller: AppCaller): boolean {
  if (caller.isPlatformAdmin) return true
  const visibility = app.manifest.visibility ?? 'private'
  if (visibility === 'public' || visibility === 'marketplace') return true
  if (!app.organizationId) return true // platform-global → readable
  const inOrg = caller.organizationIds.includes(app.organizationId)
  if (visibility === 'organization' || visibility === 'private') return inOrg
  return false
}

/**
 * Mutation/object-level predicate. A caller may MUTATE (write/activate/suspend)
 * an app only when they are a platform admin OR a member of the app's owning org.
 * Org-less apps are platform-admin-only to mutate.
 */
export function canMutate(app: AppRecord, caller: AppCaller): boolean {
  if (caller.isPlatformAdmin) return true
  if (!app.organizationId) return false
  return caller.organizationIds.includes(app.organizationId)
}

// The list sort key. MUST stay in lock-step with the ORDER BY and the keyset
// predicate in list() — a cursor that encodes fewer columns than the sort key
// silently skips or repeats rows at page boundaries.
interface SortKey {
  navRank: number
  navOrder: number
  createdAt: string
  slug: string
}

function encodeCursor(row: {
  nav_rank: any
  nav_order: any
  created_at: any
  slug: string
}): string {
  const createdAt = new Date(row.created_at).toISOString()
  const navRank = Number(row.nav_rank ?? navSectionRank(DEFAULT_NAV_SECTION))
  const navOrder = Number(row.nav_order ?? DEFAULT_NAV_ORDER)
  return Buffer.from(
    `${navRank}|${navOrder}|${createdAt}|${row.slug}`,
    'utf8'
  ).toString('base64url')
}

function decodeCursor(cursor: string): SortKey | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8')
    // Split on the FIRST 3 separators only — a slug cannot contain '|', but
    // splitting unbounded would still be wrong if that ever changed.
    const parts = decoded.split('|')
    if (parts.length < 4) return null
    const navRank = Number(parts[0])
    const navOrder = Number(parts[1])
    if (!Number.isFinite(navRank) || !Number.isFinite(navOrder)) return null
    return {
      navRank,
      navOrder,
      createdAt: parts[2],
      slug: parts.slice(3).join('|'),
    }
  } catch {
    return null
  }
}

export interface ListParams {
  status?: AppStatus
  mode?: AppMode
  limit?: number
  cursor?: string
}

export interface ListResult {
  apps: AppRecord[]
  nextCursor: string | null
}

export class AppRegistryService {
  /**
   * BOLA-safe, paginated list. Visibility filtering is applied IN SQL so a caller
   * never receives an app outside their org. Keyset pagination on
   * (nav_rank, nav_order, created_at, slug) keeps the page bounded AND returns apps
   * in side-menu order — lifecycle section first, then rank within it, with
   * created_at/slug as the tiebreak that keeps the ordering total and stable.
   * Only manifest-bearing (registry) rows are returned.
   */
  async list(params: ListParams, caller: AppCaller): Promise<ListResult> {
    const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)

    let query = db('apps').whereNotNull('slug').whereNotNull('manifest')

    if (params.status) {
      query = query.where('status', params.status)
    } else {
      // Default: hide suspended apps (per the contract's "all non-suspended").
      query = query.whereNot('status', 'suspended')
    }
    if (params.mode) {
      query = query.where('mode', params.mode)
    }

    // BOLA filter in SQL (unless platform admin).
    if (!caller.isPlatformAdmin) {
      const orgIds = caller.organizationIds
      query = query.where(builder => {
        builder
          .whereIn('visibility', ['public', 'marketplace'])
          .orWhereNull('organization_id')
        if (orgIds.length > 0) {
          builder.orWhere(sub => {
            sub
              .whereIn('visibility', ['organization', 'private'])
              .whereIn('organization_id', orgIds)
          })
        }
      })
    }

    // Keyset cursor over the FULL sort key (nav_rank, nav_order, created_at, slug).
    // Written as the expanded OR-chain rather than a row-value comparison
    // `(a,b,c,d) > (?,?,?,?)`: row-value comparison is Postgres-only and the test
    // database is sqlite3, where it does not parse.
    if (params.cursor) {
      const c = decodeCursor(params.cursor)
      if (c) {
        query = query.where(builder => {
          builder
            .where('nav_rank', '>', c.navRank)
            .orWhere(sub => {
              sub.where('nav_rank', '=', c.navRank).andWhere('nav_order', '>', c.navOrder)
            })
            .orWhere(sub => {
              sub
                .where('nav_rank', '=', c.navRank)
                .andWhere('nav_order', '=', c.navOrder)
                .andWhere('created_at', '>', c.createdAt)
            })
            .orWhere(sub => {
              sub
                .where('nav_rank', '=', c.navRank)
                .andWhere('nav_order', '=', c.navOrder)
                .andWhere('created_at', '=', c.createdAt)
                .andWhere('slug', '>', c.slug)
            })
        })
      }
    }

    const rows = await query
      .orderBy('nav_rank', 'asc')
      .orderBy('nav_order', 'asc')
      .orderBy('created_at', 'asc')
      .orderBy('slug', 'asc')
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const nextCursor = hasMore ? encodeCursor(page[page.length - 1]) : null

    return { apps: page.map(rowToApp), nextCursor }
  }

  /** Raw row fetch by slug (registry rows only). */
  async findBySlug(slug: string): Promise<AppRecord | null> {
    const row = await db('apps').where('slug', slug).whereNotNull('manifest').first()
    return row ? rowToApp(row) : null
  }

  /** Fetch the raw heartbeat token for a slug (not exposed on the App shape). */
  async getHeartbeatToken(slug: string): Promise<string | null> {
    const row = await db('apps').where('slug', slug).first()
    return row?.heartbeat_token ?? null
  }

  async existsBySlug(slug: string): Promise<boolean> {
    const row = await db('apps').where('slug', slug).first()
    return Boolean(row)
  }

  /**
   * Registers a new app from a validated manifest. Starts in `registered`.
   * Returns the created App + the generated heartbeat token (token is returned
   * to the caller out-of-band, never embedded in the App shape).
   */
  async register(
    manifest: AppManifest,
    organizationId: string | null,
    heartbeatToken: string
  ): Promise<AppRecord> {
    const now = new Date()
    const integrationUrl =
      manifest.integration.url || manifest.integration.remoteEntry || ''

    const insert: Record<string, unknown> = {
      slug: manifest.slug,
      name: manifest.name,
      url: integrationUrl,
      icon_url: manifest.icon?.kind === 'url' ? manifest.icon.value : null,
      description: manifest.description ?? null,
      integration_type: manifest.integration.type,
      remote_url: manifest.integration.remoteEntry ?? null,
      scope: manifest.integration.scope ?? null,
      module: manifest.integration.module ?? null,
      manifest: JSON.stringify(manifest),
      status: 'registered',
      mode: manifest.mode,
      builtin: manifest.builtin ?? false,
      organization_id: organizationId,
      visibility: (manifest.visibility ?? 'private') as Visibility,
      is_active: false,
      heartbeat_token: heartbeatToken,
      created_at: now,
      updated_at: now,
      ...navColumns(manifest),
    }

    await db('apps').insert(insert)
    const created = await this.findBySlug(manifest.slug)
    if (!created) throw new Error('register: row not found after insert')
    return created
  }

  /**
   * Replaces an existing app's manifest. slug/builtin/manifestVersion are
   * immutable; callers must pass a manifest whose slug matches. Status/org are
   * preserved.
   */
  async updateManifest(existing: AppRecord, manifest: AppManifest): Promise<AppRecord> {
    const integrationUrl =
      manifest.integration.url || manifest.integration.remoteEntry || ''
    await db('apps')
      .where('slug', existing.slug)
      .update({
        name: manifest.name,
        url: integrationUrl,
        icon_url: manifest.icon?.kind === 'url' ? manifest.icon.value : null,
        description: manifest.description ?? null,
        integration_type: manifest.integration.type,
        remote_url: manifest.integration.remoteEntry ?? null,
        scope: manifest.integration.scope ?? null,
        module: manifest.integration.module ?? null,
        manifest: JSON.stringify(manifest),
        mode: manifest.mode,
        visibility: (manifest.visibility ?? existing.manifest.visibility ?? 'private') as Visibility,
        updated_at: new Date(),
        // Re-derive placement: a manifest update may move the app in the menu.
        ...navColumns(manifest),
      })
    const updated = await this.findBySlug(existing.slug)
    if (!updated) throw new Error('updateManifest: row not found after update')
    return updated
  }

  async delete(slug: string): Promise<void> {
    await db('apps').where('slug', slug).del()
  }

  /** Idempotent transition to `activated`. */
  async setStatus(slug: string, status: AppStatus): Promise<AppRecord> {
    await db('apps')
      .where('slug', slug)
      .update({
        status,
        // keep legacy is_active in sync so the old /api/apps surface agrees.
        is_active: status === 'activated',
        updated_at: new Date(),
      })
    const updated = await this.findBySlug(slug)
    if (!updated) throw new Error('setStatus: row not found after update')
    return updated
  }

  /** Records a heartbeat — updates last_seen_at + is_healthy. */
  async recordHeartbeat(slug: string, healthy: boolean, at: Date): Promise<void> {
    await db('apps').where('slug', slug).update({
      last_seen_at: at,
      is_healthy: healthy,
      updated_at: at,
    })
  }

  /**
   * Idempotent upsert by slug for the built-in seed loader. Inserts if absent;
   * if present (by slug) it is left untouched so we never clobber operator state.
   */
  async upsertBuiltin(
    manifest: AppManifest,
    status: AppStatus,
    heartbeatToken: string
  ): Promise<void> {
    const existing = await db('apps').where('slug', manifest.slug).first()
    if (existing) return
    const now = new Date()
    const integrationUrl =
      manifest.integration.url || manifest.integration.remoteEntry || ''
    await db('apps')
      .insert({
        slug: manifest.slug,
        name: manifest.name,
        url: integrationUrl,
        icon_url: manifest.icon?.kind === 'url' ? manifest.icon.value : null,
        description: manifest.description ?? null,
        integration_type: manifest.integration.type,
        remote_url: manifest.integration.remoteEntry ?? null,
        scope: manifest.integration.scope ?? null,
        module: manifest.integration.module ?? null,
        manifest: JSON.stringify(manifest),
        status,
        mode: manifest.mode,
        builtin: true,
        organization_id: null,
        visibility: (manifest.visibility ?? 'public') as Visibility,
        is_active: status === 'activated',
        heartbeat_token: heartbeatToken,
        created_at: now,
        updated_at: now,
        ...navColumns(manifest),
      })
      .onConflict('slug')
      .ignore()
  }
}

export const appRegistryService = new AppRegistryService()
