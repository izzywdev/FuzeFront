/**
 * FF-EPIC-11-S2 — the CENTRAL portal-scoping helper for every user
 * listing/search/profile READ path. Mirrors the BOLA SQL-filter pattern in
 * `backend/applications/src/app-registry/service.ts` (`canRead`/the list()
 * BOLA filter) and `backend/src/routes/apps.ts` (`scopeAppsQuery`): the filter
 * is applied IN SQL, not in application code after the fact, so a caller never
 * even receives a row outside their scope.
 *
 * *** EVERY call site that reads the `users` table (or joins it) for a
 * listing/search/profile-by-id/membership-listing purpose MUST route through
 * `scopeToPortal` (or `resolvePortalScopeDecision` + `applyPortalScope`
 * directly, when the caller needs to branch on the decision before touching
 * the DB at all, e.g. to short-circuit a `denied` decision to 403/404 without
 * running a query). grep for `db('users')` / `db(\`users\`)` in
 * `src/routes/**` before adding a new read — if it is a listing/search/profile
 * path and doesn't go through this helper, that is exactly the leak this
 * module exists to prevent. See `tests/scope-to-portal-guard.test.ts`, which
 * statically enforces this for the routes known to read `users` collections. ***
 *
 * DECISION MODES
 * --------------
 *  - 'unscoped' — the `fuzefront.identity.portal-scoped-users` flag is OFF
 *    (administratively, flag store reachable). BYTE-IDENTICAL pre-feature
 *    behavior: no filter applied at all, global query, no regression.
 *  - 'bypass'   — flag ON, caller holds the Permit ReBAC `org-admin` role on
 *    the ROOT organization (the SAME platform-admin authority
 *    `services/rootOrgAdmin.ts` grants and `checkOrganizationPermission(userId,
 *    action, ROOT_ORG_ID)` checks elsewhere — deliberately NOT a second
 *    authority model). Returns the full cross-portal view. A DISTINCT path,
 *    not the default.
 *  - 'scoped'   — flag ON, caller is NOT a platform admin, and has a valid
 *    `req.user.portalId` (the CURRENT SESSION's bound portal, from
 *    authenticateToken/resolvePortalContext — reused as-is, never re-derived
 *    here). Filtered to rows whose `home_portal_id` matches (root-portal
 *    callers additionally match `NULL`, since root/platform users are stored
 *    as `home_portal_id IS NULL` — see migration 019's module doc).
 *  - 'denied'   — flag ON (or fail-closed-to-enforced per the S6 AC4 identity
 *    deviation — see utils/identityFlag.ts) and `req.user.portalId` is
 *    missing/malformed. FAIL CLOSED: the query is constrained to match NO
 *    ROWS. NEVER falls back to an unscoped global query. Route call sites
 *    should prefer to short-circuit this to 403 (list/search) or 404 (direct
 *    profile lookup — never leak whether the target user exists) BEFORE
 *    running the query at all; `applyPortalScope`'s `1 = 0` filter is the
 *    defense-in-depth backstop for any call site that doesn't.
 */
import type { Knex } from 'knex'
import { ROOT_PORTAL_ID } from '../repositories/portalRepository'
import { ROOT_ORG_ID } from '../migrations/015_seed_root_platform_organization'
import { checkOrganizationPermission } from './permit/permission-check'
import { getRequestPortalScopingEnabled } from './identityFlag'

export type PortalScopeMode = 'unscoped' | 'bypass' | 'scoped' | 'denied'

export interface PortalScopeDecision {
  mode: PortalScopeMode
  /** The caller's session-bound portal id, only meaningful when mode === 'scoped'. */
  portalId: string | null
}

export interface ScopeToPortalRequest {
  user?: { id?: string; portalId?: string }
  portalScopingFlagEnabled?: boolean
}

export interface ScopeToPortalOptions {
  /** Column to filter on (defaults to `home_portal_id`). */
  column?: string
  /**
   * Override the platform-admin bypass check (tests / non-Permit callers).
   * Defaults to the real Permit ReBAC org-admin-on-ROOT_ORG_ID check.
   */
  isPlatformAdmin?: (userId: string) => Promise<boolean>
}

/**
 * The real platform-admin authority check — Permit ReBAC `org-admin` on the
 * ROOT organization, via the EXISTING parent->child derivation
 * (`src/permit/schema.ts`) and the EXISTING `checkOrganizationPermission`
 * helper (`src/utils/permit/permission-check.ts`), the same one
 * `services/rootOrgAdmin.ts` grants against and `routes/billing.ts` checks
 * with. `manage` (not `read`) — a root-org tenant role of `viewer`/`editor`
 * also carries `Organization:read` on the root org (see permit/schema.ts's
 * top-level roles) and must NOT count as platform-admin cross-portal bypass
 * authority; only `manage` (the `admin` tenant role and the `org-admin` ReBAC
 * role) does.
 */
async function defaultIsPlatformAdmin(userId: string): Promise<boolean> {
  try {
    return await checkOrganizationPermission(userId, 'manage', ROOT_ORG_ID)
  } catch {
    // Fail-safe: a Permit error denies the BYPASS (falls through to normal
    // portal scoping below), never grants it. checkPermission/checkOrganizationPermission
    // already fail closed internally, but this guards the promise rejection path too.
    return false
  }
}

/**
 * Resolves the portal-scope decision for the current request WITHOUT touching
 * the database — so a route can branch (e.g. to a 403/404 short-circuit for
 * 'denied') before running any query at all.
 */
export async function resolvePortalScopeDecision(
  req: ScopeToPortalRequest,
  opts: Pick<ScopeToPortalOptions, 'isPlatformAdmin'> = {}
): Promise<PortalScopeDecision> {
  const enabled = await getRequestPortalScopingEnabled(req)
  if (!enabled) {
    return { mode: 'unscoped', portalId: null }
  }

  const userId = req.user?.id
  if (userId) {
    const isPlatformAdmin = opts.isPlatformAdmin ?? defaultIsPlatformAdmin
    if (await isPlatformAdmin(userId)) {
      return { mode: 'bypass', portalId: null }
    }
  }

  const portalId = req.user?.portalId
  if (!portalId || typeof portalId !== 'string') {
    // FAIL CLOSED — missing/malformed portal context on a scoped endpoint
    // NEVER falls back to an unscoped global query.
    return { mode: 'denied', portalId: null }
  }

  return { mode: 'scoped', portalId }
}

/**
 * Applies a previously-resolved decision to a query builder. Pure/sync —
 * split out from `resolvePortalScopeDecision` so a call site can inspect the
 * decision before deciding whether to run a query at all.
 */
export function applyPortalScope<Q extends Knex.QueryBuilder>(
  query: Q,
  decision: PortalScopeDecision,
  column = 'home_portal_id'
): Q {
  if (decision.mode === 'unscoped' || decision.mode === 'bypass') {
    return query
  }
  if (decision.mode === 'denied') {
    // Never matches any row — the safe empty result, defense-in-depth behind
    // the route-level 403/404 short-circuit callers are expected to prefer.
    return query.whereRaw('1 = 0') as Q
  }
  // 'scoped'
  const portalId = decision.portalId as string
  if (portalId === ROOT_PORTAL_ID) {
    // Root/platform users are stored as home_portal_id IS NULL (migration
    // 019), not the root portal's own id — a root-portal caller must match
    // both representations.
    return query.where(function (this: Knex.QueryBuilder) {
      this.whereNull(column).orWhere(column, ROOT_PORTAL_ID)
    }) as Q
  }
  return query.where(column, portalId) as Q
}

/**
 * Convenience wrapper: resolves the decision AND applies it in one call, for
 * the common case where a call site doesn't need to branch before querying
 * (e.g. it is fine to return an empty result set for `denied`/cross-portal
 * cases). Prefer calling `resolvePortalScopeDecision` directly when the route
 * needs a 403/404 short-circuit instead.
 */
export async function scopeToPortal<Q extends Knex.QueryBuilder>(
  query: Q,
  req: ScopeToPortalRequest,
  opts: ScopeToPortalOptions = {}
): Promise<{ query: Q; decision: PortalScopeDecision }> {
  const decision = await resolvePortalScopeDecision(req, opts)
  return { query: applyPortalScope(query, decision, opts.column ?? 'home_portal_id'), decision }
}

/**
 * FF-EPIC-11-S3 — normalizes a portal id to the canonical "root == NULL"
 * representation used everywhere in this epic (`users.home_portal_id`,
 * migration 019; `organization_invitations.portal_id`, migration 020; the
 * `'scoped'` branch of `applyPortalScope` above). A caller holding the ROOT
 * portal's own literal id (`ROOT_PORTAL_ID`) and a caller holding no portal at
 * all (`null`/`undefined`) must compare EQUAL — both mean "root/platform" —
 * so any code that STORES or COMPARES a portal id (not just this module's own
 * read-scoping decision) should normalize through this helper rather than
 * comparing raw ids directly.
 */
export function normalizePortalId(portalId: string | null | undefined): string | null {
  if (!portalId || portalId === ROOT_PORTAL_ID) return null
  return portalId
}
