// auth.middleware.test.ts — the claim names authMiddleware must accept.
//
// WHY THIS EXISTS. The middleware originally read `userId`/`orgId` only, while
// this service's own openapi.yaml `bearerAuth` says the credential is an
// "Authentik-issued JWT" whose `organization_id` claim carries the org. An
// Authentik token carries `sub` + `organization_id` — neither was read, so a
// spec-conformant token was authenticated with `req.orgId === undefined` and
// every org-scoped route answered 401 "Organization context required". That is
// exactly how the independent acceptance suite fails (134 tests), and nothing
// in this service's own tests noticed, because they all mint `userId`/`orgId`.
//
// These cases pin the union of the two real token shapes: the platform token
// (`userId`, no org claim) and the contract's Authentik token (`sub`,
// `organization_id`). They fail if either alias is dropped.

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { authMiddleware } from '../src/middleware/auth';

const SECRET = 'auth-middleware-test-secret';

/** Minimal app that echoes back whatever identity the middleware attached. */
function makeApp() {
  const app = express();
  app.get('/whoami', authMiddleware, (req, res) => {
    res.status(200).json({ userId: req.userId, orgId: req.orgId, appId: req.appId });
  });
  return app;
}

function get(token?: string) {
  const req = request(makeApp()).get('/whoami');
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
}

describe('authMiddleware — subject claim', () => {
  const ORIGINAL = process.env.JWT_SECRET;
  beforeAll(() => { process.env.JWT_SECRET = SECRET; });
  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = ORIGINAL;
  });

  it('reads `userId` (FuzeFront platform token shape)', async () => {
    const token = jwt.sign({ userId: 'usr_platform', orgId: 'org_a' }, SECRET);
    const res = await get(token);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('usr_platform');
  });

  it('falls back to `sub` (Authentik token shape, per openapi.yaml bearerAuth)', async () => {
    const token = jwt.sign({ sub: 'usr_authentik', organization_id: 'org_a' }, SECRET);
    const res = await get(token);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('usr_authentik');
  });

  it('prefers `userId` over `sub` when a token carries both', async () => {
    const token = jwt.sign({ userId: 'usr_wins', sub: 'usr_loses' }, SECRET);
    const res = await get(token);
    expect(res.body.userId).toBe('usr_wins');
  });

  it('rejects a signature-valid token with no subject claim at all', async () => {
    // Not "authenticated with an undefined user" — that would push the decision
    // down to every route and be one missed guard away from an anonymous write.
    const token = jwt.sign({ orgId: 'org_a' }, SECRET);
    const res = await get(token);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });
});

describe('authMiddleware — organization claim', () => {
  const ORIGINAL = process.env.JWT_SECRET;
  beforeAll(() => { process.env.JWT_SECRET = SECRET; });
  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = ORIGINAL;
  });

  it('reads `orgId`', async () => {
    const token = jwt.sign({ userId: 'usr_a', orgId: 'org_snake' }, SECRET);
    expect((await get(token)).body.orgId).toBe('org_snake');
  });

  it('falls back to `organization_id` — the name openapi.yaml publishes', async () => {
    const token = jwt.sign({ sub: 'usr_a', organization_id: 'org_from_spec' }, SECRET);
    expect((await get(token)).body.orgId).toBe('org_from_spec');
  });

  it('falls back to `organizationId` (config-service parity)', async () => {
    const token = jwt.sign({ userId: 'usr_a', organizationId: 'org_camel' }, SECRET);
    expect((await get(token)).body.orgId).toBe('org_camel');
  });

  it('leaves orgId undefined when the token carries no org claim', async () => {
    // The platform token genuinely has none. Authentication still succeeds;
    // the route-level "Organization context required" 401 is the correct and
    // only place that failure belongs.
    const token = jwt.sign({ userId: 'usr_a' }, SECRET);
    const res = await get(token);
    expect(res.status).toBe(200);
    expect(res.body.orgId).toBeUndefined();
  });
});

describe('authMiddleware — rejections', () => {
  const ORIGINAL = process.env.JWT_SECRET;
  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = ORIGINAL;
  });

  it('401s with no Authorization header', async () => {
    process.env.JWT_SECRET = SECRET;
    expect((await get()).status).toBe(401);
  });

  it('401s on a token signed with a different secret', async () => {
    process.env.JWT_SECRET = SECRET;
    const token = jwt.sign({ userId: 'usr_a', orgId: 'org_a' }, 'not-the-secret');
    expect((await get(token)).status).toBe(401);
  });

  it('500s when JWT_SECRET is unset (fails closed, never accept-anything)', async () => {
    delete process.env.JWT_SECRET;
    const token = jwt.sign({ userId: 'usr_a' }, SECRET);
    expect((await get(token)).status).toBe(500);
  });
});
