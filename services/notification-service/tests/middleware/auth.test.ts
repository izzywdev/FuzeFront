import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { authenticateToken, requireInternalToken } from '../../src/middleware/auth';

// TEST-ONLY signing key, flagged by Semgrep's hardcoded-jwt-secret rule and
// suppressed deliberately at each site below. Not a credential: it exists so
// this suite can mint tokens the middleware under test will verify, it appears
// nowhere else, and it authenticates nothing outside this process. Production
// reads JWT_SECRET from the environment (src/config.ts) and FAILS CLOSED when
// it is unset — asserted by the 'fails closed ... when JWT_SECRET is unset'
// case below.

// nosemgrep: javascript.jsonwebtoken.security.jwt-hardcode.hardcoded-jwt-secret
const SECRET = 'auth-test-secret';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.get('/protected', authenticateToken, (req, res) =>
    res.json({ userId: req.userId, orgId: req.orgId })
  );
  app.post('/internal', requireInternalToken, (_req, res) => res.json({ ok: true }));
  return app;
}

describe('authenticateToken', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = SECRET;
  });

  it('accepts a valid bearer token and exposes its claims', async () => {
    // nosemgrep: javascript.jsonwebtoken.security.jwt-hardcode.hardcoded-jwt-secret
    const token = jwt.sign({ userId: 'u-1', orgId: 'o-1' }, SECRET);
    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: 'u-1', orgId: 'o-1' });
  });

  it('accepts the token as a query param, for EventSource', async () => {
    // nosemgrep: javascript.jsonwebtoken.security.jwt-hardcode.hardcoded-jwt-secret
    const token = jwt.sign({ userId: 'u-1' }, SECRET);
    const res = await request(buildApp()).get(`/protected?token=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('u-1');
  });

  it('rejects a token signed with a different secret', async () => {
    // nosemgrep: javascript.jsonwebtoken.security.jwt-hardcode.hardcoded-jwt-secret
    const forged = jwt.sign({ userId: 'u-1' }, 'wrong-secret');
    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', `Bearer ${forged}`);

    expect(res.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    // nosemgrep: javascript.jsonwebtoken.security.jwt-hardcode.hardcoded-jwt-secret
    const expired = jwt.sign({ userId: 'u-1' }, SECRET, { expiresIn: -10 });
    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', `Bearer ${expired}`);

    expect(res.status).toBe(401);
  });

  it('rejects a token with no subject claim', async () => {
    // nosemgrep: javascript.jsonwebtoken.security.jwt-hardcode.hardcoded-jwt-secret
    const anonymous = jwt.sign({ scope: 'nothing' }, SECRET);
    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', `Bearer ${anonymous}`);

    expect(res.status).toBe(401);
  });

  it('fails closed — never open — when JWT_SECRET is unset', async () => {
    delete process.env.JWT_SECRET;
    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', 'Bearer whatever');

    expect(res.status).toBe(500);
    process.env.JWT_SECRET = SECRET;
  });
});

describe('requireInternalToken', () => {
  beforeEach(() => {
    process.env.NOTIFICATION_INTERNAL_TOKEN = 'super-secret-service-token';
  });

  it('accepts the configured token as a bearer', async () => {
    const res = await request(buildApp())
      .post('/internal')
      .set('Authorization', 'Bearer super-secret-service-token')
      .send({});

    expect(res.status).toBe(200);
  });

  it('accepts it via X-Internal-Token', async () => {
    const res = await request(buildApp())
      .post('/internal')
      .set('X-Internal-Token', 'super-secret-service-token')
      .send({});

    expect(res.status).toBe(200);
  });

  it('rejects a wrong token', async () => {
    const res = await request(buildApp())
      .post('/internal')
      .set('Authorization', 'Bearer nope')
      .send({});

    expect(res.status).toBe(401);
  });

  it('rejects a token that is merely a prefix of the real one', async () => {
    const res = await request(buildApp())
      .post('/internal')
      .set('Authorization', 'Bearer super-secret')
      .send({});

    expect(res.status).toBe(401);
  });

  it('is DISABLED, not open, when no token is configured', async () => {
    delete process.env.NOTIFICATION_INTERNAL_TOKEN;
    const res = await request(buildApp()).post('/internal').send({});

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('INTERNAL_TOKEN_UNSET');
  });
});
