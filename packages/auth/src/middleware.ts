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
 * Implementation is a FOLLOW-UP slice; signatures are frozen here.
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
 * Express middleware factory. FROZEN SIGNATURE — implementation is a follow-up.
 *
 * @example
 *   const verifier = createVerifier({ mode: 'legacy-hs256', secret, resolver });
 *   app.use('/api/private', requireAuth({ verifier }));
 */
export function requireAuth(
  options: RequireAuthOptions,
): (req: Request, res: Response, next: NextFunction) => void {
  void options;
  return function requireAuthHandler(_req: Request, res: Response, _next: NextFunction): void {
    // Interface freeze only — real impl reads header, awaits verifier.verify,
    // sets req.identity, and fail-closes on AuthError.
    const body: AuthErrorBody = {
      error: '@fuzefront/auth is contract-frozen; middleware runtime not yet implemented (#117).',
      code: 'VERIFIER_UNAVAILABLE',
    };
    res.status(501).json(body);
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
  void roles;
  void mode;
  return function requireRolesHandler(_req: Request, res: Response, _next: NextFunction): void {
    const body: AuthErrorBody = {
      error: '@fuzefront/auth is contract-frozen; authz guard runtime not yet implemented (#117).',
      code: 'VERIFIER_UNAVAILABLE',
    };
    res.status(501).json(body);
  };
}

/**
 * AuthZ guard: require the identity to be scoped to the given tenant. Fail-closed
 * when `identity.tenantId` is `null` (unresolved). FROZEN SIGNATURE.
 */
export function requireTenant(
  tenantId: string,
): (req: Request, res: Response, next: NextFunction) => void {
  void tenantId;
  return function requireTenantHandler(_req: Request, res: Response, _next: NextFunction): void {
    const body: AuthErrorBody = {
      error: '@fuzefront/auth is contract-frozen; tenant guard runtime not yet implemented (#117).',
      code: 'VERIFIER_UNAVAILABLE',
    };
    res.status(501).json(body);
  };
}

/** Re-export so consumers can `instanceof AuthError` in error handlers. */
export { AuthError };
