// middleware/listAccess.ts — authorization for per-list routes once lists can be SHARED (4.1.0).
//
// Design record: docs/planning/selection-lists-shared-and-fork.md sections 2 (D3-D5, D7, D10), 4, 6.
//
// Each guard here wraps the 4.0.0 guard of the same action (`requireAuthzCheck('SelectionList', action)`)
// and DELEGATES to it unchanged
//   - while the release flag `fuzefront.selection-lists.shared-lists` is OFF (the 4.0.0 behaviour, exactly,
//     including the Security API calls it makes), and
//   - for every list owned by the caller's own organization that is not read through visibility.
// The flag only chooses between "4.0.0" and "4.0.0 plus the rules below"; it is never an authorization
// decision. Every allow below still needs a Permit (Security API) decision.
//
// READ (`requireListRead`) — `readable(L, C)`:
//     Permit grants `SelectionList:read` on the instance (an instance role: today's path), OR
//     L is not private AND the data predicate holds (`org`: L belongs to the caller's org; `platform`: L is
//     owned by the platform org) AND Permit grants `SelectionListCatalog:read_shared` in the caller's tenant.
//   The data predicate is evaluated first; the catalog decision is made at most once per request
//   (memoised). A list of another organization that is not a readable common list is a 404, as before.
//
// MUTATION (`requireListMutation`) — a common (`platform`) list owned by ANOTHER organization is readable
//   but never writable by the caller (instance roles exist only in the owning tenant). So:
//     unreadable            -> 404 (unchanged)
//     readable + create     -> 409 CONFLICT, reason fork_required, fork_url, source_list_id   (D7)
//     readable, no create   -> 403 FORBIDDEN
//   Access-management routes are not forkable: always 403.
//
// PLATFORM-ONLY ACTS (`publish_platform`): evaluated in the PLATFORM organization's tenant — the service
//   requires the caller to be acting in the platform org (token org = platform org) and asks
//   `SelectionListCatalog:publish_platform` in that tenant (D5). A customer-org admin holds the action in
//   its own tenant and still cannot publish.
//
// Every guard FAILS CLOSED: any error talking to the Security API or the database answers 403.

import { NextFunction, Request, RequestHandler, Response } from 'express';
import { db } from '../db';
import { getLog, timed } from '../lib/logger';
import { callerInPlatformOrg, memoPerRequest, platformWritesSuspended, platformWritesSuspendedFor, resolvePlatformOrgId, sameOrg, sharedListsOn, sharedPredicate } from '../lib/sharedLists';
import {
  bearer,
  getAuthzClient,
  isAuthzEnabled,
  requireAuthzCheck,
  SELECTION_LIST_CATALOG_RESOURCE,
  SELECTION_LIST_RESOURCE,
} from './authz';

export interface ListAccessRow {
  id: string;
  organization_id: string;
  visibility: string | null;
  status?: string;
}

/**
 * The list row by id, ANY organization. Only ever used to decide which of 404 / 403 / 409 to answer — never
 * returned to the caller. Boundary-logged (start/end/elapsed) like the other pre-checks.
 */
export async function lookupList(req: Request, listId: string): Promise<ListAccessRow | undefined> {
  const row = await timed(
    getLog(req),
    'db.selection_lists.lookup',
    () => db('selection_lists').where({ id: listId }).first('id', 'organization_id', 'visibility', 'status'),
    { listId },
  );
  return row as ListAccessRow | undefined;
}

export type CatalogAction = 'read_shared' | 'create' | 'publish_platform';

/**
 * One catalog decision for the caller in the caller's own tenant, memoised per request. With authz not
 * enforced (non-production dev switch, see authz.flags.ts) it is a pass-through, exactly like
 * `requireAuthzCheck`. Throws on a Security API failure (callers fail closed).
 */
export function catalogAllowed(req: Request, action: CatalogAction): Promise<boolean> {
  return memoPerRequest(req, `catalog:${action}`, async () => {
    if (!(await isAuthzEnabled(req))) return true;
    const token = bearer(req);
    if (!token || !req.userId || !req.orgId) return false;
    const decision = await getAuthzClient().check(
      {
        subject: req.userId,
        tenant: req.orgId,
        resource: { type: SELECTION_LIST_CATALOG_RESOURCE },
        action,
      },
      token,
    );
    return decision.allow === true;
  });
}

/**
 * May the caller publish common lists? They must be acting in the platform organization AND hold
 * `SelectionListCatalog:publish_platform` in that tenant (the caller's tenant IS the platform org then).
 */
export async function mayPublishPlatform(req: Request): Promise<boolean> {
  if (!(await callerInPlatformOrg(req))) return false;
  // A suspended platform org (deactivation / deletion recorded) publishes nothing, whatever Permit still says:
  // forwarded decisions and already minted 15-minute org-session tokens do not re-check the org's activity.
  if (await platformWritesSuspendedFor(req)) {
    getLog(req).warn({ userId: req.userId, orgId: req.orgId }, 'publish_platform refused: the platform organization is SUSPENDED (deactivation recorded)');
    return false;
  }
  return catalogAllowed(req, 'publish_platform');
}

/**
 * `readable(L, C)` for a list row already loaded (design record section 6): an instance role
 * (`SelectionList:read`, only possible in the owning tenant) OR the shared read (data predicate first, then
 * the memoised `read_shared` decision). Throws on a Security API failure (callers fail closed). With authz
 * not enforced (non-production dev switch) it is the data scope alone: the caller's own organization's lists
 * and the common lists.
 */
export async function canRead(req: Request, row: ListAccessRow): Promise<boolean> {
  const { userId, orgId } = req;
  if (!userId || !orgId) return false;
  const platformOrg = row.visibility === 'platform' ? await resolvePlatformOrgId() : null;
  const viaVisibility = sharedPredicate(row, orgId, platformOrg);
  if (!(await isAuthzEnabled(req))) return sameOrg(row.organization_id, orgId) || viaVisibility;
  const token = bearer(req);
  if (!token) return false;
  if (viaVisibility && (await catalogAllowed(req, 'read_shared'))) return true;
  if (!sameOrg(row.organization_id, orgId)) return false;
  const decision = await getAuthzClient().check(
    { subject: userId, tenant: orgId, resource: { type: SELECTION_LIST_RESOURCE, key: row.id }, action: 'read' },
    token,
  );
  if (!decision.allow) getLog(req).info({ userId, orgId, listId: row.id, allow: false }, 'authz decision: read denied');
  return decision.allow === true;
}

function failClosed(req: Request, res: Response, err: unknown, ctx: Record<string, unknown>): void {
  getLog(req).error({ err, userId: req.userId, orgId: req.orgId, ...ctx }, 'shared-list authorization check threw — failing closed');
  res.status(403).json({ code: 'FORBIDDEN', message: 'Authorization service unavailable.' });
}

const notFound = (res: Response) => res.status(404).json({ code: 'NOT_FOUND', message: 'Not found.' });

// ---------------------------------------------------------------------------
// READ
// ---------------------------------------------------------------------------

/** Replaces `requireAuthzCheck('SelectionList', 'read')` on the shared-readable operations. */
export function requireListRead(): RequestHandler {
  const legacy = requireAuthzCheck(SELECTION_LIST_RESOURCE, 'read');
  return async function listReadMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!(await sharedListsOn(req))) return legacy(req, res, next);
    const { userId, orgId } = req;
    const token = bearer(req);
    // Identity gaps, dev pass-through (authz not enforced) and the like: the 4.0.0 guard owns those answers.
    if (!userId || !orgId || !token || !(await isAuthzEnabled(req))) return legacy(req, res, next);

    const listId = req.params['listId'];
    try {
      const row = await lookupList(req, listId);
      // Unknown, unreadable and another organization's private list are one and the same answer: 404.
      if (!row || !(await canRead(req, row))) return void notFound(res);
      next();
    } catch (err) {
      failClosed(req, res, err, { listId, op: 'read' });
    }
  };
}

// ---------------------------------------------------------------------------
// MUTATION
// ---------------------------------------------------------------------------

export interface MutationOptions {
  /** `false` for access management: a readable common list answers 403, never `fork_required`. */
  forkable?: boolean;
}

/** Replaces `requireAuthzCheck('SelectionList', action)` on every per-list mutation. */
export function requireListMutation(action: string, opts: MutationOptions = {}): RequestHandler {
  const legacy = requireAuthzCheck(SELECTION_LIST_RESOURCE, action);
  const forkable = opts.forkable !== false;
  return async function listMutationMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!(await sharedListsOn(req))) return legacy(req, res, next);
    const { userId, orgId } = req;
    if (!userId || !orgId || !bearer(req) || !(await isAuthzEnabled(req))) return legacy(req, res, next);

    const listId = req.params['listId'];
    try {
      const row = await lookupList(req, listId);
      // The platform organization is SUSPENDED (a deactivation / deletion was recorded): its common lists stay
      // readable by every tenant, but nobody changes them. Only a caller acting in the owning (platform) org gets
      // here as a writer; other tenants keep their usual fork_required / 403 / 404.
      if (row && row.visibility === 'platform' && sameOrg(row.organization_id, orgId) && (await platformWritesSuspendedFor(req))) {
        getLog(req).warn({ listId, op: action, userId, orgId }, 'mutation of a common list refused: the platform organization is SUSPENDED');
        res.status(403).json({ code: 'FORBIDDEN', reason: 'platform_suspended', message: 'The platform organization is suspended; common lists are read-only until it is reactivated.' });
        return;
      }
      // Unknown id, or one of the caller's own org: the 4.0.0 guard answers (its own org-scoped pre-check
      // gives the 404 / the instance decision).
      if (!row || sameOrg(row.organization_id, orgId)) return legacy(req, res, next);

      // Another organization's list. Only a readable common list is distinguishable from "no such list".
      const platformOrg = row.visibility === 'platform' ? await resolvePlatformOrgId() : null;
      const readable = sharedPredicate(row, orgId, platformOrg) && (await catalogAllowed(req, 'read_shared'));
      if (!readable) return void notFound(res);

      if (forkable && (await catalogAllowed(req, 'create'))) {
        getLog(req).info({ listId, op: action }, 'mutation of a common list — fork required (409)');
        res.status(409).json({
          code: 'CONFLICT',
          message: 'This is a common list; fork it to change it.',
          reason: 'fork_required',
          source_list_id: listId,
          fork_url: `/v1/selection-lists/${listId}/fork`,
        });
        return;
      }
      getLog(req).info({ listId, op: action, forkable }, 'mutation of a common list — 403');
      res.status(403).json({ code: 'FORBIDDEN', message: 'Permission denied.' });
    } catch (err) {
      failClosed(req, res, err, { listId, op: action });
    }
  };
}

// ---------------------------------------------------------------------------
// Extra, flag-gated checks stacked after the base guard (they can only tighten)
// ---------------------------------------------------------------------------

/** `manage_access` on the instance — only when the request carries `visibility` AND the flag is ON. */
export function requireManageAccessWhenVisibilityGiven(): RequestHandler {
  const check = requireAuthzCheck(SELECTION_LIST_RESOURCE, 'manage_access');
  return async function visibilityManageAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (req.body?.visibility === undefined || !(await sharedListsOn(req))) return next();
    return check(req, res, next);
  };
}

/**
 * `publish_platform` in the platform tenant — when the body publishes (`visibility: "platform"`) and the
 * flag is ON. 403 for a caller outside the platform org or without the action.
 */
export function requirePublishWhenBodyIsPlatform(): RequestHandler {
  return async function publishOnPlatformBody(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (req.body?.visibility !== 'platform' || !(await sharedListsOn(req))) return next();
    try {
      if (await mayPublishPlatform(req)) return next();
      getLog(req).info({ userId: req.userId, orgId: req.orgId }, 'publish to platform denied (not a platform operator)');
      res.status(403).json({ code: 'FORBIDDEN', message: 'Only a platform operator may publish a common list.' });
    } catch (err) {
      failClosed(req, res, err, { op: 'publish_platform' });
    }
  };
}

/**
 * `publish_platform` for the IRREVERSIBLE acts on a common list (purge of the list, or of one of its items):
 * it turns stored ids in every tenant into `missing`. Applies only when the target list is a `platform` list
 * (whatever the release flag says: a `platform` row cannot exist under 4.0.0, so there is nothing for the flag to
 * protect, and a guard that vanished with the flag would be a bypass if the flag is turned OFF after use);
 * `when` narrows it (e.g. to `?purge=true`).
 */
export function requirePublishForPlatformList(when: (req: Request) => boolean): RequestHandler {
  return async function publishOnPlatformPurge(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!when(req)) return next();
    let row: ListAccessRow | undefined;
    try {
      row = await lookupList(req, req.params['listId']);
    } catch (err) {
      return next(err); // a database fault is a contract 500 (nothing proceeds), not an authorization answer
    }
    try {
      if (!row || row.visibility !== 'platform') return next();
      if (await mayPublishPlatform(req)) return next();
      getLog(req).info({ userId: req.userId, orgId: req.orgId, listId: row.id }, 'purge of a common list denied (needs publish_platform)');
      res.status(403).json({ code: 'FORBIDDEN', message: 'Purging a common list requires platform-operator permission.' });
    } catch (err) {
      failClosed(req, res, err, { op: 'publish_platform' });
    }
  };
}

/**
 * Raised inside a purge transaction when the LOCKED list turned out to be a common list the caller may not
 * purge (see `assertMayPurgeLocked`). Routes map it to the same 403 the pre-transaction guard answers.
 */
export class PlatformPurgeDenied extends Error {
  constructor() {
    super('Purging a common list requires platform-operator permission.');
    this.name = 'PlatformPurgeDenied';
  }
}

export const PLATFORM_PURGE_DENIED_BODY = {
  code: 'FORBIDDEN',
  message: 'Purging a common list requires platform-operator permission.',
} as const;

/**
 * TIME-OF-CHECK / TIME-OF-USE guard for the irreversible purge (list or item). `requirePublishForPlatformList`
 * decides from a read taken BEFORE the transaction; a concurrent promotion to `platform` (which holds the same
 * org outbox lock) can land between that read and the purge taking the lock. Call this INSIDE the purge
 * transaction, AFTER the org lock is held and the row is locked, with the `visibility` read under that lock:
 * if the list is `platform` now, the caller must hold `publish_platform` (evaluated now if the earlier guard
 * had not needed it - it is memoised per request otherwise). Independent of the release flag, like the guard
 * it backs. A Security API failure fails closed (denied).
 */
export async function assertMayPurgeLocked(
  req: Request,
  lockedVisibility: string | null | undefined,
  executor?: Parameters<typeof platformWritesSuspended>[0],
): Promise<void> {
  if (lockedVisibility !== 'platform') return;
  let allowed = false;
  try {
    // fresh inside the purge transaction: a suspension recorded after the request's first look still stops the purge
    allowed = (await mayPublishPlatform(req)) && !(await platformWritesSuspended(executor));
  } catch (err) {
    getLog(req).error({ err, userId: req.userId, orgId: req.orgId }, 'purge re-check of a common list threw - failing closed');
  }
  if (!allowed) {
    getLog(req).info({ userId: req.userId, orgId: req.orgId }, 'purge of a list promoted to common mid-request denied (needs publish_platform)');
    throw new PlatformPurgeDenied();
  }
}
