import jwt from 'jsonwebtoken';

export const TEST_JWT_SECRET = 'test-secret-for-config-service-unit-tests';

export function signTestToken(claims: { userId: string; portalId?: string; orgId?: string; roles?: string[] }): string {
  return jwt.sign(claims, TEST_JWT_SECRET, { expiresIn: '1h' });
}

export function bearer(claims: { userId: string; portalId?: string; orgId?: string; roles?: string[] }): string {
  return `Bearer ${signTestToken(claims)}`;
}
