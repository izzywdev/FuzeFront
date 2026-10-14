/**
 * Which bearer tokens the service accepts, and where the org comes from.
 *
 * Authorization review I-1 (no real token resolved an org, so every route 401'd)
 * and L-2 (no algorithm pin, no `kind` rejection). These run against the live
 * service with the SHAPES FuzeFront actually issues (see helpers/auth.ts):
 *
 *   - a plain session token `{userId, sessionId, tid}` has NO org: authenticated
 *     but every org-scoped route is 401;
 *   - `tid` is the identity-directory tenant, never an org;
 *   - the org-session token `{..., orgId, kind:'fuze-org-session'}` works;
 *   - workload / delegation tokens (and any other `kind`) are not users: 401;
 *   - HS384/HS512/alg=none are refused (algorithm pinned to HS256);
 *   - the org is read from the verified token only, never a header/query.
 */
import jwt from 'jsonwebtoken';
import { rawFetch } from '../helpers/client';
import {
  TEST_JWT_SECRET,
  mintAuthentikToken,
  mintSessionToken,
  mintTestToken,
} from '../helpers/auth';

const ORG = 'org_01test00000000tokshape0000';
const ORG_OTHER = 'org_01test00000000tokother0000';
const USER = 'usr_01test00000000tokshape0000';

const LIST = '/v1/selection-lists';

async function listWith(token: string, headers: Record<string, string> = {}) {
  return rawFetch(LIST, { method: 'GET', token, headers });
}

function expect401(res: { status: number; body: unknown }) {
  expect(res.status).toBe(401);
  expect((res.body as { code?: string }).code).toBe('UNAUTHENTICATED');
}

describe('real token shapes (review I-1)', () => {
  it('the org-session token a real user presents is served', async () => {
    const res = await listWith(mintTestToken({ userId: USER, organizationId: ORG }));
    expect(res.status).toBe(200);
  });

  it('the Authentik-shaped token the published contract describes is served', async () => {
    const res = await listWith(mintAuthentikToken({ userId: USER, organizationId: ORG }));
    expect(res.status).toBe(200);
  });

  it('a plain session token {userId, sessionId, tid} is authenticated but has no org: 401', async () => {
    expect401(await listWith(mintSessionToken(USER)));
  });

  it('`tid` is NOT an org: a session token whose tid is an org id is still 401', async () => {
    expect401(await listWith(mintSessionToken(USER, { tid: ORG })));
    expect401(await listWith(mintSessionToken(USER, { tid: '5c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f' })));
  });

  it('a forged org header on an org-less session token does not supply an org', async () => {
    const res = await listWith(mintSessionToken(USER), {
      'X-Organization-Id': ORG,
      'X-Org-Id': ORG,
      'X-FF-Org-Id': ORG,
      'X-Tenant-Id': ORG,
    });
    expect401(res);
  });

  it('a forged org header cannot move a valid token to another org', async () => {
    // Same user, two orgs. A list created in ORG must not be visible when the
    // caller (token bound to ORG_OTHER) sends a header naming ORG.
    const key = 'tokshape-' + Math.random().toString(16).slice(2, 8);
    const mine = mintTestToken({ userId: USER, organizationId: ORG });
    const created = await rawFetch(LIST, {
      method: 'POST',
      token: mine,
      body: JSON.stringify({ key, name: 'Token shape probe', source_locale: 'en' }),
    });
    expect(created.status).toBe(201);
    const id = (created.body as { id: string }).id;
    try {
      const other = mintTestToken({ userId: USER, organizationId: ORG_OTHER });
      const res = await rawFetch(`${LIST}/${id}`, {
        method: 'GET',
        token: other,
        headers: { 'X-Organization-Id': ORG, 'X-Org-Id': ORG },
      });
      expect(res.status).toBe(404);
    } finally {
      await rawFetch(`${LIST}/${id}`, { method: 'DELETE', token: mine });
    }
  });
});

describe('algorithm pin and token kind (review L-2)', () => {
  const claims = { userId: USER, orgId: ORG };

  it('HS256 is accepted', async () => {
    const res = await listWith(jwt.sign(claims, TEST_JWT_SECRET, { algorithm: 'HS256' }));
    expect(res.status).toBe(200);
  });

  it('HS384 and HS512 signed with the right secret are refused', async () => {
    for (const algorithm of ['HS384', 'HS512'] as const) {
      expect401(await listWith(jwt.sign(claims, TEST_JWT_SECRET, { algorithm })));
    }
  });

  it('an unsigned alg=none token is refused', async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    expect401(await listWith(`${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.`));
  });

  it('a workload token (kind=fuze-workload) is refused even with an org claim', async () => {
    const t = jwt.sign(
      { kind: 'fuze-workload', sub: 'billing-service', aud: 'fuzefront-services', scope: 'x', orgId: ORG },
      TEST_JWT_SECRET,
      { expiresIn: '10m', issuer: 'fuzefront-security' },
    );
    expect401(await listWith(t));
  });

  it('a delegation token (kind=fuze-delegation) is refused even with an org claim', async () => {
    const t = jwt.sign(
      {
        kind: 'fuze-delegation',
        sub: USER,
        aud: 'service:selection-list-service',
        scope: 'x',
        tenantId: ORG,
        orgId: ORG,
        act: { sub: 'some-service' },
        jti: 'j',
      },
      TEST_JWT_SECRET,
      { expiresIn: '5m' },
    );
    expect401(await listWith(t));
  });

  it('two disagreeing org claims are refused rather than guessed', async () => {
    const t = jwt.sign({ userId: USER, orgId: ORG, organization_id: ORG_OTHER }, TEST_JWT_SECRET, {
      expiresIn: '5m',
    });
    expect401(await listWith(t));
  });
});
