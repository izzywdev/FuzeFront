// auth.ts — stateless JWT verification middleware for chat-service.
//
// Design intent (§10d, brief auth detail):
//   - Verifies the JWT signature using JWT_SECRET. Algorithm: default (HS256).
//   - Attaches req.userId from the token's `userId` claim.
//   - Attaches req.orgId from the token's `orgId` claim if present; otherwise
//     undefined. callers pass orgId in the request body/params but chat-service
//     validates membership in a later unit — here we only trust what's in the token.
//   - Does NOT hit the database. chat-service is stateless re: identity: the
//     token is the source of truth. (Compare backend/src/middleware/auth.ts which
//     does a DB user lookup — that step is intentionally absent here.)
//   - Missing token → 401.  Invalid/expired token → 401.  Valid → next().
//   - No console.log noise.

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Augment Express Request with chat-service identity claims.
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      orgId?: string;
    }
  }
}

interface JwtClaims {
  userId: string;
  orgId?: string;
  [key: string]: unknown;
}

export function authenticateToken(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    res.status(401).json({ error: 'Access denied. No token provided.' });
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // Should never happen in production — config validation catches it at startup.
    res.status(500).json({ error: 'Server misconfiguration: JWT_SECRET not set.' });
    return;
  }

  try {
    const decoded = jwt.verify(token, secret) as JwtClaims;
    req.userId = decoded.userId;
    req.orgId = decoded.orgId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token.' });
  }
}
