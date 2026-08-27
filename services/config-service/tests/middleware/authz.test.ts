import { Request, Response } from 'express';
import { AuthzCheck, AuthzClient, AuthzError } from '@fuzefront/auth';
import { _setAuthzClientForTesting, makeNoOpProxy, requireConfigPermission } from '../../src/middleware/authz';

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    params: {},
    headers: { authorization: 'Bearer test-token' },
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response & { statusCode?: number; body?: unknown } {
  const res: any = {};
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((body: unknown) => {
    res.body = body;
    return res;
  });
  return res;
}

describe('requireConfigPermission', () => {
  afterEach(() => {
    // Restore the default no-op (allow-all, test-mode) client between tests.
    _setAuthzClientForTesting(makeNoOpProxy());
  });

  it('401s when req.identity is missing (requireAuth must run first)', async () => {
    const middleware = requireConfigPermission('ConfigScope', 'read');
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() when the Security API allows', async () => {
    _setAuthzClientForTesting({
      check: jest.fn().mockResolvedValue({ allow: true }),
      bulkCheck: jest.fn(),
    } as unknown as AuthzClient);
    const middleware = requireConfigPermission('ConfigScope', 'read');
    const req = makeReq({ identity: { userId: 'usr_1', tenantId: null, roles: [], authMode: 'legacy-hs256' } } as any);
    const res = makeRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('403s (does not call next) when the Security API denies', async () => {
    const check = jest.fn().mockResolvedValue({ allow: false });
    _setAuthzClientForTesting({ check, bulkCheck: jest.fn() } as unknown as AuthzClient);
    const middleware = requireConfigPermission('ConfigScope', 'read');
    const req = makeReq({
      identity: { userId: 'usr_1', tenantId: 'org_1', roles: [], authMode: 'legacy-hs256' },
      orgId: 'org_1',
    } as any);
    const res = makeRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(res.statusCode).toBe(403);
    expect((res.body as any).code).toBe('FORBIDDEN');
    expect(next).not.toHaveBeenCalled();
    const [check1, token1] = check.mock.calls[0] as [AuthzCheck, string];
    expect(check1).toEqual({
      subject: 'usr_1',
      tenant: 'org_1',
      resource: { type: 'ConfigScope', key: undefined },
      action: 'read',
    });
    expect(token1).toBe('test-token');
  });

  it('fails CLOSED (403) when the Security API client throws AuthzError(DECISION_UNAVAILABLE) — timeout/unreachable', async () => {
    _setAuthzClientForTesting({
      check: jest
        .fn()
        .mockRejectedValue(
          new AuthzError('DECISION_UNAVAILABLE', 'Security API request failed: timeout; denying.'),
        ),
      bulkCheck: jest.fn(),
    } as unknown as AuthzClient);
    const middleware = requireConfigPermission('ConfigScope', 'read');
    const req = makeReq({ identity: { userId: 'usr_1', tenantId: null, roles: [], authMode: 'legacy-hs256' } } as any);
    const res = makeRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('derives the resource-instance key via resourceKeyOf when supplied', async () => {
    const check = jest.fn().mockResolvedValue({ allow: true });
    _setAuthzClientForTesting({ check, bulkCheck: jest.fn() } as unknown as AuthzClient);
    const middleware = requireConfigPermission('ConfigCatalog', 'read', (req) => (req.params as any).namespace);
    const req = makeReq({
      identity: { userId: 'usr_1', tenantId: null, roles: [], authMode: 'legacy-hs256' },
      params: { namespace: 'fuzefront.chat' },
    } as any);
    const res = makeRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(check).toHaveBeenCalledWith(
      {
        subject: 'usr_1',
        tenant: 'platform',
        resource: { type: 'ConfigCatalog', key: 'fuzefront.chat' },
        action: 'read',
      },
      'test-token',
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('falls back to the "platform" tenant when the identity has no tenantId', async () => {
    const check = jest.fn().mockResolvedValue({ allow: true });
    _setAuthzClientForTesting({ check, bulkCheck: jest.fn() } as unknown as AuthzClient);
    const middleware = requireConfigPermission('ConfigScope', 'read');
    const req = makeReq({ identity: { userId: 'usr_1', tenantId: null, roles: [], authMode: 'legacy-hs256' } } as any);
    const res = makeRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(check).toHaveBeenCalledWith(
      { subject: 'usr_1', tenant: 'platform', resource: { type: 'ConfigScope', key: undefined }, action: 'read' },
      'test-token',
    );
  });
});
