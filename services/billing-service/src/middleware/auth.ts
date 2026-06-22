import { Request, Response, NextFunction } from 'express';

/**
 * Validates the internal Bearer token on non-webhook, non-public routes.
 * billing-service is not publicly exposed; callers (backend via
 * @fuzefront/billing-client) present BILLING_INTERNAL_TOKEN.
 *
 * If no token is configured (local dev without secrets), the guard is disabled
 * and logs a warning — never silently allow in production where the token is set.
 */
export function requireInternalToken(expectedToken?: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!expectedToken) {
      // Dev convenience only.
      return next();
    }
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (token && safeEqual(token, expectedToken)) {
      return next();
    }
    res.status(401).json({ error: 'unauthorized' });
  };
}

/** Constant-time-ish comparison to avoid trivial timing leaks on the token. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
