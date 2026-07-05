import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { authenticateToken } from '../../src/middleware/auth';

const SECRET = 'test-jwt-secret-for-unit-tests';

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
    process.env.JWT_SECRET = SECRET;
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
    const token = jwt.sign({ userId: 'user-1' }, 'wrong-secret');
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid token/i);
  });

  it('returns 401 for an expired token', async () => {
    const token = jwt.sign({ userId: 'user-1' }, SECRET, { expiresIn: -1 });
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid token/i);
  });

  it('calls next() and sets req.userId for a valid token', async () => {
    const token = jwt.sign({ userId: 'user-abc' }, SECRET);
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('user-abc');
    expect(res.body.orgId).toBeUndefined();
  });

  it('sets req.orgId when the token contains an orgId claim', async () => {
    const token = jwt.sign({ userId: 'user-abc', orgId: 'org-xyz' }, SECRET);
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('user-abc');
    expect(res.body.orgId).toBe('org-xyz');
  });
});
