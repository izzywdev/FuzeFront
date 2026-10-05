/**
 * JWT generation helpers for the selection-list-service test suite.
 *
 * `mintTestToken` mints tokens shaped like the REAL ones FuzeFront issues, so
 * this suite exercises the claim names production presents, not a convenient
 * invention. Authorization review I-1 existed precisely because the harness
 * minted an Authentik-shaped token (`sub` + `organization_id`) that no FuzeFront
 * issuer produces, so CI stayed green while every real user got a 401.
 *
 * The real shapes (backend/security):
 *
 *   session token  routes/auth.ts, AuthentikIdentityProvider.ts
 *                  { userId, sessionId, tid }                  <- NO org claim
 *                  `tid` is the identity-directory tenant (e.g. "fuzefront"),
 *                  NOT an organization.
 *
 *   org-session    POST /api/organizations/:id/session-token (orgSessionToken.ts)
 *                  { userId, sessionId, tid, orgId, kind: 'fuze-org-session' }
 *                  minted only after an ACTIVE-membership check; this is the
 *                  token an org-scoped service receives from the shell.
 *
 * Ids stay in the TypeID wire form (`usr_…` / `org_…`) because the suite's DB
 * assertions are written against it; production mints the bare UUID, and the
 * service passes either through verbatim (src/middleware/auth.ts).
 *
 * `roles` is NOT a claim on any real FuzeFront token. It is a TEST-ONLY hint
 * read by the stand-in Security API (helpers/fake-security-api.mjs) to pick a
 * tenant role, and is emitted only when a test asks for one.
 */
import jwt from 'jsonwebtoken';

/** The secret the test service is configured with. Override via env. */
export const TEST_JWT_SECRET: string =
  process.env['JWT_SECRET'] ?? 'test-jwt-secret-for-selection-list-service';

/** The identity-directory tenant a real session token carries as `tid`. */
export const TEST_IDENTITY_TENANT = 'fuzefront';

export interface TestActorClaims {
  userId: string;
  organizationId: string;
  /** Test-only: consumed by the stand-in Security API, absent from real tokens. */
  roles?: string[];
}

/** Deterministic per-user session id, shaped like the UUID the Security API mints. */
function sessionIdFor(userId: string): string {
  let h = 0;
  for (const c of userId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hex = h.toString(16).padStart(8, '0');
  return `${hex}-0000-4000-8000-${hex}${hex}`.slice(0, 36);
}

/** Mint a short-lived (15 min, like the real exchange) org-session token. */
export function mintTestToken(claims: TestActorClaims): string {
  const payload: Record<string, unknown> = {
    userId: claims.userId,
    sessionId: sessionIdFor(claims.userId),
    tid: TEST_IDENTITY_TENANT,
    orgId: claims.organizationId,
    kind: 'fuze-org-session',
  };
  if (claims.roles && claims.roles.length > 0) payload['roles'] = claims.roles;
  return jwt.sign(payload, TEST_JWT_SECRET, { algorithm: 'HS256', expiresIn: '15m' });
}

/**
 * A plain FuzeFront session token: `{ userId, sessionId, tid }` and NO org. This
 * is what the shell holds after login, before any org exchange. The service must
 * authenticate it but refuse every org-scoped route (401).
 */
export function mintSessionToken(userId: string, extra: Record<string, unknown> = {}): string {
  return jwt.sign(
    { userId, sessionId: sessionIdFor(userId), tid: TEST_IDENTITY_TENANT, ...extra },
    TEST_JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '24h' },
  );
}

/**
 * The Authentik-issued shape openapi.yaml `bearerAuth` describes (`sub` +
 * `organization_id`). Not what the shell sends today, but part of the published
 * contract, so one suite keeps it honest.
 */
export function mintAuthentikToken(claims: TestActorClaims): string {
  return jwt.sign(
    {
      sub: claims.userId,
      organization_id: claims.organizationId,
      email: `${claims.userId}@test.fuzefront.invalid`,
      ...(claims.roles && claims.roles.length > 0 ? { roles: claims.roles } : {}),
    },
    TEST_JWT_SECRET,
    { issuer: 'test-harness', expiresIn: '1h' },
  );
}

/** A factory for a specific test actor bound to a fixed org. */
export function makeActor(userId: string, organizationId: string, roles: string[] = []) {
  return {
    userId,
    organizationId,
    token: () => mintTestToken({ userId, organizationId, roles }),
  };
}
