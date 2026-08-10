/**
 * JWT generation helpers for the selection-list-service test suite.
 *
 * The service validates Authentik-issued JWTs. In test mode it must accept
 * tokens signed with JWT_SECRET (defaults to the env var, falls back to a
 * well-known test-only secret). All claims mirror what Authentik emits:
 *   - sub             — the usr_-prefixed user id
 *   - organization_id — the org_-prefixed org id
 *   - email           — a deterministic test email
 *   - roles           — org-level roles (empty for ordinary users)
 */
import jwt from 'jsonwebtoken';

/** The secret the test service is configured with. Override via env. */
export const TEST_JWT_SECRET: string =
  process.env['JWT_SECRET'] ?? 'test-jwt-secret-for-selection-list-service';

export interface TestActorClaims {
  userId: string;
  organizationId: string;
  email?: string;
  roles?: string[];
}

/** Mint a short-lived (1 h) signed JWT for a synthetic test actor. */
export function mintTestToken(claims: TestActorClaims): string {
  const payload = {
    sub: claims.userId,
    organization_id: claims.organizationId,
    email: claims.email ?? `${claims.userId}@test.fuzefront.invalid`,
    roles: claims.roles ?? [],
  };
  return jwt.sign(payload, TEST_JWT_SECRET, {
    issuer: 'test-harness',
    expiresIn: '1h',
  });
}

/** A factory for a specific test actor bound to a fixed org. */
export function makeActor(userId: string, organizationId: string, roles: string[] = []) {
  return {
    userId,
    organizationId,
    token: () => mintTestToken({ userId, organizationId, roles }),
  };
}
