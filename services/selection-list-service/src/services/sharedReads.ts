// services/sharedReads.ts — the READ-side data scope for shared lists (design record section 6) and the
// `editable` hint (D13).
//
// "Org scoping" for reads becomes `organization_id = X OR (visibility = 'platform' AND owned by the platform
// org)`; for WRITES it stays `organization_id = X` (callers never use this for writes). The Permit half of
// readability is enforced by the route guards (middleware/listAccess.ts) BEFORE a handler runs; the SQL scope
// here only decides which rows the handler may even look at, so a cross-org row is never reachable by id.
//
// With the release flag OFF the scope is the 4.0.0 one, byte for byte: `organization_id = ?`. With it ON the
// caller's own org always matches under every rendering of its id; the platform organization only decides
// whether the common lists are added (unresolved => none).

import type { Request } from 'express';
import type { Knex } from 'knex';
import { db } from '../db';
import { getLog } from '../lib/logger';
import { orgForms, orgRenderings, resolvePlatformOrgId, sameOrg, sharedListsOn, sharedPredicate } from '../lib/sharedLists';
import {
  bearer,
  filterReadable,
  getAuthzClient,
  isAuthzEnabled,
  SELECTION_LIST_RESOURCE,
} from '../middleware/authz';
import { catalogAllowed } from '../middleware/listAccess';
import { type DupRow, notOutrankedByRendering, pickWinner, renderingWinnerOrder } from '../lib/renderingWinner';

// The winner rule is defined once, in lib/renderingWinner.ts (pure; shared with the rollout jobs); re-exported here
// so every existing importer keeps working.
export { type DupRow, notOutrankedByRendering, pickWinner, renderingWinnerOrder };

export interface ReadScope {
  /** The shared-lists flag is ON for this request. */
  shared: boolean;
  /** Wire id of the platform organization when it resolves, else null (platform features fail closed). */
  platformOrg: string | null;
  /**
   * Also include the platform organization's common lists (default true). The default listing (no
   * `include_shared`) sets it false: it is the caller's OWN organization only - but still across every
   * rendering of the org id (bare UUID / TypeID) while the feature is on.
   */
  includePlatform?: boolean;
}

export async function getReadScope(req: Pick<Request, 'orgId' | 'userId'>): Promise<ReadScope> {
  const shared = await sharedListsOn(req);
  return { shared, platformOrg: shared ? await resolvePlatformOrgId() : null };
}

/** SQL predicate (+ positional params) for "rows the caller's organization may READ", on `alias` (or no alias). */
export function readableByOrg(alias: string, orgId: string, scope: ReadScope): { sql: string; params: Array<string | string[]> } {
  const p = alias ? `${alias}.` : '';
  if (!scope.shared) return { sql: `${p}organization_id = ?`, params: [orgId] }; // flag OFF: the 4.0.0 exact match
  // Flag ON: the caller's OWN org matches under every rendering of its id, whether or not the platform org
  // resolves. Only the foreign common lists need the platform org (unresolved => fail closed: none served).
  if (!scope.platformOrg || scope.includePlatform === false) return { sql: `${p}organization_id = ANY(?)`, params: [orgRenderings(orgId)] };
  return {
    sql: `(${p}organization_id = ANY(?) OR (${p}visibility = 'platform' AND ${p}organization_id = ANY(?)))`,
    params: [orgRenderings(orgId), orgForms(scope.platformOrg)],
  };
}

// ---------------------------------------------------------------------------
// ONE winner per logical key among the rows the caller can READ (Permit-aware duplicate resolution)
// ---------------------------------------------------------------------------
//
// `(organization_id, key)` is unique per STORED string, so one organization can hold a key under several renderings
// of its id (at most one row per rendering). Every consumer that answers "the list for this key" - the listing and
// its `?key=` lookup, the fork lookups, the resolve fork redirect, and shadowing - must pick the SAME row, and that
// row must be one the caller can read: an unreadable private winner must not hide a readable duplicate.
//
//   1. an ACTIVE row over an archived one;
//   2. the row stored under the caller's claim exactly;
//   3. the oldest (`created_at`), then the smallest `id`
//
// applied AMONG THE READABLE CANDIDATES ONLY (`pickWinner`). The decision for a row depends only on that row and its
// duplicates (a handful: one per rendering of the org id, found by `duplicatePartners` with one bounded query), never
// on the page it appears on, so a paged walk shows each effective list exactly once. A Security API failure throws
// (callers fail closed: nothing is shown).

/** How rows are judged readable (the same three modes as the listing). */
export interface ReadableCtx {
  /** The shared-lists flag is ON. */
  shared: boolean;
  /** Admit rows by the shared read (data predicate + `read_shared`) as well as by an instance role. */
  includeShared: boolean;
  platformOrg: string | null;
}

/**
 * Ids of the rows the caller can READ: with the flag ON and `includeShared`, the shared read (data predicate +
 * the memoised `read_shared` decision) OR an instance role (bulk, chunked to the Security API ceiling; a row of
 * another organization can only ever be admitted by the shared read); otherwise instance roles only. With authz
 * not enforced (non-production dev switch) everything passes. Throws on a Security API failure.
 */
export async function readableIds(
  req: Request,
  rows: Array<{ id: string; organization_id: string; visibility?: string | null }>,
  ctx: ReadableCtx,
): Promise<Set<string>> {
  const out = new Set<string>();
  if (rows.length === 0) return out;
  const enforced = await isAuthzEnabled(req);
  if (!enforced) {
    for (const r of rows) out.add(r.id);
    return out;
  }
  const chunked = async <T extends { id: string }>(list: T[]): Promise<T[]> => {
    const kept: T[] = [];
    for (let i = 0; i < list.length; i += BULK_CHECK_MAX) kept.push(...(await filterReadable(req, list.slice(i, i + BULK_CHECK_MAX))));
    return kept;
  };
  if (ctx.shared && ctx.includeShared) {
    const sharedRows = rows.filter((r) => sharedPredicate(r, req.orgId as string, ctx.platformOrg));
    if (sharedRows.length > 0 && (await catalogAllowed(req, 'read_shared'))) for (const r of sharedRows) out.add(r.id);
    const needInstance = rows.filter((r) => !out.has(r.id) && sameOrg(r.organization_id, req.orgId));
    for (const r of await chunked(needInstance)) out.add(r.id);
    return out;
  }
  for (const r of await chunked(rows)) out.add(r.id);
  return out;
}

type Executor = Knex | Knex.Transaction;

/**
 * Every OTHER row that holds one of the `rows`' keys under another rendering of the same organization (any status,
 * any visibility), in ONE bounded query: at most one row per rendering per key, so the result is at most
 * `keys x renderings` rows.
 */
export async function duplicatePartners<T extends DupRow>(
  ex: Executor,
  rows: T[],
  groupFormsOf: (r: T) => string[],
): Promise<DupRow[]> {
  if (rows.length === 0) return [];
  const keys = [...new Set(rows.map((r) => r.key))];
  const forms = [...new Set(rows.flatMap(groupFormsOf))];
  const res = await ex.raw(
    `SELECT id, organization_id, key, status, visibility, created_at FROM selection_lists WHERE key = ANY(?) AND organization_id = ANY(?)`,
    [keys, forms],
  );
  const found = (res as { rows?: DupRow[] }).rows ?? [];
  return found.filter((p) => rows.some((r) => p.id !== r.id && p.key === r.key && sameOrg(p.organization_id, r.organization_id)));
}

/**
 * The effective rows of a page: a row is kept iff the caller can read it AND it is the winner (`pickWinner`) among
 * the readable members of its duplicate group. Flag OFF: not applicable (4.0.0 exact scope; callers do not call this).
 */
export async function readableWinners<T extends DupRow>(
  req: Request,
  pageRows: T[],
  ctx: ReadableCtx,
  ex: Executor = db,
): Promise<T[]> {
  if (pageRows.length === 0) return [];
  const callerOrg = req.orgId as string;
  const claimOf = (r: DupRow): string => (sameOrg(r.organization_id, callerOrg) ? callerOrg : ctx.platformOrg ?? r.organization_id);
  const formsOf = (r: DupRow): string[] =>
    sameOrg(r.organization_id, callerOrg) ? orgRenderings(callerOrg) : ctx.platformOrg ? orgForms(ctx.platformOrg) : orgRenderings(r.organization_id);
  const partners = await duplicatePartners(ex, pageRows, formsOf);
  const universe = new Map<string, DupRow>();
  for (const r of [...pageRows, ...partners]) universe.set(r.id, r);
  const readable = await readableIds(req, [...universe.values()], ctx);
  return pageRows.filter((r) => {
    if (!readable.has(r.id)) return false;
    const group = [...universe.values()].filter((p) => readable.has(p.id) && p.key === r.key && sameOrg(p.organization_id, r.organization_id));
    return pickWinner(group, claimOf(r))?.id === r.id;
  });
}

const BULK_CHECK_MAX = 200;

/**
 * `editable` for each row: `true` when the caller holds a write role on the list (D13: ONE bulk check of
 * `SelectionList:translate`, which every write role holds and `list-viewer` does not). A caller-relative
 * hint, NOT an authorization — every mutation is still authorized on its own. Rows of another organization
 * (a common list read through visibility) are never editable, without a check.
 *
 * Best-effort: if the Security API fails the hint degrades to `false` (read-only UI) instead of failing a
 * read that was already authorized.
 */
export async function editableIds(
  req: Request,
  rows: Array<{ id: string; organization_id: string }>,
): Promise<Set<string>> {
  const own = rows.filter((r) => sameOrg(r.organization_id, req.orgId));
  if (own.length === 0) return new Set();
  if (!(await isAuthzEnabled(req))) return new Set(own.map((r) => r.id)); // dev pass-through: everything is allowed
  const token = bearer(req);
  if (!token || !req.userId || !req.orgId) return new Set();
  const out = new Set<string>();
  try {
    for (let i = 0; i < own.length; i += BULK_CHECK_MAX) {
      const chunk = own.slice(i, i + BULK_CHECK_MAX);
      const decisions = await getAuthzClient().bulkCheck(
        chunk.map((r) => ({
          subject: req.userId as string,
          tenant: req.orgId as string,
          resource: { type: SELECTION_LIST_RESOURCE, key: r.id },
          action: 'translate',
        })),
        token,
      );
      chunk.forEach((r, j) => {
        if (decisions[j]?.allow === true) out.add(r.id);
      });
    }
  } catch (err) {
    getLog(req).warn({ err }, 'editable hint: bulk translate check failed — reporting editable=false');
    return new Set();
  }
  return out;
}
