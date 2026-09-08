// auth.ts — stateless session-JWT verification middleware for
// devportal-service.
//
// Unlike selection-list-service (which trusts a platform-wide JWT_SECRET
// token minted elsewhere), devportal-service mints its OWN session after
// completing its own Authentik OIDC exchange (routes/auth.ts) and hands it
// back as an httpOnly cookie — a browser SPA session, not a service-to-
// service Bearer token. DEVPORTAL_JWT_SECRET is deliberately its own secret
// (not the platform JWT_SECRET) so a devportal session cannot be replayed
// against any other FuzeFront service, and vice versa.

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export const SESSION_COOKIE = 'devportal_session';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
    }
  }
}

interface DevportalSessionClaims {
  userId: string;
  email?: string;
  [key: string]: unknown;
}

function getSecret(): string | null {
  return process.env.DEVPORTAL_JWT_SECRET || null;
}

export function signSession(claims: DevportalSessionClaims): string {
  const secret = getSecret();
  if (!secret) {
    throw new Error('DEVPORTAL_JWT_SECRET is not set');
  }
  return jwt.sign(claims, secret, { expiresIn: '12h' });
}

/**
 * Requires a valid session. Missing/invalid/expired -> 401. Reads the token
 * from the httpOnly cookie first (browser flow), falling back to a Bearer
 * header (useful for CLI/tooling access to the same catalog API).
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
    res.status(500).json({ code: 'UNAUTHENTICATED', message: 'Server misconfiguration: DEVPORTAL_JWT_SECRET not set.' });
    return;
  }

  try {
    const decoded = jwt.verify(token, secret) as DevportalSessionClaims;
    req.userId = decoded.userId;
    req.userEmail = decoded.email;
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
      const decoded = jwt.verify(token, secret) as DevportalSessionClaims;
      req.userId = decoded.userId;
      req.userEmail = decoded.email;
    } catch {
      // Not signed in — proceed as anonymous, same as no cookie at all.
    }
  }
  next();
}
