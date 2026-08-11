/**
 * Stateless JWT verification for config-service's write surface, matching
 * the family's shared-secret session token: `JWT_SECRET`-signed, subject in
 * `userId` (`backend/src/middleware/auth.ts`), `portalId` optionally present
 * on tokens minted while FF-EPIC-10's multi-tenant-portals flag was ON
 * (`decoded.portalId?`). Deliberately the SAME shape read by
 * `services/selection-list-service/src/middleware/auth.ts`'s `userId`/`orgId`
 * claims, so a caller's existing platform token works unmodified against
 * every FuzeFront-family microservice.
 *
 * Does NOT hit the database (config-service is stateless re: identity — the
 * token, not a session row, is the source of truth). Missing/invalid/expired
 * token -> 401 `UNAUTHENTICATED`. Authorization (can THIS principal write at
 * THIS scope) is a separate, later step — see src/auth/permit.ts.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { sendError } from '../http/errors';

export interface Principal {
  userId: string;
  /** Present when the token was minted with a portal context (FF-EPIC-10). */
  portalId?: string;
  /** Present on tokens minted with an org-scoped claim. */
  orgId?: string;
  roles: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Populated by `authMiddleware`. Absent on unauthenticated requests. */
      principal?: Principal;
    }
  }
}

interface JwtClaims {
  userId?: string;
  sub?: string;
  portalId?: string;
  orgId?: string;
  roles?: string[] | string;
  [key: string]: unknown;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // "Bearer <token>"

  if (!token) {
    sendError(res, 401, { code: 'UNAUTHENTICATED', message: 'No credential supplied.' });
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // Fail CLOSED: an unset signing secret must never be treated as "accept
    // anything" — see billing-service auth.ts's HIGH-2 precedent.
    // eslint-disable-next-line no-console
    console.error('[config-service] JWT_SECRET is not set — refusing every credential (fail-closed).');
    sendError(res, 401, { code: 'UNAUTHENTICATED', message: 'Server misconfiguration.' });
    return;
  }

  try {
    // Algorithm PINNED to HS256. Without this, `jwt.verify` accepts whatever
    // `alg` the token header claims — including `none` or an asymmetric
    // algorithm — which is the classic JWT algorithm-confusion attack (a
    // token crafted with `alg: none`, or one signed with a public key the
    // verifier is tricked into treating as an HMAC secret, would otherwise
    // verify successfully). Mirrors `@fuzefront/auth`'s legacy-hs256 verifier.
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as JwtClaims;
    const userId = decoded.userId ?? decoded.sub;
    if (!userId) {
      sendError(res, 401, { code: 'UNAUTHENTICATED', message: 'Token has no subject claim.' });
      return;
    }
    const roles = Array.isArray(decoded.roles) ? decoded.roles : decoded.roles ? [decoded.roles] : [];
    req.principal = {
      userId,
      portalId: typeof decoded.portalId === 'string' ? decoded.portalId : undefined,
      orgId: typeof decoded.orgId === 'string' ? decoded.orgId : undefined,
      roles,
    };
    next();
  } catch {
    sendError(res, 401, { code: 'UNAUTHENTICATED', message: 'Invalid or expired credential.' });
  }
}
