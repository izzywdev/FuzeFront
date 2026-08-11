import express from 'express';
import request from 'supertest';
import { authMiddleware } from '../../src/auth/jwt';
import { bearer, signTestToken, TEST_JWT_SECRET } from '../helpers/authToken';

function buildApp() {
  const app = express();
  app.get('/whoami', authMiddleware, (req, res) => {
    res.json(req.principal);
  });
  return app;
}

describe('authMiddleware', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = TEST_JWT_SECRET;
  });

  it('401s with no Authorization header', async () => {
    const res = await request(buildApp()).get('/whoami');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('401s with a malformed token', async () => {
    const res = await request(buildApp()).get('/whoami').set('Authorization', 'Bearer not-a-jwt');
    expect(res.status).toBe(401);
  });

  it('401s (fail closed) when JWT_SECRET is unset', async () => {
    delete process.env.JWT_SECRET;
    const res = await request(buildApp()).get('/whoami').set('Authorization', bearer({ userId: 'u1' }));
    expect(res.status).toBe(401);
    process.env.JWT_SECRET = TEST_JWT_SECRET;
  });

  it('attaches userId/portalId/orgId from a valid token', async () => {
    const res = await request(buildApp())
      .get('/whoami')
      .set('Authorization', bearer({ userId: 'u1', portalId: 'p1', orgId: 'o1' }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ userId: 'u1', portalId: 'p1', orgId: 'o1' });
  });

  it('401s a token signed with the wrong secret', async () => {
    const wrongToken = require('jsonwebtoken').sign({ userId: 'u1' }, 'wrong-secret');
    const res = await request(buildApp()).get('/whoami').set('Authorization', `Bearer ${wrongToken}`);
    expect(res.status).toBe(401);
  });
});
