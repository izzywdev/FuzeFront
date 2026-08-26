// access.ts — per-list ReBAC access grant management (S7, FFRNT-190).
//
// Endpoints:
//   GET    /:listId/access           List all grants (cursor-paginated)
//   PUT    /:listId/access/:userId   Grant or update a role for a user
//   DELETE /:listId/access/:userId   Revoke a user's access
//
// Authorization:
//   - GET  requires 'read'  on SelectionList (list-owner, list-editor, list-contributor,
//                            list-translator, list-viewer can read the roster)
//   - PUT  requires 'admin' on SelectionList (list-owner only)
//   - DELETE requires 'admin' on SelectionList (list-owner only)
//
// The selection_list_access table is a READ-MODEL MIRROR of the authorization
// backend's state (FuzeFront's Security API, via @fuzefront/auth's
// AuthzClient — see middleware/authz.ts). It is NEVER consulted for
// authorization decisions — only for:
//   a) returning the grant roster on GET
//   b) the last-owner guard (count of non-revoked owners before demotion/revoke)
//
// Pagination (GET):
//   - Default limit: 50; max: 200 (clamped server-side).
//   - Cursor: opaque base64url encoding of the last user_id in the page.
//   - Deterministic order: user_id ASC (stable under concurrent writes).

import { Router, Request, Response } from 'express';
import { db } from '../db';
import { requireAuthzCheck, countActiveOwners, getAuthzClient, bearer } from '../middleware/authz';
import { authMiddleware } from '../middleware/auth';

const router = Router();

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
// GET /:listId/access  — list grants (cursor-paginated)
// ---------------------------------------------------------------------------

router.get(
  '/:listId/access',
  authMiddleware,
  requireAuthzCheck('SelectionList', 'read'),
  async (req: Request, res: Response): Promise<void> => {
    const { listId } = req.params;

    // --- Pagination params ---
    const rawLimit = parseInt(String(req.query['limit'] ?? DEFAULT_LIMIT), 10);
    const limit = isNaN(rawLimit) || rawLimit < 1 ? DEFAULT_LIMIT : Math.min(rawLimit, MAX_LIMIT);
    const cursorParam = req.query['cursor'] as string | undefined;
    const afterUserId = cursorParam ? decodeCursor(cursorParam) : undefined;

    try {
      // Fetch one extra row to determine hasMore.
      // Chain order: select → where → whereNull → orderBy → (cursor where) → limit
      // limit() is always last so it can serve as the query execution trigger in tests.
      let query = db('selection_list_access')
        .select('user_id', 'role', 'granted_by', 'granted_at', 'updated_at', 'org_id')
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
        items: items.map((r) => ({
          userId: r['user_id'],
          role: r['role'],
          grantedBy: r['granted_by'],
          grantedAt: r['granted_at'],
          updatedAt: r['updated_at'],
          orgId: r['org_id'],
        })),
        page: {
          nextCursor,
          hasMore,
        },
      });
    } catch (err) {
      console.error('[access.GET] DB error', err);
      res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Failed to list access grants.' });
    }
  },
);

// ---------------------------------------------------------------------------
// PUT /:listId/access/:userId  — grant or update a role
// ---------------------------------------------------------------------------

router.put(
  '/:listId/access/:userId',
  authMiddleware,
  requireAuthzCheck('SelectionList', 'admin'),
  async (req: Request, res: Response): Promise<void> => {
    const { listId, userId } = req.params;
    const orgId = req.orgId!;
    const actorId = req.userId!;

    const { role } = req.body as { role?: string };

    if (!role || !VALID_ROLES.has(role)) {
      res.status(400).json({
        code: 'INVALID_ROLE',
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
      // Last-owner guard: if target currently has list-owner and we're changing
      // them to a non-owner role, ensure there is at least one other owner.
      if (role !== 'list-owner') {
        const existing = await db('selection_list_access')
          .where({ list_id: listId, user_id: userId })
          .whereNull('revoked_at')
          .select('role')
          .first();

        if (existing && existing['role'] === 'list-owner') {
          const ownerCount = await countActiveOwners(listId);
          if (ownerCount <= 1) {
            res.status(409).json({
              code: 'LAST_OWNER',
              message: 'Cannot demote the last owner of a list.',
            });
            return;
          }
        }
      }

      // Assign role via the Security API (source of truth for authz).
      // resource is REQUIRED here: it is what scopes this grant to this one
      // list (resource_instance 'SelectionList:${listId}' on the wire) rather
      // than tenant-wide. This is a WRITE — grant() throws (never resolves)
      // on a Security API failure, so a 502/timeout is caught below and
      // surfaced as 500 WITHOUT ever reaching the mirror upsert.
      await getAuthzClient().grant(
        {
          subject: userId,
          tenant: orgId,
          role,
          resource: { type: 'SelectionList', key: listId },
        },
        token,
      );

      // Upsert the mirror row. Only reached if the grant above succeeded.
      await db('selection_list_access')
        .insert({
          list_id: listId,
          user_id: userId,
          role,
          granted_by: actorId,
          org_id: orgId,
          granted_at: db.fn.now(),
          updated_at: db.fn.now(),
          revoked_at: null,
        })
        .onConflict(['list_id', 'user_id'])
        .merge(['role', 'granted_by', 'org_id', 'updated_at', 'revoked_at']);

      res.status(200).json({
        userId,
        listId,
        role,
        grantedBy: actorId,
        orgId,
      });
    } catch (err) {
      console.error('[access.PUT] error', err);
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
  requireAuthzCheck('SelectionList', 'admin'),
  async (req: Request, res: Response): Promise<void> => {
    const { listId, userId } = req.params;
    const orgId = req.orgId!;

    const token = bearer(req);
    if (!token) {
      res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Missing bearer token.' });
      return;
    }

    try {
      // Fetch current grant for last-owner guard and idempotency.
      const existing = await db('selection_list_access')
        .where({ list_id: listId, user_id: userId })
        .whereNull('revoked_at')
        .select('role')
        .first();

      if (!existing) {
        // Idempotent: no active grant → 204.
        res.status(204).send();
        return;
      }

      // Last-owner guard.
      if (existing['role'] === 'list-owner') {
        const ownerCount = await countActiveOwners(listId);
        if (ownerCount <= 1) {
          res.status(409).json({
            code: 'LAST_OWNER',
            message: 'Cannot remove the last owner of a list.',
          });
          return;
        }
      }

      // Revoke via the Security API. resource is REQUIRED here for the same
      // reason as the PUT handler's grant() call: it scopes the revocation
      // to this list's instance rather than the tenant-wide role. This is a
      // WRITE — revoke() throws (never resolves) on a Security API failure,
      // caught below and surfaced as 500 WITHOUT ever reaching the mirror's
      // soft-delete, so a failed revoke never leaves the mirror claiming
      // access was removed when it was not.
      await getAuthzClient().revoke(
        {
          subject: userId,
          tenant: orgId,
          role: existing['role'],
          resource: { type: 'SelectionList', key: listId },
        },
        token,
      );

      // Soft-delete the mirror row. Only reached if the revoke above succeeded.
      await db('selection_list_access')
        .where({ list_id: listId, user_id: userId })
        .update({ revoked_at: db.fn.now(), updated_at: db.fn.now() });

      res.status(204).send();
    } catch (err) {
      console.error('[access.DELETE] error', err);
      res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Failed to revoke access.' });
    }
  },
);

export default router;
