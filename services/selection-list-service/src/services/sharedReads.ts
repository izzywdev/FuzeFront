// services/sharedReads.ts — the READ-side data scope for shared lists (design record section 6) and the
// `editable` hint (D13).
//
// "Org scoping" for reads becomes `organization_id = X OR (visibility = 'platform' AND owned by the platform
// org)`; for WRITES it stays `organization_id = X` (callers never use this for writes). The Permit half of
// readability is enforced by the route guards (middleware/listAccess.ts) BEFORE a handler runs; the SQL scope
// here only decides which rows the handler may even look at, so a cross-org row is never reachable by id.
//
// With the release flag OFF (or the platform organization unresolved) the scope is the 4.0.0 one,
// byte for byte: `organization_id = ?`.

import type { Request } from 'express';
import { getLog } from '../lib/logger';
import { orgForms, resolvePlatformOrgId, sharedListsOn } from '../lib/sharedLists';
import {
  bearer,
  getAuthzClient,
  isAuthzEnabled,
  SELECTION_LIST_RESOURCE,
} from '../middleware/authz';

export interface ReadScope {
  /** The shared-lists flag is ON for this request. */
  shared: boolean;
  /** Wire id of the platform organization when it resolves, else null (platform features fail closed). */
  platformOrg: string | null;
}

export async function getReadScope(req: Pick<Request, 'orgId' | 'userId'>): Promise<ReadScope> {
  const shared = await sharedListsOn(req);
  return { shared, platformOrg: shared ? await resolvePlatformOrgId() : null };
}

/** SQL predicate (+ positional params) for "rows the caller's organization may READ", on `alias` (or no alias). */
export function readableByOrg(alias: string, orgId: string, scope: ReadScope): { sql: string; params: Array<string | string[]> } {
  const p = alias ? `${alias}.` : '';
  if (!scope.shared || !scope.platformOrg) return { sql: `${p}organization_id = ?`, params: [orgId] };
  return {
    sql: `(${p}organization_id = ? OR (${p}visibility = 'platform' AND ${p}organization_id = ANY(?)))`,
    params: [orgId, orgForms(scope.platformOrg)],
  };
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
  const own = rows.filter((r) => r.organization_id === req.orgId);
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
