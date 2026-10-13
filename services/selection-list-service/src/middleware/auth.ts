// auth.ts — stateless JWT verification middleware for selection-list-service.
//
// Design intent:
//   - Verifies the JWT signature using JWT_SECRET. The algorithm is PINNED to
//     HS256 (no `alg` negotiation, no `none`, no asymmetric-as-HMAC confusion).
//   - Accepts only USER-SESSION-shaped tokens: a token carrying a `kind` other
//     than `fuze-org-session` (e.g. `fuze-workload`, `fuze-delegation`, minted
//     by backend/security/src/routes/security.ts) is not a user and is refused.
//   - Attaches req.userId from `userId`, falling back to the standard `sub`.
//   - Attaches req.orgId from a VERIFIED TOKEN CLAIM ONLY (see ORG_CLAIMS).
//     Never from a header, query string or body.
//   - Does NOT hit the database. selection-list-service is stateless re: identity:
//     the token is the source of truth.
//   - Missing token → 401.  Invalid/expired token → 401.  Valid → next().
//
// ── Where the org comes from (I-1) ──────────────────────────────────────────
//
// FuzeFront's platform session token (minted by backend/security: routes/auth.ts
// /login + OIDC callback, providers/authentik/AuthentikIdentityProvider.ts) is
// `{ userId, sessionId, tid }` and carries NO organization. `tid` is the
// IDENTITY-DIRECTORY tenant (the Authentik instance that authenticated the
// user: SECURITY_TENANT_ID, default the literal string `fuzefront`; see
// backend/security/src/providers/authentik/tenants.ts). It is NOT an org id and
// is NEVER read here: treating it as one would put every user of a directory
// in the same selection-list tenant and hand them each other's data.
//
// A caller therefore obtains an org-scoped token from the Security API:
//
//     POST /api/organizations/:id/session-token      (Bearer = session token)
//
// which checks the caller's ACTIVE membership of :id and mints a short-lived
// `{ userId, sessionId, tid, orgId, kind: 'fuze-org-session' }` token. The org
// is signed into the token after that check, so the only way to hold a token
// naming org X is for the Security API to have verified membership of X.
//
// ORG_CLAIMS precedence, left to right (first present wins):
//   1. `orgId`            — what the Security API mints; chat-service,
//                           config-service read the same name.
//   2. `organization_id`  — the name this service's openapi.yaml `bearerAuth`
//                           publishes (an Authentik-shaped token).
//   3. `organizationId`   — camelCase variant, config-service parity.
// If more than one is present and they DISAGREE the token is ambiguous and is
// refused (401) rather than silently picking one.
//
// ── Why the aliases exist ───────────────────────────────────────────────────
//
//   - openapi.yaml's `bearerAuth` says "Authentik-issued JWT. `organization_id`
//     and the acting user are derived from the token claims". An Authentik token
//     carries `sub` and `organization_id`; the acceptance suite mints that shape.
//   - The Security API's org-session token carries `userId` + `orgId`.
//   - A plain session token carries `userId` and no org: authentication
//     succeeds, `req.orgId` stays undefined and the route-level guards answer
//     401 "Organization context required".
//
// Accepting the union is additive and mirrors config-service's requireAuth
// (services/config-service/src/middleware/auth.ts), which also pins HS256.
//
// Org ids appear in two forms in the family: a bare UUID (what
// `organizations.id`, the Permit tenant key and the Security API use) and the
// `org_…` TypeID (identifier standard). The value is passed through verbatim
// and `wireOrgId()` (src/events/outbox.ts) renders either to the wire TypeID.

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getLog } from '../lib/logger';

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
  /** Token kind. Absent on session tokens; see ACCEPTED_KINDS. */
  kind?: unknown;
  [key: string]: unknown;
}

/** Org claim names in precedence order. `tid` is deliberately NOT here. */
export const ORG_CLAIMS = ['orgId', 'organization_id', 'organizationId'] as const;

/**
 * `kind` values this service accepts. Session tokens carry no `kind`; the
 * Security API's org-session exchange stamps `fuze-org-session`. Everything else
 * (`fuze-workload`, `fuze-delegation`, any future kind) is a machine/delegated
 * credential, not a user session, and is refused. An allow-list, not a
 * deny-list, so a new kind fails closed.
 */
export const ACCEPTED_KINDS: ReadonlySet<string> = new Set(['fuze-org-session']);

const MAX_ORG_CLAIM_LENGTH = 128;
// eslint-disable-next-line no-control-regex
const UNSAFE_ORG_CHARS = /[\s\u0000-\u001f\u007f]/;

export interface OrgResolution {
  /** The org from the verified claims; undefined when the token names none. */
  orgId?: string;
  /** Set when the claims are unusable; the token must then be refused. */
  error?: 'ambiguous' | 'malformed';
}

/**
 * Resolve the org from VERIFIED claims. A claim that is present but not a sane
 * string (non-string, empty, oversized, whitespace/control chars) makes the
 * whole token unusable rather than falling through to the next alias: a token
 * with a garbage `orgId` and a valid `organization_id` is malformed, not
 * "use the other one".
 */
export function resolveOrgClaim(claims: JwtClaims): OrgResolution {
  const present: string[] = [];
  for (const name of ORG_CLAIMS) {
    const v = claims[name];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string' || v.length === 0 || v.length > MAX_ORG_CLAIM_LENGTH || UNSAFE_ORG_CHARS.test(v)) {
      return { error: 'malformed' };
    }
    present.push(v);
  }
  if (present.length === 0) return {};
  if (present.some((v) => v !== present[0])) return { error: 'ambiguous' };
  return { orgId: present[0] };
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    getLog(req).debug('auth: no bearer token — 401');
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Access denied. No token provided.' });
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    getLog(req).error('auth misconfiguration: JWT_SECRET not set — 500');
    res.status(500).json({ code: 'UNAUTHENTICATED', message: 'Server misconfiguration: JWT_SECRET not set.' });
    return;
  }

  try {
    // PIN the algorithm. Without it jsonwebtoken accepts whatever `alg` the
    // token header names: the classic algorithm-confusion hole (review L-2).
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as JwtClaims;

    if (decoded.kind !== undefined && !(typeof decoded.kind === 'string' && ACCEPTED_KINDS.has(decoded.kind))) {
      // A workload/delegation token verifies under the shared secret whenever
      // DELEGATION_SIGNING_KEY is unset. It names a service or an act-on-behalf
      // delegation, not a user session, so it is never a user here.
      getLog(req).warn(
        { kind: typeof decoded.kind === 'string' ? decoded.kind.slice(0, 40) : typeof decoded.kind },
        'auth: non-session token kind — 401',
      );
      res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Invalid token.' });
      return;
    }

    const userId = decoded.userId ?? decoded.sub;
    if (typeof userId !== 'string' || userId.length === 0) {
      // A signature-valid token with no subject is not an identity. Reject it
      // rather than letting req.userId stay undefined and having each route
      // rediscover that on its own.
      getLog(req).warn('auth: signature-valid token has no subject — 401');
      res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Invalid token.' });
      return;
    }
    const org = resolveOrgClaim(decoded);
    if (org.error) {
      getLog(req).warn({ reason: org.error }, 'auth: unusable organization claim — 401');
      res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Invalid token.' });
      return;
    }

    req.userId = userId;
    // Undefined when the token genuinely carries no org (a plain session token):
    // the route-level guards answer 401 for that. NEVER sourced from a header.
    req.orgId = org.orgId;
    req.appId = decoded.appId;
    // Bind identity once so every later line on this request carries it.
    req.log = getLog(req).child({ userId: req.userId, orgId: req.orgId });
    next();
  } catch (err) {
    // Log the failure CLASS only (TokenExpiredError / JsonWebTokenError / ...);
    // never the token or the verifier's message, which can echo token content.
    getLog(req).info({ reason: (err as Error)?.name }, 'auth: token verification failed — 401');
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Invalid token.' });
  }
}
