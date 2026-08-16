/**
 * Stateless JWT verification middleware for config-service. The SOLE JWT
 * verifier for this service (FFRNT-157 read + FFRNT-158 write) — see the
 * reconciliation note on PR #641: FFRNT-157 and FFRNT-158 were built in
 * parallel and each shipped its own verifier (this one, and the
 * now-deleted `src/auth/jwt.ts`). This file won on merge because it landed
 * on `master` first; it is extended here to also populate `req.principal`
 * (the shape the write routes were built against) so neither side had to
 * change its call sites.
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
 * the token happens to carry those claims) AND req.principal populated.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

/** The write-surface's view of the authenticated caller. Set by requireAuth(). */
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
      /**
       * Same identity as userId/orgId/portalId above, reshaped into one
       * object (+ roles) for the write-surface handlers (FFRNT-158), which
       * were built against this shape. Always set together with
       * userId/orgId/portalId — never populated on its own.
       */
      principal?: Principal;
    }
  }
}

interface JwtClaims {
  userId?: string;
  /** Fallback subject claim, for tokens that carry `sub` instead of `userId`. */
  sub?: string;
  orgId?: string;
  organizationId?: string;
  portalId?: string;
  roles?: string[] | string;
  [key: string]: unknown;
}

/**
 * Verifies the bearer JWT and attaches identity claims to the request.
 * Mounted ahead of every `/v1/*` route (openapi.yaml `security: bearerAuth`).
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
    // Algorithm PINNED to HS256. Without this, `jwt.verify` accepts whatever
    // `alg` the token header claims -- including `none`, or an asymmetric
    // algorithm whose public key the verifier is then tricked into treating as
    // an HMAC secret. That is the classic JWT algorithm-confusion attack, and
    // it turns "verified" into "attacker-supplied". Matches the write surface
    // (FFRNT-158) and `@fuzefront/auth`'s legacy-hs256 verifier.
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as JwtClaims;
    // Accept either claim name; a token minted with a `sub` subject claim
    // (rather than `userId`) is still a valid identity — this is the write
    // surface's fallback, additive to the strict `userId`-only read path.
    const userId = decoded.userId ?? decoded.sub;
    if (!userId) throw new Error('token missing userId/sub claim');
    req.userId = userId;
    // Accept either claim name; the platform JWT does not yet carry an org
    // claim at all (see routes/config.routes.ts), but this stays
    // forward-compatible with whichever name a future token shape uses.
    req.orgId = decoded.orgId ?? decoded.organizationId;
    req.portalId = decoded.portalId;
    const roles = Array.isArray(decoded.roles) ? decoded.roles : decoded.roles ? [decoded.roles] : [];
    req.principal = {
      userId,
      portalId: req.portalId,
      orgId: req.orgId,
      roles,
    };
    next();
  } catch {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'No credential, or a credential that is not valid.' });
  }
}
