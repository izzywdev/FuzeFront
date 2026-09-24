import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { authenticateToken } from '../../src/middleware/auth';

// Test-only signing key. Read from the environment so this file cannot silently
// mirror whatever default production happens to use.
const TEST_JWT_SECRET = process.env.TEST_JWT_SECRET ?? 'test-only-not-a-real-secret';

// DELIBERATELY the wrong key. The "wrong signature" test below asserts that a token
// signed with a key the middleware does NOT hold is rejected, so this MUST stay
// distinct from TEST_JWT_SECRET — it is derived from it to guarantee that.
const WRONG_JWT_SECRET = `${TEST_JWT_SECRET}-wrong-signature`;

// Build a minimal express app that applies the auth middleware and echoes back
// req.userId and req.orgId so we can assert on them.
function makeApp() {
  const app = express();
  app.use(express.json());
  app.get('/protected', authenticateToken, (req, res) => {
    res.json({ userId: (req as any).userId, orgId: (req as any).orgId });
  });
  return app;
}

describe('authenticateToken middleware', () => {
  const app = makeApp();

  beforeEach(() => {
    process.env.JWT_SECRET = TEST_JWT_SECRET;
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
  });

  it('returns 401 when no token is provided', async () => {
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/no token/i);
  });

  it('returns 401 when token has wrong signature', async () => {
    const token = jwt.sign({ userId: 'user-1' }, WRONG_JWT_SECRET);
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid token/i);
  });

  it('returns 401 for an expired token', async () => {
    const token = jwt.sign({ userId: 'user-1' }, TEST_JWT_SECRET, { expiresIn: -1 });
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid token/i);
  });

  it('calls next() and sets req.userId for a valid token', async () => {
    const token = jwt.sign({ userId: 'user-abc' }, TEST_JWT_SECRET);
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('user-abc');
    expect(res.body.orgId).toBeUndefined();
  });

  it('sets req.orgId when the token contains an orgId claim', async () => {
    const token = jwt.sign({ userId: 'user-abc', orgId: 'org-xyz' }, TEST_JWT_SECRET);
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('user-abc');
    expect(res.body.orgId).toBe('org-xyz');
  });
});
