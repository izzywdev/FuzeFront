/**
 * Stateless JWT verification middleware for config-service (FFRNT-157).
 *
 * Mirrors `services/selection-list-service/src/middleware/auth.ts`: verifies
 * the bearer JWT against `JWT_SECRET` (the platform-wide signing secret) and
 * attaches the decoded claims to the request. Does NOT hit the database —
 * config-service is stateless with respect to identity, matching its
 * `bearerAuth` security scheme in openapi.yaml (the caller's own access
 * token, verified directly by this service — not a proxied internal token
 * the way billing-service's cluster-internal routes are).
 *
 * Missing token -> 401 UNAUTHENTICATED. Invalid/expired token -> 401
 * UNAUTHENTICATED. Valid -> next(), with req.userId (+ req.orgId/portalId if
 * the token happens to carry those claims) populated.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** The authenticated principal (JWT `userId` claim). Set by requireAuth(). */
      userId?: string;
      /**
       * Optional org context, when the caller's token carries one. Not every
       * platform JWT does (see routes/config.routes.ts's chain-assembly
       * comment) — this is best-effort context, not a guarantee.
       */
      orgId?: string;
      /** Optional portal context (FF-EPIC-10-S3 `portalId` claim), if present. */
      portalId?: string;
    }
  }
}

interface JwtClaims {
  userId: string;
  orgId?: string;
  organizationId?: string;
  portalId?: string;
  [key: string]: unknown;
}

/**
 * Verifies the bearer JWT and attaches identity claims to the request.
 * Mounted ahead of every `/v1/*` read route (openapi.yaml `security: bearerAuth`).
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;

  if (!token) {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'No credential, or a credential that is not valid.' });
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // Fail CLOSED: an unset signing secret must never be treated as "accept
    // anything" — that would turn a misconfiguration into an open service.
    res.status(503).json({ code: 'UNAUTHENTICATED', message: 'Server misconfiguration: JWT_SECRET not set.' });
    return;
  }

  try {
    const decoded = jwt.verify(token, secret) as JwtClaims;
    if (!decoded.userId) throw new Error('token missing userId claim');
    req.userId = decoded.userId;
    // Accept either claim name; the platform JWT does not yet carry an org
    // claim at all (see routes/config.routes.ts), but this stays
    // forward-compatible with whichever name a future token shape uses.
    req.orgId = decoded.orgId ?? decoded.organizationId;
    req.portalId = decoded.portalId;
    next();
  } catch {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'No credential, or a credential that is not valid.' });
  }
}
