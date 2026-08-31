/**
 * @fuzefront/service-auth — Express middleware.
 *
 * `requireMachineAuth()` gates a route to machine (client-credentials)
 * callers only. It reads the bearer token, verifies it via a
 * `MachineTokenVerifier` (see `verifier.ts` — fail-closed, branches on the
 * introspection body's `active`, never on HTTP status), attaches the
 * resulting `MachineIdentity` to `req.machineIdentity`, and never calls
 * `next()` for a request that didn't pass.
 *
 * `express` is an OPTIONAL peer dependency — only importing this file pulls
 * in Express types; `createServiceAuthClient`/`createMachineTokenVerifier`
 * have no Express dependency at all.
 */

import type { NextFunction, Request, Response } from 'express';
import { MachineIdentity, ServiceAuthError } from './types';
import { MachineTokenVerifier } from './verifier';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Populated by `requireMachineAuth()`. Absent on requests it did not gate. */
      machineIdentity?: MachineIdentity;
    }
  }
}

/** The JSON error body `requireMachineAuth` sends on rejection. */
export interface MachineAuthErrorBody {
  error: string;
  code: string;
}

/**
 * A per-caller authorization hook, run AFTER verification succeeds. This is
 * the seam for wiring in the `/authz/*` routes once they're live — e.g.
 * `authorize: (identity, req) => authzClient.check({ subject: identity.subject,
 * tenant: identity.tenantId!, resource: {type: 'invoice'}, action: 'read' },
 * bearerFromReq(req)).then(d => d.allow)`. Left unset, every verified machine
 * identity is authorized (authentication-only gating). A thrown/rejected hook
 * is treated as a denial — same fail-closed rule as verification itself.
 */
export type MachineAuthorizeHook = (
  identity: MachineIdentity,
  req: Request,
) => Promise<boolean> | boolean;

export interface RequireMachineAuthOptions {
  /** The verifier used to validate tokens. Required. */
  verifier: MachineTokenVerifier;
  /** Header to read the token from. Default `'authorization'` with a `Bearer` scheme. */
  header?: string;
  /** Optional per-caller authorization check. See {@link MachineAuthorizeHook}. */
  authorize?: MachineAuthorizeHook;
}

/** Pull the raw token out of `Authorization: Bearer <token>` (or a custom header). */
function readBearer(req: Request, header: string): string | undefined {
  const raw = req.headers[header.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || !value) return undefined;
  const [scheme, token] = value.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return undefined;
  return token;
}

function deny(res: Response, err: unknown): void {
  const authErr =
    err instanceof ServiceAuthError ? err : new ServiceAuthError('UNKNOWN', 'machine authentication failed', 401);
  const body: MachineAuthErrorBody = { error: authErr.message, code: authErr.code };
  res.status(authErr.status).json(body);
}

/**
 * Express middleware factory: require a verified machine (client-credentials)
 * identity, and optionally a passing `authorize` decision.
 *
 * @example
 *   const verifier = createMachineTokenVerifier({ baseUrl: process.env.FUZEFRONT_API_URL! });
 *   app.use('/internal', requireMachineAuth({ verifier }));
 */
export function requireMachineAuth(
  options: RequireMachineAuthOptions,
): (req: Request, res: Response, next: NextFunction) => void {
  const { verifier, header = 'authorization', authorize } = options;
  if (!verifier) {
    throw new ServiceAuthError('MISCONFIGURED', 'requireMachineAuth requires a `verifier`', 500);
  }

  return function requireMachineAuthHandler(req: Request, res: Response, next: NextFunction): void {
    const token = readBearer(req, header);

    if (!token) {
      return deny(res, new ServiceAuthError('NO_TOKEN', 'no bearer token presented', 401));
    }

    verifier
      .verifyMachineToken(token)
      .then(async identity => {
        req.machineIdentity = identity;

        if (!authorize) {
          next();
          return;
        }

        let allowed: boolean;
        try {
          allowed = await authorize(identity, req);
        } catch (err) {
          // Undecidable authz (hook threw) => deny. Never next().
          deny(res, new ServiceAuthError('FORBIDDEN', 'authorization decision unavailable; denying', 403));
          return;
        }

        if (!allowed) {
          deny(res, new ServiceAuthError('FORBIDDEN', 'not permitted', 403));
          return;
        }
        next();
      })
      .catch((err: unknown) => {
        // Verification failure (inactive token, network error, malformed
        // body — see verifier.ts). Always a denial; never next().
        deny(res, err);
      });
  };
}

export { ServiceAuthError };
