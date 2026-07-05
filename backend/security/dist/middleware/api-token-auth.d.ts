/**
 * api-token-auth.ts
 *
 * Flexible auth middleware that accepts either:
 *   - An API token (bearer value starts with "ff_live_")
 *   - A JWT (all other bearer values) — delegated to the core authenticateToken
 *
 * Principal mapping for API tokens:
 *   - PAT (owner_type === 'user'): loads user row from DB; builds the same User shape
 *     that core's JWT middleware builds (id, email, firstName, lastName, defaultAppId?, roles).
 *   - Service token (owner_type === 'org'): no user row. Synthetic principal:
 *     { id: 'svc_token:<token.id>', email: '', firstName: '', lastName: '', roles: ['service'] }
 *     The Permit principal key is "svc_token:<token.id>".
 *
 * Rate limiting:
 *   tokenAuthRateLimiter uses skipSuccessfulRequests: true so only non-2xx responses
 *   count toward the limit. Limit = 10 failed token-auth attempts per IP per 60 s.
 *   An 11th consecutive failed attempt from the same IP returns HTTP 429.
 *
 * Security: never log raw token or token_hash; only token.token_prefix may be logged.
 */
import { Request, Response, NextFunction } from 'express';
/**
 * Apply this limiter to routes that accept ff_live_ tokens.
 * Only failed (non-2xx) responses increment the counter, so legitimate
 * traffic is never throttled. The 11th failed attempt within 60 s returns 429.
 */
export declare const tokenAuthRateLimiter: any;
/**
 * authenticateFlexible — express middleware that accepts JWT or API token.
 *
 * If the bearer token starts with "ff_live_" it is treated as an API token
 * and verified via the token service. Otherwise the JWT path is taken by
 * delegating to core's authenticateToken unchanged.
 */
export declare function authenticateFlexible(req: Request, res: Response, next: NextFunction): Promise<void>;
//# sourceMappingURL=api-token-auth.d.ts.map