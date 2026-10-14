// lib/sharedLists.ts — the shared / common list vocabulary (docs/planning/selection-lists-shared-and-fork.md).
//
//   - the release flag, memoised per request (`sharedListsOn`);
//   - the PLATFORM ORGANIZATION: which organization owns the common (`platform`) lists (D2). Its wire id
//     is CONFIGURATION ONLY (SELECTION_LIST_PLATFORM_ORG_ID), cross-checked against the org projection so a
//     wrong value cannot let an ordinary org publish (risk in the design record, section 12). There is NO
//     fallback to the projection: `org_type` there comes from identity.org.created.type, which a logged-in
//     user controls (POST /api/organizations {type:'platform'}), so "the org the projection calls platform"
//     is attacker-chosen. When the variable is unset or does not resolve, EVERY platform feature fails
//     closed: no `platform` list is served, created, promoted or resolved, and nothing else changes;
//   - the DATA half of "may this caller read list L" (`sharedPredicate`): the service owns `visibility`,
//     Permit decides membership. The Permit half (`SelectionListCatalog:read_shared`) lives in
//     middleware/listAccess.ts.
//
// Authorization never routes through the flag: with the flag OFF the service simply does not look at any
// of this (4.0.0 behaviour). With it ON the flag is still not a boundary: every read/write below is
// decided by Permit (through the Security API) AND by the data predicate.

import type { Request } from 'express';
import type { Knex } from 'knex';
import { fromUuid, toUuid } from '@izzywdev/fuzefront-identity';
import { db } from '../db';
import { isSharedListsEnabled } from '../flags';
import { logger } from './logger';

export type Visibility = 'private' | 'org' | 'platform';
export const VISIBILITIES: readonly Visibility[] = ['private', 'org', 'platform'];
export const isVisibility = (v: unknown): v is Visibility => typeof v === 'string' && (VISIBILITIES as readonly string[]).includes(v);

type Executor = Knex | Knex.Transaction;

// ---------------------------------------------------------------------------
// Per-request memo (flag evaluation, catalog decisions)
// ---------------------------------------------------------------------------

const memos = new WeakMap<object, Map<string, Promise<unknown>>>();

/** Run `fn` at most once per (request, key). A rejection is memoised too (the same failure answers every caller). */
export function memoPerRequest<T>(req: object, key: string, fn: () => Promise<T>): Promise<T> {
  let m = memos.get(req);
  if (!m) {
    m = new Map();
    memos.set(req, m);
  }
  const hit = m.get(key);
  if (hit) return hit as Promise<T>;
  const p = fn();
  m.set(key, p);
  return p;
}

/** Is the shared-lists release flag ON for this request's org/user? Fail-safe OFF. */
export function sharedListsOn(req: Pick<Request, 'orgId' | 'userId'>): Promise<boolean> {
  return memoPerRequest(req, 'flag:shared-lists', () =>
    isSharedListsEnabled({ organizationId: req.orgId, userId: req.userId }),
  );
}

// ---------------------------------------------------------------------------
// Organization id renderings
// ---------------------------------------------------------------------------

const ORG_WIRE_RE = /^org_[0-9a-z]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `org_…` TypeID form of a stored organization id (TypeID or bare UUID); null when it is neither. */
export function canonicalOrgId(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (ORG_WIRE_RE.test(stored)) return stored;
  if (UUID_RE.test(stored)) return fromUuid('organization', stored.toLowerCase());
  return null;
}

/** True iff two stored organization ids name the same organization (renderings compared canonically). */
export function sameOrg(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const ca = canonicalOrgId(a);
  const cb = canonicalOrgId(b);
  return ca !== null && ca === cb;
}

/** Every stored rendering of an org (wire TypeID + bare UUID when derivable), for `= ANY(?)` predicates. */
export function orgForms(wire: string): string[] {
  const forms = new Set<string>([wire]);
  try {
    forms.add(toUuid(wire as never));
  } catch {
    // not a codec-valid TypeID: match it literally only
  }
  return [...forms];
}

/**
 * THE canonical organization helper of the shared-lists code: every rendering of the caller's org (the claim as
 * presented, its org_ TypeID and its bare UUID). Every NEW query/lock/quota/predicate of the shared-lists
 * feature matches an organization through this (`= ANY(?)`) or compares with `sameOrg`, never with the raw
 * claim, because the auth middleware passes the claim verbatim and it may be either rendering. (The 4.0.0
 * routes keep their verbatim scoping; rows are STORED under the caller's own rendering.)
 */
export function orgRenderings(stored: string): string[] {
  return [...new Set([stored, ...orgForms(canonicalOrgId(stored) ?? stored)])];
}

/**
 * The org scope of a WRITE / write-guard lookup. `null` = the 4.0.0 behaviour, an EXACT match on the claim as
 * presented, which applies ONLY while the shared-lists flag is OFF. With the flag ON it is every rendering of the
 * caller's org (`orgRenderings`) - INDEPENDENT of whether the platform organization resolves: a list stored under
 * the org's TypeID (seeding stores under the wire id) is the same org's list for a token carrying the bare UUID,
 * and vice versa, whether or not platform features are available. Only foreign `platform` rows, `publish_platform`
 * and platform-tenant behaviour depend on the platform org; the caller's OWN org never does. Another org's
 * renderings never match.
 */
export async function writeOrgs(req: Pick<Request, 'orgId' | 'userId'>): Promise<string[] | null> {
  if (!req.orgId) return null;
  return memoPerRequest(req, 'write-orgs', async () => ((await sharedListsOn(req)) ? orgRenderings(req.orgId as string) : null));
}

/** SQL predicate for "this column is the caller's org" under a `writeOrgs` scope (exact when `orgs` is null). */
export function orgIs(column: string, orgId: string, orgs: string[] | null): { sql: string; params: Array<string | string[]> } {
  return orgs ? { sql: `${column} = ANY(?)`, params: [orgs] } : { sql: `${column} = ?`, params: [orgId] };
}

// ---------------------------------------------------------------------------
// The platform organization (D2)
// ---------------------------------------------------------------------------

export const PLATFORM_ORG_ENV = 'SELECTION_LIST_PLATFORM_ORG_ID';

/** TypeID of the root platform organization (backend ROOT_ORG_ID 00000000-0000-0000-0000-000000000010). */
export const ROOT_PLATFORM_ORG_WIRE = 'org_0000000000000000000000000g';

/** The configured platform org wire id; null when unset or not an `org_…` TypeID (see `verifyPlatformOrgConfig`). */
export function configuredPlatformOrgId(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env[PLATFORM_ORG_ENV]?.trim();
  return raw && ORG_WIRE_RE.test(raw) && raw.length <= 255 ? raw : null;
}

interface ProjectionRow {
  org_type: string | null;
  status: string;
  /** false = an administrator deactivated the org (the projection keeps status 'active' for it). */
  is_active: boolean | null;
  wire_id: string | null;
}

async function projectionByWire(ex: Executor, wire: string): Promise<ProjectionRow | undefined> {
  const res = await ex.raw(
    `SELECT org_type, status, is_active, wire_id FROM selection_list_ref_index WHERE entity_type = 'organization' AND wire_id = ?`,
    [wire],
  );
  return (res as { rows?: ProjectionRow[] }).rows?.[0];
}

export class PlatformOrgConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlatformOrgConfigError';
  }
}

/**
 * Resolve the platform organization's wire id, or null (=> platform features fail closed): the value of
 * SELECTION_LIST_PLATFORM_ORG_ID, but ONLY once the org projection CONFIRMS it: an active row whose
 * org_type is 'platform'. An absent row, a row without a type (the projection is fed asynchronously and may
 * simply be late), a deleted row or another type are all UNRESOLVED => platform features stay DISABLED until
 * the projection confirms the configured id (we prefer "disabled until confirmed" to refusing to boot).
 * Unset => null. The projection is never a SOURCE of the platform org (see the header): it only CONFIRMS a
 * configured one.
 * Cached briefly (it is on the read path of every shared list), but this is AUTHORIZATION state, so the
 * cache is bounded and explicitly invalidated:
 *   - the projection writers (`upsertOrgProjection` / `markOrgProjectionDeleted`, i.e. the
 *     identity.org.created / .updated / .deleted handlers) call `invalidatePlatformOrgCache()` right after
 *     they write, so on the replica that processed the event a deactivation / deletion / retype denies the very
 *     next request. A resolution that was already in flight when the invalidation happened is discarded
 *     (generation counter), never stored.
 *   - the cache is per PROCESS. Another replica does not see this replica's invalidation (a Kafka event is
 *     handled by ONE consumer of the group), so there a positive answer can outlive the change by at most
 *     CACHE_TTL_MS (5 s). That is the remaining multi-replica staleness; the unresolved answer is cached for
 *     the same time so a projection that catches up enables the features almost at once.
 */
const CACHE_TTL_MS = 5_000;
const NEGATIVE_CACHE_TTL_MS = 5_000;
let cache: { at: number; value: string | null; key: string } | null = null;
let cacheGeneration = 0;

export function _resetPlatformOrgCacheForTesting(): void {
  cache = null;
  cacheGeneration++;
}

/** Drop the cached platform-org resolution (called by the org projection writers after every write). */
export function invalidatePlatformOrgCache(): void {
  cache = null;
  cacheGeneration++;
}

export async function resolvePlatformOrgId(ex: Executor = db, now: number = Date.now()): Promise<string | null> {
  const configured = configuredPlatformOrgId();
  const key = configured ?? '';
  if (cache && cache.key === key && now - cache.at < (cache.value === null ? NEGATIVE_CACHE_TTL_MS : CACHE_TTL_MS)) return cache.value;
  const generation = cacheGeneration;
  let value: string | null = null;
  try {
    if (configured) {
      const row = await projectionByWire(ex, configured);
      if (row && row.status === 'active' && row.is_active === true && row.org_type === 'platform') {
        value = configured;
      } else {
        logger.warn(
          { configured, projected: row ? { orgType: row.org_type, status: row.status, isActive: row.is_active } : null },
          `${PLATFORM_ORG_ENV} is not (yet) confirmed as an active platform org by the org projection — platform features are disabled until it is`,
        );
        value = null;
      }
    }
  } catch (err) {
    logger.error({ err }, 'could not resolve the platform organization — platform features fail closed');
    return null; // not cached: retry on the next request
  }
  // An invalidation that happened while we were reading means the row may be stale: answer, don't store.
  if (generation === cacheGeneration) cache = { at: now, value, key };
  return value;
}

/** Is the caller acting in the platform organization? Memoised per request. */
export function callerInPlatformOrg(req: Pick<Request, 'orgId' | 'userId'>): Promise<boolean> {
  return memoPerRequest(req, 'platform-org:caller', async () => {
    const platform = await resolvePlatformOrgId();
    return platform !== null && sameOrg(req.orgId, platform);
  });
}

/**
 * Boot check (index.ts). Refuses to start on a CONTRADICTION; an unconfirmed value (no projection row yet,
 * e.g. a fresh environment) is accepted with a warning but platform features stay DISABLED until the
 * projection confirms it (resolvePlatformOrgId), because the projection is fed asynchronously.
 *   - set but not an `org_…` TypeID                                   -> fatal
 *   - set and the projection says it is not a platform org / deleted  -> fatal
 *   - unset                                                           -> warn (platform features DISABLED; no projection fallback)
 */
export async function verifyPlatformOrgConfig(ex: Executor = db, env: NodeJS.ProcessEnv = process.env): Promise<'unset' | 'confirmed' | 'unconfirmed'> {
  const raw = env[PLATFORM_ORG_ENV]?.trim();
  if (!raw) {
    logger.warn(`${PLATFORM_ORG_ENV} not set — platform features (common lists) are DISABLED (fail closed); there is no fallback to the org projection`);
    return 'unset';
  }
  if (!ORG_WIRE_RE.test(raw) || raw.length > 255) {
    throw new PlatformOrgConfigError(`${PLATFORM_ORG_ENV} must be an org_… TypeID`);
  }
  const row = await projectionByWire(ex, raw);
  if (!row) {
    logger.warn({ platformOrg: raw }, `${PLATFORM_ORG_ENV} is not in the org projection yet — cannot confirm it is a platform org`);
    return 'unconfirmed';
  }
  if (row.status === 'deleted' || row.is_active === false || (row.org_type !== null && row.org_type !== 'platform')) {
    throw new PlatformOrgConfigError(
      `${PLATFORM_ORG_ENV} (${raw}) is ${
        row.status === 'deleted' ? 'a deleted organization' : row.is_active === false ? 'a deactivated organization' : `an organization of type '${row.org_type}'`
      }, not the platform organization`,
    );
  }
  if (raw !== ROOT_PLATFORM_ORG_WIRE) {
    // The design record (D2) names the root platform organization but leaves the id to configuration, so this
    // is not fatal; it is loud, because publishing common lists into every tenant is this org's power.
    logger.warn({ platformOrg: raw, root: ROOT_PLATFORM_ORG_WIRE }, `${PLATFORM_ORG_ENV} is not the root platform organization (ROOT_ORG_ID) - confirm this is intended`);
  }
  if (row.org_type === null || row.is_active === null) {
    logger.warn({ platformOrg: raw }, `${PLATFORM_ORG_ENV} is in the org projection without a type — cannot confirm it is a platform org`);
    return 'unconfirmed';
  }
  logger.info({ platformOrg: raw }, 'platform organization confirmed by the org projection');
  return 'confirmed';
}

// ---------------------------------------------------------------------------
// The data predicate of a shared read
// ---------------------------------------------------------------------------

export interface VisibilityRow {
  organization_id: string;
  visibility?: string | null;
}

/**
 * The service-owned half of `readable(L, C)` (design record section 6): for a non-private list, does the
 * data say the caller's organization may see it WITHOUT an instance role? `org`: the list belongs to the
 * caller's organization. `platform`: always — but only if the row is really owned by the platform
 * organization (a `platform` row anywhere else is untrusted data and is not served).
 * Permit's `SelectionListCatalog:read_shared` (membership) must ALSO hold; this alone grants nothing.
 */
export function sharedPredicate(row: VisibilityRow, callerOrgId: string, platformOrgId: string | null): boolean {
  if (row.visibility === 'org') return sameOrg(row.organization_id, callerOrgId);
  if (row.visibility === 'platform') return platformOrgId !== null && sameOrg(row.organization_id, platformOrgId);
  return false;
}
