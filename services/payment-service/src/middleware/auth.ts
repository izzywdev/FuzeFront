import { NextFunction, Request, Response } from 'express';

/**
 * Guards the neutral API: consumers (billing-service / the host proxy) present
 * `PAYMENT_INTERNAL_TOKEN` as a Bearer token. Mirrors billing-service's
 * `requireInternalToken`.
 *
 * Scaffold behaviour: when no token is configured the guard is a NO-OP (open in
 * local/degraded runs). When a token IS configured it fails CLOSED — a missing
 * or mismatched Bearer token is rejected with 401.
 */
export function requireInternalToken(token?: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!token) {
      next();
      return;
    }
    const header = req.header('authorization') || '';
    const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (presented && presented === token) {
      next();
      return;
    }
    res.status(401).json({ error: 'unauthorized' });
  };
}
