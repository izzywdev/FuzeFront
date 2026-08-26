/**
 * Authorization for config-service, routed through FuzeFront's Security API
 * (backend/security's `/api/v1/security/authz/*`) instead of an embedded
 * Permit.io SDK — the SOLE home of the authz client bootstrap for this
 * service (formerly `middleware/permit.ts`, FFRNT-157 read
 * `requirePermit`/FFRNT-158 write `checkConfigPermission`).
 *
 * Permit is now purely an implementation detail of backend/security's
 * `AuthorizationProvider` seam (`authzFactory.ts`); this service knows
 * nothing about it. It talks to exactly one thing: FuzeFront's own Security
 * API, via the shared, provider-neutral `@fuzefront/auth` client
 * (`createAuthzClient`). No vendor SDK, no vendor API key here.
 *
 * FAIL CLOSED throughout, same discipline as the Permit-backed predecessor:
 *  1. Every transport error / non-decision from the Security API is a deny
 *     (`AuthzClient.check()` never throws for a policy denial — only for
 *     DECISION_UNAVAILABLE, which this module treats as `false`, never an
 *     uncaught rejection).
 *  2. CI / unit-test no-op mode: when `NODE_ENV=test`, a recursive no-op
 *     proxy stands in and allows every check — no real HTTP call, no need
 *     for a live Security API in unit tests. Tests that need a real denial
 *     inject a mock via `_setAuthzClientForTesting()`.
 *
 * `requireConfigPermission()` is route-level middleware (former
 * `requirePermit`); `checkConfigPermission()` is a plain function for checks
 * that must run mid-handler (former same name, same call-site rationale —
 * see the write routers); `checkAuthorization()` is the direct-call
 * primitive both are built on, and is also used directly by
 * `config-read.routes.ts` for its dynamic-key/tenant checks (the admin
 * `includeHidden` gate, and `GET /v1/config`'s scope-level read check). All
 * three funnel through the SAME underlying `AuthzClient` — see
 * `getAuthzClient()`.
 *
 * The decision cache (`AuthzClientOptions.cacheTtlSeconds`) is left OFF
 * (the package default) — this service's authz surface gates writes and
 * scope-chain reads, and the staleness a cache would trade for PDP load is
 * not a trade this service makes without a specific reason to.
 */

import { Request, Response, NextFunction } from 'express';
import { AuthzCheck, AuthzClient, AuthzDecision, createAuthzClient } from '@fuzefront/auth';

/**
 * In-cluster Service DNS for backend/security (`deploy/helm/fuzefront/templates/security.yaml`),
 * matching the `SECURITY_SERVICE_URL` convention `services/provisioning-service`
 * already uses for the same Service. `createAuthzClient` appends
 * `/api/v1/security/authz/{check,bulk-check}` itself.
 */
const SECURITY_SERVICE_URL = process.env.SECURITY_SERVICE_URL ?? 'http://fuzefront-security:3002';

/** `NODE_ENV=test` with no explicit client wired -> allow-all, no network. */
export const isNoOpMode: boolean = process.env.NODE_ENV === 'test';

function makeNoOpProxy(): AuthzClient {
  return {
    check: async (): Promise<AuthzDecision> => ({ allow: true }),
    bulkCheck: async (checks: AuthzCheck[]): Promise<AuthzDecision[]> => checks.map(() => ({ allow: true })),
  };
}

let _authzClient: AuthzClient = isNoOpMode
  ? makeNoOpProxy()
  : createAuthzClient({ baseUrl: SECURITY_SERVICE_URL });

export function getAuthzClient(): AuthzClient {
  return _authzClient;
}

/** Test seam: swap the authz client for a mock. Restore in afterEach. */
export function _setAuthzClientForTesting(client: AuthzClient): void {
  _authzClient = client;
}

export { makeNoOpProxy };

/** The Security API resource types this service checks every read/write against. */
export const CONFIG_SCOPE_RESOURCE = 'ConfigScope';
export const CONFIG_CATALOG_RESOURCE = 'ConfigCatalog';

/**
 * The write surface's action vocabulary (FFRNT-158 / FF-EPIC-17-S6):
 *
 *   'write'             — set/unset a non-system value
 *   'lock'               — lock/unlock a value (distinct from 'write' per
 *                          the S6 assumption: write authority at your own
 *                          scope does not imply lock authority over the
 *                          scopes beneath it)
 *   'write-system'       — any operation on an `isSystem` key (platform-only)
 *   'register-namespace' — POST /v1/namespaces
 *   'register-keys'      — PUT /v1/namespaces/{namespace}/keys
 */
export type ConfigAction = 'write' | 'lock' | 'write-system' | 'register-namespace' | 'register-keys';

/** Re-read the raw bearer token so the decision is asked for the CALLER's real credential, never a service-wide one. */
function bearer(req: Request): string | null {
  const header = req.headers['authorization'];
  if (!header || Array.isArray(header)) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

/**
 * Direct-call primitive: ask the Security API one authorization question for
 * `req`'s principal (`req.identity`, set by `middleware/auth.ts`). FAIL
 * CLOSED — a missing identity/token, a policy denial, and a
 * DECISION_UNAVAILABLE/misconfiguration from the client are all `false`;
 * this never throws, so a call site can never forget to catch it.
 *
 * @param tenant  Explicit tenant override (e.g. `GET /v1/config`'s
 *                org-scope-aware derivation). Defaults to
 *                `req.identity.tenantId ?? 'platform'` — this service's own
 *                fallback for a token that carries no org claim, matching
 *                pre-existing behaviour.
 */
export async function checkAuthorization(
  req: Request,
  resource: string,
  action: string,
  key?: string,
  tenant?: string,
): Promise<boolean> {
  const identity = req.identity;
  const token = bearer(req);
  if (!identity || !token) return false;

  const check: AuthzCheck = {
    subject: identity.userId,
    tenant: tenant ?? identity.tenantId ?? 'platform',
    resource: key ? { type: resource, key } : { type: resource },
    action,
  };

  try {
    const decision = await getAuthzClient().check(check, token);
    return decision.allow;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[authz] Security API check threw — failing closed.', {
      err,
      subject: identity.userId,
      resource,
      action,
    });
    return false;
  }
}

/**
 * Returns an Express middleware that enforces an authorization decision via
 * the Security API. Replaces the removed `requirePermit()` — same shape,
 * same 401 (wiring bug: `requireAuth` did not run first) / 403 (denied or
 * undecidable) contract.
 *
 * @param resource        Security API resource type (e.g. 'ConfigScope').
 * @param action           Security API action (e.g. 'read').
 * @param resourceKeyOf    Derives the resource-instance key from the request
 *                          (e.g. the namespace). Omitted -> a tenant-level
 *                          check with no instance key.
 */
export function requireConfigPermission(
  resource: string,
  action: string,
  resourceKeyOf?: (req: Request) => string | undefined,
) {
  return async function authzMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!req.identity) {
      res.status(401).json({ code: 'UNAUTHENTICATED', message: 'No credential, or a credential that is not valid.' });
      return;
    }

    const key = resourceKeyOf ? resourceKeyOf(req) : undefined;
    const allowed = await checkAuthorization(req, resource, action, key);
    if (!allowed) {
      // The response does not reveal whether the requested scope/namespace
      // exists (openapi.yaml `Forbidden` response) — a generic denial only.
      res.status(403).json({ code: 'FORBIDDEN', message: 'Permission denied.' });
      return;
    }
    next();
  };
}

/**
 * Asks the Security API whether `req`'s principal may perform `action` on
 * the config resource instance named by `resourceKey` — e.g.
 * `${namespace}:${scopeType}:${scopeId ?? 'singleton'}` for a scope-level
 * write, or `${namespace}` alone for a namespace/catalog-registration
 * action. FAIL CLOSED: any error (transport, timeout, Security API
 * unavailable) is a deny, never a silent allow.
 *
 * Former signature took a bare `userId`; the Security API needs the
 * CALLER's bearer token to decide for the real principal, so this now takes
 * the request. Deliberately a plain function rather than middleware: the
 * write surface needs to run this AFTER key-existence/shape validation but
 * BEFORE fine-grained value validation (openapi.yaml's `Forbidden` response
 * promises a denial reveals nothing about whether the requested scope/keys
 * are otherwise valid), which route-level middleware ordering can't express
 * as directly as an inline call.
 */
export async function checkConfigPermission(req: Request, action: ConfigAction, resourceKey: string): Promise<boolean> {
  return checkAuthorization(req, 'Config', action, resourceKey);
}
