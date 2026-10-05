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
//  3. Enforcement gate: requireAuthzCheck() asks `isAuthzEnforced()` first.
//     In NODE_ENV=production authz is ALWAYS enforced (the env var is never
//     consulted — review H-1). Outside production the authz-enabled env var is
//     honoured as a dev/test convenience: OFF passes through with a warning
//     log, ON does a real Security API check.
//
//  4. The selection_list_access table is a READ-MODEL MIRROR — it is never
//     consulted for authorization. It is updated by grantListOwner() and
//     src/routes/access.ts's PUT/DELETE handlers for display purposes and as
//     the CANDIDATE set of the last-owner guard — the guard itself asks the
//     Security API (services/authority.ts hasConfirmedOtherOwner, review M-2).
//     countActiveOwners() below is a mirror-only count (diagnostics), not the
//     guard.
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
import type { Knex } from 'knex';
import { db } from '../db';
import { isAuthzEnforced, FLAGS, FlagContext } from './authz.flags';
import { createLoggedFetch, getLog, timed } from '../lib/logger';
import { getGrantToken } from '../lib/machineIdentity';

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

/**
 * `NODE_ENV=test` with no explicit client wired -> allow-all, no network.
 *
 * Setting `SECURITY_SERVICE_URL` explicitly opts OUT of the no-op: the
 * integration/acceptance suite runs the service under NODE_ENV=test (so the
 * FLAGS_FORCE_ON escape hatch works) against a stand-in Security API
 * (tests/selection-list-service/helpers/fake-security-api.mjs) and needs REAL
 * decisions — an allow-all client cannot exercise a single denial path.
 * Unit tests never set it, so they keep the no-op.
 */
export const isNoOpMode: boolean =
  process.env.NODE_ENV === 'test' && !process.env.SECURITY_SERVICE_URL;

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
    // Echoes the write back, like `grant` above: this double exists so a unit
    // test never reaches the network, not to model provider behaviour.
    setAttributes: async (req) => ({
      subject: req.subject,
      attributes: req.attributes,
      updatedAt: Date.now(),
    }),
  };
}

// ---------------------------------------------------------------------------
// AuthzClient singleton with test seam
// ---------------------------------------------------------------------------

let _authzClient: AuthzClient = isNoOpMode
  ? makeNoOpProxy()
  : // createLoggedFetch: boundary logging (start/end/elapsedMs) + x-request-id
    // propagation on every Security API call; behaviour is otherwise unchanged.
    createAuthzClient({ baseUrl: SECURITY_SERVICE_URL, fetch: createLoggedFetch() });

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
// Resource types — instance level vs tenant level (review H-3)
// ---------------------------------------------------------------------------

/**
 * Per-LIST resource. Every check against it carries the list id as the
 * instance key (ReBAC): `list-owner|editor|contributor|translator|viewer` are
 * granted per list instance, and only per-list actions (`read`, `update`,
 * `add_value`, ...) are evaluated against it. A tenant role must NEVER be given
 * these actions: Permit applies a tenant role to every instance in the tenant,
 * which would erase the per-list distinctions.
 */
export const SELECTION_LIST_RESOURCE = 'SelectionList';

/**
 * Tenant-level CATALOG resource (keyless — there is no instance to key on).
 * Authorizes the operations that are not about one list: asking for the
 * catalog (`list`), creating a list (`create`), reading the quota
 * (`read_quota`) and bulk-resolving item ids (`resolve`). Tenant roles carry
 * these actions; they never carry a per-list action. See
 * docs/planning/selection-lists-permit-actions.md.
 */
export const SELECTION_LIST_CATALOG_RESOURCE = 'SelectionListCatalog';

export type CatalogAction = 'list' | 'create' | 'read_quota' | 'resolve';

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
 * Production → ALWAYS a real check (fail closed on any error).
 * Non-production, env switch OFF → pass-through with a warning log (dev/test).
 * Non-production, env switch ON  → real check, fail closed on any error.
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
    const authzEnabled = await isAuthzEnforced(flagCtx);

    if (!authzEnabled) {
      getLog(req).warn(
        { userId, orgId, resource, action, flag: FLAGS.AUTHZ_ENABLED },
        'authz-enabled flag is OFF — passing through without a Security API check',
      );
      next();
      return;
    }

    const token = bearer(req);
    if (!token) {
      res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Missing bearer token.' });
      return;
    }

    // The catalog resource is tenant-level by definition: it is never keyed,
    // even if a route happens to carry a :listId param.
    const listId = resource === SELECTION_LIST_CATALOG_RESOURCE ? undefined : req.params['listId'];
    try {
      // Org-scoped existence pre-check: a list id that does not exist IN THE
      // CALLER'S ORG is a 404 whatever the action, before any decision is
      // asked. Cross-org ids and never-minted ids are therefore
      // indistinguishable (no cross-org existence oracle), and the Security API
      // is never asked to rule on an id the caller's tenant does not own.
      if (listId) {
        const exists = await timed(
          getLog(req),
          'db.selection_lists.exists',
          () => db('selection_lists').where({ id: listId, organization_id: orgId }).first('id'),
          { listId, orgId },
        );
        if (!exists) {
          getLog(req).debug({ listId, orgId }, 'authz precheck: list not in caller org — 404');
          res.status(404).json({ code: 'NOT_FOUND', message: 'Not found.' });
          return;
        }
      }

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
        getLog(req).info(
          { userId, orgId, resource, action, listId, allow: false },
          'authz decision: denied',
        );
        if (action === 'read' && listId) {
          // A read the caller is not entitled to is a 404, not a 403, so the
          // API is not an existence oracle (openapi §Authorization).
          res.status(404).json({ code: 'NOT_FOUND', message: 'Not found.' });
          return;
        }
        res.status(403).json({ code: 'FORBIDDEN', message: 'Permission denied.' });
        return;
      }
      next();
    } catch (err) {
      // Fail CLOSED: any Security API error (including a thrown
      // AuthzError('DECISION_UNAVAILABLE') for a timeout/non-200) must never
      // grant access.
      getLog(req).error(
        { err, userId, orgId, resource, action, listId },
        'Security API check threw — failing closed',
      );
      res.status(403).json({ code: 'FORBIDDEN', message: 'Authorization service unavailable.' });
    }
  };
}

/**
 * Tenant-level check against the `SelectionListCatalog` resource (keyless).
 * Use for GET / (`list`), POST / (`create`), GET /quota (`read_quota`) and
 * POST /resolve (`resolve`). Never use it for anything addressed to one list.
 */
export function requireCatalogCheck(action: CatalogAction) {
  return requireAuthzCheck(SELECTION_LIST_CATALOG_RESOURCE, action);
}

/**
 * Like `requireAuthzCheck`, but only asks when `when(req)` is true; otherwise
 * it passes straight through. For routes whose required action depends on the
 * request (e.g. an extra `delete` check only when `?purge=true`, or only when a
 * PATCH body sets `status: "archived"`). It is stacked AFTER the route's base
 * check, so it can only ever make a route stricter, never looser.
 */
export function requireAuthzCheckWhen(
  when: (req: Request) => boolean,
  resource: string,
  action: string,
) {
  const check = requireAuthzCheck(resource, action);
  return function conditionalAuthzMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> | void {
    if (!when(req)) {
      next();
      return;
    }
    return check(req, res, next);
  };
}

// ---------------------------------------------------------------------------
// isAuthzEnabled / filterReadable — instance-level filtering of collections
// ---------------------------------------------------------------------------

/** True when authz decisions are enforced (always in production; see authz.flags.ts). */
export async function isAuthzEnabled(req: Request): Promise<boolean> {
  return isAuthzEnforced({
    userId: req.userId,
    orgId: req.orgId,
    appId: req.appId,
  });
}

/**
 * Drops every list the caller may not `read` from a page of rows. The
 * tenant-level `SelectionListCatalog:list` check (route middleware) only
 * authorizes ASKING for the catalog; WHICH lists come back is decided here, per
 * list, by the per-list `SelectionList:read` action (review H-3) — Permit
 * decides, this service assumes nothing about org-admin derivation.
 * (openapi: "a list the caller has no grant on is simply absent, never a 403").
 * One `bulkCheck` round trip for the whole page (<= 200 rows == the Security
 * API's bulk ceiling). Fail CLOSED: a thrown AuthzError propagates to the
 * route's catch (-> 500), it never degrades to "return everything".
 * With the authz flag OFF (dark deploy) rows pass through unchanged, exactly
 * like `requireAuthzCheck`.
 */
export async function filterReadable<T extends { id: string }>(
  req: Request,
  rows: T[],
): Promise<T[]> {
  if (rows.length === 0 || !(await isAuthzEnabled(req))) return rows;
  const token = bearer(req);
  if (!token || !req.userId || !req.orgId) return [];
  const decisions = await getAuthzClient().bulkCheck(
    rows.map((r) => ({
      subject: req.userId as string,
      tenant: req.orgId as string,
      resource: { type: SELECTION_LIST_RESOURCE, key: r.id },
      action: 'read',
    })),
    token,
  );
  return rows.filter((_, i) => decisions[i]?.allow === true);
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
 * AUTHENTICATION OF THE WRITE. The grant is made with this service's MACHINE
 * identity (`getGrantToken()`: OAuth client_credentials, scope `authz:admin`),
 * never the end user's token: the end user has no standing to write their own
 * role, and the Security API denies non-admin human grant calls (review C-1).
 * `grantedBy` is recorded on the mirror row as the acting user; the Security API
 * sees the machine principal. Fail closed: no/failed machine token -> throws.
 */
export async function grantListOwner(
  userId: string,
  orgId: string,
  listId: string,
  grantedBy: string,
  executor: Knex | Knex.Transaction = db,
): Promise<void> {
  const machineToken = await getGrantToken();
  await getAuthzClient().grant(
    {
      subject: userId,
      tenant: orgId,
      role: 'list-owner',
      resource: { type: 'SelectionList', key: listId },
    },
    machineToken,
  );

  // Upsert the mirror row. Only reached if the grant above succeeded.
  // `executor` lets a create handler write the mirror row inside the same
  // transaction as the list row (the mirror has an FK to selection_lists).
  await executor('selection_list_access')
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
// countActiveOwners — mirror-only owner count (NOT the last-owner guard)
// ---------------------------------------------------------------------------

/**
 * Returns the number of active (non-revoked) list-owner assignments for listId
 * in the read-model mirror.
 *
 * A diagnostic count of mirror rows. The last-owner guard (409 before a
 * demotion / revocation) no longer trusts it: it asks the Security API
 * (services/authority.ts, review M-2). NOT used for authorization. Reads the
 * local mirror table exclusively.
 */
export async function countActiveOwners(listId: string): Promise<number> {
  const result = await db('selection_list_access')
    .where({ list_id: listId, role: 'list-owner' })
    .whereNull('revoked_at')
    .count<{ count: string }>('user_id as count')
    .first();

  return result ? parseInt(result.count, 10) : 0;
}
