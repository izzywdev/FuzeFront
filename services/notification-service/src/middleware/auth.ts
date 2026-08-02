// auth.ts — stateless JWT verification for notification-service.
//
// The inbox is inherently per-user, so `userId` comes from the VERIFIED token
// and never from a path, query or body. There is deliberately no route that
// takes a user id: with none to tamper, there is no BOLA surface on the
// user-facing API at all.
//
// The one privileged surface is `/internal/*`, gated on a shared service token
// (`requireInternalToken`) rather than a user JWT — the caller there is another
// service fanning an event out to many recipients.

import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      orgId?: string;
    }
  }
}

interface JwtClaims {
  userId?: string;
  id?: string;
  sub?: string;
  orgId?: string;
  [key: string]: unknown;
}

/** The platform issues `userId`; accept `id`/`sub` as aliases for robustness. */
function subjectOf(claims: JwtClaims): string | undefined {
  return claims.userId || claims.id || claims.sub;
}

export function verifyToken(token: string, secret: string): JwtClaims | null {
  try {
    return jwt.verify(token, secret) as JwtClaims;
  } catch {
    return null;
  }
}

export function authenticateToken(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // Never fall back to "no verification" — an unset secret must fail closed.
    res.status(500).json({ error: 'Server misconfiguration: JWT_SECRET not set.' });
    return;
  }

  const header = req.headers['authorization'];
  const bearer = typeof header === 'string' ? header.split(' ')[1] : undefined;

  // EventSource cannot set headers, so the SSE route carries the SAME bearer
  // token as a query param. Accepted only as a fallback, and only because the
  // stream is read-only and same-origin over TLS.
  const queryToken =
    typeof req.query.token === 'string' ? req.query.token : undefined;

  const token = bearer || queryToken;
  if (!token) {
    res.status(401).json({ error: 'Access denied. No token provided.' });
    return;
  }

  const claims = verifyToken(token, secret);
  const userId = claims ? subjectOf(claims) : undefined;
  if (!claims || !userId) {
    res.status(401).json({ error: 'Invalid token.' });
    return;
  }

  req.userId = userId;
  req.orgId = typeof claims.orgId === 'string' ? claims.orgId : undefined;
  next();
}

/**
 * Service-to-service auth for `/internal/*`.
 *
 * Fails CLOSED when no internal token is configured: an unauthenticated publish
 * endpoint would let anyone who can reach the pod write into any user's inbox,
 * which is a far worse outcome than the feature being unavailable.
 */
export function requireInternalToken(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const expected = process.env.NOTIFICATION_INTERNAL_TOKEN;
  if (!expected) {
    res.status(503).json({
      error: 'Internal publishing is not configured.',
      code: 'INTERNAL_TOKEN_UNSET',
    });
    return;
  }

  const header = req.headers['authorization'];
  const provided =
    (typeof header === 'string' ? header.split(' ')[1] : undefined) ||
    (typeof req.headers['x-internal-token'] === 'string'
      ? (req.headers['x-internal-token'] as string)
      : undefined);

  if (!provided || !safeEqual(provided, expected)) {
    res.status(401).json({ error: 'Invalid internal token.' });
    return;
  }

  next();
}

/** Length-checked, constant-time-ish comparison — no early return on the first
 *  differing byte, so the endpoint does not leak the token a character at a
 *  time under timing analysis. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
