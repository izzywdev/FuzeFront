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

// Owner ruling 2026-08-19/2026-08-25: "there should be no app without orgid.
// at the minimum fuzefront itself the root org is the orgid for our own
// apps. like google owns docs, sheets, etc." `organization_id` on `apps` is
// NEVER null post-migration (see backend/applications/src/migrations —
// backfill + NOT NULL) — a first-party FuzeFront product (registered by a
// platform-admin service account, or a BUILTIN_MANIFESTS entry) is owned by
// the platform root org, not left org-less.
//
// This is the applications-service's own copy of the SAME fixed id
// backend/src/migrations/015_seed_root_platform_organization.ts seeds and
// exports as ROOT_ORG_ID — cross-service TS imports don't resolve (separate
// deployables), so every service that needs it re-declares the literal
// (same pattern as backend/applications/tests/portal-catalog.integration.test.ts
// and backend/security/src/migrations/014_seed_root_platform_organization.ts).
// Changing this value without a coordinated migration across every service
// orphans every row already keyed to it.
export const ROOT_ORG_ID = '00000000-0000-0000-0000-000000000010'

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
  /**
   * Creator/publisher of record (users.id) — INFORMATIONAL, immutable once set,
   * never a source of authority (that is Permit + org role). Internal field:
   * routes strip it from the wire shape and only expose `createdBy`/`creator`
   * when fuzefront.apps.creator-ownership is ON.
   */
  createdByUserId?: string | null
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

/**
 * Total timestamp -> ISO conversion for response mapping. A stored 'infinity' /
 * '-infinity' (node-postgres: a non-finite Date/number) or a year outside
 * 0000..9999 (extended-year ISO, not RFC 3339) must never throw and turn a read
 * into a 500; it maps to null so the caller can fall back.
 */
export function safeIso(d: unknown): string | null {
  if (d === null || d === undefined || d === '') return null
  const t = new Date(d as any)
  if (Number.isNaN(t.getTime())) return null
  const y = t.getUTCFullYear()
  if (y < 0 || y > 9999) return null
  return t.toISOString()
}

function rowToApp(row: any): AppRecord {
  const manifest: AppManifest =
    typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest
  return {
    slug: row.slug,
    status: row.status,
    mode: row.mode,
    builtin: Boolean(row.builtin),
    organizationId: row.organization_id ?? null,
    createdByUserId: row.created_by_user_id ?? null,
    manifest,
    isHealthy: row.is_healthy === null || row.is_healthy === undefined ? null : Boolean(row.is_healthy),
    lastSeenAt: safeIso(row.last_seen_at),
    createdAt: safeIso(row.created_at) ?? new Date().toISOString(),
    updatedAt: safeIso(row.updated_at) ?? new Date().toISOString(),
  }
}

/**
 * Visibility / BOLA predicate. A caller may READ an app when:
 *  - they are a platform admin (sees all), OR
 *  - visibility is public|marketplace (everyone), OR
 *  - visibility is organization AND the app's org is one the caller belongs to, OR
 *  - visibility is private AND the app's org is one the caller belongs to (owner org).
 * `organization_id` is NOT NULL on `apps` (see ROOT_ORG_ID's doc comment
 * above) — the `!app.organizationId` branch below is unreachable defensive
 * code, kept rather than deleted so a future regression on the DB
 * constraint fails safe (deny) here instead of this predicate silently
 * assuming a shape the schema no longer allows.
 */
export function canRead(app: AppRecord, caller: AppCaller): boolean {
  if (caller.isPlatformAdmin) return true
  const visibility = app.manifest.visibility ?? 'private'
  if (visibility === 'public' || visibility === 'marketplace') return true
  if (!app.organizationId) return false // should be unreachable; fail closed, not open
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

/**
 * FF-EPIC-12-S2 — the portal-catalog context `list()`'s caller
 * (routes/app-registry.ts, via app-registry/portalContext.ts) resolves and
 * passes in. See portalContext.ts's module doc for how this is derived (the
 * JWT's `portalId` claim — this service has no other source of portal
 * context). Optional/undefined behaves EXACTLY like `{ mode: 'off' }` — every
 * existing caller that never passes this argument sees byte-identical
 * pre-epic behavior (S5 AC1).
 */
export interface PortalCatalogListContext {
  mode: 'off' | 'root' | 'scoped' | 'denied'
  portalId: string | null
}

export interface PublicationRow {
  submittedAt: string | null
  isApproved: boolean
  approvedAt: string | null
  approvedBy: string | null
  metadata: Record<string, any>
}

function readJson(v: unknown): Record<string, any> {
  if (!v) return {}
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) ?? {}
    } catch {
      return {}
    }
  }
  return v as Record<string, any>
}

function rowToPublication(row: any): PublicationRow {
  const iso = safeIso
  return {
    submittedAt: iso(row.marketplace_submitted_at),
    isApproved: Boolean(row.is_marketplace_approved),
    approvedAt: iso(row.marketplace_approved_at),
    approvedBy: row.approved_by ?? null,
    metadata: readJson(row.marketplace_metadata),
  }
}

// ── marketplace review queue (GET /publication-requests) ──────────────────────
export type PublicationQueueStatus = 'pending' | 'approved' | 'rejected'
export const PUBLICATION_QUEUE_STATUSES: readonly PublicationQueueStatus[] = ['pending', 'approved', 'rejected']

export interface PublicationQueuePage {
  items: { app: AppRecord; publication: PublicationRow }[]
  nextCursor: string | null
  hasMore: boolean
}

/** Thrown for a malformed / wrong-status cursor; the route maps it to 400. */
export class InvalidCursorError extends Error {
  constructor() {
    super('invalid cursor')
    this.name = 'InvalidCursorError'
  }
}

/**
 * The instant each queue is ordered by ("oldest first by submittedAt"). It MUST
 * be a value that does not change while the row stays in that queue, or the
 * keyset cursor would skip/repeat rows under concurrent writes:
 *  - pending : marketplace_submitted_at (immutable until decided).
 *  - approved: marketplace_approved_at (the contract's `approvedAt`, set once by
 *              approve), falling back to creation time for legacy rows with no
 *              recorded approval. NOT the retained submission instant: reviews
 *              can complete out of submission order.
 *  - rejected: reject clears marketplace_submitted_at, so the stable instant is
 *              the recorded rejectedAt (immutable until resubmission moves the
 *              row to pending); a missing/unparseable value falls back to
 *              creation time (see "cast-safety" below).
 * Every expression is truncated to ms so it compares exactly with the
 * ms-precision ISO string carried in the cursor (JS Date has no microseconds).
 */
function publicationSortExpr(status: PublicationQueueStatus): string {
  switch (status) {
    case 'pending':
      return sortInstant('marketplace_submitted_at')
    case 'approved':
      return sortInstant('marketplace_approved_at', 'created_at')
    case 'rejected':
      return sortInstant(REJECTED_AT_SQL, 'created_at')
  }
}

// ── cast-safety for the sort key ───────────────────────────────────────────────
// Nothing stored may make the queue query RAISE or yield a key the cursor cannot
// round-trip, or one bad legacy row would 500 (or silently skip rows from) the
// whole view. Hazards handled here:
//  - a rejectedAt string that is shape-valid but not a real timestamp
//    ('2026-01-01Tbogus', '2026-02-30T00:00:00Z', bad zone): cast via
//    apps_try_timestamptz() (migration 019), which yields NULL instead of raising.
//    The prefilter regex also excludes the PG special inputs ('now', 'today',
//    'epoch', ...) that cast fine but are NOT stable instants.
//  - 'infinity' / '-infinity' / years outside 0001..9999 (JS Date.toISOString
//    would emit an extended year or throw, and the cursor would no longer parse):
//    bounded() turns them into NULL.
//  - a NULL key (keyset `NULL > x` is NULL -> the row would vanish): the final
//    COALESCE fallback is the epoch, so every row has a finite, total-ordered key.
const EPOCH_SQL = "'1970-01-01 00:00:00+00'::timestamptz"
const REJECTED_AT_SQL =
  "(CASE WHEN (marketplace_metadata #>> '{publication,rejection,rejectedAt}') " +
  "~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}' " +
  "THEN apps_try_timestamptz(marketplace_metadata #>> '{publication,rejection,rejectedAt}') END)"

function bounded(expr: string): string {
  return (
    `(CASE WHEN ${expr} >= '0001-01-01 00:00:00+00'::timestamptz ` +
    `AND ${expr} <= '9999-12-31 23:59:59.999+00'::timestamptz THEN ${expr} END)`
  )
}

/** First usable candidate, ms-truncated, never NULL, never infinite, always in 0001..9999. */
function sortInstant(...candidates: string[]): string {
  return `date_trunc('milliseconds', COALESCE(${candidates.map(bounded).join(', ')}, ${EPOCH_SQL}))`
}

function encodePublicationCursor(status: PublicationQueueStatus, at: unknown, slug: string): string {
  return Buffer.from(`pq1|${status}|${new Date(at as any).toISOString()}|${slug}`, 'utf8').toString('base64url')
}

function decodePublicationCursor(
  cursor: string,
  status: PublicationQueueStatus
): { at: string; slug: string } | null {
  try {
    const parts = Buffer.from(cursor, 'base64url').toString('utf8').split('|')
    if (parts.length < 4 || parts[0] !== 'pq1') return null
    // A cursor is only valid for the queue it was issued for.
    if (parts[1] !== status) return null
    // Strict ms-precision UTC ISO, years 0001..9999 only: anything else (forged,
    // extended-year, non-canonical) is a 400 here rather than a cast error later.
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(parts[2])) return null
    const t = new Date(parts[2])
    if (Number.isNaN(t.getTime()) || t.toISOString() !== parts[2]) return null
    const slug = parts.slice(3).join('|')
    // A NUL byte in a bound parameter makes Postgres raise (500), so reject it.
    if (!slug || slug.includes('\u0000')) return null
    return { at: parts[2], slug }
  } catch {
    return null
  }
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
  async list(
    params: ListParams,
    caller: AppCaller,
    portalCtx?: PortalCatalogListContext
  ): Promise<ListResult> {
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

    // BOLA filter in SQL (unless platform admin). Platform admins bypass this
    // ENTIRE block — including the FF-EPIC-12-S2 portal-catalog gate below —
    // same "sees everything" convention `canRead`/`canMutate` already apply.
    if (!caller.isPlatformAdmin) {
      const orgIds = caller.organizationIds

      // FF-EPIC-12-S2 AC4 — fail closed. A 'denied' portal context (the flag
      // is ON and the caller's portal context is missing/malformed) must
      // NEVER fall back to the unscoped global list — match no rows at all,
      // rather than only gating the org-less/public branch below.
      if (portalCtx?.mode === 'denied') {
        query = query.whereRaw('1 = 0')
      } else {
        // 'scoped' (a resolved, non-root tenant portal) ANDs an extra
        // membership check onto the org-less/public branch ONLY — the
        // org-owned branch (organization/private visibility, caller's own
        // orgs) is untouched, since that leak never existed for those. 'off'
        // and 'root' apply NO extra gate here, preserving the EXACT
        // pre-epic/root SQL (S5 AC1 / S2 AC3).
        const applyPortalGate = portalCtx?.mode === 'scoped'

        query = query.where(builder => {
          // `organization_id IS NULL` was a THIRD branch here (public/marketplace
          // visibility OR org-less), removed by owner ruling 2026-08-25: "there
          // should be no app without orgid ... fuzefront itself [is] the orgid
          // for our own apps" (see ROOT_ORG_ID's doc comment above). It was a
          // latent hole, not a feature — it made ANY row with no owning org
          // visible to every caller regardless of `visibility`, and every
          // first-party FuzeFront product ended up in exactly that state
          // (registered with no organizationId). `organization_id` is NOT NULL
          // on this table as of the migration backfilling those rows to
          // ROOT_ORG_ID (backend/applications/src/migrations), so this branch
          // is now simply "public/marketplace visibility" — nothing was ever
          // org-less on purpose, so nothing is lost by requiring an org match
          // for everything else.
          builder.where(publicOrMarketplace => {
            publicOrMarketplace.whereIn('visibility', ['public', 'marketplace'])
            if (applyPortalGate) {
              const portalId = portalCtx!.portalId as string
              publicOrMarketplace.whereExists(function (this: any) {
                this.select(1)
                  .from('portal_apps')
                  .whereRaw('portal_apps.app_id = apps.id')
                  .andWhere('portal_apps.portal_id', portalId)
                  .andWhere('portal_apps.enabled', true)
              })
            }
          })
          if (orgIds.length > 0) {
            builder.orWhere(sub => {
              sub
                .whereIn('visibility', ['organization', 'private'])
                .whereIn('organization_id', orgIds)
            })
          }
        })
      }
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
    heartbeatToken: string,
    opts?: { createdByUserId?: string | null }
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
      // Only present when creator-ownership is ON and a human registered it.
      ...(opts?.createdByUserId ? { created_by_user_id: opts.createdByUserId } : {}),
      scope_level:
        manifest.scopeLevel ??
        (manifest.requiresOrgContext || manifest.visibility === 'organization'
          ? 'organization'
          : 'both'),
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
        ...(manifest.scopeLevel
          ? { scope_level: manifest.scopeLevel }
          : manifest.requiresOrgContext || manifest.visibility === 'organization'
          ? { scope_level: 'organization' }
          : {}),
        updated_at: new Date(),
        // Re-derive placement: a manifest update may move the app in the menu.
        ...navColumns(manifest),
      })
    const updated = await this.findBySlug(existing.slug)
    if (!updated) throw new Error('updateManifest: row not found after update')
    return updated
  }

  /**
   * Records the creator of an app that has none yet. IMMUTABLE once set: the
   * `created_by_user_id IS NULL` guard makes this a no-op on an app that already
   * has a creator, and no other write path touches the column. Returns whether
   * the creator was written.
   */
  async setCreatorIfUnset(slug: string, userId: string): Promise<boolean> {
    const n = await db('apps')
      .where('slug', slug)
      .whereNull('created_by_user_id')
      .update({ created_by_user_id: userId })
    return Number(n) > 0
  }

  // ── marketplace publication (columns from migration 002) ────────────────────
  async getPublication(slug: string): Promise<PublicationRow | null> {
    const row = await db('apps').where('slug', slug).whereNotNull('manifest').first()
    return row ? rowToPublication(row) : null
  }

  /**
   * Cross-app marketplace review queue (`GET /publication-requests`). A
   * single-service collection over this service's own `apps` table — NOT a
   * cross-service join. Oldest first on the per-status sort instant (see
   * publicationSortExpr), `slug` as the total-order tiebreak, keyset-paginated
   * with an opaque cursor that is bound to the requested status.
   *
   * NO visibility/BOLA filter here by design: the caller is authorised as a
   * platform admin by the route BEFORE this runs (fail closed), and the queue
   * is by definition cross-org.
   */
  async listPublicationRequests(params: {
    status: PublicationQueueStatus
    limit?: number
    cursor?: string | null
  }): Promise<PublicationQueuePage> {
    const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
    const sortExpr = publicationSortExpr(params.status)

    let query = db('apps').whereNotNull('slug').whereNotNull('manifest')
    switch (params.status) {
      case 'pending':
        query = query
          .whereNotNull('marketplace_submitted_at')
          .whereRaw('COALESCE(is_marketplace_approved, false) = false')
        break
      case 'approved':
        query = query.whereRaw('COALESCE(is_marketplace_approved, false) = true')
        break
      case 'rejected':
        // Mirrors publicationStatus(): not approved, submission cleared, and a
        // recorded rejection.
        query = query
          .whereRaw('COALESCE(is_marketplace_approved, false) = false')
          .whereNull('marketplace_submitted_at')
          .whereRaw("jsonb_typeof(marketplace_metadata #> '{publication,rejection}') = 'object'")
        break
    }

    if (params.cursor) {
      const c = decodePublicationCursor(params.cursor, params.status)
      if (!c) throw new InvalidCursorError()
      query = query.whereRaw(`(${sortExpr} > ?::timestamptz OR (${sortExpr} = ?::timestamptz AND slug > ?))`, [
        c.at,
        c.at,
        c.slug,
      ])
    }

    const rows = await query
      .select('apps.*', db.raw(`${sortExpr} AS queue_sort_at`))
      .orderByRaw(`${sortExpr} ASC`)
      .orderBy('slug', 'asc')
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const last = page[page.length - 1]
    const nextCursor = hasMore && last ? encodePublicationCursor(params.status, last.queue_sort_at, last.slug) : null

    return {
      items: page.map((row: any) => ({ app: rowToApp(row), publication: rowToPublication(row) })),
      nextCursor,
      hasMore,
    }
  }

  /** Marks the app as submitted to the marketplace (pending review). */
  async submitPublication(
    slug: string,
    publication: Record<string, unknown>
  ): Promise<PublicationRow> {
    const row = await db('apps').where('slug', slug).first()
    const meta = readJson(row?.marketplace_metadata)
    await db('apps')
      .where('slug', slug)
      .update({
        marketplace_submitted_at: new Date(),
        is_marketplace_approved: false,
        marketplace_metadata: JSON.stringify({ ...meta, publication }),
        updated_at: new Date(),
      })
    return (await this.getPublication(slug)) as PublicationRow
  }

  /** Approves: visibility -> marketplace (column AND manifest, which canRead reads). */
  async approvePublication(
    slug: string,
    approvedBy: string | null,
    publicationPatch: Record<string, unknown>
  ): Promise<PublicationRow> {
    const row = await db('apps').where('slug', slug).first()
    const meta = readJson(row?.marketplace_metadata)
    const manifest = readJson(row?.manifest)
    const now = new Date()
    await db('apps')
      .where('slug', slug)
      .update({
        visibility: 'marketplace',
        manifest: JSON.stringify({ ...manifest, visibility: 'marketplace' }),
        is_marketplace_approved: true,
        marketplace_approved_at: now,
        approved_by: approvedBy,
        marketplace_metadata: JSON.stringify({
          ...meta,
          publication: { ...(meta.publication ?? {}), ...publicationPatch },
        }),
        updated_at: now,
      })
    return (await this.getPublication(slug)) as PublicationRow
  }

  /** Rejects: clears the submission and records the reason in metadata. */
  async rejectPublication(
    slug: string,
    publicationPatch: Record<string, unknown>
  ): Promise<PublicationRow> {
    const row = await db('apps').where('slug', slug).first()
    const meta = readJson(row?.marketplace_metadata)
    await db('apps')
      .where('slug', slug)
      .update({
        marketplace_submitted_at: null,
        is_marketplace_approved: false,
        marketplace_metadata: JSON.stringify({
          ...meta,
          publication: { ...(meta.publication ?? {}), ...publicationPatch },
        }),
        updated_at: new Date(),
      })
    return (await this.getPublication(slug)) as PublicationRow
  }

  async delete(slug: string): Promise<void> {
    await db('apps').where('slug', slug).del()
  }

  /**
   * Stores the app's self-declared authorization policy (full replace — a policy is
   * never merged with its predecessor, so removing a role in the product's repo
   * actually removes it). The stored value is what the product SUBMITTED, with bare
   * un-namespaced keys; namespacing/merging happens at sync time.
   */
  async setPolicy(slug: string, policy: unknown): Promise<void> {
    await db('apps')
      .where('slug', slug)
      .update({ policy: JSON.stringify(policy), updated_at: new Date() })
  }

  /** Stores the app's billing profile (full replace). */
  async setBillingProfile(slug: string, profile: unknown): Promise<void> {
    await db('apps')
      .where('slug', slug)
      .update({ billing_profile: JSON.stringify(profile), updated_at: new Date() })
  }

  /**
   * Every registered app that has declared a policy, for the permit-schema sync job.
   * This is what replaces the hardcoded product list in sync-permit-schema.ts —
   * adding a product no longer edits platform source.
   */
  async listPolicies(): Promise<{ slug: string; policy: any }[]> {
    const rows = await db('apps')
      .whereNotNull('slug')
      .whereNotNull('policy')
      .select('slug', 'policy')
    return rows.map((r: any) => ({
      slug: r.slug,
      policy: typeof r.policy === 'string' ? JSON.parse(r.policy) : r.policy,
    }))
  }

  /** Every registered billing profile, for the billing service's key allowlist. */
  async listBillingProfiles(): Promise<{ slug: string; profile: any }[]> {
    const rows = await db('apps')
      .whereNotNull('slug')
      .whereNotNull('billing_profile')
      .select('slug', 'billing_profile')
    return rows.map((r: any) => ({
      slug: r.slug,
      profile:
        typeof r.billing_profile === 'string'
          ? JSON.parse(r.billing_profile)
          : r.billing_profile,
    }))
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
        // ROOT_ORG_ID, not null (owner ruling — see ROOT_ORG_ID's own doc
        // comment above): a builtin is a first-party FuzeFront product like
        // any other, owned by the platform root org rather than org-less.
        organization_id: ROOT_ORG_ID,
        visibility: (manifest.visibility ?? 'public') as Visibility,
        scope_level:
          manifest.scopeLevel ??
          (manifest.requiresOrgContext || manifest.visibility === 'organization'
            ? 'organization'
            : 'both'),
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
