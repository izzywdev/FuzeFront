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
//   b) the last-owner guard (count of non-revoked owners before demotion/revoke)
//
// Wire shape: snake_case, exactly `SelectionListAccessGrant` in the openapi
// (list_id, user_id, role, granted_by, granted_at, updated_at). Errors use the
// contract's codes: 400 VALIDATION_ERROR, 404 NOT_FOUND, 409 CONFLICT.
//
// Who authenticates what. Decisions about the CALLER (and the membership probe
// on the target user) use the end user's bearer token. Grant/revoke WRITES use
// this service's machine identity (lib/machineIdentity.ts, client_credentials,
// scope `authz:admin`) — never the end user's token: the Security API denies
// non-admin human grant calls (review C-1), and the user must not authorize
// their own role. The route-level `manage_access` check above is what decides
// whether the human may ask for the change at all.
//
// Write ordering (a thrown Security API call must never leave the mirror
// claiming a change that did not happen): every handler runs inside ONE
// transaction that takes a row lock on the list's access rows, performs the
// Security API write(s) first, and only then writes the mirror. A failure at
// any point rolls the mirror back; the lock also makes the last-owner guard
// race-free (two concurrent demotions of a 2-owner list cannot both pass it).
//
// Pagination (GET):
//   - Default limit: 50; max: 200 (clamped server-side).
//   - Cursor: opaque base64url encoding of the last user_id in the page.
//   - Deterministic order: user_id ASC (stable under concurrent writes).

import { Request, Response } from 'express';
import { createRouter } from '../lib/http';
import { registerIdParams } from '../middleware/validateInput';
import { getLog } from '../lib/logger';
import { db } from '../db';
import { requireAuthzCheck, getAuthzClient, bearer } from '../middleware/authz';
import { getGrantToken } from '../lib/machineIdentity';
import { authMiddleware } from '../middleware/auth';
import { lockOrgOutbox } from '../events/outbox';
import { eventContextFromRequest, emitAccessGranted, emitAccessRevoked } from '../events/emitters';

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

function formatGrant(r: AccessRow) {
  return {
    list_id: r.list_id,
    user_id: r.user_id,
    role: r.role,
    granted_by: r.granted_by,
    granted_at: iso(r.granted_at),
    updated_at: iso(r.updated_at),
  };
}

/** True iff the list exists in the caller's organization (org-scoped, never cross-org). */
async function listExistsInOrg(listId: string, orgId: string): Promise<boolean> {
  const row = await db('selection_lists').where({ id: listId, organization_id: orgId }).first('id');
  return Boolean(row);
}

// ---------------------------------------------------------------------------
// GET /:listId/access  — list grants (cursor-paginated)
// ---------------------------------------------------------------------------

router.get(
  '/:listId/access',
  authMiddleware,
  requireAuthzCheck('SelectionList', 'manage_access'),
  async (req: Request, res: Response): Promise<void> => {
    const { listId } = req.params;
    const orgId = req.orgId as string;

    // --- Pagination params ---
    const rawLimit = parseInt(String(req.query['limit'] ?? DEFAULT_LIMIT), 10);
    const limit = isNaN(rawLimit) || rawLimit < 1 ? DEFAULT_LIMIT : Math.min(rawLimit, MAX_LIMIT);
    const cursorParam = req.query['cursor'] as string | undefined;
    const afterUserId = cursorParam ? decodeCursor(cursorParam) : undefined;

    try {
      if (!(await listExistsInOrg(listId, orgId))) {
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
      const items = hasMore ? rows.slice(0, limit) : rows;

      const nextCursor =
        hasMore && items.length > 0
          ? encodeCursor(items[items.length - 1]['user_id'])
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
  requireAuthzCheck('SelectionList', 'manage_access'),
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

    try {
      if (!(await listExistsInOrg(listId, orgId))) {
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

      // Resolved BEFORE the transaction opens: a missing/failed machine identity
      // fails closed (-> 500 below) without taking a row lock first.
      const machineToken = await getGrantToken();

      const row = await db.transaction(async (trx) => {
        // Lock order is ALWAYS org outbox lock first (events/outbox.ts): a list
        // purge in the same org deletes these access rows while holding it.
        await lockOrgOutbox(trx, orgId);
        // Serialise every access mutation on this list (guard + writes).
        await trx('selection_list_access').where({ list_id: listId }).forUpdate().select('user_id');

        const existing = await trx('selection_list_access')
          .where({ list_id: listId, user_id: userId })
          .whereNull('revoked_at')
          .first('role');

        // Last-owner guard: demoting the only list-owner is refused.
        if (existing && existing['role'] === 'list-owner' && role !== 'list-owner') {
          const owners = await trx('selection_list_access')
            .where({ list_id: listId, role: 'list-owner' })
            .whereNull('revoked_at')
            .count<{ count: string }>('user_id as count')
            .first();
          if (parseInt(owners?.count ?? '0', 10) <= 1) {
            throw new HttpError(409, {
              code: 'CONFLICT',
              message: 'Cannot demote the last list-owner of a list.',
            });
          }
        }

        // Roles do not stack: drop the old role in the Security API before
        // granting the new one. Revoke-first fails safe — a failure between the
        // two leaves the user with LESS access, never more.
        if (existing && existing['role'] !== role) {
          await getAuthzClient().revoke(
            {
              subject: userId,
              tenant: orgId,
              role: existing['role'],
              resource: { type: 'SelectionList', key: listId },
            },
            machineToken,
          );
        }

        // Assign role via the Security API (source of truth for authz).
        // resource is REQUIRED: it scopes this grant to this one list rather
        // than tenant-wide. grant() THROWS on a Security API failure, which
        // rolls this transaction back before the mirror is touched.
        await getAuthzClient().grant(
          {
            subject: userId,
            tenant: orgId,
            role,
            resource: { type: 'SelectionList', key: listId },
          },
          machineToken,
        );

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
          [listId, userId, role, actorId, orgId],
        );

        // Outbox, same transaction: access.granted (previousRole null for a new
        // grant). A repeat PUT of the role the user already holds changes nothing,
        // so it announces nothing.
        if (!existing || existing['role'] !== role) {
          await emitAccessGranted(trx, eventContextFromRequest(req), listId, {
            userId,
            role,
            previousRole: existing ? (existing['role'] as string) : null,
          });
        }

        return (await trx('selection_list_access')
          .where({ list_id: listId, user_id: userId })
          .first('list_id', 'user_id', 'role', 'granted_by', 'granted_at', 'updated_at')) as AccessRow;
      });

      res.status(200).json(formatGrant(row));
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json(err.body);
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
  requireAuthzCheck('SelectionList', 'manage_access'),
  async (req: Request, res: Response): Promise<void> => {
    const { listId, userId } = req.params;
    const orgId = req.orgId as string;

    try {
      if (!(await listExistsInOrg(listId, orgId))) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Selection list not found.' });
        return;
      }

      // Machine identity resolved BEFORE the transaction opens (fail closed).
      const machineToken = await getGrantToken();

      await db.transaction(async (trx) => {
        // Org outbox lock first (see PUT above), then serialise every access
        // mutation on this list (guard + writes).
        await lockOrgOutbox(trx, orgId);
        await trx('selection_list_access').where({ list_id: listId }).forUpdate().select('user_id');

        // Fetch current grant for last-owner guard and idempotency.
        const existing = await trx('selection_list_access')
          .where({ list_id: listId, user_id: userId })
          .whereNull('revoked_at')
          .first('role');

        // Idempotent: no active grant → nothing to do (204).
        if (!existing) return;

        // Last-owner guard.
        if (existing['role'] === 'list-owner') {
          const owners = await trx('selection_list_access')
            .where({ list_id: listId, role: 'list-owner' })
            .whereNull('revoked_at')
            .count<{ count: string }>('user_id as count')
            .first();
          if (parseInt(owners?.count ?? '0', 10) <= 1) {
            throw new HttpError(409, {
              code: 'CONFLICT',
              message: 'Cannot remove the last list-owner of a list.',
            });
          }
        }

        // Revoke via the Security API. resource is REQUIRED: it scopes the
        // revocation to this list's instance. revoke() THROWS on failure,
        // rolling back before the mirror soft-delete, so a failed revoke never
        // leaves the mirror claiming access was removed when it was not.
        await getAuthzClient().revoke(
          {
            subject: userId,
            tenant: orgId,
            role: existing['role'],
            resource: { type: 'SelectionList', key: listId },
          },
          machineToken,
        );

        await trx('selection_list_access')
          .where({ list_id: listId, user_id: userId })
          .update({ revoked_at: trx.fn.now(), updated_at: trx.fn.now() });

        // Outbox, same transaction: access.revoked (an idempotent no-op returned above).
        await emitAccessRevoked(trx, eventContextFromRequest(req), listId, {
          userId,
          role: existing['role'] as string,
        });
      });

      res.status(204).send();
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json(err.body);
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
