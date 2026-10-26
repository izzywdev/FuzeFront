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

import { randomBytes } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { authMiddleware } from '../src/middleware/auth';

// Generated per run, not a literal. Nothing here depends on the VALUE — these
// cases are about which claim names the middleware reads — so a fresh random
// secret is strictly better than a constant: it proves no assertion is coupled
// to a particular string, it cannot be copied into anything real, and it does
// not read as a hard-coded credential to a secret scanner (Semgrep
// `jwt-hardcode.hardcoded-jwt-secret` flagged the literal this replaces).
const SECRET = randomBytes(32).toString('hex');

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
    const token = jwt.sign({ userId: 'usr_a', orgId: 'org_a' }, randomBytes(32).toString('hex'));
    expect((await get(token)).status).toBe(401);
  });

  it('500s when JWT_SECRET is unset (fails closed, never accept-anything)', async () => {
    delete process.env.JWT_SECRET;
    const token = jwt.sign({ userId: 'usr_a' }, SECRET);
    expect((await get(token)).status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Review I-1 / L-2: the REAL token shapes, precedence, and what is NOT an org.
// ---------------------------------------------------------------------------

/** Exactly what backend/security mints at login (routes/auth.ts, AuthentikIdentityProvider.ts). */
function realSessionToken(extra: Record<string, unknown> = {}, opts: jwt.SignOptions = {}): string {
  return jwt.sign(
    {
      userId: '0b3a2f64-7d1e-4c1a-9f0e-2b5f6a7c8d90',
      sessionId: '11111111-2222-4333-8444-555555555555',
      tid: 'fuzefront',
      ...extra,
    },
    SECRET,
    { expiresIn: '24h', ...opts },
  );
}

/** Exactly what POST /api/organizations/:id/session-token mints (services/orgSessionToken.ts). */
function realOrgSessionToken(orgId: string, extra: Record<string, unknown> = {}): string {
  return realSessionToken({ orgId, kind: 'fuze-org-session', ...extra }, { expiresIn: '15m' });
}

function getWith(token: string, headers: Record<string, string> = {}) {
  let r = request(makeApp()).get('/whoami').set('Authorization', `Bearer ${token}`);
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
  return r;
}

/** Shared secret setup for the blocks below. */
function useSecret() {
  const ORIGINAL = process.env.JWT_SECRET;
  beforeAll(() => { process.env.JWT_SECRET = SECRET; });
  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = ORIGINAL;
  });
}

describe('authMiddleware — real FuzeFront token shapes (I-1)', () => {
  useSecret();
  const ORG = '5c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
  const ORG_TYPEID = 'org_01h455vb4pex5vsknk084sn02q';

  it('a plain session token authenticates the user but names NO org', async () => {
    const res = await getWith(realSessionToken());
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('0b3a2f64-7d1e-4c1a-9f0e-2b5f6a7c8d90');
    expect(res.body.orgId).toBeUndefined();
  });

  it('`tid` is the identity-directory tenant, never an org (string slug)', async () => {
    const res = await getWith(realSessionToken({ tid: 'fuzefront' }));
    expect(res.body.orgId).toBeUndefined();
  });

  it('`tid` is never read as an org even when it looks like one (UUID / TypeID)', async () => {
    for (const tid of [ORG, ORG_TYPEID]) {
      const res = await getWith(realSessionToken({ tid }));
      expect(res.status).toBe(200);
      expect(res.body.orgId).toBeUndefined();
    }
  });

  it('an org-session token (Security API exchange) resolves the bare-UUID org verbatim', async () => {
    const res = await getWith(realOrgSessionToken(ORG));
    expect(res.status).toBe(200);
    expect(res.body.orgId).toBe(ORG);
  });

  it('an org-session token resolves the org_ TypeID form verbatim too', async () => {
    const res = await getWith(realOrgSessionToken(ORG_TYPEID));
    expect(res.body.orgId).toBe(ORG_TYPEID);
  });

  it('an Authentik-shaped token (sub + organization_id) still resolves', async () => {
    const res = await getWith(jwt.sign({ sub: 'usr_x', organization_id: ORG_TYPEID }, SECRET));
    expect(res.body).toMatchObject({ userId: 'usr_x', orgId: ORG_TYPEID });
  });
});

describe('authMiddleware — org precedence and ambiguity', () => {
  useSecret();

  it('exposes the documented precedence order, with tid absent', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ORG_CLAIMS } = require('../src/middleware/auth');
    expect([...ORG_CLAIMS]).toEqual(['orgId', 'organization_id', 'organizationId']);
    expect(ORG_CLAIMS).not.toContain('tid');
  });

  it('accepts the same org under several names', async () => {
    const res = await getWith(
      jwt.sign({ userId: 'usr_a', orgId: 'org_same', organization_id: 'org_same', organizationId: 'org_same' }, SECRET),
    );
    expect(res.status).toBe(200);
    expect(res.body.orgId).toBe('org_same');
  });

  it('401s when two org claims DISAGREE rather than picking one', async () => {
    const res = await getWith(jwt.sign({ userId: 'usr_a', orgId: 'org_a', organization_id: 'org_b' }, SECRET));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('401s on a malformed org claim instead of falling through to a later alias', async () => {
    for (const bad of ['', '   ', 'org a', 'org\nx', 'x'.repeat(129), 42, { id: 'org_a' }, ['org_a']]) {
      const res = await getWith(jwt.sign({ userId: 'usr_a', orgId: bad, organization_id: 'org_ok' }, SECRET));
      expect(res.status).toBe(401);
    }
  });
});

describe('authMiddleware — the org is never taken from the request (forged header/query)', () => {
  useSecret();
  const FORGED = 'org_attacker0000000000000000';
  const HEADERS = {
    'X-Organization-Id': FORGED,
    'X-Org-Id': FORGED,
    'X-Org': FORGED,
    'X-FF-Org-Id': FORGED,
    'X-Tenant-Id': FORGED,
    'X-Billing-Entity-Id': FORGED,
  };

  it('a session token with no org stays org-less whatever headers are sent', async () => {
    const res = await getWith(realSessionToken(), HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.orgId).toBeUndefined();
  });

  it('a token that names an org keeps THAT org, never the forged header', async () => {
    const org = '5c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
    const res = await getWith(realOrgSessionToken(org), HEADERS);
    expect(res.body.orgId).toBe(org);
  });

  it('the query string cannot supply the org either', async () => {
    const res = await request(makeApp())
      .get(`/whoami?orgId=${FORGED}&organization_id=${FORGED}`)
      .set('Authorization', `Bearer ${realSessionToken()}`);
    expect(res.body.orgId).toBeUndefined();
  });
});

describe('authMiddleware — L-2: algorithm pin and non-session token kinds', () => {
  useSecret();

  it('accepts HS256 (what the Security API signs with)', async () => {
    const res = await getWith(jwt.sign({ userId: 'usr_a', orgId: 'org_a' }, SECRET, { algorithm: 'HS256' }));
    expect(res.status).toBe(200);
  });

  it('rejects HS384 / HS512 signed with the right secret (pinned to HS256)', async () => {
    for (const algorithm of ['HS384', 'HS512'] as const) {
      const res = await getWith(jwt.sign({ userId: 'usr_a', orgId: 'org_a' }, SECRET, { algorithm }));
      expect(res.status).toBe(401);
    }
  });

  it('rejects an unsigned alg=none token', async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const forged = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ userId: 'usr_a', orgId: 'org_a' })}.`;
    expect((await getWith(forged)).status).toBe(401);
  });

  it('rejects a workload token (kind=fuze-workload) even with an org claim and a valid signature', async () => {
    const t = jwt.sign(
      { kind: 'fuze-workload', sub: 'billing-service', aud: 'fuzefront-services', scope: 'x', orgId: 'org_a' },
      SECRET,
      { expiresIn: '10m', issuer: 'fuzefront-security' },
    );
    const res = await getWith(t);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a delegation token (kind=fuze-delegation) even with tenantId/org claims', async () => {
    const t = jwt.sign(
      {
        kind: 'fuze-delegation',
        sub: 'usr_a',
        aud: 'service:selection-list-service',
        scope: 'x',
        tenantId: 'org_a',
        organization_id: 'org_a',
        act: { sub: 'some-service' },
        jti: 'j',
      },
      SECRET,
      { expiresIn: '5m' },
    );
    expect((await getWith(t)).status).toBe(401);
  });

  it('rejects ANY other kind (allow-list, so a future kind fails closed) and a non-string kind', async () => {
    for (const kind of ['fuze-future-kind', '', 7, ['fuze-org-session'], null]) {
      const res = await getWith(jwt.sign({ userId: 'usr_a', orgId: 'org_a', kind }, SECRET));
      expect(res.status).toBe(401);
    }
  });

  it('accepts exactly kind=fuze-org-session', async () => {
    const res = await getWith(jwt.sign({ userId: 'usr_a', orgId: 'org_a', kind: 'fuze-org-session' }, SECRET));
    expect(res.status).toBe(200);
  });

  it('rejects a non-string subject claim', async () => {
    const res = await getWith(jwt.sign({ userId: { $ne: null }, orgId: 'org_a' }, SECRET));
    expect(res.status).toBe(401);
  });
});
