// access.ts — per-list ReBAC access grant management (S7, FFRNT-190).
//
// Endpoints (openapi `access` tag; every one requires `manage_access`):
//   GET    /:listId/access           List all grants (cursor-paginated)
//   PUT    /:listId/access/:userId   Grant or change a user's role (upsert, roles do not stack)
//   DELETE /:listId/access/:userId   Revoke a user's access (idempotent)
//
// The selection_list_access table is a READ-MODEL MIRROR of the authorization
// backend's state (FuzeFront's Security API, via @fuzefront/auth's
// AuthzClient — see middleware/authz.ts). It is NEVER consulted for
// authorization decisions — only for:
//   a) returning the grant roster on GET
//   b) the CANDIDATE list for the last-owner guard. The guard itself is decided
//      by the authority (review M-2): at least one OTHER mirror owner must be
//      confirmed by the Security API (`manage_access` on the instance) before an
//      owner may be demoted or removed — see services/authority.ts.
//
// Wire shape: snake_case, exactly `SelectionListAccessGrant` in the openapi
// (list_id, user_id, role, granted_by, granted_at, updated_at). Errors use the
// contract's codes: 400 VALIDATION_ERROR, 404 NOT_FOUND, 409 CONFLICT.
//
// Who authenticates what. Decisions about the CALLER (and the membership probe
// on the target user) use the end user's bearer token. Grant/revoke WRITES use
// the caller's credential and exact instance manage_access authorization.
// Security repeats the exact-instance policy check on each write; the read
// mirror is never used to authorize a grant.
//
// Write ordering (a thrown Security API call must never leave the mirror
// claiming a change that did not happen): every handler runs inside ONE
// transaction that takes a row lock on the list's access rows, performs the
// Security API write(s) first, and only then writes the mirror. A failure at
// any point rolls the mirror back; the lock also makes the last-owner guard
// race-free (two concurrent demotions of a 2-owner list cannot both pass it).
//
// Compensation (review M-2): the Security API write is NOT part of the database
// transaction, so rolling the mirror back does not undo it. When a handler fails
// after it attempted a revoke/grant, the route restores the authority to the
// user's prior role (services/authority.ts restoreAuthority) before answering
// 500 — otherwise a failed role change leaves the user with NO role in the
// authority while the mirror still says they hold the old one. Compensation is
// best-effort and idempotent; if it too fails it is logged at ERROR and counted
// (selection_list_authz_compensation_total{outcome="failed"}), and the guard,
// which asks the authority, still refuses to treat the stale mirror row as an
// owner.
//
// One LOGICAL grant per user (grant groups). The same user can hold mirror rows under BOTH renderings of its id
// (bare UUID and `usr_...`) on a list that predates the rendering-aware code (the (list_id, user_id) key is exact).
// All live rows of the user are ONE grant group:
//   - the SURVIVOR is deterministic: the row stored under the Permit key form (the bare UUID the Security API is
//     sent) first, then the oldest `granted_at`, then the smallest `user_id` (the list winner rule: exact key, oldest,
//     smallest id);
//   - DELETE revokes EVERY row's authority grant (each with the subject and tenant it was recorded under) and
//     soft-revokes every row; PUT converges the group to exactly one live row with the new role (every other role
//     held in the group is revoked first, the other rows are soft-revoked, the survivor is upserted) - all under the
//     one compensation scheme below, which re-grants every role the request revoked;
//   - GET lists the user once (its survivor); the last-owner guard treats the group as an owner when ANY row is one.
//
// Pagination (GET):
//   - Default limit: 50; max: 200 (clamped server-side).
//   - Cursor: opaque base64url encoding of the last user_id in the page.
//   - Deterministic order: user_id ASC (stable under concurrent writes).

import type { Knex } from 'knex';
import { Request, Response } from 'express';
import { createRouter } from '../lib/http';
import { parseLimitParam, registerIdParams } from '../middleware/validateInput';
import { getLog } from '../lib/logger';
import { db } from '../db';
import { getAuthzClient, bearer } from '../middleware/authz';
import { assertPlatformWritable, replyPlatformSuspended, requireListMutation } from '../middleware/listAccess';
import { canonicalUserId, userRenderings, userScope, writeOrgs } from '../lib/sharedLists';
import { PermitKeyError, permitSubjectKey, permitTenantKey } from '../lib/permitKeys';
import { authMiddleware } from '../middleware/auth';
import { lockOrgOutbox } from '../events/outbox';
import { eventContextFromRequest, emitAccessGranted, emitAccessRevoked } from '../events/emitters';
import {
  hasConfirmedOtherOwner,
  restoreAuthority,
  type AuthorityWrites,
} from '../services/authority';

const router = createRouter();
registerIdParams(router);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const VALID_ROLES = new Set([
  'list-owner',
  'list-editor',
  'list-contributor',
  'list-translator',
  'list-viewer',
]);

/** References carry their type: a user id is `usr_…` (governance/identifier-standard.md §2). */
const USER_ID_PREFIX = 'usr_';

// ---------------------------------------------------------------------------
// Cursor helpers (opaque base64url of user_id)
// ---------------------------------------------------------------------------

function encodeCursor(userId: string): string {
  return Buffer.from(userId, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): string {
  return Buffer.from(cursor, 'base64url').toString('utf8');
}

// ---------------------------------------------------------------------------
// Row -> wire
// ---------------------------------------------------------------------------

interface AccessRow {
  list_id: string;
  user_id: string;
  role: string;
  granted_by: string;
  granted_at: Date | string;
  updated_at: Date | string;
}

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

/**
 * The mirror records the key the Security API was sent (the bare UUID, see lib/permitKeys.ts), but the contract
 * names users by their `usr_...` TypeID: render both user fields in the wire form (legacy rows already holding a
 * TypeID, and `system:*` principals, are left as they are).
 */
function formatGrant(r: AccessRow) {
  const wire = (id: string): string => canonicalUserId(id) ?? id;
  return {
    list_id: r.list_id,
    user_id: wire(r.user_id),
    role: r.role,
    granted_by: wire(r.granted_by),
    granted_at: iso(r.granted_at),
    updated_at: iso(r.updated_at),
  };
}

/** True iff the list exists in the caller's organization (org-scoped, never cross-org). */
async function listExistsInOrg(listId: string, orgId: string, orgs: string[] | null): Promise<boolean> {
  const row = orgs
    ? await db('selection_lists').where({ id: listId }).whereIn('organization_id', orgs).first('id')
    : await db('selection_lists').where({ id: listId, organization_id: orgId }).first('id');
  return Boolean(row);
}

// ---------------------------------------------------------------------------
// GET /:listId/access  — list grants (cursor-paginated)
// ---------------------------------------------------------------------------

router.get(
  '/:listId/access',
  authMiddleware,
  requireListMutation('manage_access', { forkable: false, readOnly: true }),
  async (req: Request, res: Response): Promise<void> => {
    const { listId } = req.params;
    const orgId = req.orgId as string;

    // --- Pagination params ---
    const limit = parseLimitParam(req, res, DEFAULT_LIMIT, MAX_LIMIT);
    if (limit === undefined) return;
    const cursorParam = req.query['cursor'] as string | undefined;
    const afterUserId = cursorParam ? decodeCursor(cursorParam) : undefined;

    try {
      if (!(await listExistsInOrg(listId, orgId, await writeOrgs(req)))) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Selection list not found.' });
        return;
      }

      // Fetch one extra row to determine hasMore.
      // Chain order: select → where → whereNull → orderBy → (cursor where) → limit
      // limit() is always last so it can serve as the query execution trigger in tests.
      let query = db('selection_list_access')
        .select('list_id', 'user_id', 'role', 'granted_by', 'granted_at', 'updated_at')
        .where({ list_id: listId })
        .whereNull('revoked_at')
        .orderBy('user_id', 'asc');

      if (afterUserId) {
        query = query.where('user_id', '>', afterUserId);
      }

      const rows = await query.limit(limit + 1);
      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;

      // One entry per LOGICAL user: a user stored under both renderings of its id (pre-upgrade rows) is listed once,
      // at the position of its survivor (see the grant-group rule in the header); the other row is skipped here and
      // the cursor still follows the raw order, so the walk stays gap- and duplicate-free.
      const partnerIds = [...new Set(pageRows.flatMap((r) => userRenderings(r['user_id'] as string).filter((f) => f !== r['user_id'])))];
      const partners = partnerIds.length
        ? ((await db('selection_list_access')
            .where({ list_id: listId })
            .whereNull('revoked_at')
            .whereIn('user_id', partnerIds)
            .select('user_id', 'granted_at')) as Array<{ user_id: string; granted_at: Date | string | null }>)
        : [];
      const items = pageRows.filter((r) => {
        const mine = userRenderings(r['user_id'] as string);
        const group = [r as { user_id: string; granted_at: Date | string | null }, ...partners.filter((p) => mine.includes(p.user_id))];
        return group.length === 1 || rankGroup(group)[0].user_id === r['user_id'];
      });

      const nextCursor =
        hasMore && pageRows.length > 0
          ? encodeCursor(pageRows[pageRows.length - 1]['user_id'])
          : null;

      res.status(200).json({
        items: items.map((r) => formatGrant(r as AccessRow)),
        page: {
          nextCursor,
          hasMore,
        },
      });
    } catch (err) {
      getLog(req).error(
      { err, op: 'access.GET DB error', userId: req.userId, orgId: req.orgId, params: req.params },
      'access.GET DB error failed',
    );
      res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Failed to list access grants.' });
    }
  },
);

// ---------------------------------------------------------------------------
// PUT /:listId/access/:userId  — grant or change a role
// ---------------------------------------------------------------------------

interface GroupRow {
  role: string;
  org_id: string | null;
  user_id: string;
  granted_at: Date | string | null;
}

/** Is `id` the Permit key form of a user (what the Security API is sent: the bare UUID)? */
function isPermitKeyForm(id: string): boolean {
  try {
    return permitSubjectKey(id) === id;
  } catch {
    return false;
  }
}

/**
 * Deterministic order of the rows of ONE logical grant (first = the survivor): the row stored under the Permit key
 * form, then the oldest `granted_at`, then the smallest `user_id`. The same winner rule as the lists (exact key form,
 * oldest, smallest id), so every reader and writer picks the same row.
 */
function rankGroup<T extends { user_id: string; granted_at?: Date | string | null }>(rows: T[]): T[] {
  const at = (v: Date | string | null | undefined): number => (v ? new Date(v).getTime() : 0);
  return [...rows].sort(
    (a, b) =>
      Number(isPermitKeyForm(b.user_id)) - Number(isPermitKeyForm(a.user_id)) ||
      at(a.granted_at) - at(b.granted_at) ||
      (a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0),
  );
}

/**
 * The LIVE grant group of a user on a list, found under any of `userForms` (one entry = the exact 4.0.0 lookup),
 * survivor first. Empty = no live grant.
 */
async function grantGroup(trx: Knex.Transaction, listId: string, userForms: string[]): Promise<GroupRow[]> {
  const q =
    userForms.length === 1
      ? trx('selection_list_access').where({ list_id: listId, user_id: userForms[0] })
      : trx('selection_list_access').where({ list_id: listId }).whereIn('user_id', userForms);
  const rows = (await q.whereNull('revoked_at').select('role', 'org_id', 'user_id', 'granted_at')) as GroupRow[];
  return rankGroup(rows.map((r) => ({ ...r }))); // copies: a later write must not change what this read saw
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: { code: string; message: string },
  ) {
    super(body.message);
  }
}

router.put(
  '/:listId/access/:userId',
  authMiddleware,
  requireListMutation('manage_access', { forkable: false }),
  async (req: Request, res: Response): Promise<void> => {
    const { listId, userId } = req.params;
    const orgId = req.orgId as string;
    const actorId = req.userId as string;

    // --- Validate inputs (additionalProperties: false; role is the only field) ---
    if (!userId.startsWith(USER_ID_PREFIX) || userId.length <= USER_ID_PREFIX.length) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: `userId must be a '${USER_ID_PREFIX}'-prefixed user id.`,
      });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const unknownProps = Object.keys(body).filter((k) => k !== 'role');
    if (unknownProps.length > 0) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: `Unknown properties: ${unknownProps.join(', ')}`,
      });
      return;
    }
    const role = body['role'];
    if (typeof role !== 'string' || !VALID_ROLES.has(role)) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: `role must be one of: ${[...VALID_ROLES].join(', ')}.`,
      });
      return;
    }

    const token = bearer(req);
    if (!token) {
      res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Missing bearer token.' });
      return;
    }

    // Authority-write bookkeeping for compensation (see header).
    const writes: AuthorityWrites = { revokeAttempted: false, grantAttempted: false };
    let prior: string | null = null;
    // Every role the request revoked in the authority (before the call, so a possibly-applied revoke is restored).
    const revokedRoles: Array<{ subject: string; tenant: string; role: string }> = [];
    // The tenant this user's grant on this list lives in: where an existing grant was made (the mirror's org_id),
    // else the caller's. Role changes revoke/re-grant/compensate THERE, so a grant is never split across two
    // renderings of the org id.
    let grantTenant = orgId;
    // The target user as the mirror / Security API know them. The path carries the `usr_` TypeID, but a grant made
    // through a bare-UUID token is stored (and was sent to the Security API) under the UUID: with shared lists ON an
    // existing grant is found under any rendering and every later write for it uses ITS subject, so a user is
    // never split into two grants, and the last-owner guard never counts the target as "another owner".
    let subject = userId;
    const userForms = await userScope(req, userId);

    try {
      // A NEW grant is keyed (and recorded in the mirror) by the key the Security API is sent: the bare UUID.
      subject = permitSubjectKey(userId);
      if (!(await listExistsInOrg(listId, orgId, await writeOrgs(req)))) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Selection list not found.' });
        return;
      }

      // The target must already belong to the list's organization. Asked of the
      // Security API (the membership authority — this service holds no
      // membership state): a member can `read` their own Organization. Fail
      // CLOSED: a thrown AuthzError -> 500 below, never "assume member".
      const member = await getAuthzClient().check(
        { subject: userId, tenant: orgId, resource: { type: 'Organization' }, action: 'read' },
        token,
      );
      if (!member.allow) {
        res.status(400).json({
          code: 'VALIDATION_ERROR',
          message: 'The user is not a member of this list\'s organization.',
        });
        return;
      }

      // Authenticate the exact list manager at the Security API; do not impersonate a broad grant administrator.
      const callerToken = token;

      const row = await db.transaction(async (trx) => {
        // Lock order is ALWAYS org outbox lock first (events/outbox.ts): a list
        // purge in the same org deletes these access rows while holding it.
        await lockOrgOutbox(trx, orgId);
        // The list's OWNER re-checked for suspension FRESH, under the lock a deactivation also takes. Nothing has been
        // written (mirror or Security API) yet, so the refusal needs no compensation.
        await assertPlatformWritable(trx, listId);
        // Serialise every access mutation on this list (guard + writes).
        await trx('selection_list_access').where({ list_id: listId }).forUpdate().select('user_id');

        // The user's grant GROUP (every live row under any rendering of the id), survivor first.
        const group = await grantGroup(trx, listId, userForms);
        const existing = group[0];

        prior = existing ? existing.role : null;
        if (existing?.org_id) grantTenant = existing.org_id;
        if (existing?.user_id) subject = existing.user_id;
        else {
          // No live grant: a previously REVOKED row of this user (under any rendering) is re-activated in place,
          // rather than leaving a second row for the same user next to it. Deterministic when there are several
          // (the survivor rule), never an arbitrary `first()`.
          const revokedRows = (await trx('selection_list_access')
            .where({ list_id: listId })
            .whereIn('user_id', userForms)
            .select('user_id', 'granted_at')) as Array<{ user_id: string; granted_at: Date | string | null }>;
          if (revokedRows.length > 0) subject = rankGroup(revokedRows)[0].user_id;
        }

        // EVERY Permit key this operation will use (the grant's tenant and subject - and those of every other row of
        // the group - possibly a LEGACY mirror row's org_id / user_id) is validated and computed HERE, before any
        // Security API call: a malformed key fails with nothing written, never after revoke/grant landed (which
        // would split the authority from the mirror).
        const mirrorTenantKey = permitTenantKey(grantTenant);
        permitSubjectKey(subject);
        for (const g of group) {
          permitTenantKey(g.org_id ?? orgId);
          permitSubjectKey(g.user_id);
        }

        // Last-owner guard: demoting the only list-owner is refused (ANY row of the group being an owner makes the
        // user an owner). Decided by the AUTHORITY (review M-2): another mirror owner must be confirmed by the
        // Security API, not merely counted.
        const wasOwner = group.some((g) => g.role === 'list-owner');
        if (wasOwner && role !== 'list-owner') {
          const otherOwner = await hasConfirmedOtherOwner({
            executor: trx,
            listId,
            orgId,
            excludeUserIds: userForms,
            token,
            log: getLog(req),
          });
          if (!otherOwner) {
            throw new HttpError(409, {
              code: 'CONFLICT',
              message: 'Cannot demote the last list-owner of a list.',
            });
          }
        }

        const assignment = {
          subject,
          tenant: grantTenant,
          role,
          resource: { type: 'SelectionList', key: listId },
        };
        // An owner demoting themselves must retain manage_access until the
        // final revoke. The replacement is strictly weaker than list-owner;
        // a failed revoke retains existing authority rather than adding any.
        const selfDemotion = userForms.includes(actorId) && wasOwner && role !== 'list-owner';
        if (selfDemotion) {
          writes.grantAttempted = true;
          await getAuthzClient().grant(assignment, callerToken);
        }

        // Other role changes revoke first, leaving less access on failure. EVERY distinct role of the group other
        // than the new one is revoked (each with the subject / tenant it was recorded under), so the user ends with
        // exactly the new role.
        const seenRoles = new Set<string>();
        for (const g of group) {
          if (g.role === role || seenRoles.has(g.role)) continue;
          seenRoles.add(g.role);
          const entry = { subject: g.user_id, tenant: g.org_id ?? orgId, role: g.role };
          revokedRoles.push(entry);
          writes.revokeAttempted = true;
          await getAuthzClient().revoke({ ...entry, resource: { type: 'SelectionList', key: listId } }, callerToken);
        }

        // Assign role via the Security API (source of truth for authz).
        // resource is REQUIRED: it scopes this grant to this one list rather
        // than tenant-wide. grant() THROWS on a Security API failure, which
        // rolls this transaction back before the mirror is touched.
        if (!selfDemotion) {
          writes.grantAttempted = true;
          await getAuthzClient().grant(assignment, callerToken);
        }

        // Mirror upsert. A previously revoked row is a NEW grant (granted_at
        // restarts); a live row keeps its original granted_at (the contract:
        // "when the grant was first created").
        await trx.raw(
          `
          INSERT INTO selection_list_access
            (list_id, user_id, role, granted_by, org_id, granted_at, updated_at, revoked_at)
          VALUES (?, ?, ?, ?, ?, now(), now(), NULL)
          ON CONFLICT (list_id, user_id) DO UPDATE SET
            role       = EXCLUDED.role,
            granted_by = EXCLUDED.granted_by,
            org_id     = EXCLUDED.org_id,
            granted_at = CASE WHEN selection_list_access.revoked_at IS NOT NULL
                              THEN now() ELSE selection_list_access.granted_at END,
            updated_at = now(),
            revoked_at = NULL
          `,
          [listId, subject, role, actorId, mirrorTenantKey],
        );
        // Converge to ONE live row: the group's other rows are soft-revoked (their authority roles were revoked above).
        const duplicates = group.slice(1).map((g) => g.user_id).filter((u) => u !== subject);
        if (duplicates.length > 0) {
          await trx('selection_list_access')
            .where({ list_id: listId })
            .whereIn('user_id', duplicates)
            .whereNull('revoked_at')
            .update({ revoked_at: trx.fn.now(), updated_at: trx.fn.now() });
        }

        // Outbox, same transaction: access.granted (previousRole null for a new
        // grant). A repeat PUT of the role the user already holds changes nothing,
        // so it announces nothing.
        if (!existing || group.some((g) => g.role !== role)) {
          await emitAccessGranted(trx, eventContextFromRequest(req), listId, {
            userId,
            role,
            previousRole: existing ? existing.role : null,
          });
        }

        return (await trx('selection_list_access')
          .where({ list_id: listId, user_id: subject })
          .first('list_id', 'user_id', 'role', 'granted_by', 'granted_at', 'updated_at')) as AccessRow;
      });

      res.status(200).json(formatGrant(row));
    } catch (err) {
      if (replyPlatformSuspended(err, res)) return;
      if (err instanceof HttpError) {
        res.status(err.status).json(err.body);
        return;
      }
      // The mirror rolled back with the transaction; the Security API did not.
      // Put the authority back to the user's prior role (never throws). This runs BEFORE the PermitKeyError answer
      // (defence in depth: keys are validated up front, but whatever raises after a Security API write landed must
      // still compensate).
      if (writes.revokeAttempted || writes.grantAttempted) {
        await restoreAuthority({
          op: 'put',
          subject,
          tenant: grantTenant,
          listId,
          prior,
          target: role,
          alsoRestore: revokedRoles.filter((r) => r.role !== prior),
          writes,
          token,
          log: getLog(req),
        });
      }
      if (err instanceof PermitKeyError) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: err.message });
        return;
      }
      getLog(req).error(
      { err, op: 'access.PUT error', userId: req.userId, orgId: req.orgId, params: req.params },
      'access.PUT error failed',
    );
      res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Failed to grant access.' });
    }
  },
);

// ---------------------------------------------------------------------------
// DELETE /:listId/access/:userId  — revoke access
// ---------------------------------------------------------------------------

router.delete(
  '/:listId/access/:userId',
  authMiddleware,
  requireListMutation('manage_access', { forkable: false }),
  async (req: Request, res: Response): Promise<void> => {
    const { listId, userId } = req.params;
    const orgId = req.orgId as string;

    // The owner guard asks the Security API about the OTHER owners with the
    // caller's token (decisions are asked for the presented principal).
    const token = bearer(req);
    if (!token) {
      res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Missing bearer token.' });
      return;
    }

    // Authority-write bookkeeping for compensation (see file header).
    const writes: AuthorityWrites = { revokeAttempted: false, grantAttempted: false };
    let prior: string | null = null;
    let grantTenant = orgId; // where the grant being removed was made (see PUT)
    let subject = userId; // the grant's subject as recorded (see PUT)
    // Every grant the request revoked in the authority (before the call), for compensation.
    const revokedRoles: Array<{ subject: string; tenant: string; role: string }> = [];
    const userForms = await userScope(req, userId);

    try {
      if (!(await listExistsInOrg(listId, orgId, await writeOrgs(req)))) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Selection list not found.' });
        return;
      }

      // Keep the authenticated caller identity for every instance grant mutation.
      const callerToken = token;

      await db.transaction(async (trx) => {
        // Org outbox lock first (see PUT above), then serialise every access
        // mutation on this list (guard + writes).
        await lockOrgOutbox(trx, orgId);
        // The list's OWNER re-checked for suspension FRESH, under the lock a deactivation also takes. Nothing has been
        // written (mirror or Security API) yet, so the refusal needs no compensation.
        await assertPlatformWritable(trx, listId);
        await trx('selection_list_access').where({ list_id: listId }).forUpdate().select('user_id');

        // Fetch the user's grant GROUP (every live row under any rendering) for the last-owner guard and idempotency.
        const group = await grantGroup(trx, listId, userForms);
        const existing = group[0];

        // Idempotent: no active grant → nothing to do (204).
        if (!existing) return;
        prior = existing.role;
        if (existing.org_id) grantTenant = existing.org_id;
        if (existing.user_id) subject = existing.user_id;

        // Validate every Permit key (of EVERY row) before any Security API call (see PUT): a malformed legacy mirror
        // key fails with nothing written.
        permitTenantKey(grantTenant);
        permitSubjectKey(subject);
        for (const g of group) {
          permitTenantKey(g.org_id ?? orgId);
          permitSubjectKey(g.user_id);
        }

        // Last-owner guard, decided by the AUTHORITY (review M-2): another
        // mirror owner must be confirmed by the Security API. The user is an owner when ANY row of the group is.
        if (group.some((g) => g.role === 'list-owner')) {
          const otherOwner = await hasConfirmedOtherOwner({
            executor: trx,
            listId,
            orgId,
            excludeUserIds: userForms,
            token,
            log: getLog(req),
          });
          if (!otherOwner) {
            throw new HttpError(409, {
              code: 'CONFLICT',
              message: 'Cannot remove the last list-owner of a list.',
            });
          }
        }

        // Revoke via the Security API: EVERY row of the group, each with the subject / tenant / role it was recorded
        // under. resource is REQUIRED: it scopes the revocation to this list's instance. revoke() THROWS on failure,
        // rolling back before the mirror soft-delete, so a failed revoke never
        // leaves the mirror claiming access was removed when it was not.
        for (const g of group) {
          const entry = { subject: g.user_id, tenant: g.org_id ?? orgId, role: g.role };
          revokedRoles.push(entry);
          writes.revokeAttempted = true;
          await getAuthzClient().revoke({ ...entry, resource: { type: 'SelectionList', key: listId } }, callerToken);
        }

        await trx('selection_list_access')
          .where({ list_id: listId })
          .whereIn('user_id', group.map((g) => g.user_id))
          .whereNull('revoked_at')
          .update({ revoked_at: trx.fn.now(), updated_at: trx.fn.now() });

        // Outbox, same transaction: access.revoked (an idempotent no-op returned above).
        await emitAccessRevoked(trx, eventContextFromRequest(req), listId, {
          userId,
          role: existing.role,
        });
      });

      res.status(204).send();
    } catch (err) {
      if (replyPlatformSuspended(err, res)) return;
      if (err instanceof HttpError) {
        res.status(err.status).json(err.body);
        return;
      }
      // The mirror rolled back with the transaction (a later step, e.g. the
      // outbox write, can fail after the revoke landed); the Security API did
      // not. Restore the user's role there (never throws). Before the PermitKeyError answer: see PUT.
      if (writes.revokeAttempted) {
        await restoreAuthority({
          op: 'delete',
          subject,
          tenant: grantTenant,
          listId,
          prior: null, // every revoked grant is re-granted through `alsoRestore`
          target: null,
          alsoRestore: revokedRoles,
          writes,
          token,
          log: getLog(req),
        });
      }
      if (err instanceof PermitKeyError) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: err.message });
        return;
      }
      getLog(req).error(
      { err, op: 'access.DELETE error', userId: req.userId, orgId: req.orgId, params: req.params },
      'access.DELETE error failed',
    );
      res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Failed to revoke access.' });
    }
  },
);

export default router;
