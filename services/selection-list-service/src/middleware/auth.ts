// auth.ts — stateless JWT verification middleware for selection-list-service.
//
// Design intent:
//   - Verifies the JWT signature using JWT_SECRET. Algorithm: default (HS256).
//   - Attaches req.userId from `userId`, falling back to the standard `sub`.
//   - Attaches req.orgId from `orgId`, falling back to `organization_id` /
//     `organizationId` if present.
//   - Does NOT hit the database. selection-list-service is stateless re: identity:
//     the token is the source of truth.
//   - Missing token → 401.  Invalid/expired token → 401.  Valid → next().
//
// WHY THE ALIASES. This middleware originally read `userId`/`orgId` ONLY, which
// is narrower than the two token shapes it actually has to accept:
//
//   - openapi.yaml's `bearerAuth` — this service's own frozen contract — says
//     "Authentik-issued JWT. `organization_id` and the acting user are derived
//     from the token claims". A real Authentik token carries `sub` and
//     `organization_id`; neither name was read here, so every org-scoped route
//     answered 401 "Organization context required" for a token that satisfies
//     the published spec. That is what the independent acceptance suite
//     (tests/selection-list-service) mints, and why 134 of its tests failed
//     with that exact message once the release flag was forced on in CI.
//   - FuzeFront's own platform token (backend/security/src/routes/auth.ts)
//     carries `userId` + `sessionId` and NO org claim at all — so `orgId`
//     legitimately stays undefined there and the route-level 401 is correct.
//
// Accepting the union is additive: a token that already carried `userId`/`orgId`
// resolves identically. This mirrors config-service's requireAuth
// (services/config-service/src/middleware/auth.ts), which took the same
// widening deliberately for the same reason.

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Augment Express Request with selection-list-service identity claims.
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      orgId?: string;
      appId?: string;
    }
  }
}

interface JwtClaims {
  userId?: string;
  /** Standard subject claim — what an Authentik-issued token carries. */
  sub?: string;
  orgId?: string;
  /** openapi.yaml `bearerAuth` names this claim; Authentik emits it. */
  organization_id?: string;
  /** camelCase variant, accepted for parity with config-service. */
  organizationId?: string;
  appId?: string;
  [key: string]: unknown;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Access denied. No token provided.' });
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res.status(500).json({ code: 'UNAUTHENTICATED', message: 'Server misconfiguration: JWT_SECRET not set.' });
    return;
  }

  try {
    const decoded = jwt.verify(token, secret) as JwtClaims;
    const userId = decoded.userId ?? decoded.sub;
    if (!userId) {
      // A signature-valid token with no subject is not an identity. Reject it
      // rather than letting req.userId stay undefined and having each route
      // rediscover that on its own.
      res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Invalid token.' });
      return;
    }
    req.userId = userId;
    // Left to right: this service's original claim name, then the two names the
    // published contract and config-service use. Undefined when the token
    // genuinely carries no org — the route-level guards answer 401 for that.
    req.orgId = decoded.orgId ?? decoded.organization_id ?? decoded.organizationId;
    req.appId = decoded.appId;
    next();
  } catch {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Invalid token.' });
  }
}
