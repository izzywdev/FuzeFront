// lib/sharedLists.ts — the shared / common list vocabulary (docs/planning/selection-lists-shared-and-fork.md).
//
//   - the release flag, memoised per request (`sharedListsOn`);
//   - the PLATFORM ORGANIZATION: which organization owns the common (`platform`) lists (D2). Its wire id
//     is configuration (SELECTION_LIST_PLATFORM_ORG_ID), cross-checked against the org projection so a
//     wrong value cannot let an ordinary org publish (risk in the design record, section 12). When it does
//     not resolve, EVERY platform feature fails closed: no `platform` list is served, created or promoted,
//     and nothing else changes;
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

// ---------------------------------------------------------------------------
// The platform organization (D2)
// ---------------------------------------------------------------------------

export const PLATFORM_ORG_ENV = 'SELECTION_LIST_PLATFORM_ORG_ID';

/** The configured platform org wire id; null when unset or not an `org_…` TypeID (see `verifyPlatformOrgConfig`). */
export function configuredPlatformOrgId(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env[PLATFORM_ORG_ENV]?.trim();
  return raw && ORG_WIRE_RE.test(raw) && raw.length <= 255 ? raw : null;
}

interface ProjectionRow {
  org_type: string | null;
  status: string;
  wire_id: string | null;
}

async function projectionByWire(ex: Executor, wire: string): Promise<ProjectionRow | undefined> {
  const res = await ex.raw(
    `SELECT org_type, status, wire_id FROM selection_list_ref_index WHERE entity_type = 'organization' AND wire_id = ?`,
    [wire],
  );
  return (res as { rows?: ProjectionRow[] }).rows?.[0];
}

async function platformProjections(ex: Executor): Promise<ProjectionRow[]> {
  const res = await ex.raw(
    `SELECT org_type, status, wire_id FROM selection_list_ref_index
      WHERE entity_type = 'organization' AND org_type = 'platform' AND status = 'active' AND wire_id IS NOT NULL`,
  );
  return (res as { rows?: ProjectionRow[] }).rows ?? [];
}

export class PlatformOrgConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlatformOrgConfigError';
  }
}

/**
 * Resolve the platform organization's wire id, or null (=> platform features fail closed).
 *   1. SELECTION_LIST_PLATFORM_ORG_ID, but ONLY if the org projection does not contradict it (a projection
 *      row that says the org is not a platform org, or is deleted, makes the value untrustworthy);
 *   2. else the single active projection row with org_type = 'platform'.
 * Cached briefly: it is on the read path of every shared list.
 */
const CACHE_TTL_MS = 30_000;
let cache: { at: number; value: string | null; key: string } | null = null;

export function _resetPlatformOrgCacheForTesting(): void {
  cache = null;
}

export async function resolvePlatformOrgId(ex: Executor = db, now: number = Date.now()): Promise<string | null> {
  const configured = configuredPlatformOrgId();
  const key = configured ?? '';
  if (cache && cache.key === key && now - cache.at < CACHE_TTL_MS) return cache.value;
  let value: string | null = null;
  try {
    if (configured) {
      const row = await projectionByWire(ex, configured);
      if (row && (row.status === 'deleted' || (row.org_type !== null && row.org_type !== 'platform'))) {
        logger.error(
          { configured, orgType: row.org_type, status: row.status },
          `${PLATFORM_ORG_ENV} names an organization the projection says is not an active platform org — platform features fail closed`,
        );
        value = null;
      } else {
        value = configured;
      }
    } else {
      const rows = await platformProjections(ex);
      value = rows.length === 1 ? (rows[0].wire_id as string) : null;
      if (rows.length > 1) {
        logger.error({ count: rows.length }, 'more than one active platform org in the projection and no SELECTION_LIST_PLATFORM_ORG_ID — platform features fail closed');
      }
    }
  } catch (err) {
    logger.error({ err }, 'could not resolve the platform organization — platform features fail closed');
    return null; // not cached: retry on the next request
  }
  cache = { at: now, value, key };
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
 * e.g. a fresh environment) is accepted with a warning, because the projection is fed asynchronously.
 *   - set but not an `org_…` TypeID                                   -> fatal
 *   - set and the projection says it is not a platform org / deleted  -> fatal
 *   - unset                                                           -> info (fallback to the projection)
 */
export async function verifyPlatformOrgConfig(ex: Executor = db, env: NodeJS.ProcessEnv = process.env): Promise<'unset' | 'confirmed' | 'unconfirmed'> {
  const raw = env[PLATFORM_ORG_ENV]?.trim();
  if (!raw) {
    logger.info(`${PLATFORM_ORG_ENV} not set — the platform organization is taken from the org projection (org_type = 'platform'); platform features fail closed until it resolves`);
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
  if (row.status === 'deleted' || (row.org_type !== null && row.org_type !== 'platform')) {
    throw new PlatformOrgConfigError(
      `${PLATFORM_ORG_ENV} (${raw}) is ${row.status === 'deleted' ? 'a deleted organization' : `an organization of type '${row.org_type}'`}, not the platform organization`,
    );
  }
  if (row.org_type === null) {
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
  if (row.visibility === 'org') return row.organization_id === callerOrgId;
  if (row.visibility === 'platform') return platformOrgId !== null && sameOrg(row.organization_id, platformOrgId);
  return false;
}
