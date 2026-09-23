// auth.ts — stateless JWT verification middleware for selection-list-service.
//
// Design intent:
//   - Verifies the JWT signature using JWT_SECRET. Algorithm: default (HS256).
//   - Attaches req.userId from the token's `userId` claim.
//   - Attaches req.orgId from the token's `orgId` claim if present.
//   - Does NOT hit the database. selection-list-service is stateless re: identity:
//     the token is the source of truth.
//   - Missing token → 401.  Invalid/expired token → 401.  Valid → next().

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
  sub?: string;
  organizationId?: string;
  organization_id?: string;
  userId: string;
  orgId?: string;
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
    // Accept BOTH spellings. The platform mints its own tokens with
    // `userId`/`orgId` (backend/src/middleware/auth.ts), but an Authentik-issued
    // OIDC token carries the standard `sub` plus a snake_case
    // `organization_id` -- which is what the integration harness mints, per its
    // own doc comment. Reading only the first pair meant every such request
    // arrived with req.orgId undefined and was rejected with
    // "Organization context required". config-service already reads both
    // (`decoded.userId ?? decoded.sub`); this brings the service in line.
    // Identity still comes from the VERIFIED token -- this widens which claim
    // name is read, never whether the signature is checked.
    req.userId = decoded.userId ?? decoded.sub;
    req.orgId = decoded.orgId ?? decoded.organizationId ?? decoded.organization_id;
    req.appId = decoded.appId;
    next();
  } catch {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Invalid token.' });
  }
}
