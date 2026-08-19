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
    req.userId = decoded.userId;
    req.orgId = decoded.orgId;
    req.appId = decoded.appId;
    next();
  } catch {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Invalid token.' });
  }
}
