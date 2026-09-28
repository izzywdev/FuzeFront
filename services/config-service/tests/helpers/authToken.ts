import jwt from 'jsonwebtoken';

// Test-only signing secret. Never a production credential: it is read from
// TEST_JWT_SECRET when supplied so the literal below is an obviously fake
// fallback rather than a copy of any real/default production secret.
// Exported under this exact name — several suites do
// `process.env.JWT_SECRET = TEST_JWT_SECRET` before building the app.
export const TEST_JWT_SECRET =
  process.env.TEST_JWT_SECRET ?? 'test-only-not-a-real-secret-config-service';

export function signTestToken(claims: { userId: string; portalId?: string; orgId?: string; roles?: string[] }): string {
  return jwt.sign(claims, TEST_JWT_SECRET, { expiresIn: '1h' });
}

export function bearer(claims: { userId: string; portalId?: string; orgId?: string; roles?: string[] }): string {
  return `Bearer ${signTestToken(claims)}`;
}
