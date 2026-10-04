// Data layer for app_build_sessions (migration 018) + the few directory lookups
// the build routes need. Behind an interface so route tests inject an in-memory
// store (setBuildSessionStore) with no Postgres.
import { db } from '../config/database'

export type BuildStatus =
  | 'requested'
  | 'launching'
  | 'building'
  | 'deploying'
  | 'deployed'
  | 'failed'
  | 'cancelled'

export const TERMINAL_STATUSES: readonly BuildStatus[] = ['deployed', 'failed', 'cancelled']
export const CANCELLABLE_STATUSES: readonly BuildStatus[] = [
  'requested',
  'launching',
  'building',
  'deploying',
]

export interface BuildSessionRow {
  id: string // bare uuid (storage form)
  organization_id: string
  requested_by_user_id: string | null
  context: 'personal' | 'organization'
  name: string
  brief: string
  status: BuildStatus
  app_id: string | null
  /** Joined from apps.slug (read paths only). */
  app_slug?: string | null
  agent_session_ref: string | null
  agent_session_url: string | null
  error_code: string | null
  error_message: string | null
  created_at: Date
  updated_at: Date
}

export interface BuildAppRef {
  id: string
  slug: string
  organization_id: string
  created_by_user_id: string | null
}

export interface ListBuildSessionsQuery {
  requesterId: string
  /** When set, restrict to this org; `includeAllInOrg` then widens to every requester. */
  organizationId?: string
  includeAllInOrg: boolean
  limit: number
  cursor?: { createdAt: string; id: string } | null
}

export interface BuildSessionStore {
  insert(row: Omit<BuildSessionRow, 'app_slug'>): Promise<void>
  findById(id: string): Promise<BuildSessionRow | null>
  /** Newest first; returns up to `limit + 1` rows so the caller can compute hasMore. */
  list(q: ListBuildSessionsQuery): Promise<BuildSessionRow[]>
  /**
   * Compare-and-set: apply `patch` only while status is one of `fromStatuses`.
   * Returns false when no row matched (lost a race / illegal transition).
   */
  transition(
    id: string,
    fromStatuses: readonly BuildStatus[],
    patch: Partial<BuildSessionRow>
  ): Promise<boolean>
  /** Unconditional patch of non-status fields (agent refs after a racing callback). */
  patch(id: string, patch: Partial<BuildSessionRow>): Promise<void>
  findPersonalOrgId(userId: string): Promise<string | null>
  orgExists(organizationId: string): Promise<boolean>
  getOrgRole(userId: string, organizationId: string): Promise<string | null>
  findAppBySlug(slug: string): Promise<BuildAppRef | null>
}

const cols = [
  'app_build_sessions.*',
  'apps.slug as app_slug',
]

export const knexBuildSessionStore: BuildSessionStore = {
  async insert(row) {
    await db('app_build_sessions').insert(row)
  },

  async findById(id) {
    const r = await db('app_build_sessions')
      .leftJoin('apps', 'apps.id', 'app_build_sessions.app_id')
      .where('app_build_sessions.id', id)
      .select(...cols)
      .first()
    return (r as BuildSessionRow) ?? null
  },

  async list(q) {
    let query = db('app_build_sessions')
      .leftJoin('apps', 'apps.id', 'app_build_sessions.app_id')
      .select(...cols)
    if (q.organizationId) {
      query = query.where('app_build_sessions.organization_id', q.organizationId)
      if (!q.includeAllInOrg) {
        query = query.where('app_build_sessions.requested_by_user_id', q.requesterId)
      }
    } else {
      query = query.where('app_build_sessions.requested_by_user_id', q.requesterId)
    }
    if (q.cursor) {
      // Keyset over the FULL sort key (created_at DESC, id DESC) so pages
      // neither skip nor repeat rows that share a created_at.
      const { createdAt, id } = q.cursor
      query = query.where(b => {
        b.where('app_build_sessions.created_at', '<', createdAt).orWhere(s => {
          s.where('app_build_sessions.created_at', '=', createdAt).andWhere(
            'app_build_sessions.id',
            '<',
            id
          )
        })
      })
    }
    const rows = await query
      .orderBy('app_build_sessions.created_at', 'desc')
      .orderBy('app_build_sessions.id', 'desc')
      .limit(q.limit + 1)
    return rows as BuildSessionRow[]
  },

  async transition(id, fromStatuses, patch) {
    const n = await db('app_build_sessions')
      .where('id', id)
      .whereIn('status', fromStatuses as BuildStatus[])
      .update({ ...patch, updated_at: new Date() })
    return Number(n) > 0
  },

  async patch(id, patch) {
    await db('app_build_sessions')
      .where('id', id)
      .update({ ...patch, updated_at: new Date() })
  },

  async findPersonalOrgId(userId) {
    // A personal org is organizations.type='personal' with the user as owner
    // (backend migration 009: partial unique index uq_personal_org_per_owner
    // enforces at most one per owner).
    const r = await db('organizations').where({ owner_id: userId, type: 'personal' }).first()
    return r?.id ?? null
  },

  async orgExists(organizationId) {
    const r = await db('organizations').where('id', organizationId).first()
    return Boolean(r)
  },

  async getOrgRole(userId, organizationId) {
    const r = await db('organization_memberships')
      .where('user_id', userId)
      .where('organization_id', organizationId)
      .where('status', 'active')
      .first()
    return r ? r.role : null
  },

  async findAppBySlug(slug) {
    const r = await db('apps').where('slug', slug).first()
    return r
      ? {
          id: r.id,
          slug: r.slug,
          organization_id: r.organization_id,
          created_by_user_id: r.created_by_user_id ?? null,
        }
      : null
  },
}

let store: BuildSessionStore = knexBuildSessionStore

/** Test/DI seam. */
export function setBuildSessionStore(s: BuildSessionStore | null): void {
  store = s ?? knexBuildSessionStore
}
export function getBuildSessionStore(): BuildSessionStore {
  return store
}

export function encodeSessionCursor(row: { created_at: Date | string; id: string }): string {
  return Buffer.from(`${new Date(row.created_at).toISOString()}|${row.id}`, 'utf8').toString(
    'base64url'
  )
}

export function decodeSessionCursor(
  cursor: string
): { createdAt: string; id: string } | null {
  try {
    const [createdAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|')
    if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) return null
    return { createdAt, id }
  } catch {
    return null
  }
}
