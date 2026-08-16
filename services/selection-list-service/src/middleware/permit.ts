// permit.ts — Permit.io client and middleware for selection-list-service.
//
// Design decisions:
//
//  1. Fail CLOSED: any error from Permit.io → 403. Never fail open.
//
//  2. CI / unit-test no-op mode: when PERMIT_API_KEY is a known CI dummy key
//     OR (NODE_ENV=test AND the key does not start with 'permit_key_'), we
//     substitute a Recursive Proxy that returns a truthy value for every
//     .check() call and a no-op for every .api.*() call. Tests that need real
//     Permit behaviour inject a mock via _setPermitClientForTesting().
//
//  3. Feature flag gate: requirePermit() checks the authz-enabled flag first.
//     If the flag is OFF, the middleware passes through with a warning log (dark
//     deploy / kill-switch mode).  If ON, it does a real Permit check.
//
//  4. The selection_list_access table is a READ-MODEL MIRROR — it is never
//     consulted for authorization.  It is updated by grantListOwner() and
//     revokeListAccess() for display purposes and for the last-owner guard.

import { Request, Response, NextFunction } from 'express';
import { Permit } from 'permitio';
import { db } from '../db';
import { getBooleanFlag, FLAGS, FlagContext } from './permit.flags';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PERMIT_API_KEY = process.env.PERMIT_API_KEY ?? '';
const PERMIT_PDP_URL = process.env.PERMIT_PDP_URL ?? 'https://cloudpdp.api.permit.io';

/** Keys that signal "no real Permit account available" — CI / offline mode. */
const CI_DUMMY_KEYS = new Set([
  'ci-no-real-permit-calls',
  'ci-noop',
  'ci-offline-pdp-key',
]);

/**
 * True when we should substitute a no-op proxy for the real Permit client.
 * Conditions:
 *  - The API key is a known CI dummy, OR
 *  - We're in test mode and the key does not look like a real permit key.
 */
export const isNoOpMode: boolean =
  CI_DUMMY_KEYS.has(PERMIT_API_KEY) ||
  (process.env.NODE_ENV === 'test' && !PERMIT_API_KEY.startsWith('permit_key_'));

// ---------------------------------------------------------------------------
// No-op proxy (CI / test safety net)
// ---------------------------------------------------------------------------

/**
 * Returns a recursive Proxy that:
 *  - For .check() → returns true (allow).
 *  - For any other method call → returns a Promise that resolves to undefined.
 *  - For any property access → returns another Proxy (so chaining works).
 */
function makeNoOpProxy(): any {
  const handler: ProxyHandler<object> = {
    get(_target, prop: string) {
      if (prop === 'check') {
        return () => Promise.resolve(true);
      }
      // Any other property access (e.g. .api.roleAssignments.assign()) returns
      // a new Proxy so chaining does not throw.
      return new Proxy(
        function noOp() {
          return Promise.resolve(undefined);
        },
        handler,
      );
    },
    apply(_target, _thisArg, _args) {
      return Promise.resolve(undefined);
    },
  };
  return new Proxy({}, handler);
}

// ---------------------------------------------------------------------------
// Permit client singleton with test seam
// ---------------------------------------------------------------------------

let _permitClient: any = isNoOpMode
  ? makeNoOpProxy()
  : new Permit({ token: PERMIT_API_KEY, pdp: PERMIT_PDP_URL });

/** Returns the active Permit client (real or no-op). */
export function getPermitClient(): any {
  return _permitClient;
}

/**
 * Test seam: swap the Permit client for a mock.
 * Call with `makeNoOpProxy()` or a jest mock object.
 * Tests should restore the original client in afterEach.
 */
export function _setPermitClientForTesting(client: any): void {
  _permitClient = client;
}

/** Re-export so tests can create a fresh no-op without importing the factory. */
export { makeNoOpProxy };

// ---------------------------------------------------------------------------
// requirePermit — Express middleware factory
// ---------------------------------------------------------------------------

/**
 * Returns an Express middleware that enforces a Permit.io check.
 *
 * @param resource  Permit resource type (e.g. 'SelectionList').
 * @param action    Permit action (e.g. 'read', 'write', 'admin').
 *
 * The listId is extracted from req.params.listId.  If absent, the check is
 * performed without a resource-instance key (tenant-level check only).
 *
 * Flag OFF → pass-through with a warning log (dark deploy / kill-switch).
 * Flag ON  → perform real check, fail closed on any error.
 */
export function requirePermit(resource: string, action: string) {
  return async function permitMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const userId = req.userId;
    const orgId = req.orgId;

    if (!userId || !orgId) {
      res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Missing identity claims.' });
      return;
    }

    const flagCtx: FlagContext = { userId, orgId, appId: req.appId };
    const authzEnabled = await getBooleanFlag(FLAGS.AUTHZ_ENABLED, false, flagCtx);

    if (!authzEnabled) {
      console.warn(
        '[permit] authz-enabled flag is OFF — passing through without Permit check.',
        { userId, orgId, resource, action },
      );
      next();
      return;
    }

    const listId = req.params['listId'];
    try {
      const resourceInstance = listId
        ? { type: resource, tenant: orgId, key: listId }
        : { type: resource, tenant: orgId };

      const allowed: boolean = await _permitClient.check(userId, action, resourceInstance);
      if (!allowed) {
        res.status(403).json({ code: 'FORBIDDEN', message: 'Permission denied.' });
        return;
      }
      next();
    } catch (err) {
      // Fail CLOSED: Permit.io errors must never grant access.
      console.error('[permit] Permit.io check threw — failing closed.', { err, userId, orgId, resource, action });
      res.status(403).json({ code: 'FORBIDDEN', message: 'Authorization service unavailable.' });
    }
  };
}

// ---------------------------------------------------------------------------
// grantListOwner — assign list-owner role in Permit + upsert mirror row
// ---------------------------------------------------------------------------

/**
 * Grants the list-owner role to userId on listId within orgId.
 * Performs two writes atomically from the caller's perspective:
 *  1. Permit.io role assignment (source of truth for authz).
 *  2. Upsert into selection_list_access (read-model mirror for display / guard).
 *
 * Throws on Permit.io error; the caller is responsible for propagating.
 */
export async function grantListOwner(
  userId: string,
  orgId: string,
  listId: string,
  grantedBy: string,
): Promise<void> {
  await _permitClient.api.roleAssignments.assign({
    user: userId,
    role: 'list-owner',
    tenant: orgId,
    resource_instance: `SelectionList:${listId}`,
  });

  // Upsert the mirror row.
  await db('selection_list_access')
    .insert({
      list_id: listId,
      user_id: userId,
      role: 'list-owner',
      granted_by: grantedBy,
      org_id: orgId,
      granted_at: db.fn.now(),
      updated_at: db.fn.now(),
      revoked_at: null,
    })
    .onConflict(['list_id', 'user_id'])
    .merge(['role', 'granted_by', 'org_id', 'updated_at', 'revoked_at']);
}

// ---------------------------------------------------------------------------
// countActiveOwners — last-owner guard helper
// ---------------------------------------------------------------------------

/**
 * Returns the number of active (non-revoked) list-owner assignments for listId
 * in the read-model mirror.
 *
 * Used ONLY for the last-owner guard (409 check before demotion / revocation).
 * NOT used for authorization.
 */
export async function countActiveOwners(listId: string): Promise<number> {
  const result = await db('selection_list_access')
    .where({ list_id: listId, role: 'list-owner' })
    .whereNull('revoked_at')
    .count<{ count: string }>('user_id as count')
    .first();

  return result ? parseInt(result.count, 10) : 0;
}
