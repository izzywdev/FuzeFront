/**
 * @fuzefront/auth — Express middleware contract (CONTRACT FREEZE).
 *
 * `requireAuth()` is the frozen Express middleware every FuzeFront-family
 * service mounts to gate a route. It:
 *   1. reads the `Authorization: Bearer <token>` header (fail-closed on absence),
 *   2. verifies via the configured `Verifier`,
 *   3. attaches the normalized `Identity` to `req.identity`,
 *   4. on any failure responds `401` (authn) with a stable error body — it NEVER
 *      calls `next()` with an unauthenticated request.
 *
 * `requireRoles()` is an authZ guard that runs AFTER `requireAuth()`.
 *
 * NOTE ON EXPRESS TYPES: FuzeFront pins `@types/express` to v4 via root
 * `overrides`. We augment `Request` with `identity?` and re-declare nothing else
 * to avoid the CI TS2339 `serve-static-core` resolution issue documented in the
 * backend. `express` is an OPTIONAL peer dependency so non-Express consumers
 * (edge, test) can import `verifyToken`/types without pulling Express.
 *
 * Status codes are deliberate: 401 means "who are you?" (authn — re-authenticate),
 * 403 means "I know who you are, and no" (authz — re-authenticating changes
 * nothing). Collapsing them sends clients into pointless login loops.
 */

import type { NextFunction, Request, Response } from 'express';
import { AuthError, Identity, Verifier } from './types';

/**
 * Module augmentation: after `requireAuth()`, `req.identity` holds the stable
 * `Identity`. It is optional on the base type (a route without the middleware
 * has no identity); guards downstream should assert its presence.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Populated by `requireAuth()`. Absent on unauthenticated requests. */
      identity?: Identity;
    }
  }
}

/** Options controlling `requireAuth`'s wiring. */
export interface RequireAuthOptions {
  /** The verifier used to validate tokens. Required. */
  verifier: Verifier;
  /**
   * Header to read the token from. Default `'authorization'` with a `Bearer `
   * scheme.
   */
  header?: string;
  /**
   * When true, a missing/invalid token calls `next()` WITHOUT an identity
   * instead of responding 401 (for routes that are auth-optional). Default
   * `false` (fail-closed — the safe default).
   */
  optional?: boolean;
}

/** The shape of the JSON error body `requireAuth` sends on rejection. */
export interface AuthErrorBody {
  error: string;
  code: string;
}

/**
 * Pull the raw token out of `Authorization: Bearer <token>` (or a custom header).
 * Scheme match is case-insensitive per RFC 6750; anything else yields undefined
 * and is treated as "no token".
 */
function readBearer(req: Request, header: string): string | undefined {
  const raw = req.headers[header.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || !value) return undefined;
  const [scheme, token] = value.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return undefined;
  return token;
}

/**
 * Single rejection path. Every denial routes through here so the body shape and
 * status stay consistent, and so an unexpected error can never fall through as
 * success. Non-AuthError throwables become an opaque 401 — an unknown failure is
 * still a failure, and its message must not leak internals to the caller.
 */
function deny(res: Response, err: unknown): void {
  const authErr =
    err instanceof AuthError ? err : new AuthError('UNKNOWN', 'authentication failed');
  const body: AuthErrorBody = { error: authErr.message, code: authErr.code };
  res.status(authErr.status).json(body);
}

/** Guards run after requireAuth; a missing identity is a wiring bug, not a 403. */
function requireIdentity(req: Request, res: Response): Identity | undefined {
  const identity = req.identity;
  if (!identity) {
    // Ordering mistake (guard mounted before/without requireAuth). Deny — but as
    // 401, because nothing here is authenticated at all.
    deny(res, new AuthError('NO_TOKEN', 'requireAuth() must run before this guard'));
    return undefined;
  }
  return identity;
}

/**
 * Express middleware factory. FROZEN SIGNATURE — implementation is a follow-up.
 *
 * @example
 *   const verifier = createVerifier({ mode: 'legacy-hs256', secret, resolver });
 *   app.use('/api/private', requireAuth({ verifier }));
 */
export function requireAuth(
  options: RequireAuthOptions,
): (req: Request, res: Response, next: NextFunction) => void {
  const { verifier, header = 'authorization', optional = false } = options;
  if (!verifier) {
    // Fail at wiring time. A middleware built without a verifier that only threw
    // on first request would ship a route silently ungated until traffic hit it.
    throw new AuthError('VERIFIER_UNAVAILABLE', 'requireAuth requires a `verifier`', 500);
  }

  return function requireAuthHandler(req: Request, res: Response, next: NextFunction): void {
    const token = readBearer(req, header);

    if (!token) {
      // `optional` routes continue WITHOUT an identity — they must never
      // continue with a half-built one.
      if (optional) return next();
      return deny(res, new AuthError('NO_TOKEN', 'no bearer token presented'));
    }

    // Express 4 does not await handlers, so the promise is driven here and every
    // rejection is funnelled to `deny`. An unhandled rejection would leave the
    // request hanging rather than denying it — the one failure mode a
    // fail-closed gate cannot have.
    verifier
      .verify(token)
      .then(identity => {
        req.identity = identity;
        next();
      })
      .catch((err: unknown) => {
        if (optional) return next();
        deny(res, err);
      });
  };
}

/**
 * AuthZ guard: require the authenticated identity to hold ALL (default) or ANY
 * of the given roles. Runs after `requireAuth()`. Responds `403` on failure.
 * FROZEN SIGNATURE.
 */
export function requireRoles(
  roles: string[],
  mode: 'all' | 'any' = 'all',
): (req: Request, res: Response, next: NextFunction) => void {
  return function requireRolesHandler(req: Request, res: Response, next: NextFunction): void {
    const identity = requireIdentity(req, res);
    if (!identity) return;

    const held = identity.roles ?? [];
    const ok =
      mode === 'any'
        ? roles.some(r => held.includes(r))
        : roles.every(r => held.includes(r));

    if (!ok) {
      // 403, not 401: the caller IS authenticated, just not permitted. Collapsing
      // these would tell a client to re-authenticate over a permission problem.
      //
      // Note this denies when roles are empty — which is exactly right for the
      // legacy-hs256 token, whose roles only exist if an out-of-band resolver
      // hydrated them. No resolver means no roles means no role-gated access,
      // rather than a silent grant.
      const body: AuthErrorBody = {
        error: `requires ${mode === 'any' ? 'any of' : 'all of'}: ${roles.join(', ')}`,
        code: 'FORBIDDEN',
      };
      res.status(403).json(body);
      return;
    }
    next();
  };
}

/**
 * AuthZ guard: require the identity to be scoped to the given tenant. Fail-closed
 * when `identity.tenantId` is `null` (unresolved). FROZEN SIGNATURE.
 */
export function requireTenant(
  tenantId: string,
): (req: Request, res: Response, next: NextFunction) => void {
  return function requireTenantHandler(req: Request, res: Response, next: NextFunction): void {
    const identity = requireIdentity(req, res);
    if (!identity) return;

    if (identity.tenantId === null || identity.tenantId === undefined) {
      // UNRESOLVED is not the same as "matches". A legacy-hs256 identity with no
      // resolver has tenantId null, and treating null as a wildcard would hand
      // every tenant's data to any valid token — the worst possible reading of a
      // missing value. Deny, and say why, because this is a config gap (no
      // resolver wired) rather than a permission decision.
      const body: AuthErrorBody = {
        error: 'tenant scope is unresolved for this identity; wire an OutOfBandResolver',
        code: 'MISSING_CLAIM',
      };
      res.status(403).json(body);
      return;
    }

    if (identity.tenantId !== tenantId) {
      const body: AuthErrorBody = { error: 'identity is not scoped to this tenant', code: 'FORBIDDEN' };
      res.status(403).json(body);
      return;
    }
    next();
  };
}

/** Re-export so consumers can `instanceof AuthError` in error handlers. */
export { AuthError };
