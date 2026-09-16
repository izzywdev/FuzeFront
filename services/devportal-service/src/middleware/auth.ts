// auth.ts — stateless session-JWT verification middleware for
// devportal-service.
//
// governance/architecture-guidelines.md §1 — AuthN is provided by FuzeFront;
// products VERIFY FuzeFront-issued tokens, they never mint their own. The
// session cookie devportal-service issues is the EXACT token
// security-service's `/internal/mint-session` returns (services/
// internalClient.ts's `mintSession`) — the same `{userId, sessionId}` shape,
// same `JWT_SECRET`, same `sessions` table row as the core `/oidc/callback`
// flow. This file only VERIFIES that token; it does not sign one. Mirrors
// services/selection-list-service/src/middleware/auth.ts's JWT_SECRET
// verification exactly, on purpose — devportal-service trusts the same
// platform token every other service does, not a service-local secret.

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export const SESSION_COOKIE = 'devportal_session';
// Display-only hint, never used for an auth decision — the email claim does
// not exist on the FuzeFront-issued token (see the header comment), so it is
// carried here purely for "My access"/NavBar to show a friendly name.
export const EMAIL_COOKIE = 'devportal_email';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
    }
  }
}

interface FuzeFrontSessionClaims {
  userId: string;
  sessionId?: string;
  [key: string]: unknown;
}

function getSecret(): string | null {
  return process.env.JWT_SECRET || null;
}

/**
 * Requires a valid FuzeFront session. Missing/invalid/expired -> 401. Reads
 * the token from the httpOnly cookie first (browser flow), falling back to a
 * Bearer header (useful for CLI/tooling access to the same catalog API).
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const cookieToken = (req as any).cookies?.[SESSION_COOKIE];
  const authHeader = req.headers['authorization'];
  const bearerToken = authHeader && authHeader.split(' ')[1];
  const token = cookieToken || bearerToken;

  if (!token) {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'No devportal session.' });
    return;
  }

  const secret = getSecret();
  if (!secret) {
    res.status(500).json({ code: 'UNAUTHENTICATED', message: 'Server misconfiguration: JWT_SECRET not set.' });
    return;
  }

  try {
    const decoded = jwt.verify(token, secret) as FuzeFrontSessionClaims;
    req.userId = decoded.userId;
    req.userEmail = (req as any).cookies?.[EMAIL_COOKIE];
    next();
  } catch {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Invalid or expired session.' });
  }
}

/**
 * Optional session: attaches req.userId when a valid session is present but
 * never rejects the request. Used by routes with a signed-out state (Home,
 * Catalog) that only PERSONALIZE when signed in.
 */
export function optionalAuthMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const cookieToken = (req as any).cookies?.[SESSION_COOKIE];
  const authHeader = req.headers['authorization'];
  const bearerToken = authHeader && authHeader.split(' ')[1];
  const token = cookieToken || bearerToken;
  const secret = getSecret();

  if (token && secret) {
    try {
      const decoded = jwt.verify(token, secret) as FuzeFrontSessionClaims;
      req.userId = decoded.userId;
      req.userEmail = (req as any).cookies?.[EMAIL_COOKIE];
    } catch {
      // Not signed in — proceed as anonymous, same as no cookie at all.
    }
  }
  next();
}
