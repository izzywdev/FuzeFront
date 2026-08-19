/**
 * @fuzefront/auth — `requirePermission()`, the policy-backed Express guard.
 *
 * Runs AFTER `requireAuth()` and reads `req.identity`. Where `requireRoles()`
 * can only compare role strings the token already carried (coarse RBAC),
 * `requirePermission()` asks FuzeFront's Security API for a real policy
 * decision — so it covers ABAC (via `context`) and ReBAC (via a per-instance
 * `resourceKey` derived from the request) too.
 *
 * Every option may be a literal or a `(req) => string` resolver; the resolver is
 * what lets a route name the *specific* object under decision:
 *
 *   app.get('/invoices/:id',
 *     requireAuth({ verifier }),
 *     requirePermission({
 *       client,
 *       resource: 'invoice',
 *       action: 'read',
 *       resourceKey: (req) => req.params.id,
 *     }),
 *     handler);
 *
 * FAIL-CLOSED, with no fail-open option by design: 401 iff the guard was mounted
 * without `requireAuth` (a wiring bug, reported as such rather than silently
 * denied), 403 for every genuine denial AND every undecidable case.
 */

import type { NextFunction, Request, Response } from 'express';
import { AuthzCheck, AuthzClient, AuthzError, AuthzErrorCode } from './authzTypes';

/** A guard option that is either a literal or derived from the request. */
export type ValueOrResolver<T> = T | ((req: Request) => T);

/** The JSON error body `requirePermission` sends. Mirrors `AuthErrorBody`. */
export interface AuthzErrorBody {
  error: string;
  code: AuthzErrorCode;
}

/** Options for {@link requirePermission}. */
export interface RequirePermissionOptions {
  /** The client bound to FuzeFront's Security API. Required. */
  client: AuthzClient;
  /** Resource type, literal or derived from the request. */
  resource: ValueOrResolver<string>;
  /** Action being attempted, literal or derived from the request. */
  action: ValueOrResolver<string>;
  /**
   * Tenant scope. Defaults to `req.identity.tenantId`. When neither is
   * resolvable the request is DENIED — an unscoped decision is not a decision.
   */
  tenant?: ValueOrResolver<string>;
  /** Specific resource instance key — this is what makes the check instance-level. */
  resourceKey?: ValueOrResolver<string>;
  /** Extra attributes for the policy to evaluate (the "A" in ABAC). */
  context?: ValueOrResolver<Record<string, unknown>>;
  /**
   * Subject override. Defaults to `req.identity.userId`. Rarely needed; a
   * service asking on another principal's behalf must be trusted to do so.
   */
  subject?: ValueOrResolver<string>;
}

function resolve<T>(value: ValueOrResolver<T> | undefined, req: Request): T | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'function' ? (value as (r: Request) => T)(req) : value;
}

/** Re-read the raw bearer token so we can forward the CALLER's credential verbatim. */
function bearer(req: Request): string | null {
  const header = req.headers?.['authorization'];
  if (!header || Array.isArray(header)) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

function fail(res: Response, code: AuthzErrorCode, error: string, status: number): void {
  const body: AuthzErrorBody = { error, code };
  res.status(status).json(body);
}

/**
 * Express middleware factory: require a policy-backed permission.
 * Mount AFTER `requireAuth()`.
 */
export function requirePermission(
  options: RequirePermissionOptions,
): (req: Request, res: Response, next: NextFunction) => void {
  if (!options?.client) {
    throw new AuthzError(
      'AUTHZ_MISCONFIGURED',
      'requirePermission requires a `client` from createAuthzClient().',
      500,
    );
  }

  return function requirePermissionHandler(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const identity = req.identity;
    if (!identity) {
      // 401, NOT 403 — this is not the caller's fault. The guard was mounted
      // without requireAuth in front of it. Collapsing it into 403 would let a
      // wiring bug masquerade as a routine permission denial forever.
      return fail(
        res,
        'IDENTITY_MISSING',
        'No authenticated identity on the request. Mount requireAuth() before requirePermission().',
        401,
      );
    }

    const token = bearer(req);
    if (!token) {
      return fail(
        res,
        'IDENTITY_MISSING',
        'No bearer token to forward for the authorization decision.',
        401,
      );
    }

    let check: AuthzCheck;
    try {
      const resource = resolve(options.resource, req);
      const action = resolve(options.action, req);
      const tenant = resolve(options.tenant, req) ?? identity.tenantId ?? undefined;
      const subject = resolve(options.subject, req) ?? identity.userId;

      if (!tenant) {
        // `Identity.tenantId` is legitimately null in legacy mode. Fail closed.
        return fail(
          res,
          'TENANT_UNRESOLVED',
          'No tenant scope for the authorization decision; denying.',
          403,
        );
      }
      if (!resource || !action) {
        return fail(
          res,
          'AUTHZ_MISCONFIGURED',
          'requirePermission could not resolve `resource`/`action`; denying.',
          403,
        );
      }

      check = {
        subject,
        tenant,
        resource: { type: resource, key: resolve(options.resourceKey, req) },
        action,
        context: resolve(options.context, req),
      };
    } catch (err) {
      // A resolver threw (e.g. req.params shape changed). Undecidable => deny.
      return fail(
        res,
        'AUTHZ_MISCONFIGURED',
        `Failed to build the authorization query: ${(err as Error)?.message ?? 'unknown error'}; denying.`,
        403,
      );
    }

    options.client
      .check(check, token)
      .then((decision) => {
        if (decision.allow) return next();
        fail(
          res,
          'FORBIDDEN',
          `Not permitted to ${check.action} ${check.resource.type}.`,
          403,
        );
      })
      .catch((err) => {
        // DECISION_UNAVAILABLE and anything unforeseen. Never next().
        const code: AuthzErrorCode =
          err instanceof AuthzError ? err.code : 'DECISION_UNAVAILABLE';
        fail(res, code, 'Authorization decision unavailable; denying.', 403);
      });
  };
}

/** Re-export so consumers can `instanceof AuthzError` in error handlers. */
export { AuthzError };
