// authz.ts — authorization for selection-list-service, routed through
// FuzeFront's Security API (backend/security's `/api/v1/security/authz/*`)
// instead of an embedded Permit.io SDK. Replaces middleware/permit.ts.
//
// Step 2 of 3 in an owner-requested migration off the embedded Permit SDK,
// onto backend/security's provider-agnostic `AuthorizationProvider` seam
// (`authzFactory.ts`) via the shared `@fuzefront/auth` client. config-service
// was step 1 (#679); billing-service follows separately (step 3). Permit is
// now purely an implementation detail of that seam — this service knows
// nothing about it. It talks to exactly one thing: FuzeFront's own Security
// API, via `createAuthzClient`. No vendor SDK, no vendor API key here.
//
// Design decisions (preserved from the Permit-backed predecessor):
//
//  1. Fail CLOSED: any error talking to the Security API -> 403. Never fail
//     open. `AuthzClient.check()` never throws for a policy denial (that's
//     `{ allow: false }`, a normal decision) — only for DECISION_UNAVAILABLE
//     (transport error, timeout, non-200, malformed response), which this
//     module treats as a deny, never an uncaught rejection that could
//     somehow resolve to "allowed".
//
//  2. CI / unit-test no-op mode: when NODE_ENV=test, a recursive no-op proxy
//     stands in for the real client — no real HTTP call, no live Security
//     API needed for unit tests. Tests that need real behaviour (an actual
//     denial, a thrown DECISION_UNAVAILABLE, asserting the exact request
//     body) inject a mock via `_setAuthzClientForTesting()`.
//
//  3. Feature flag gate: requireAuthzCheck() checks the authz-enabled flag
//     first. If OFF, the middleware passes through with a warning log (dark
//     deploy / kill-switch mode). If ON, it does a real Security API check.
//     Unchanged by this migration — same flag, same env var, same
//     dark-deploy semantics; only what happens when the flag is ON changed.
//
//  4. The selection_list_access table is a READ-MODEL MIRROR — it is never
//     consulted for authorization. It is updated by grantListOwner() and
//     src/routes/access.ts's PUT/DELETE handlers for display purposes and
//     for the last-owner guard. countActiveOwners() (routes/access.ts) reads
//     ONLY this mirror and is untouched by this migration.
//
//  5. `resource` is what makes a grant/revoke/check INSTANCE-scoped (ReBAC).
//     Every call site that has a listId passes
//     `resource: { type: 'SelectionList', key: listId }` through to the
//     `AuthzClient` — omitting it silently widens a list-scoped grant/check
//     to tenant-wide, a real privilege-escalation surface. See
//     `grantListOwner()` and `src/routes/access.ts`'s PUT/DELETE handlers.
//
//  6. grant()/revoke() are WRITES. A transport failure/timeout THROWS
//     (`AuthzError`) rather than resolving — it is never swallowed into a
//     false "succeeded". Call sites in `routes/access.ts` let that throw
//     propagate to their route-level try/catch (-> 500), and — critically —
//     always perform the Security API write BEFORE touching the
//     `selection_list_access` mirror row, so a thrown grant/revoke never
//     leaves the mirror claiming a role change that did not actually happen
//     in the authorization backend.

import { Request, Response, NextFunction } from 'express';
import { AuthzClient, createAuthzClient } from '@fuzefront/auth';
import { db } from '../db';
import { getBooleanFlag, FLAGS, FlagContext } from './authz.flags';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * In-cluster Service DNS for backend/security
 * (`deploy/helm/fuzefront/templates/security.yaml`), matching the
 * `SECURITY_SERVICE_URL` convention config-service and provisioning-service
 * already use for the same Service. `createAuthzClient` appends
 * `/api/v1/security/authz/{check,bulk-check,grants}` itself.
 */
const SECURITY_SERVICE_URL = process.env.SECURITY_SERVICE_URL ?? 'http://fuzefront-security:3002';

/** `NODE_ENV=test` with no explicit client wired -> allow-all, no network. */
export const isNoOpMode: boolean = process.env.NODE_ENV === 'test';

// ---------------------------------------------------------------------------
// No-op proxy (CI / test safety net)
// ---------------------------------------------------------------------------

/**
 * A fully-typed allow-all `AuthzClient` used only when `NODE_ENV=test` and no
 * explicit mock has been wired via `_setAuthzClientForTesting()`. Every
 * method resolves successfully — no real HTTP call, ever, from a unit test.
 */
function makeNoOpProxy(): AuthzClient {
  return {
    check: async () => ({ allow: true }),
    bulkCheck: async (checks) => checks.map(() => ({ allow: true })),
    grant: async (req) => ({
      id: `${req.tenant}:${req.subject}:${req.role}`,
      subject: req.subject,
      tenant: req.tenant,
      role: req.role,
      permission: req.permission,
      resource: req.resource,
    }),
    revoke: async () => undefined,
    listGrants: async () => ({ items: [], page: { nextCursor: null, hasMore: false } }),
  };
}

// ---------------------------------------------------------------------------
// AuthzClient singleton with test seam
// ---------------------------------------------------------------------------

let _authzClient: AuthzClient = isNoOpMode
  ? makeNoOpProxy()
  : createAuthzClient({ baseUrl: SECURITY_SERVICE_URL });

/** Returns the active authz client (real or no-op). */
export function getAuthzClient(): AuthzClient {
  return _authzClient;
}

/**
 * Test seam: swap the authz client for a mock.
 * Call with `makeNoOpProxy()` or a jest mock object.
 * Tests should restore the original client in afterEach.
 */
export function _setAuthzClientForTesting(client: AuthzClient): void {
  _authzClient = client;
}

/** Re-export so tests can create a fresh no-op without importing the factory. */
export { makeNoOpProxy };

// ---------------------------------------------------------------------------
// bearer — re-read the raw token so a decision is always asked for the
// CALLER's real credential, never a service-wide one.
// ---------------------------------------------------------------------------

export function bearer(req: Request): string | null {
  const header = req.headers['authorization'];
  if (!header || Array.isArray(header)) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

// ---------------------------------------------------------------------------
// requireAuthzCheck — Express middleware factory (replaces requirePermit)
// ---------------------------------------------------------------------------

/**
 * Returns an Express middleware that enforces an authorization decision via
 * FuzeFront's Security API.
 *
 * @param resource  Security API resource type (e.g. 'SelectionList').
 * @param action    Security API action (e.g. 'read', 'admin').
 *
 * The listId is extracted from req.params.listId.  If absent, the check is
 * performed without a resource-instance key (tenant-level check only).
 *
 * Flag OFF → pass-through with a warning log (dark deploy / kill-switch).
 * Flag ON  → perform a real check, fail closed on any error.
 */
export function requireAuthzCheck(resource: string, action: string) {
  return async function authzMiddleware(
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
        '[authz] authz-enabled flag is OFF — passing through without a Security API check.',
        { userId, orgId, resource, action },
      );
      next();
      return;
    }

    const token = bearer(req);
    if (!token) {
      res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Missing bearer token.' });
      return;
    }

    const listId = req.params['listId'];
    try {
      const decision = await getAuthzClient().check(
        {
          subject: userId,
          tenant: orgId,
          resource: listId ? { type: resource, key: listId } : { type: resource },
          action,
        },
        token,
      );
      if (!decision.allow) {
        res.status(403).json({ code: 'FORBIDDEN', message: 'Permission denied.' });
        return;
      }
      next();
    } catch (err) {
      // Fail CLOSED: any Security API error (including a thrown
      // AuthzError('DECISION_UNAVAILABLE') for a timeout/non-200) must never
      // grant access.
      console.error('[authz] Security API check threw — failing closed.', { err, userId, orgId, resource, action });
      res.status(403).json({ code: 'FORBIDDEN', message: 'Authorization service unavailable.' });
    }
  };
}

// ---------------------------------------------------------------------------
// grantListOwner — grant list-owner via the Security API + upsert mirror row
// ---------------------------------------------------------------------------

/**
 * Grants the list-owner role to userId on listId within orgId.
 * Performs two writes in order:
 *  1. Security API grant (source of truth for authz) — instance-scoped via
 *     `resource: { type: 'SelectionList', key: listId }`, so this reaches
 *     Permit as `resource_instance: 'SelectionList:${listId}'`, exactly the
 *     scope the embedded-SDK predecessor used.
 *  2. Upsert into selection_list_access (read-model mirror for display / the
 *     last-owner guard).
 *
 * Throws on a Security API error (grant() never swallows a write failure);
 * the mirror row is only reached — and only written — once the grant
 * succeeded, so a thrown grant can never leave a mirror row claiming success.
 *
 * @param token  The ACTING caller's bearer token — the Security API decides
 *               (and records) the grant for the real principal, never a
 *               service-wide credential.
 */
export async function grantListOwner(
  userId: string,
  orgId: string,
  listId: string,
  grantedBy: string,
  token: string,
): Promise<void> {
  await getAuthzClient().grant(
    {
      subject: userId,
      tenant: orgId,
      role: 'list-owner',
      resource: { type: 'SelectionList', key: listId },
    },
    token,
  );

  // Upsert the mirror row. Only reached if the grant above succeeded.
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
// countActiveOwners — last-owner guard helper (UNCHANGED by this migration)
// ---------------------------------------------------------------------------

/**
 * Returns the number of active (non-revoked) list-owner assignments for listId
 * in the read-model mirror.
 *
 * Used ONLY for the last-owner guard (409 check before demotion / revocation).
 * NOT used for authorization. Reads the local mirror table exclusively — it
 * has nothing to do with Permit or the Security API, and this migration does
 * not touch it.
 */
export async function countActiveOwners(listId: string): Promise<number> {
  const result = await db('selection_list_access')
    .where({ list_id: listId, role: 'list-owner' })
    .whereNull('revoked_at')
    .count<{ count: string }>('user_id as count')
    .first();

  return result ? parseInt(result.count, 10) : 0;
}
